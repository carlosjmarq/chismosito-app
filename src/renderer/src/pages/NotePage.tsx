import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  ArrowLeft,
  CloudUpload,
  Copy,
  ExternalLink,
  FileAudio,
  FileText,
  Folder,
  FolderPlus,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2
} from 'lucide-react'
import type { NoteDetail } from '@shared/types'
import { useAppStore } from '../store'
import { DurationBadge, StatusBadge } from '../components/StatusBadge'
import { DriveIcon } from '../components/NoteRow'
import { TranscriptView } from '../components/TranscriptView'
import { ChatPanel } from '../components/ChatPanel'
import { EditNoteModal } from '../components/EditNoteModal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ProgressBar } from '../components/ProgressBar'
import { noteDateLabel, formatDuration, formatClock } from '../lib/format'
import { decodeAudioToPcm } from '../lib/audio-decode'
import { errorMessage } from '../lib/errors'
import { cn } from '../lib/cn'

const EMPTY_LIVE: Array<{ speaker: 'Yo' | 'Otros'; fromMs: number; toMs: number; text: string }> = []

export function NotePage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams()
  const path = searchParams.get('path') ?? ''
  const activeTab = searchParams.get('tab') === 'chat' ? 'chat' : 'note'
  const navigate = useNavigate()
  const notesRevision = useAppStore((state) => state.notesRevision)
  const folders = useAppStore((state) => state.folders)
  const jobs = useAppStore((state) => state.jobs)
  const drive = useAppStore((state) => state.drive)
  const env = useAppStore((state) => state.env)
  const pushToast = useAppStore((state) => state.pushToast)
  const liveSegments = useAppStore((state) => state.liveTranscript[path] ?? EMPTY_LIVE)
  const refreshNotes = useAppStore((state) => state.refreshNotes)

  const [note, setNote] = useState<NoteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [confirmReprocess, setConfirmReprocess] = useState(false)
  const [confirmRetranscribe, setConfirmRetranscribe] = useState(false)
  const [busyRetranscribe, setBusyRetranscribe] = useState(false)
  const [busyBackup, setBusyBackup] = useState(false)
  const [busyRegenerate, setBusyRegenerate] = useState(false)
  const [busyReprocess, setBusyReprocess] = useState(false)
  const [busySuggestion, setBusySuggestion] = useState(false)
  const [chatThreadId, setChatThreadId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const liveRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!path) {
      setError('No se indicó una nota')
      setLoading(false)
      return
    }
    try {
      const detail = await window.chismosito.notes.get(path)
      if (!detail) {
        setError('La nota no existe o fue movida')
        setNote(null)
      } else {
        setNote(detail)
        setError(null)
      }
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load, notesRevision])

  useEffect(() => {
    if (liveRef.current) liveRef.current.scrollTop = liveRef.current.scrollHeight
  }, [liveSegments.length])

  useEffect(() => {
    if (activeTab !== 'chat') return
    if (!note || note.status === 'processing' || note.status === 'recording') return
    if (note.transcript.length === 0) return
    let cancelled = false
    setChatThreadId(null)
    window.chismosito.chat
      .open({ scope: 'note', notePath: note.path })
      .then((thread) => {
        if (!cancelled) setChatThreadId(thread.id)
      })
      .catch((chatError) => {
        if (!cancelled) pushToast('error', errorMessage(chatError))
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, note?.path, note?.status, pushToast])

  const switchTab = (tab: 'note' | 'chat'): void => {
    const next = new URLSearchParams(searchParams)
    if (tab === 'chat') next.set('tab', 'chat')
    else next.delete('tab')
    setSearchParams(next, { replace: true })
  }

  const job = jobs.find((entry) => entry.notePath === path)
  const jobActive = Boolean(job && !['done', 'failed', 'cancelled'].includes(job.stage))
  const processing = note?.status === 'processing' || jobActive

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <div className="shimmer h-5 w-28 rounded-lg" />
        <div className="shimmer mt-4 h-10 w-3/4 rounded-xl" />
        <div className="shimmer mt-3 h-4 w-1/2 rounded-lg" />
        <div className="shimmer mt-8 h-24 rounded-2xl" />
        <div className="shimmer mt-6 h-64 rounded-3xl" />
      </div>
    )
  }

  if (!note) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center gap-4 px-8 text-center">
        <AlertTriangle className="size-8 text-gold" />
        <h1 className="font-serif text-2xl">{error ?? 'Nota no encontrada'}</h1>
        <Link to="/library" className="btn-secondary">
          Volver a la biblioteca
        </Link>
      </div>
    )
  }

  const transcriptIndex = note.content.indexOf('## Transcripción')
  const beforeTranscript = transcriptIndex >= 0 ? note.content.slice(0, transcriptIndex) : note.content
  const summaryContent = beforeTranscript.replace(/^#\s+.*(?:\r?\n)+/, '').trim()
  const separator = note.path.includes('\\') ? '\\' : '/'
  const directory = note.path.slice(0, note.path.lastIndexOf(separator))
  const audioSrc = note.audio
    ? `chismosito-media://local/?path=${encodeURIComponent(`${directory}${separator}${note.audio}`)}`
    : null
  const suggestedFolder = note.suggestedFolder
  const suggestedExists = suggestedFolder
    ? folders.some((folder) => folder.toLowerCase() === suggestedFolder.toLowerCase())
    : false

  const seek = (seconds: number): void => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = seconds
    void audio.play().catch(() => undefined)
  }

  const fixAudioDuration = (event: React.SyntheticEvent<HTMLAudioElement>): void => {
    const audio = event.currentTarget
    if (Number.isFinite(audio.duration)) return
    const onDuration = (): void => {
      audio.removeEventListener('durationchange', onDuration)
      try {
        audio.currentTime = 0
      } catch {
        // ignore
      }
    }
    audio.addEventListener('durationchange', onDuration)
    try {
      audio.currentTime = 1e101
    } catch {
      // Some Chromium versions reject the seek; the metadata duration is still shown below.
    }
  }

  const backup = async (): Promise<void> => {
    setBusyBackup(true)
    try {
      await window.chismosito.drive.backupNote(note.path)
      await load()
    } catch (backupError) {
      pushToast('error', errorMessage(backupError))
    } finally {
      setBusyBackup(false)
    }
  }

  const regenerate = async (): Promise<void> => {
    setBusyRegenerate(true)
    try {
      await window.chismosito.notes.resummarize(note.path)
      await load()
    } catch (regenerateError) {
      pushToast('error', errorMessage(regenerateError))
    } finally {
      setBusyRegenerate(false)
    }
  }

  const reprocess = async (): Promise<void> => {
    setBusyReprocess(true)
    try {
      await window.chismosito.notes.reprocess(note.path)
      await load()
    } catch (reprocessError) {
      pushToast('error', errorMessage(reprocessError))
    } finally {
      setBusyReprocess(false)
    }
  }

  const acceptSuggestion = async (): Promise<void> => {
    if (!note?.suggestedFolder || busySuggestion) return
    const target = note.suggestedFolder
    setBusySuggestion(true)
    try {
      const updated = await window.chismosito.notes.move(note.path, target)
      await refreshNotes()
      pushToast('success', `Nota movida a «${target}»`)
      if (updated.path !== note.path) {
        navigate(
          `/note?path=${encodeURIComponent(updated.path)}${activeTab === 'chat' ? '&tab=chat' : ''}`,
          { replace: true }
        )
      } else {
        setNote(updated)
      }
    } catch (suggestionError) {
      pushToast('error', errorMessage(suggestionError))
    } finally {
      setBusySuggestion(false)
    }
  }

  const dismissSuggestion = async (): Promise<void> => {
    if (!note || busySuggestion) return
    setBusySuggestion(true)
    try {
      const updated = await window.chismosito.notes.clearFolderSuggestion(note.path)
      setNote(updated)
      await refreshNotes()
      pushToast('info', 'Sugerencia descartada')
    } catch (suggestionError) {
      pushToast('error', errorMessage(suggestionError))
    } finally {
      setBusySuggestion(false)
    }
  }

  const duplicate = async (): Promise<void> => {
    try {
      const copy = await window.chismosito.notes.duplicate(note!.path)
      pushToast('success', 'Nota duplicada')
      navigate(`/note?path=${encodeURIComponent(copy.path)}`)
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  const retranscribe = async (): Promise<void> => {
    if (!audioSrc) {
      pushToast('error', 'La nota no tiene audio para re-transcribir')
      return
    }
    setBusyRetranscribe(true)
    try {
      pushToast('info', 'Preparando el audio…')
      const { id, needs } = await window.chismosito.notes.retranscribeBegin(note!.path)
      try {
        const chunkSize = 1_000_000
        for (const need of needs) {
          const track = need === 'mixed' ? 'mix' : need
          const bytes = await window.chismosito.notes.audioBytes(note!.path, track)
          const pcm = await decodeAudioToPcm(bytes)
          for (let offset = 0; offset < pcm.length; offset += chunkSize) {
            const chunk = pcm.slice(offset, offset + chunkSize)
            await window.chismosito.notes.retranscribeChunk(id, need, chunk.buffer as ArrayBuffer)
          }
        }
        const job = await window.chismosito.notes.retranscribeFinish(id)
        pushToast('success', `Re-transcripción en cola (${job.baseName}).`)
      } catch (error) {
        await window.chismosito.notes.retranscribeCancel(id).catch(() => undefined)
        throw error
      }
    } catch (error) {
      pushToast('error', errorMessage(error))
    } finally {
      setBusyRetranscribe(false)
    }
  }

  const remove = async (): Promise<void> => {
    try {
      await window.chismosito.notes.remove(note.path)
      await refreshNotes()
      navigate('/library')
      pushToast('success', 'Nota enviada a la papelera')
    } catch (removeError) {
      pushToast('error', errorMessage(removeError))
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-7 pb-16 pt-7 lg:px-10">
      <div className="mb-5 flex items-center justify-between gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost h-8 px-2 text-xs">
          <ArrowLeft className="size-4" />
          Volver
        </button>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setEditOpen(true)}
            disabled={processing}
            className="btn-secondary h-8 px-3 text-[11px] disabled:opacity-40"
            title={processing ? 'Espera a que termine el procesamiento' : 'Editar título, etiquetas o carpeta'}
          >
            <Pencil className="size-3.5" /> Editar
          </button>
          <button
            onClick={() => void duplicate()}
            className="btn-secondary h-8 px-3 text-[11px]"
            title="Crear una copia de la nota y su audio"
          >
            <Copy className="size-3.5" /> Duplicar
          </button>
          {drive?.connected ? (
            <button
              onClick={() => void backup()}
              disabled={busyBackup || processing}
              className="btn-secondary h-8 px-3 text-[11px]"
              title={processing ? 'Espera a que termine el procesamiento' : 'Respaldar nota y audio en Google Drive'}
            >
              {busyBackup ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CloudUpload className="size-3.5" />
              )}
              Respaldar
            </button>
          ) : null}
          <button
            onClick={() => void window.chismosito.notes.reveal(note.path)}
            className="btn-ghost h-8 w-8 p-0"
            title="Mostrar en Explorer"
            aria-label="Mostrar en Explorer"
          >
            <ExternalLink className="size-4" />
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={processing}
            className="btn-ghost h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950/40"
            title={processing ? 'Espera a que termine el procesamiento' : 'Eliminar nota'}
            aria-label="Eliminar nota"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <header>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={note.status} />
          <DriveIcon status={note.drive} error={note.driveError} />
          {note.folder ? (
            <span className="chip">
              <Folder className="size-3" /> {note.folder}
            </span>
          ) : null}
          <DurationBadge seconds={note.durationSeconds} />
        </div>
        <h1 className="font-serif text-4xl leading-[1.1] tracking-tight lg:text-[44px]">
          {note.title}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {noteDateLabel(note.date)}
          {note.language ? ` · ${note.language.toUpperCase()}` : ''}
          {note.llm ? ` · resumen con ${note.llm}` : ''}
        </p>
        {note.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {note.tags.map((tag) => (
              <span key={tag} className="chip">
                <Tag className="size-3" />
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      {jobActive ? (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="size-4 animate-spin text-accent" />
            <p className="text-sm font-medium">{job?.message || 'Procesando la reunión…'}</p>
            <span className="ml-auto text-[11px] tabular-nums text-muted">
              {Math.round(job?.progress ?? 0)}%
            </span>
          </div>
          <ProgressBar value={job?.progress ?? 0} className="mt-3 h-1.5" />
        </div>
      ) : null}

      {note.status === 'summary_failed' ? (
        <div className="mt-4 rounded-2xl border border-[color-mix(in_srgb,var(--gold)_35%,transparent)] bg-[color-mix(in_srgb,var(--gold)_10%,transparent)] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">La transcripción está lista, pero falta el resumen</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {env?.llm.configured
                  ? job?.error || 'El modelo no respondió. Puedes intentarlo de nuevo.'
                  : 'Agrega tu API key de OpenCode en Ajustes para generar el resumen.'}
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-medium">
                {env?.llm.configured ? (
                  <button
                    onClick={() => setConfirmRegenerate(true)}
                    className="text-accent hover:underline"
                  >
                    Regenerar resumen
                  </button>
                ) : (
                  <Link to="/settings?section=llm" className="text-accent hover:underline">
                    Configurar API key
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {note.status === 'transcription_failed' ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-300" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                No se pudo transcribir esta reunión
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-red-700/90 dark:text-red-300/90">
                {job?.error ||
                  'Revisa que el modelo esté descargado y vuelve a grabar si el audio no se conservó.'}
              </p>
              {job ? (
                <button
                  onClick={() => void window.chismosito.jobs.retry(job.id)}
                  className="mt-2 text-[11px] font-medium text-red-700 underline hover:no-underline dark:text-red-300"
                >
                  Reintentar procesamiento
                </button>
              ) : null}
              {note.audio ? (
                <button
                  onClick={() => void reprocess()}
                  disabled={busyReprocess || jobActive}
                  className="ml-3 mt-2 text-[11px] font-medium text-red-700 underline hover:no-underline disabled:opacity-50 dark:text-red-300"
                >
                  {busyReprocess ? 'Reprocesando…' : 'Reprocesar desde el audio'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {note.status === 'cancelled' ? (
        <div className="mt-4 rounded-2xl border border-line bg-surface2 p-4 text-sm text-muted">
          El procesamiento de esta nota se canceló. El audio original sigue disponible.
        </div>
      ) : null}

      {suggestedFolder ? (
        <section className="mt-4 rounded-2xl border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-accent-soft/40 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-accent">
              <FolderPlus className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                Podrías guardarla en «{suggestedFolder}»
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {note.suggestedFolderConfidence
                  ? `Coincidencia del ${Math.round(
                      note.suggestedFolderConfidence * 100
                    )} % según el contenido de la reunión.`
                  : 'Sugerencia basada en el contenido de la reunión.'}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void acceptSuggestion()}
                  disabled={busySuggestion}
                  className="btn-primary h-8 text-xs"
                >
                  {busySuggestion ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Folder className="size-3.5" />
                  )}
                  {suggestedExists
                    ? `Mover a «${suggestedFolder}»`
                    : `Crear «${suggestedFolder}» y mover`}
                </button>
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  disabled={busySuggestion}
                  className="btn-secondary h-8 text-xs"
                >
                  Elegir otra
                </button>
                <button
                  type="button"
                  onClick={() => void dismissSuggestion()}
                  disabled={busySuggestion}
                  className="btn-ghost h-8 text-xs"
                >
                  Descartar
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {audioSrc ? (
        <section className="mt-6 rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <FileAudio className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Audio original</p>
              <p className="truncate text-[11px] text-muted">
                {note.audio} · {formatDuration(note.durationSeconds)}
              </p>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-muted">WebM · Opus</span>
          </div>
          <audio
            ref={audioRef}
            controls
            preload="metadata"
            src={audioSrc}
            onLoadedMetadata={fixAudioDuration}
            className="mt-3 w-full"
          />
        </section>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-line px-4 py-3 text-xs text-muted">
          El archivo de audio ya no está junto a esta nota.
        </div>
      )}

      <div className="mt-8 flex w-fit items-center gap-1 rounded-full border border-line bg-surface p-1">
        <button
          type="button"
          onClick={() => switchTab('note')}
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors',
            activeTab === 'note' ? 'bg-surface2 text-ink' : 'text-muted hover:text-ink'
          )}
        >
          <FileText className="size-3.5" />
          Nota
        </button>
        <button
          type="button"
          onClick={() => switchTab('chat')}
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors',
            activeTab === 'chat' ? 'bg-surface2 text-ink' : 'text-muted hover:text-ink'
          )}
        >
          <MessageSquare className="size-3.5" />
          Preguntar
        </button>
      </div>

      {activeTab === 'note' ? (
        <>
          <article className="md mt-6">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryContent}</ReactMarkdown>
          </article>

          <div className="mt-9 border-t border-line pt-6">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-serif text-2xl">Transcripción</h2>
                <p className="mt-0.5 text-[11px] text-muted">
                  {note.transcript.length} fragmentos · haz clic en un tiempo para escuchar ese momento
                </p>
              </div>
              {note.transcript.length > 0 || note.audio ? (
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {note.audio ? (
                    <button
                      onClick={() => setConfirmRetranscribe(true)}
                      disabled={busyRetranscribe || jobActive}
                      className="btn-ghost h-8 px-2 text-[11px]"
                      title="Volver a transcribir el audio con el modelo activo"
                    >
                      {busyRetranscribe ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Regenerar transcripción
                    </button>
                  ) : null}
                  {note.audio ? (
                    <button
                      onClick={() => setConfirmReprocess(true)}
                      disabled={busyReprocess || jobActive}
                      className="btn-ghost h-8 px-2 text-[11px]"
                      title="Volver a transcribir el audio completo desde el WebM original"
                    >
                      {busyReprocess ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <FileAudio className="size-3.5" />
                      )}
                      Reprocesar audio
                    </button>
                  ) : null}
                  {note.transcript.length > 0 ? (
                    <button
                      onClick={() => setConfirmRegenerate(true)}
                      disabled={busyRegenerate || !env?.llm.configured || jobActive}
                      className={cn('btn-ghost h-8 px-2 text-[11px]', !env?.llm.configured && 'hidden')}
                      title="Volver a generar resumen, decisiones y acciones"
                    >
                      {busyRegenerate ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Regenerar resumen
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {liveSegments.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[11px] text-muted">
                  <Sparkles className="size-3.5 animate-pulse text-accent" />
                  Transcribiendo en vivo · {liveSegments.length} fragmentos
                </div>
                <div
                  ref={liveRef}
                  className="max-h-[420px] space-y-2 overflow-y-auto rounded-2xl border border-line bg-surface2/40 p-3"
                >
                  {liveSegments.map((segment, index) => (
                    <div key={index} className="flex gap-3 text-[13px] leading-relaxed">
                      <span className="w-12 shrink-0 whitespace-nowrap pt-0.5 text-right text-[10px] tabular-nums text-muted">
                        {formatClock(segment.fromMs / 1000)}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                          segment.speaker === 'Yo'
                            ? 'bg-accent-soft text-accent'
                            : 'bg-surface text-muted'
                        )}
                      >
                        {segment.speaker}
                      </span>
                      <span className="min-w-0 flex-1 text-ink">{segment.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : note.status === 'processing' && note.transcript.length === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-5 text-sm text-muted">
                <Sparkles className="size-4 animate-pulse text-accent" />
                La transcripción aparecerá aquí cuando termine el procesamiento.
              </div>
            ) : (
              <TranscriptView lines={note.transcript} onSeek={seek} />
            )}
          </div>
        </>
      ) : (
        <ChatPanel
          threadId={chatThreadId}
          scope="note"
          folders={folders}
          className="mt-5 h-[560px]"
          onSeek={seek}
          disabledReason={
            note.status === 'processing' || note.status === 'recording'
              ? 'Espera a que termine el procesamiento para preguntar sobre esta reunión.'
              : note.transcript.length === 0
                ? 'Esta reunión todavía no tiene transcripción. Regenera el procesamiento o graba de nuevo.'
                : null
          }
        />
      )}

      <EditNoteModal
        open={editOpen}
        note={note}
        folders={folders}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => {
          if (updated.path !== path) {
            navigate(`/note?path=${encodeURIComponent(updated.path)}`, { replace: true })
          } else {
            setNote(updated)
          }
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="¿Eliminar esta nota?"
        description="La nota y su audio se moverán a la papelera de Windows."
        confirmLabel="Eliminar"
        destructive
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />

      <ConfirmDialog
        open={confirmRetranscribe}
        title="Regenerar transcripción"
        description="Se vuelve a transcribir el audio con el modelo activo y luego se regenera el resumen. La transcripción actual se reemplaza; el audio no se toca. Si la nota guarda las pistas separadas, «Yo» y «Otros» se conservan exactos; si solo tiene el audio mezclado, se aproximan desde la transcripción anterior. Puede tardar varios minutos en reuniones largas."
        confirmLabel="Re-transcribir"
        onClose={() => setConfirmRetranscribe(false)}
        onConfirm={() => void retranscribe()}
      />
      <ConfirmDialog
        open={confirmRegenerate}
        title="Regenerar resumen"
        description="Se volverá a llamar al LLM con la transcripción completa. Esto puede tardar unos segundos y consumir tokens."
        confirmLabel="Regenerar"
        onClose={() => setConfirmRegenerate(false)}
        onConfirm={() => void regenerate()}
      />

      <ConfirmDialog
        open={confirmReprocess}
        title="Reprocesar el audio completo"
        description="Se volverá a transcribir el WebM original de principio a fin y se reemplazará la transcripción actual. Se guardará una copia de la nota como .bak."
        confirmLabel="Reprocesar"
        onClose={() => setConfirmReprocess(false)}
        onConfirm={() => void reprocess()}
      />
    </div>
  )
}
