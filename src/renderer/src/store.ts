import { create } from 'zustand'
import type {
  AppInfo,
  AppSettings,
  DriveProgress,
  DriveStatus,
  DownloadProgress,
  EnvStatus,
  Job,
  NoteMeta,
  LiveSegment,
  RecorderSnapshot,
  ToastLevel,
  WhisperStatus
} from '@shared/types'

export interface ToastItem {
  id: string
  level: ToastLevel
  message: string
}

const idleRecorder: RecorderSnapshot = {
  phase: 'idle',
  id: null,
  elapsedSeconds: 0,
  micLevel: 0,
  systemLevel: 0,
  error: null,
  warning: null,
  startedAt: null
}

interface AppStore {
  bootstrapped: boolean
  settings: AppSettings | null
  env: EnvStatus | null
  appInfo: AppInfo | null
  whisper: WhisperStatus | null
  notes: NoteMeta[]
  folders: string[]
  jobs: Job[]
  drive: DriveStatus | null
  download: DownloadProgress | null
  driveProgress: DriveProgress | null
  recording: RecorderSnapshot
  toasts: ToastItem[]
  notesLoading: boolean
  notesRevision: number
  liveTranscript: Record<string, LiveSegment[]>
  refreshNotes: () => Promise<void>
  refreshJobs: () => Promise<void>
  refreshWhisper: () => Promise<void>
  refreshDrive: () => Promise<void>
  refreshEnv: () => Promise<void>
  refreshAll: () => Promise<void>
  initialize: () => Promise<void>
  setSettings: (settings: AppSettings) => void
  setEnv: (env: EnvStatus) => void
  setDrive: (drive: DriveStatus) => void
  setWhisper: (whisper: WhisperStatus) => void
  setJobs: (jobs: Job[]) => void
  setDownload: (download: DownloadProgress) => void
  setDriveProgress: (progress: DriveProgress) => void
  setRecording: (snapshot: RecorderSnapshot) => void
  pushToast: (level: ToastLevel, message: string) => void
  dismissToast: (id: string) => void
  bumpNotes: () => void
  appendLiveSegment: (notePath: string, segment: LiveSegment) => void
  clearLiveTranscript: (notePath: string) => void
}

export const useAppStore = create<AppStore>((set, get) => ({
  bootstrapped: false,
  settings: null,
  env: null,
  appInfo: null,
  whisper: null,
  notes: [],
  folders: [],
  jobs: [],
  drive: null,
  download: null,
  driveProgress: null,
  recording: idleRecorder,
  toasts: [],
  notesLoading: false,
  notesRevision: 0,
  liveTranscript: {},

  refreshNotes: async () => {
    set({ notesLoading: true })
    try {
      const [notes, folders] = await Promise.all([
        window.chismosito.notes.list(),
        window.chismosito.notes.folders()
      ])
      set({ notes, folders, notesLoading: false })
    } catch {
      set({ notesLoading: false })
    }
  },
  refreshJobs: async () => {
    set({ jobs: await window.chismosito.jobs.list() })
  },
  refreshWhisper: async () => {
    set({ whisper: await window.chismosito.whisper.status() })
  },
  refreshDrive: async () => {
    set({ drive: await window.chismosito.drive.status() })
  },
  refreshEnv: async () => {
    try {
      set({ env: await window.chismosito.env.status() })
    } catch {
      // sin cambios: se reintenta en el próximo evento
    }
  },
  refreshAll: async () => {
    await Promise.allSettled([
      get().refreshNotes(),
      get().refreshJobs(),
      get().refreshWhisper(),
      get().refreshDrive()
    ])
  },
  initialize: async () => {
    const results = await Promise.allSettled([
      window.chismosito.settings.get(),
      window.chismosito.env.status(),
      window.chismosito.app.info(),
      window.chismosito.whisper.status(),
      window.chismosito.notes.list(),
      window.chismosito.notes.folders(),
      window.chismosito.jobs.list(),
      window.chismosito.drive.status()
    ])
    const value = <T,>(index: number, fallback: T): T =>
      results[index].status === 'fulfilled' ? (results[index].value as T) : fallback
    const settings = value<AppSettings | null>(0, null)
    set({
      settings,
      env: value(1, null),
      appInfo: value(2, null),
      whisper: value(3, null),
      notes: value(4, []),
      folders: value(5, []),
      jobs: value(6, []),
      drive: value(7, null),
      bootstrapped: true
    })
    if (settings) applyTheme(settings)
  },

  setSettings: (settings) => {
    set({ settings })
    applyTheme(settings)
  },
  setEnv: (env) => set({ env }),
  setDrive: (drive) => set({ drive }),
  setWhisper: (whisper) => set({ whisper }),
  setJobs: (jobs) => set({ jobs }),
  setDownload: (download) => set({ download }),
  setDriveProgress: (driveProgress) => set({ driveProgress }),
  setRecording: (recording) => set({ recording }),
  pushToast: (level, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    set((state) => ({ toasts: [...state.toasts.slice(-4), { id, level, message }] }))
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  bumpNotes: () => set((state) => ({ notesRevision: state.notesRevision + 1 })),
  appendLiveSegment: (notePath, segment) => {
    set((state) => {
      const current = state.liveTranscript[notePath] ?? []
      const next = current.length >= 2000 ? current.slice(-1999) : current.slice()
      next.push(segment)
      return { liveTranscript: { ...state.liveTranscript, [notePath]: next } }
    })
  },
  clearLiveTranscript: (notePath) => {
    set((state) => {
      if (!state.liveTranscript[notePath]) return state
      const next = { ...state.liveTranscript }
      delete next[notePath]
      return { liveTranscript: next }
    })
  }
}))

function applyTheme(settings: AppSettings): void {
  const root = document.documentElement
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  if (themeCleanup) {
    themeCleanup()
    themeCleanup = null
  }
  const apply = (): void => {
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
    root.classList.toggle('dark', dark)
  }
  apply()
  if (settings.theme === 'system') {
    media.addEventListener('change', apply)
    themeCleanup = () => media.removeEventListener('change', apply)
  }
}

let themeCleanup: (() => void) | null = null
