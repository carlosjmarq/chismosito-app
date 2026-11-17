import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { downloadModelFile, sha256File } from '../src/main/whisper/download'

const CONTENT = Buffer.alloc(64 * 1024, 7)
const HASH = createHash('sha256').update(CONTENT).digest('hex')

let root = ''
let server: Server | null = null
let baseUrl = ''
let requests: Array<{ range: string | null }> = []

async function startServer(
  body: Buffer,
  options: { ignoreRange?: boolean } = {}
): Promise<void> {
  requests = []
  server = createServer((request, response) => {
    const range = (request.headers.range as string | undefined) ?? null
    requests.push({ range })
    if (range && !options.ignoreRange) {
      const start = Number(range.replace(/bytes=(\d+)-/, '$1'))
      response.writeHead(206, {
        'Content-Length': String(body.length - start),
        'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}`,
        'Content-Type': 'application/octet-stream'
      })
      response.end(body.subarray(start))
      return
    }
    response.writeHead(200, {
      'Content-Length': String(body.length),
      'Content-Type': 'application/octet-stream'
    })
    response.end(body)
  })
  await new Promise<void>((resolvePromise) => server!.listen(0, '127.0.0.1', resolvePromise))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('servidor sin puerto')
  baseUrl = `http://127.0.0.1:${address.port}/model.bin`
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chismosito-download-'))
})

afterEach(async () => {
  rmSync(root, { recursive: true, force: true })
  if (server) {
    await new Promise<void>((resolvePromise) => server!.close(() => resolvePromise()))
    server = null
  }
})

describe('downloadModelFile', () => {
  it('descarga, verifica el sha256 y deja el archivo final', async () => {
    await startServer(CONTENT)
    const target = join(root, 'model.bin')
    const phases: string[] = []

    await downloadModelFile({
      url: baseUrl,
      target,
      expectedBytes: CONTENT.length,
      sha256: HASH,
      onProgress: (update) => {
        if (phases[phases.length - 1] !== update.phase) phases.push(update.phase)
      }
    })

    expect(existsSync(target)).toBe(true)
    expect(existsSync(`${target}.part`)).toBe(false)
    expect(readFileSync(target).equals(CONTENT)).toBe(true)
    expect(phases).toEqual(['downloading', 'verifying'])
    expect(await sha256File(target)).toBe(HASH)
  })

  it('reanuda desde un .part existente con Range', async () => {
    await startServer(CONTENT)
    const target = join(root, 'model.bin')
    const half = Math.floor(CONTENT.length / 2)
    writeFileSync(`${target}.part`, CONTENT.subarray(0, half))

    await downloadModelFile({
      url: baseUrl,
      target,
      expectedBytes: CONTENT.length,
      sha256: HASH
    })

    expect(requests[0]?.range).toBe(`bytes=${half}-`)
    expect(readFileSync(target).equals(CONTENT)).toBe(true)
  })

  it('reinicia si el servidor ignora el Range', async () => {
    await startServer(CONTENT, { ignoreRange: true })
    const target = join(root, 'model.bin')
    writeFileSync(`${target}.part`, Buffer.alloc(1000, 1))

    await downloadModelFile({
      url: baseUrl,
      target,
      expectedBytes: CONTENT.length,
      sha256: HASH
    })

    expect(readFileSync(target).equals(CONTENT)).toBe(true)
  })

  it('descarta el archivo cuando el sha256 no coincide', async () => {
    await startServer(CONTENT)
    const target = join(root, 'model.bin')

    await expect(
      downloadModelFile({
        url: baseUrl,
        target,
        expectedBytes: CONTENT.length,
        sha256: '0'.repeat(64),
        retries: 0
      })
    ).rejects.toThrow(/sha256/)

    expect(existsSync(target)).toBe(false)
    expect(existsSync(`${target}.part`)).toBe(false)
  })

  it('falla si el tamaño descargado no es el esperado', async () => {
    await startServer(CONTENT)
    const target = join(root, 'model.bin')

    await expect(
      downloadModelFile({
        url: baseUrl,
        target,
        expectedBytes: CONTENT.length + 10,
        retries: 0
      })
    ).rejects.toThrow(/Tamaño inesperado/)
  })

  it('propaga el abort', async () => {
    await startServer(CONTENT)
    const target = join(root, 'model.bin')
    const controller = new AbortController()
    controller.abort()

    await expect(
      downloadModelFile({
        url: baseUrl,
        target,
        expectedBytes: CONTENT.length,
        signal: controller.signal
      })
    ).rejects.toThrow()
    expect(existsSync(target)).toBe(false)
  })
})
