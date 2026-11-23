import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIN_TRACK_PEAK, wavPeak } from '../src/main/whisper/wav-peak'

let root = ''

function wav(sample: number, samples = 1000): string {
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(sample * 32767), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16_000, 24)
  header.writeUInt32LE(32_000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  const path = join(root, `v-${sample}.wav`)
  writeFileSync(path, Buffer.concat([header, data]))
  return path
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chismosito-peak-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('wavPeak', () => {
  it('mide el pico de una señal fuerte', async () => {
    expect(await wavPeak(wav(0.5))).toBeCloseTo(0.5, 2)
  })

  it('detecta silencio y ruido muy bajo', async () => {
    expect(await wavPeak(wav(0))).toBe(0)
    expect(await wavPeak(wav(0.001))).toBeLessThan(MIN_TRACK_PEAK)
  })

  it('usa el umbral para descartar pistas sin voz', () => {
    expect(MIN_TRACK_PEAK).toBeGreaterThan(0.001)
    expect(MIN_TRACK_PEAK).toBeLessThan(0.05)
  })
})
