const TARGET_RATE = 16_000

/**
 * Decodifica el audio de una nota (webm/opus) a PCM 16 kHz mono int16.
 *
 * Se hace en el renderer porque Chromium es el único que trae decodificador de
 * Opus: whisper.cpp solo lee WAV/MP3/FLAC y el proceso principal no tiene
 * ffmpeg. Los bytes llegan por IPC en lugar de `fetch` porque la CSP del
 * renderer no permite `connect-src` hacia el protocolo propio del audio.
 */
export async function decodeAudioToPcm(bytes: ArrayBuffer): Promise<Int16Array> {
  if (bytes.byteLength === 0) throw new Error('El audio de la nota está vacío')

  // decodeAudioData remuestrea a la frecuencia del contexto y mezcla a mono.
  const context = new OfflineAudioContext(1, TARGET_RATE, TARGET_RATE)
  let decoded: AudioBuffer
  try {
    decoded = await context.decodeAudioData(bytes)
  } catch {
    throw new Error('No se pudo decodificar el audio de la nota (¿archivo dañado?)')
  }

  const channel = decoded.getChannelData(0)
  const output = new Int16Array(channel.length)
  for (let i = 0; i < channel.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, channel[i]))
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return output
}
