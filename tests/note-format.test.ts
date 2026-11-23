import { describe, expect, it } from 'vitest'
import {
  buildNoteMarkdown,
  extractTranscript,
  parseNote,
  type SummaryData
} from '../src/main/notes/format'

const summary: SummaryData = {
  summary_bullets: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'],
  decisions: [{ decision: 'Lanzar la beta', context: 'Validar con clientes' }],
  action_items: [
    { task: 'Preparar la guía', owner: 'María', due_date: '2026-11-25' },
    { task: 'Revisar precios', owner: 'Sin asignar', due_date: null }
  ]
}

  const processingBase = {
    title: 'Planificación Q4',
    date: '2026-11-14T15:30:00-06:00',
    durationSeconds: 3_720,
    language: 'es',
    audio: '2026-11-14-15-30.webm',
    folder: '',
    tags: [],
    status: 'processing' as const,
    llm: null,
    summary: null,
    transcript: '',
    createdAt: '2026-11-14T15:30:00-06:00',
    updatedAt: '2026-11-14T15:30:00-06:00'
  }

describe('note markdown', () => {
  it('builds the summary, decisions, actions and transcript with a divider', () => {
    const markdown = buildNoteMarkdown({
      title: 'Planificación Q4',
      date: '2026-11-14T15:30:00-06:00',
      durationSeconds: 3_720,
      language: 'es',
      audio: '2026-11-14-15-30.webm',
      folder: 'Producto',
      suggestedFolder: 'Producto/Q4',
      suggestedFolderConfidence: 0.91,
      tags: ['q4', 'planning'],
      status: 'complete',
      llm: 'mock-model',
      summary,
      transcript: '[00:00:12] **Yo:** Hola.',
      createdAt: '2026-11-14T16:00:00-06:00',
      updatedAt: '2026-11-14T16:32:00-06:00'
    })

    const parsed = parseNote(markdown)
    expect(parsed.data.title).toBe('Planificación Q4')
    expect(parsed.data.audio).toBe('2026-11-14-15-30.webm')
    expect(parsed.data.folder).toBe('Producto')
    expect(parsed.data.suggested_folder).toBe('Producto/Q4')
    expect(parsed.data.suggested_folder_confidence).toBe(0.91)
    expect(parsed.data.tags).toEqual(['q4', 'planning'])
    expect(parsed.content).toContain('## Resumen')
    expect(parsed.content).toContain('- Cinco')
    expect(parsed.content).toContain('| Preparar la guía | María | 2026-11-25 |')
    expect(parsed.content).toContain('\n---\n')
    expect(extractTranscript(parsed.content)).toEqual([
      { timestamp: '00:00:12', seconds: 12, speaker: 'Yo', text: 'Hola.' }
    ])
  })

  it('writes a processing stub without inventing a summary', () => {
    const markdown = buildNoteMarkdown({
      title: 'Reunión',
      date: '2026-11-14T15:30:00-06:00',
      durationSeconds: 0,
      language: 'es',
      audio: null,
      folder: '',
      tags: [],
      status: 'processing',
      llm: null,
      summary: null,
      transcript: '',
      createdAt: '2026-11-14T16:00:00-06:00',
      updatedAt: '2026-11-14T16:00:00-06:00'
    })
    expect(markdown).toContain('Procesando la grabación')
    expect(markdown).toContain('## Transcripción')
    expect(markdown).not.toContain('## Decisiones')
  })

  it('conserva la transcripción mientras el resumen está pendiente', () => {
    const markdown = buildNoteMarkdown({
      ...processingBase,
      transcript: '[00:00:12] **Yo:** Hola a todos.'
    })
    expect(markdown).toContain('[00:00:12] **Yo:** Hola a todos.')
    expect(markdown).not.toContain('_(Pendiente)_')
    expect(markdown).toContain('Transcripción lista')
  })

  it('usa el placeholder cuando todavía no hay transcripción', () => {
    const markdown = buildNoteMarkdown({ ...processingBase, transcript: '' })
    expect(markdown).toContain('_(Pendiente)_')
    expect(markdown).toContain('Procesando la grabación')
  })

})
