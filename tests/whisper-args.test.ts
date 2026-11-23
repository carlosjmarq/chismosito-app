import { describe, expect, it } from 'vitest'
import {
  buildWhisperArgs,
  parseSegmentLine,
  type WhisperRunOptions
} from '../src/main/whisper/runner'
import { VAD_MODEL } from '../src/shared/whisper-vad'

const base: WhisperRunOptions = {
  cliPath: 'whisper-cli.exe',
  modelPath: 'ggml-large-v3-q5_0.bin',
  wavPath: 'audio.wav',
  language: 'es',
  device: 'cuda',
  threads: 8
}

function args(overrides: Partial<WhisperRunOptions> = {}): string[] {
  return buildWhisperArgs({ ...base, ...overrides }, 'result')
}

describe('buildWhisperArgs', () => {
  it('arma los argumentos base', () => {
    expect(args()).toEqual([
      '-m',
      'ggml-large-v3-q5_0.bin',
      '-f',
      'audio.wav',
      '-l',
      'es',
      '-t',
      '8',
      '-oj',
      '-of',
      'result',
      '-pp'
    ])
  })

  it('no usa contexto, entropía baja ni VAD si no se piden', () => {
    const list = args()
    expect(list).not.toContain('--vad')
    expect(list).not.toContain('-mc')
    expect(list).not.toContain('-et')
    expect(list).not.toContain('-ng')
  })

  it('activa los flags anti-bucle en modo sin contexto', () => {
    const list = args({ noContext: true })
    expect(list[list.indexOf('-mc') + 1]).toBe('0')
    expect(list[list.indexOf('-et') + 1]).toBe('2.0')
    expect(list).toContain('-sns')
  })

  it('agrega VAD con su modelo', () => {
    const list = args({
      noContext: true,
      vadModelPath: 'C:\\whisper\\ggml-silero-v6.2.0.bin'
    })
    expect(list).toContain('--vad')
    expect(list[list.indexOf('-vm') + 1]).toBe('C:\\whisper\\ggml-silero-v6.2.0.bin')
  })

  it('fuerza CPU y respeta el idioma', () => {
    expect(args({ device: 'cpu' })).toContain('-ng')
    expect(args({ language: '' }).slice(4, 6)).toEqual(['-l', 'es'])
  })

  it('nunca pasa menos de un hilo', () => {
    const list = args({ threads: 0 })
    expect(list[list.indexOf('-t') + 1]).toBe('1')
  })
})

describe('parseSegmentLine', () => {
  it('lee una línea de segmento de whisper', () => {
    expect(
      parseSegmentLine('[00:00:12.000 --> 00:00:18.400]   Hola a todos, empezamos.')
    ).toEqual({ fromMs: 12_000, toMs: 18_400, text: 'Hola a todos, empezamos.' })
  })

  it('acepta horas y descarta líneas que no son segmentos', () => {
    expect(parseSegmentLine('[01:02:03.500 --> 01:02:07.000] Retomamos.')).toEqual({
      fromMs: 3_723_500,
      toMs: 3_727_000,
      text: 'Retomamos.'
    })
    expect(parseSegmentLine('progress = 42%')).toBeNull()
    expect(parseSegmentLine('[00:00:00.000 --> 00:00:01.000]   ')).toBeNull()
    expect(parseSegmentLine('texto suelto')).toBeNull()
  })
})

describe('VAD_MODEL', () => {
  it('apunta al modelo de silero del repo de whisper.cpp', () => {
    expect(VAD_MODEL.file).toBe('ggml-silero-v6.2.0.bin')
    expect(VAD_MODEL.bytes).toBe(885_098)
    expect(VAD_MODEL.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(VAD_MODEL.url).toBe(
      'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin'
    )
  })
})
