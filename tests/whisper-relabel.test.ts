import { describe, expect, it } from 'vitest'
import { assignSpeakers, parseSpeakerTimeline } from '../src/main/whisper/relabel'

describe('parseSpeakerTimeline', () => {
  it('lee los cambios de hablante con mm:ss y hh:mm:ss', () => {
    const timeline = parseSpeakerTimeline(
      [
        '[00:00:12] **Yo:** Hola a todos.',
        '[00:00:31] **Otros:** Buenas.',
        '[01:02:03] **Yo:** Retomamos.'
      ].join('\n')
    )
    expect(timeline).toEqual([
      { fromMs: 12_000, speaker: 'Yo' },
      { fromMs: 31_000, speaker: 'Otros' },
      { fromMs: 3_723_000, speaker: 'Yo' }
    ])
  })

  it('colapsa hablantes repetidos y tolera texto plano', () => {
    const timeline = parseSpeakerTimeline(
      '[00:01] **Otros:** a\n[00:05] **Otros:** b\n[00:09] **Yo:** c\nsin marcas aquí'
    )
    expect(timeline).toEqual([
      { fromMs: 1_000, speaker: 'Otros' },
      { fromMs: 9_000, speaker: 'Yo' }
    ])
    expect(parseSpeakerTimeline('')).toEqual([])
    expect(parseSpeakerTimeline(null)).toEqual([])
  })
})

describe('assignSpeakers', () => {
  const segments = [
    { fromMs: 0, toMs: 5_000, text: 'Hola a todos.' },
    { fromMs: 20_000, toMs: 26_000, text: 'Buenas.' },
    { fromMs: 45_000, toMs: 49_000, text: 'Retomamos.' },
    { fromMs: 60_000, toMs: 62_000, text: '[BLANK_AUDIO]' }
  ]

  it('usa el hablante vigente del timeline anterior', () => {
    const timeline = parseSpeakerTimeline(
      '[00:00:00] **Yo:** hola\n[00:00:15] **Otros:** buenas\n[00:00:40] **Yo:** retomamos'
    )
    const result = assignSpeakers(segments, timeline)
    expect(result.map((segment) => segment.speaker)).toEqual(['Yo', 'Otros', 'Yo'])
    // Los segmentos de ruido se descartan.
    expect(result).toHaveLength(3)
  })

  it('sin timeline cae al hablante por defecto', () => {
    const result = assignSpeakers(segments, [])
    expect(result.every((segment) => segment.speaker === 'Otros')).toBe(true)
    expect(assignSpeakers(segments, [], 'Yo')[0].speaker).toBe('Yo')
  })

  it('elige el hablante más cercano entre dos marcas', () => {
    const timeline = parseSpeakerTimeline(
      '[00:00:00] **Yo:** a\n[00:00:40] **Otros:** b'
    )
    const [close, far] = assignSpeakers(
      [
        { fromMs: 36_000, toMs: 38_000, text: 'cerca del cambio' },
        { fromMs: 5_000, toMs: 6_000, text: 'cerca del inicio' }
      ],
      timeline
    )
    expect(close.speaker).toBe('Otros')
    expect(far.speaker).toBe('Yo')
  })
})
