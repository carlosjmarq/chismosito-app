import type { RawSegment } from './runner'
import { cleanSegmentText, type Speaker, type SpeakerSegment } from './merge'

export interface SpeakerTimelineEntry {
  fromMs: number
  speaker: Speaker
}

const LINE = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*\*\*(yo|otros)\s*:?\*\*/i

function timestampToMs(value: string): number {
  const parts = value.split(':').map((part) => Number(part))
  if (parts.some((part) => !Number.isFinite(part))) return 0
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
  return 0
}

/**
 * Extrae los cambios de hablante de una transcripción existente
 * (`[00:12] **Yo:** hola`). Sirve para conservar la separación «Yo/Otros»
 * cuando el audio disponible ya viene mezclado y solo hay una pista.
 */
export function parseSpeakerTimeline(markdown: string | null | undefined): SpeakerTimelineEntry[] {
  if (!markdown) return []
  const entries: SpeakerTimelineEntry[] = []
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = line.match(LINE)
    if (!match) continue
    const speaker: Speaker = match[2].toLowerCase().startsWith('yo') ? 'Yo' : 'Otros'
    const fromMs = timestampToMs(match[1])
    const previous = entries[entries.length - 1]
    if (previous && previous.speaker === speaker) continue
    entries.push({ fromMs, speaker })
  }
  return entries
}

export function nearestSpeaker(entries: SpeakerTimelineEntry[], fromMs: number): Speaker | null {
  if (entries.length === 0) return null
  let previous: SpeakerTimelineEntry | null = null
  for (const entry of entries) {
    if (entry.fromMs <= fromMs + 1_500) {
      previous = entry
      continue
    }
    if (!previous) return entry.speaker
    const distanceToPrevious = Math.abs(fromMs - previous.fromMs)
    const distanceToNext = Math.abs(entry.fromMs - fromMs)
    return distanceToPrevious <= distanceToNext ? previous.speaker : entry.speaker
  }
  return previous?.speaker ?? null
}

/**
 * Asigna hablantes a los segmentos nuevos usando el timeline de la
 * transcripción anterior. Si no hay timeline, todo queda como `fallback`.
 */
export function assignSpeakers(
  segments: RawSegment[],
  timeline: SpeakerTimelineEntry[],
  fallback: Speaker = 'Otros'
): SpeakerSegment[] {
  return segments
    .map((segment) => {
      const text = cleanSegmentText(segment.text)
      if (!text) return null
      const speaker = nearestSpeaker(timeline, Math.max(0, segment.fromMs)) ?? fallback
      return {
        speaker,
        fromMs: Math.max(0, segment.fromMs),
        toMs: Math.max(segment.fromMs, segment.toMs),
        text
      } satisfies SpeakerSegment
    })
    .filter((segment): segment is SpeakerSegment => segment !== null)
}
