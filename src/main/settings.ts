import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cpus } from 'node:os'
import { z } from 'zod'
import type { AppSettings } from '@shared/types'
import { DEFAULT_HOTKEY } from '@shared/constants'
import { getEnv } from './env'
import { ensureDir, writeAtomic } from './lib/fs'
import { log } from './lib/logger'

const SUPPORTED_LANGUAGES = ['auto', 'es', 'en', 'pt', 'fr', 'de', 'it', 'ja', 'zh'] as const

export const settingsSchema = z.object({
  notesDir: z.string().min(1),
  userName: z.string().max(80),
  language: z.enum(SUPPORTED_LANGUAGES),
  micDeviceId: z.string().nullable(),
  recordMic: z.boolean(),
  recordSystem: z.boolean(),
  whisperDevice: z.enum(['auto', 'cpu', 'cuda']),
  whisperThreads: z.number().int().min(1).max(32),
  whisperModel: z.string().max(80),
  whisperModelPath: z.string().nullable(),
  keepTempWav: z.boolean(),
  llmModel: z.string().max(120),
  folderSuggestions: z.boolean(),
  jevModel: z.string().max(80),
  closeToTray: z.boolean(),
  launchAtLogin: z.boolean(),
  hotkey: z.string().min(1).max(80),
  autoBackup: z.boolean(),
  chatAutoBackup: z.boolean(),
  driveFolderName: z.string().min(1).max(80),
  theme: z.enum(['system', 'light', 'dark']),
  onboardingDismissed: z.boolean()
})

function defaultNotesDir(): string {
  const env = getEnv()
  if (env.meetingNotesDir) return env.meetingNotesDir
  return join(app.getPath('documents'), 'MeetingNotes')
}

export function defaultSettings(): AppSettings {
  const env = getEnv()
  const language = (SUPPORTED_LANGUAGES as readonly string[]).includes(env.whisperLanguage)
    ? (env.whisperLanguage as AppSettings['language'])
    : 'es'
  const device = ['auto', 'cpu', 'cuda'].includes(env.whisperDevice)
    ? (env.whisperDevice as AppSettings['whisperDevice'])
    : 'auto'

  return {
    notesDir: defaultNotesDir(),
    userName: env.userName,
    language,
    micDeviceId: null,
    recordMic: true,
    recordSystem: true,
    whisperDevice: device,
    whisperThreads: Math.max(4, Math.min(10, cpus().length - 2)),
    whisperModel: '',
    whisperModelPath: env.whisperModelPath || null,
    keepTempWav: false,
    llmModel: '',
    folderSuggestions: true,
    jevModel: '',
    closeToTray: true,
    launchAtLogin: false,
    hotkey: DEFAULT_HOTKEY,
    autoBackup: env.googleAutoBackup,
    chatAutoBackup: env.googleAutoBackup,
    driveFolderName: env.googleFolderName,
    theme: 'system',
    onboardingDismissed: false
  }
}

export class SettingsStore {
  private settings: AppSettings
  private listeners = new Set<(settings: AppSettings) => void>()

  constructor(private readonly filePath: string) {
    this.settings = this.load()
  }

  private load(): AppSettings {
    const defaults = defaultSettings()
    if (!existsSync(this.filePath)) {
      ensureDir(defaults.notesDir)
      return defaults
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'))
      const parsed = settingsSchema.safeParse({ ...defaults, ...raw })
      if (!parsed.success) {
        log.warn('settings.json inválido, usando valores por defecto', parsed.error.issues)
        return defaults
      }
      ensureDir(parsed.data.notesDir)
      return parsed.data
    } catch (error) {
      log.error('No se pudo leer settings.json', error)
      ensureDir(defaults.notesDir)
      return defaults
    }
  }

  get(): AppSettings {
    return { ...this.settings }
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const candidate = settingsSchema.safeParse({ ...this.settings, ...patch })
    if (!candidate.success) {
      throw new Error(`Configuración inválida: ${candidate.error.issues[0]?.message ?? 'error'}`)
    }
    this.settings = candidate.data
    ensureDir(this.settings.notesDir)
    this.save()
    for (const listener of this.listeners) listener(this.get())
    return this.get()
  }

  onChange(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  save(): void {
    try {
      writeAtomic(this.filePath, JSON.stringify(this.settings, null, 2))
    } catch (error) {
      log.error('No se pudo guardar settings.json', error)
    }
  }
}

export const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')
