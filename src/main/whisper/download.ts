import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type DownloadPhase = 'downloading' | 'verifying'

export interface DownloadProgressUpdate {
  receivedBytes: number
  totalBytes: number
  phase: DownloadPhase
}

export interface DownloadRequest {
  url: string
  target: string
  expectedBytes: number
  sha256?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  onProgress?: (update: DownloadProgressUpdate) => void
  /** Reintentos completos si el hash no coincide. */
  retries?: number
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

class Counter extends Transform {
  constructor(private readonly onBytes: (bytes: number) => void) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.onBytes(chunk.length)
    this.push(chunk)
    callback()
  }
}

/**
 * Descarga un modelo con reanudación (Range sobre `.part`), verificación de
 * tamaño y sha256, y renombrado atómico. Si el hash no coincide borra el
 * archivo y reintenta desde cero (una vez por defecto).
 */
export async function downloadModelFile(request: DownloadRequest): Promise<void> {
  const fetchImpl = request.fetchImpl ?? fetch
  const part = `${request.target}.part`
  const retries = request.retries ?? 1

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let offset = 0
    if (existsSync(part)) {
      try {
        offset = (await stat(part)).size
      } catch {
        offset = 0
      }
    }
    if (offset >= request.expectedBytes) offset = 0

    if (offset < request.expectedBytes) {
      request.onProgress?.({
        receivedBytes: offset,
        totalBytes: request.expectedBytes,
        phase: 'downloading'
      })

      const headers: Record<string, string> = {}
      if (offset > 0) headers.Range = `bytes=${offset}-`
      const response = await fetchImpl(request.url, {
        headers,
        redirect: 'follow',
        signal: request.signal
      })
      if (!response.ok || !response.body) {
        throw new Error(`No se pudo descargar el modelo (HTTP ${response.status})`)
      }
      const resumed = response.status === 206
      if (!resumed) offset = 0

      let received = offset
      let lastEmit = 0
      const counter = new Counter((bytes) => {
        received += bytes
        const now = Date.now()
        if (now - lastEmit > 200) {
          lastEmit = now
          request.onProgress?.({
            receivedBytes: received,
            totalBytes: Math.max(request.expectedBytes, received),
            phase: 'downloading'
          })
        }
      })

      await pipeline(
        Readable.fromWeb(response.body as never),
        counter,
        createWriteStream(part, { flags: offset > 0 ? 'a' : 'w' })
      )
    }

    const size = (await stat(part)).size
    if (size !== request.expectedBytes) {
      await rm(part, { force: true })
      if (attempt >= retries) {
        throw new Error(
          `Tamaño inesperado del modelo (${size} bytes; se esperaban ${request.expectedBytes}).`
        )
      }
      continue
    }

    request.onProgress?.({
      receivedBytes: size,
      totalBytes: size,
      phase: 'verifying'
    })

    if (request.sha256) {
      const actual = await sha256File(part)
      if (actual !== request.sha256) {
        await rm(part, { force: true })
        if (attempt >= retries) {
          throw new Error('El modelo descargado no coincide con el sha256 esperado; se descartó.')
        }
        continue
      }
    }

    await rename(part, request.target)
    request.onProgress?.({ receivedBytes: size, totalBytes: size, phase: 'verifying' })
    return
  }

  throw new Error('No se pudo descargar el modelo')
}
