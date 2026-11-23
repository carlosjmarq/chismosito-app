import matter from 'gray-matter'
import dayjs from 'dayjs'
import 'dayjs/locale/es'
import type { NoteStatus, TranscriptLine } from '@shared/types'

dayjs.locale('es')

export interface SummaryData {
  summary_bullets: string[]
  decisions: Array<{ decision: string; context?: string }>
  action_items: Array<{ task: string; owner: string; due_date: string | null }>
}

export interface NoteBuildInput {
  title: string
  date: string
  durationSeconds: number
  language: string
  audio: string | null
  folder: string
  suggestedFolder?: string | null
  suggestedFolderConfidence?: number | null
  tags: string[]
  status: NoteStatus
  llm: string | null
  summary: SummaryData | null
  transcript: string
  createdAt: string
  updatedAt: string
}

export interface ParsedNote {
  data: Record<string, unknown>
  content: string
  raw: string
}

const SAME_LINE = (value: string): string =>
  value.replace(/\s+/g, ' ').replace(/^#+\s*/, '').trim()

function quote(value: string): string {
  return JSON.stringify(SAME_LINE(value))
}

function serializeFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = ['---']
  const order = [
    'title',
    'date',
    'duration_seconds',
    'language',
    'audio',
    'folder',
    'suggested_folder',
    'suggested_folder_confidence',
    'tags',
    'source',
    'llm',
    'status',
    'created_at',
    'updated_at'
  ]
  const keys = [...order.filter((key) => key in data), ...Object.keys(data).filter((key) => !order.includes(key))]

  for (const key of keys) {
    const value = data[key]
    if (value === undefined) continue
    if (value === null) {
      lines.push(`${key}: null`)
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${JSON.stringify(value)}`)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${String(value)}`)
    } else if (Array.isArray(value)) {
      lines.push(`${key}: ${JSON.stringify(value.map((entry) => String(entry)))}`)
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

export function composeNote(data: Record<string, unknown>, content: string): string {
  return `${serializeFrontmatter(data)}\n\n${content.trim()}\n`
}

export function parseNote(raw: string): ParsedNote {
  const parsed = matter(raw)
  return { data: parsed.data as Record<string, unknown>, content: parsed.content.trim(), raw }
}

export function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  if (hours > 0) return `${hours} h ${minutes} min`
  if (minutes > 0) return `${minutes} min ${seconds} s`
  return `${seconds} s`
}

function tableCell(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

export function buildNoteMarkdown(input: NoteBuildInput): string {
  const title = SAME_LINE(input.title) || 'Reunión sin título'
  const dateLabel = dayjs(input.date).isValid()
    ? dayjs(input.date).format('D [de] MMMM [de] YYYY, HH:mm')
    : input.date

  const data: Record<string, unknown> = {
    title,
    date: input.date,
    duration_seconds: Math.max(0, Math.round(input.durationSeconds)),
    language: input.language,
    audio: input.audio,
    folder: input.folder,
    suggested_folder: input.suggestedFolder ?? null,
    suggested_folder_confidence: input.suggestedFolderConfidence ?? null,
    tags: input.tags,
    source: 'chismosito',
    llm: input.llm,
    status: input.status,
    created_at: input.createdAt,
    updated_at: input.updatedAt
  }

  const sections: string[] = [`# ${title} — ${dateLabel}`]

  if (input.status === 'processing' || input.status === 'recording') {
    const partialTranscript = (input.transcript ?? '').trim()
    if (partialTranscript) {
      // La transcripción ya existe (p. ej. al re-transcribir): no se descarta.
      sections.push(
        '> Transcripción lista. El resumen, las decisiones y las acciones aparecerán al terminar.'
      )
      sections.push('---')
      sections.push(`## Transcripción\n\n${partialTranscript}`)
      return composeNote(data, sections.join('\n\n'))
    }
    sections.push(
      '> Procesando la grabación… El resumen y la transcripción aparecerán aquí al terminar.'
    )
    sections.push('---')
    sections.push('## Transcripción\n\n_(Pendiente)_')
    return composeNote(data, sections.join('\n\n'))
  }

  if (input.summary) {
    const bullets = input.summary.summary_bullets.slice(0, 5)
    sections.push(
      `## Resumen\n\n${
        bullets.length > 0 ? bullets.map((bullet) => `- ${SAME_LINE(bullet)}`).join('\n') : '- Sin resumen disponible.'
      }`
    )

    const decisions = input.summary.decisions.filter((entry) => entry.decision?.trim())
    sections.push(
      `## Decisiones\n\n${
        decisions.length > 0
          ? decisions
              .map((entry) =>
                entry.context
                  ? `- **${SAME_LINE(entry.decision)}** — ${SAME_LINE(entry.context)}`
                  : `- **${SAME_LINE(entry.decision)}**`
              )
              .join('\n')
          : 'Sin decisiones registradas.'
      }`
    )

    const actions = input.summary.action_items.filter((entry) => entry.task?.trim())
    sections.push(
      `## Acciones\n\n| Acción | Responsable | Fecha límite |\n| --- | --- | --- |\n${
        actions.length > 0
          ? actions
              .map(
                (entry) =>
                  `| ${tableCell(entry.task)} | ${tableCell(entry.owner || 'Sin asignar')} | ${tableCell(
                    entry.due_date || '—'
                  )} |`
              )
              .join('\n')
          : '| Sin acciones asignadas | — | — |'
      }`
    )
  } else {
    sections.push('## Resumen\n\n_(Pendiente de generar)_')
  }

  sections.push('---')
  const transcript = input.transcript.trim()
  sections.push(`## Transcripción\n\n${transcript || '_(Sin transcripción)_'}`)

  return composeNote(data, sections.join('\n\n'))
}

const TRANSCRIPT_LINE = /^\[(\d{2}):(\d{2}):(\d{2})\]\s+\*\*(.+?):\*\*\s+(.*)$/

export function extractTranscript(content: string): TranscriptLine[] {
  const lines: TranscriptLine[] = []
  for (const line of content.split(/\r?\n/)) {
    const match = line.trim().match(TRANSCRIPT_LINE)
    if (!match) continue
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    lines.push({
      timestamp: `${match[1]}:${match[2]}:${match[3]}`,
      seconds,
      speaker: match[4].trim(),
      text: match[5].trim()
    })
  }
  return lines
}

function sectionBody(content: string, heading: string): string {
  const marker = `## ${heading}`
  const start = content.indexOf(marker)
  if (start < 0) return ''
  const lineEnd = content.indexOf('\n', start)
  if (lineEnd < 0) return ''
  const rest = content.slice(lineEnd + 1)
  const nextHeading = rest.search(/^##\s+/m)
  return nextHeading >= 0 ? rest.slice(0, nextHeading) : rest
}

function plainMarkdown(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractSummary(content: string): SummaryData {
  const summarySection = sectionBody(content, 'Resumen')
  const summary_bullets = summarySection
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1] ?? '')
    .filter((line) => line && !/^_\(.*\)_$/.test(line.trim()))
    .map((line) => plainMarkdown(line))
    .filter(Boolean)

  const decisionsSection = sectionBody(content, 'Decisiones')
  const decisions = decisionsSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) && !/^_\(.*\)_$/.test(line))
    .map((line) => {
      const body = line.replace(/^[-*]\s+/, '')
      const match = body.match(/^\*\*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$/)
      if (match) {
        const decision = plainMarkdown(match[1])
        const context = plainMarkdown(match[2])
        return decision ? { decision, ...(context ? { context } : {}) } : null
      }
      const decision = plainMarkdown(body)
      return decision ? { decision } : null
    })
    .filter((entry): entry is { decision: string; context?: string } => Boolean(entry))

  const actionsSection = sectionBody(content, 'Acciones')
  const action_items = actionsSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim()))
    .filter((cells) => cells.length >= 4)
    .map((cells) => {
      const task = plainMarkdown(cells[1] ?? '')
      const owner = plainMarkdown(cells[2] ?? '')
      const due = plainMarkdown(cells[3] ?? '')
      return {
        task,
        owner: owner || 'Sin asignar',
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null
      }
    })
    .filter(
      (entry) =>
        entry.task &&
        entry.task !== 'Acción' &&
        entry.task !== 'Sin acciones asignadas' &&
        !/^[-:]+$/.test(entry.task)
    )

  return { summary_bullets, decisions, action_items }
}

export function excerptFromContent(content: string, maxLength = 180): string {
  const cleaned = content
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/^---+$/gm, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\|[^\n]*\|/g, ' ')
    .replace(/_\([^)]*\)_/g, ' ')
    .replace(/\[\d{2}:\d{2}:\d{2}\]\s*/g, ' ')
    .replace(/\*\*[^*\n]+:\*\*\s*/g, ' ')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}…` : cleaned
}

export function stringField(data: Record<string, unknown>, key: string, fallback = ''): string {
  const value = data[key]
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return String(value)
  return fallback
}

export function numberField(data: Record<string, unknown>, key: string, fallback = 0): number {
  const value = data[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return fallback
}

export function tagsField(data: Record<string, unknown>): string[] {
  const value = data.tags
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return []
}

export function statusField(data: Record<string, unknown>): NoteStatus {
  const value = String(data.status ?? '')
  const allowed: NoteStatus[] = [
    'recording',
    'processing',
    'complete',
    'summary_failed',
    'transcription_failed',
    'cancelled'
  ]
  return (allowed as string[]).includes(value) ? (value as NoteStatus) : 'complete'
}
