/**
 * Nombres de las pistas separadas que se guardan junto al audio mezclado:
 * `<base>-yo.webm` (micrófono) y `<base>-otros.webm` (audio del sistema).
 *
 * Sirven para que una re-transcripción conserve la separación exacta de
 * hablantes en vez de adivinarla desde la transcripción anterior.
 */
export type RecordingTrack = 'you' | 'others'

export const TRACK_SUFFIX: Record<RecordingTrack, string> = {
  you: '-yo',
  others: '-otros'
}

export function trackFileName(audioFileName: string, track: RecordingTrack): string {
  const match = audioFileName.match(/^(.*?)(\.[^.]*)?$/)
  const stem = match?.[1] ?? audioFileName
  const ext = match?.[2] ?? '.webm'
  return `${stem}${TRACK_SUFFIX[track]}${ext}`
}

/** Devuelve los nombres de pista existentes (o null si no hay). */
export function trackFilesFor(
  audioFileName: string,
  exists: (fileName: string) => boolean
): { you: string | null; others: string | null } {
  const you = trackFileName(audioFileName, 'you')
  const others = trackFileName(audioFileName, 'others')
  return {
    you: exists(you) ? you : null,
    others: exists(others) ? others : null
  }
}
