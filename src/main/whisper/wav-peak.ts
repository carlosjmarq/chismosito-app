import { createReadStream } from 'node:fs'

/**
 * Pico absoluto de un WAV PCM 16-bit (0..1). Sirve para descartar pistas
 * prácticamente silenciosas: whisper inventa frases cuando le das solo ruido
 * de fondo, y eso aparecía como «Yo: ¡Gracias!» en notas con el micrófono
 * apagado o sin voz.
 */
export async function wavPeak(path: string): Promise<number> {
  let peak = 0
  let carried: Buffer | null = null

  const stream = createReadStream(path, { start: 44, highWaterMark: 1 << 20 })
  for await (const chunk of stream) {
    let buffer = chunk as Buffer
    if (carried) {
      buffer = Buffer.concat([carried, buffer])
      carried = null
    }
    const usable = buffer.length - (buffer.length % 2)
    for (let i = 0; i < usable; i += 2) {
      const sample = Math.abs(buffer.readInt16LE(i)) / 32_768
      if (sample > peak) peak = sample
    }
    if (usable < buffer.length) carried = Buffer.from(buffer.subarray(usable))
  }
  return peak
}

/** Umbral conservador: por debajo de esto no hay voz utilizable. */
export const MIN_TRACK_PEAK = 0.005
