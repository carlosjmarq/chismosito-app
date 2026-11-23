import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { log } from '../lib/logger'

export interface RawSegment {
  fromMs: number
  toMs: number
  text: string
}

export interface WhisperRunOptions {
  cliPath: string
  modelPath: string
  wavPath: string
  language: string
  device: 'cpu' | 'cuda'
  threads: number
  /** Sin contexto previo: evita bucles de repetición en audio con silencios. */
  noContext?: boolean
  /** Modelo VAD (silero): corta el audio en tramos con voz. */
  vadModelPath?: string | null
  /** Se llama con cada segmento en cuanto whisper lo imprime (streaming). */
  onSegment?: (segment: RawSegment) => void
  signal?: AbortSignal
  onProgress?: (percent: number) => void
}

interface WhisperJsonSegment {
  offsets?: { from?: number; to?: number; from_ms?: number; to_ms?: number }
  timestamps?: { from?: string; to?: string }
  text?: string
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return 0
  const match = value.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/)
  if (!match) return 0
  return (
    Number(match[1]) * 3_600_000 +
    Number(match[2]) * 60_000 +
    Number(match[3]) * 1000 +
    Number(match[4])
  )
}

function segmentMs(segment: WhisperJsonSegment): { from: number; to: number } {
  const from =
    segment.offsets?.from_ms ??
    segment.offsets?.from ??
    parseTimestamp(segment.timestamps?.from)
  const to =
    segment.offsets?.to_ms ?? segment.offsets?.to ?? parseTimestamp(segment.timestamps?.to)
  return { from: Number(from) || 0, to: Number(to) || 0 }
}

const SEGMENT_LINE =
  /^\[(\d{1,2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{1,2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)$/

function timestampMs(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1_000 + Number(ms)
}

/** Parsea una línea de segmento que whisper imprime en stdout. */
export function parseSegmentLine(line: string): RawSegment | null {
  const match = line.match(SEGMENT_LINE)
  if (!match) return null
  const text = match[9].trim()
  if (!text) return null
  return {
    fromMs: timestampMs(match[1], match[2], match[3], match[4]),
    toMs: timestampMs(match[5], match[6], match[7], match[8]),
    text
  }
}

/**
 * Construye los argumentos de whisper-cli.
 *
 * En modo `noContext` se pasan `-mc 0` (sin contexto previo), `-et 2.0`
 * (umbral de entropía bajo) y `-sns` (sin tokens de no-habla): juntos evitan
 * que una alucinación se propague al resto de la transcripción. `--vad` usa
 * Silero para ignorar los silencios.
 */
export function buildWhisperArgs(options: WhisperRunOptions, outputBase: string): string[] {
  const args = [
    '-m',
    options.modelPath,
    '-f',
    options.wavPath,
    '-l',
    options.language || 'es',
    '-t',
    String(Math.max(1, options.threads)),
    '-oj',
    '-of',
    outputBase,
    '-pp'
  ]
  if (options.noContext) args.push('-mc', '0', '-et', '2.0', '-sns')
  if (options.vadModelPath) args.push('--vad', '-vm', options.vadModelPath)
  if (options.device === 'cpu') args.push('-ng')
  return args
}

export async function runWhisper(options: WhisperRunOptions): Promise<RawSegment[]> {
  if (!existsSync(options.cliPath)) {
    throw new Error('No se encontró whisper-cli.exe. Reinstala la aplicación.')
  }
  if (!existsSync(options.modelPath)) {
    throw new Error('El modelo de whisper no está descargado. Descárgalo en Ajustes.')
  }
  if (!existsSync(options.wavPath)) {
    throw new Error('No se encontró el audio a transcribir.')
  }

  const workDir = await mkdtemp(join(tmpdir(), 'chismosito-whisper-'))
  const outputBase = join(workDir, 'result')
  const vadModelPath =
    options.vadModelPath && existsSync(options.vadModelPath) ? options.vadModelPath : null
  if (!vadModelPath) {
    log.warn('Modelo VAD de Silero no encontrado; se transcribe sin detección de voz')
  }
  const args = buildWhisperArgs({ ...options, vadModelPath }, outputBase)

  log.info('whisper.cpp', args.join(' '))

  try {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(options.cliPath, args, {
        windowsHide: true,
        cwd: workDir
      })
      let stderr = ''
      let stdout = ''
      let stdoutPending = ''
      let lastPercent = -1
      let killedForAbort = false

      const handleOutput = (text: string): void => {
        const matches = [...text.matchAll(/progress\s*=\s*(\d+)%/g)]
        if (matches.length > 0) {
          const percent = Number(matches[matches.length - 1][1])
          if (percent !== lastPercent) {
            lastPercent = percent
            options.onProgress?.(percent)
          }
        }
      }

      // whisper imprime cada segmento en stdout en cuanto lo decodifica:
      //   [00:00:12.000 --> 00:00:18.400]   texto
      const parseSegments = (): void => {
        if (!options.onSegment) return
        const lines = stdoutPending.split(/\r?\n/)
        stdoutPending = lines.pop() ?? ''
        for (const line of lines) {
          const segment = parseSegmentLine(line)
          if (segment) options.onSegment(segment)
        }
      }

      child.stdout?.on('data', (chunk) => {
        const text = String(chunk)
        stdout += text
        stdoutPending += text
        parseSegments()
        handleOutput(stdout.slice(-400))
      })
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
        handleOutput(stderr.slice(-400))
      })

      const abort = (): void => {
        if (child.killed || killedForAbort) return
        killedForAbort = true
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true
          }).on('error', () => child.kill())
        } else {
          child.kill('SIGKILL')
        }
      }

      if (options.signal?.aborted) abort()
      options.signal?.addEventListener('abort', abort, { once: true })

      child.on('error', (error) => {
        options.signal?.removeEventListener('abort', abort)
        reject(new Error(`No se pudo ejecutar whisper.cpp: ${error.message}`))
      })

      child.on('close', (code) => {
        options.signal?.removeEventListener('abort', abort)
        if (killedForAbort || options.signal?.aborted) {
          reject(new Error('Transcripción cancelada'))
          return
        }
        if (code !== 0) {
          const tail = (stderr || stdout).trim().split(/\r?\n/).slice(-8).join('\n')
          reject(new Error(`whisper.cpp terminó con código ${code}${tail ? `:\n${tail}` : ''}`))
          return
        }
        resolvePromise()
      })
    })

    const jsonPath = `${outputBase}.json`
    if (!existsSync(jsonPath)) throw new Error('whisper.cpp no generó el archivo de transcripción')
    const parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as {
      transcription?: WhisperJsonSegment[]
      segments?: WhisperJsonSegment[]
    }
    const segments = parsed.transcription ?? parsed.segments ?? []
    const result: RawSegment[] = []
    for (const segment of segments) {
      const text = String(segment.text ?? '').trim()
      if (!text) continue
      const { from, to } = segmentMs(segment)
      result.push({ fromMs: from, toMs: to, text })
    }
    return result
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
