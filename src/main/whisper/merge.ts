import type { RawSegment } from './runner'

export type Speaker = 'Yo' | 'Otros' | 'Mixto'

export interface SpeakerSegment {
  speaker: Speaker
  fromMs: number
  toMs: number
  text: string
}

const NOISE = [
  /^\[?\s*(blank_audio|blank audio|silencio|silence|música|music|applause|aplausos|risas|laughter)\s*\]?$/i,
  /^[\[(].{0,20}[\])]$/,
  /subtítulos realizados por la comunidad de amara\.?org/i,
  /subtitles by the amara\.?org community/i,
  /gracias por ver el (video|vídeo)\.?$/i,
  /thanks for watching!?$/i,
  /^♪+$/,
  /^\.+$/
]

/**
 * Detecta los bucles típicos de whisper cuando recibe silencio o audio
 * corrupto: "Pero cuando... Pero cuando..." o "No, no, no, no...".
 */
export function isRepetitiveText(text: string): boolean {
  const tokens = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  if (tokens.length < 8) return false

  const uniqueRatio = new Set(tokens).size / tokens.length
  if (tokens.length >= 10 && uniqueRatio < 0.3) return true

  for (let size = 2; size <= 4; size += 1) {
    let run = 1
    for (let i = size; i + size <= tokens.length; i += 1) {
      const previous = tokens.slice(i - size, i).join(' ')
      const current = tokens.slice(i, i + size).join(' ')
      if (previous === current) {
        run += 1
        if (run >= 4) return true
        i += size - 1
      } else {
        run = 1
      }
    }
  }

  return false
}

export function cleanSegmentText(text: string): string {
  const cleaned = text
    .replace(/^\s*[-–—]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return ''
  if (NOISE.some((pattern) => pattern.test(cleaned))) return ''
  if (isRepetitiveText(cleaned)) return ''
  return cleaned
}

function prepare(segments: RawSegment[], speaker: Speaker): SpeakerSegment[] {
  return segments
    .map((segment) => ({
      speaker,
      fromMs: Math.max(0, segment.fromMs),
      toMs: Math.max(segment.fromMs, segment.toMs),
      text: cleanSegmentText(segment.text)
    }))
    .filter((segment) => segment.text.length > 0)
}

export function mergeSpeakers(mic: RawSegment[], system: RawSegment[]): SpeakerSegment[] {
  const micPrepared = prepare(mic, 'Yo')
  const systemPrepared = prepare(system, 'Otros')
  const dedupedMic = removeEchoedMicSegments(micPrepared, systemPrepared)
  const all = [...dedupedMic, ...systemPrepared].sort((a, b) => {
    if (a.fromMs !== b.fromMs) return a.fromMs - b.fromMs
    return a.speaker === 'Yo' ? -1 : 1
  })

  const merged: SpeakerSegment[] = []
  for (const segment of all) {
    const previous = merged[merged.length - 1]
    const gap = previous ? segment.fromMs - previous.toMs : Number.POSITIVE_INFINITY
    const combinedLength = previous ? previous.text.length + segment.text.length : 0
    if (
      previous &&
      previous.speaker === segment.speaker &&
      gap <= 1800 &&
      combinedLength <= 600
    ) {
      previous.text = `${previous.text} ${segment.text}`.replace(/\s+/g, ' ').trim()
      previous.toMs = Math.max(previous.toMs, segment.toMs)
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

const MIN_REPEAT_CHARS = 12

/**
 * Whisper se queda en bucle con silencios largos y repite la misma frase.
 * Colapsa oraciones idénticas (consecutivas o no) dejando la primera, sin
 * tocar repeticiones cortas legítimas («Sí. Sí.»).
 */
export function collapseRepetitions(text: string): string {
  const sentences = text.split(/(?<=[.!?…])\s+/)
  if (sentences.length < 2) return text.trim()
  const seen = new Set<string>()
  const kept: string[] = []
  for (const sentence of sentences) {
    const value = sentence.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (value.length >= MIN_REPEAT_CHARS && seen.has(key)) continue
    if (value.length >= MIN_REPEAT_CHARS) seen.add(key)
    kept.push(value)
  }
  return kept.join(' ')
}

export function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function comparisonTokens(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
  )
}

function textSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  const containment = intersection / Math.min(a.size, b.size)
  const union = a.size + b.size - intersection
  const jaccard = intersection / union
  return Math.max(containment, jaccard)
}

function overlapRatio(a: SpeakerSegment, b: SpeakerSegment): number {
  const overlap = Math.min(a.toMs, b.toMs) - Math.max(a.fromMs, b.fromMs)
  if (overlap <= 0) return 0
  const shorter = Math.max(1, Math.min(a.toMs - a.fromMs, b.toMs - b.fromMs))
  return overlap / shorter
}

/**
 * When the audio comes out of the speakers, the microphone also captures the
 * system audio. Whisper then produces the same sentence twice ("Yo" and
 * "Otros"). This drops the microphone copy when both tracks overlap and say
 * essentially the same thing.
 */
function removeEchoedMicSegments(
  mic: SpeakerSegment[],
  system: SpeakerSegment[]
): SpeakerSegment[] {
  if (system.length === 0) return mic
  const systemTokens = system.map((segment) => comparisonTokens(segment.text))
  return mic.filter((segment) => {
    if (comparisonTokens(segment.text).size < 3) return true
    const tokens = comparisonTokens(segment.text)
    return !system.some((candidate, index) => {
      if (overlapRatio(segment, candidate) < 0.35) return false
      return textSimilarity(tokens, systemTokens[index]) >= 0.55
    })
  })
}

export interface RenderedTranscript {
  markdown: string
  plain: string
  lines: number
}

export function renderTranscript(segments: SpeakerSegment[]): RenderedTranscript {
  const markdownLines: string[] = []
  const plainLines: string[] = []
  let current: SpeakerSegment | null = null
  let currentStart = ''
  let lastText = ''

  const flush = (): void => {
    if (!current) return
    const text = collapseRepetitions(current.text)
    const key = text.toLowerCase()
    // Descarta líneas que repiten exactamente la anterior (bucle de whisper).
    if (text.length >= MIN_REPEAT_CHARS && key === lastText) {
      current = null
      return
    }
    lastText = key
    markdownLines.push(`[${currentStart}] **${current.speaker}:** ${text}`)
    plainLines.push(`[${currentStart}] ${current.speaker}: ${text}`)
    current = null
  }

  for (const segment of segments) {
    const start = formatTime(segment.fromMs / 1000)
    if (
      current &&
      current.speaker === segment.speaker &&
      segment.fromMs - current.toMs <= 2500 &&
      current.text.length + segment.text.length <= 700
    ) {
      current.text = `${current.text} ${segment.text}`.replace(/\s+/g, ' ').trim()
      current.toMs = segment.toMs
    } else {
      flush()
      current = { ...segment }
      currentStart = start
    }
  }
  flush()

  return {
    markdown: markdownLines.join('\n'),
    plain: plainLines.join('\n'),
    lines: markdownLines.length
  }
}
