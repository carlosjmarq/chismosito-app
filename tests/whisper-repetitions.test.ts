import { describe, expect, it } from 'vitest'
import {
  collapseRepetitions,
  renderTranscript,
  type SpeakerSegment
} from '../src/main/whisper/merge'

function segment(overrides: Partial<SpeakerSegment>): SpeakerSegment {
  return {
    speaker: 'Otros',
    fromMs: 0,
    toMs: 1_000,
    text: 'texto',
    ...overrides
  }
}

describe('collapseRepetitions', () => {
  it('colapsa una frase repetida en bucle', () => {
    const phrase = 'No, pero esa tesis la hiciste con guía.'
    const text = Array.from({ length: 8 }, () => phrase).join(' ')
    expect(collapseRepetitions(text)).toBe(phrase)
  })

  it('colapsa patrones A B A B repetidos', () => {
    const a = 'Primero revisamos el sprint completo.'
    const b = 'Y luego pasamos a los tickets abiertos.'
    const text = `${a} ${b} ${a} ${b} ${a} ${b}`
    expect(collapseRepetitions(text)).toBe(`${a} ${b}`)
  })

  it('respeta repeticiones cortas legítimas', () => {
    expect(collapseRepetitions('Sí. Sí. Sí.')).toBe('Sí. Sí. Sí.')
  })

  it('deja intacto un texto sin repeticiones', () => {
    const text = 'Hola a todos. Vamos a revisar el presupuesto del trimestre.'
    expect(collapseRepetitions(text)).toBe(text)
  })
})

describe('renderTranscript', () => {
  it('colapsa el bucle cuando los segmentos se fusionan en una línea', () => {
    const repeated = 'No, pero esa tesis la hiciste con guía. A mí no me vas a mentir.'
    const result = renderTranscript([
      segment({ fromMs: 0, toMs: 20_000, text: repeated }),
      segment({ fromMs: 20_000, toMs: 40_000, text: repeated }),
      segment({ fromMs: 40_000, toMs: 60_000, text: repeated }),
      segment({ fromMs: 60_000, toMs: 80_000, text: 'Y seguimos con el siguiente tema.' })
    ])

    const rendered = result.markdown.split('\n')
    expect(rendered).toHaveLength(1)
    expect(rendered[0].match(/esa tesis la hiciste con guía/g)).toHaveLength(1)
    expect(rendered[0]).toContain('Y seguimos con el siguiente tema.')
  })

  it('descarta líneas idénticas consecutivas de distinto hablante lejano', () => {
    const repeated = 'Estamos probando el micrófono de la sala grande.'
    const result = renderTranscript([
      segment({ speaker: 'Yo', fromMs: 0, toMs: 20_000, text: repeated }),
      segment({ speaker: 'Otros', fromMs: 40_000, toMs: 60_000, text: repeated })
    ])
    expect(result.markdown.split('\n')).toHaveLength(1)
  })

  it('mantiene el diálogo normal entre hablantes', () => {
    const result = renderTranscript([
      segment({ speaker: 'Yo', fromMs: 0, toMs: 5_000, text: 'Hola a todos.' }),
      segment({ speaker: 'Otros', fromMs: 6_000, toMs: 9_000, text: 'Buenas.' }),
      segment({ speaker: 'Yo', fromMs: 12_000, toMs: 16_000, text: 'Empezamos.' })
    ])
    expect(result.markdown.split('\n')).toHaveLength(3)
  })
})
