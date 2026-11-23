import { useEffect, useRef } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Square } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Toasts'
import { Logo } from './components/Logo'
import { RecordPage } from './pages/RecordPage'
import { LibraryPage } from './pages/LibraryPage'
import { NotePage } from './pages/NotePage'
import { AskPage } from './pages/AskPage'
import { SettingsPage } from './pages/SettingsPage'
import { recorder } from './lib/recorder'
import { publishChat } from './lib/chat'
import { useAppStore } from './store'
import { formatElapsed } from './lib/format'
import { errorMessage } from './lib/errors'

export default function App(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const bootstrapped = useAppStore((state) => state.bootstrapped)
  const recording = useAppStore((state) => state.recording)
  const initialize = useAppStore((state) => state.initialize)
  const setRecording = useAppStore((state) => state.setRecording)
  const setJobs = useAppStore((state) => state.setJobs)
  const setDownload = useAppStore((state) => state.setDownload)
  const setDrive = useAppStore((state) => state.setDrive)
  const setDriveProgress = useAppStore((state) => state.setDriveProgress)
  const pushToast = useAppStore((state) => state.pushToast)
  const refreshNotes = useAppStore((state) => state.refreshNotes)
  const bumpNotes = useAppStore((state) => state.bumpNotes)
  const refreshWhisper = useAppStore((state) => state.refreshWhisper)
  const refreshJobs = useAppStore((state) => state.refreshJobs)
  const refreshEnv = useAppStore((state) => state.refreshEnv)
  const appendLiveSegment = useAppStore((state) => state.appendLiveSegment)
  const clearLiveTranscript = useAppStore((state) => state.clearLiveTranscript)
  const notesTimer = useRef<number | null>(null)
  const activeNotesRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => recorder.subscribe(setRecording), [setRecording])

  useEffect(() => {
    const unsubscribe = window.chismosito.onEvent((event) => {
      switch (event.type) {
        case 'jobs': {
          setJobs(event.jobs)
          const active = new Set(
            event.jobs
              .filter((job) => !['done', 'failed', 'cancelled'].includes(job.stage))
              .map((job) => job.notePath)
          )
          // Solo se limpia cuando la nota se queda sin trabajos activos: el
          // historial incluye trabajos viejos ya terminados de la misma nota.
          for (const notePath of activeNotesRef.current) {
            if (!active.has(notePath)) clearLiveTranscript(notePath)
          }
          activeNotesRef.current = active
          break
        }
        case 'transcript-live':
          appendLiveSegment(event.notePath, event.segment)
          break
        case 'notes-changed':
          bumpNotes()
          if (notesTimer.current) window.clearTimeout(notesTimer.current)
          notesTimer.current = window.setTimeout(() => {
            notesTimer.current = null
            void refreshNotes()
          }, 250)
          break
        case 'download':
          setDownload(event.progress)
          if (event.progress.status === 'done' || event.progress.status === 'error') {
            void refreshWhisper()
          }
          break
        case 'drive':
          setDrive(event.status)
          if (notesTimer.current) window.clearTimeout(notesTimer.current)
          notesTimer.current = window.setTimeout(() => {
            notesTimer.current = null
            void refreshNotes()
          }, 800)
          break
        case 'drive-progress':
          setDriveProgress(event.progress)
          break
        case 'toast':
          pushToast(event.level, event.message)
          break
        case 'env-changed':
          void refreshEnv()
          break
        case 'command':
          if (event.command === 'open-settings') {
            navigate('/settings')
          } else if (event.command === 'open-note' && event.notePath) {
            navigate(`/note?path=${encodeURIComponent(event.notePath)}`)
          } else if (event.command === 'start-recording') {
            navigate('/')
            void (async () => {
              const state = useAppStore.getState()
              if (!state.whisper?.model.present) {
                pushToast('error', 'Descarga el modelo de transcripción antes de grabar.')
                navigate('/settings?section=transcription')
                return
              }
              const settings = state.settings ?? (await window.chismosito.settings.get())
              if (!settings) return
              await recorder.start(settings)
            })()
          } else if (event.command === 'stop-recording') {
            void recorder.stop()
          }
          break
        case 'recording-state':
          break
        case 'chat':
          publishChat(event.event)
          break
      }
    })
    return () => unsubscribe()
  }, [
    bumpNotes,
    navigate,
    pushToast,
    refreshNotes,
    refreshEnv,
    appendLiveSegment,
    clearLiveTranscript,
    refreshWhisper,
    setDrive,
    setDriveProgress,
    setDownload,
    setJobs
  ])

  useEffect(() => {
    const onFocus = (): void => {
      void refreshNotes()
      void refreshJobs()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshJobs, refreshNotes])

  const stopRecording = async (): Promise<void> => {
    try {
      await recorder.stop()
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  if (!bootstrapped) {
    return (
      <div className="flex h-full items-center justify-center bg-paper">
        <div className="flex flex-col items-center gap-4">
          <Logo size={54} />
          <p className="text-sm text-muted">Abriendo tu biblioteca…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full overflow-hidden bg-paper">
      <Sidebar />
      <main className="relative min-w-0 flex-1 overflow-y-auto">
        {recording.phase === 'recording' || recording.phase === 'stopping' ? (
          <div className="fixed right-6 top-5 z-40 flex items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 shadow-lg">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
            </span>
            <span className="font-mono text-sm tabular-nums">
              {formatElapsed(recording.elapsedSeconds)}
            </span>
            <span className="text-xs text-muted">
              {recording.phase === 'stopping' ? 'Cerrando…' : 'Grabando'}
            </span>
            <button
              onClick={() => void stopRecording()}
              disabled={recording.phase === 'stopping'}
              className="ml-1 flex size-7 items-center justify-center rounded-full bg-ink text-paper transition-opacity hover:opacity-80 disabled:opacity-40"
              aria-label="Detener grabación"
              title="Detener grabación"
            >
              <Square className="size-3 fill-current" />
            </button>
          </div>
        ) : null}

        <div key={location.pathname} className="fade-up min-h-full">
          <Routes>
            <Route path="/" element={<RecordPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/note" element={<NotePage />} />
            <Route path="/ask" element={<AskPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
      <Toasts />
    </div>
  )
}
