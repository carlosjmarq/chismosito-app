import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type {
  AppEvent,
  AppInfo,
  AppSettings,
  ChatFilter,
  ChatOpenInput,
  ChatScope,
  ChatSendInput,
  ChatSendResult,
  ChatThread,
  ChatThreadSummary,
  DriveBackupSummary,
  DriveStatus,
  EnvStatus,
  LlmKeyStatus,
  LlmModelList,
  LlmTestResult,
  NoteDetail,
  NoteMeta,
  NoteUpdateInput,
  RecordingStartInput,
  RecordingStartResult,
  RecordingStateUpdate,
  RecordingStopInput,
  WhisperStatus
} from '@shared/types'
import { IPC } from '@shared/constants'
import type { SettingsStore } from './settings'
import type { SecretStore } from './secrets'
import type { NoteRepository } from './notes/repository'
import type { JobRunner } from './jobs/runner'
import type { RecordingSessionManager } from './audio/session'
import type { WhisperManager } from './whisper/manager'
import type { LlmClient } from './llm/summarizer'
import type { JevClient } from './llm/jev'
import type { DriveManager } from './drive/manager'
import type { ChatAssistant } from './chat/assistant'
import { getEnv } from './env'
import { whisperModel } from '@shared/whisper-models'
import { log } from './lib/logger'

export interface MainContext {
  settings: SettingsStore
  secrets: SecretStore
  notes: NoteRepository
  jobs: JobRunner
  sessions: RecordingSessionManager
  whisper: WhisperManager
  llm: LlmClient
  jev: JevClient
  drive: DriveManager
  chat: ChatAssistant
  broadcast: (event: AppEvent) => void
  setRecordingState: (state: RecordingStateUpdate) => void
  afterSettingsUpdate: (previous: AppSettings, next: AppSettings) => void
  afterRecordingStopped: () => void
  getWindow: () => BrowserWindow | null
  chooseNotesDir: () => Promise<string | null>
}

export function registerIpc(context: MainContext): void {
  const toast = (level: 'info' | 'success' | 'error', message: string): void => {
    context.broadcast({ type: 'toast', level, message })
  }
  const assertIdleForModelChange = (): void => {
    if (context.sessions.isRecording()) {
      throw new Error('Detén la grabación antes de cambiar el modelo')
    }
    const busy = context.jobs
      .list()
      .some((job) => !['done', 'failed', 'cancelled'].includes(job.stage))
    if (busy) throw new Error('Espera a que terminen los trabajos de procesamiento')
  }
  const assertFolderChangeAllowed = (): void => {
    if (context.sessions.isRecording()) {
      throw new Error('Detén la grabación antes de renombrar o eliminar carpetas')
    }
    const active = context.jobs
      .list()
      .some((job) => !['done', 'failed', 'cancelled'].includes(job.stage))
    if (active) {
      throw new Error('Espera a que terminen los trabajos de procesamiento')
    }
  }

  ipcMain.handle(IPC.settingsGet, (): AppSettings => context.settings.get())
  ipcMain.handle(
    IPC.settingsUpdate,
    (_event, patch: Partial<AppSettings>): AppSettings => {
      const previous = context.settings.get()
      if (
        patch?.whisperModel !== undefined &&
        patch.whisperModel !== '' &&
        !whisperModel(patch.whisperModel)
      ) {
        throw new Error('Modelo de transcripción desconocido')
      }
      const next = context.settings.update(patch ?? {})
      context.afterSettingsUpdate(previous, next)
      return next
    }
  )
  ipcMain.handle(IPC.settingsChooseDir, (): Promise<string | null> => context.chooseNotesDir())

  ipcMain.handle(IPC.envStatus, (): EnvStatus => {
    const env = getEnv()
    const settings = context.settings.get()
    return {
      envPath: env.envPath,
      llm: {
        configured: context.secrets.configured(),
        baseUrl: env.llmBaseUrl,
        model: settings.llmModel.trim() || env.llmModel,
        source: settings.llmModel.trim() ? 'default' : 'env',
        apiKey: context.secrets.status()
      },
      jev: {
        configured: context.secrets.configured(),
        baseUrl: env.jevBaseUrl,
        model: settings.jevModel.trim() || env.jevModel
      },
      google: {
        clientConfigured: Boolean(env.googleClientId && env.googleClientSecret),
        tokenConfigured: context.drive.auth.tokenSource() !== 'none',
        folderName: settings.driveFolderName
      },
      notesDirFromEnv: Boolean(env.meetingNotesDir)
    }
  })

  ipcMain.handle(IPC.appInfo, (): AppInfo => {
    const env = getEnv()
    return {
      version: app.getVersion(),
      platform: process.platform,
      userData: app.getPath('userData'),
      appPath: app.getAppPath(),
      envPath: env.envPath,
      notesDir: context.settings.get().notesDir
    }
  })
  ipcMain.handle(IPC.appOpenPath, async (_event, path: string): Promise<void> => {
    const rawTarget = resolve(String(path))
    const target = rawTarget.toLowerCase()
    const notesDir = resolve(context.settings.get().notesDir).toLowerCase()
    const userData = resolve(app.getPath('userData')).toLowerCase()
    const envPath = resolve(getEnv().envPath).toLowerCase()
    const allowed =
      target === envPath ||
      target === notesDir ||
      target.startsWith(`${notesDir}\\`) ||
      target.startsWith(`${notesDir}/`) ||
      target === userData ||
      target.startsWith(`${userData}\\`) ||
      target.startsWith(`${userData}/`)
    if (!allowed) throw new Error('Ruta no permitida')
    const error = await shell.openPath(rawTarget)
    if (error) throw new Error(error)
  })
  ipcMain.handle(IPC.appRevealPath, async (_event, path: string): Promise<void> => {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Ruta inválida')
    shell.showItemInFolder(path)
  })
  ipcMain.handle(IPC.appOpenExternal, async (_event, url: string): Promise<void> => {
    const parsed = new URL(String(url))
    const allowedProtocols = ['https:', 'http:', 'ms-settings:']
    if (!allowedProtocols.includes(parsed.protocol)) throw new Error('URL no permitida')
    await shell.openExternal(parsed.toString())
  })

  ipcMain.handle(
    IPC.recordingStart,
    async (_event, input: RecordingStartInput): Promise<RecordingStartResult> => {
      if (!input || typeof input.startedAt !== 'string') throw new Error('Datos de grabación inválidos')
      const result = await context.sessions.start({
        hasMic: Boolean(input.hasMic),
        hasSystem: Boolean(input.hasSystem),
        startedAt: input.startedAt,
        language: String(input.language || 'es')
      })
      context.setRecordingState({
        phase: 'recording',
        recordingId: result.id,
        elapsedSeconds: 0
      })
      return result
    }
  )
  ipcMain.on(IPC.recordingWebmChunk, (_event, id: string, chunk: ArrayBuffer | Uint8Array) => {
    if (typeof id !== 'string') return
    context.sessions.sendWebmChunk(id, normalizeChunk(chunk))
  })
  ipcMain.on(
    IPC.recordingPcmChunk,
    (_event, id: string, track: 'mic' | 'system', chunk: ArrayBuffer | Uint8Array) => {
      if (typeof id !== 'string' || (track !== 'mic' && track !== 'system')) return
      context.sessions.sendPcmChunk(id, track, normalizeChunk(chunk))
    }
  )
  ipcMain.handle(
    IPC.recordingStop,
    async (_event, input: RecordingStopInput) => {
      if (!input || typeof input.id !== 'string') throw new Error('Datos de cierre inválidos')
      context.setRecordingState({ phase: 'stopping', recordingId: input.id, elapsedSeconds: 0 })
      const job = await context.sessions.stop({
        id: input.id,
        durationSeconds: Number(input.durationSeconds) || 0,
        micPeak: Number(input.micPeak) || 0,
        systemPeak: Number(input.systemPeak) || 0
      })
      context.setRecordingState({ phase: 'idle', recordingId: null, elapsedSeconds: 0 })
      context.afterRecordingStopped()
      context.broadcast({ type: 'notes-changed' })
      return job
    }
  )
  ipcMain.handle(IPC.recordingCancel, async (_event, id: string): Promise<void> => {
    await context.sessions.cancel(String(id))
    context.setRecordingState({ phase: 'idle', recordingId: null, elapsedSeconds: 0 })
  })
  ipcMain.on(IPC.recordingState, (_event, state: RecordingStateUpdate) => {
    if (!state || typeof state.phase !== 'string') return
    context.setRecordingState(state)
  })

  ipcMain.handle(IPC.jobsList, () => context.jobs.list())
  ipcMain.handle(IPC.jobsRetry, (_event, id: string) => context.jobs.retry(String(id)))
  ipcMain.handle(IPC.jobsCancel, (_event, id: string) => context.jobs.cancel(String(id)))

  ipcMain.handle(IPC.notesList, (): Promise<NoteMeta[]> => context.notes.list())
  ipcMain.handle(IPC.notesGet, (_event, path: string): Promise<NoteDetail | null> =>
    context.notes.get(String(path))
  )
  ipcMain.handle(
    IPC.notesUpdate,
    async (_event, input: NoteUpdateInput): Promise<NoteDetail> => {
      if (!input || typeof input.path !== 'string') throw new Error('Nota inválida')
      const result = await context.notes.update(input)
      context.broadcast({ type: 'notes-changed' })
      return result
    }
  )
  ipcMain.handle(
    IPC.notesMove,
    async (_event, path: string, folder: string | null): Promise<NoteDetail> => {
      const result = await context.notes.move(String(path), folder)
      context.broadcast({ type: 'notes-changed' })
      return result
    }
  )
  ipcMain.handle(IPC.notesDelete, async (_event, path: string): Promise<void> => {
    await context.notes.remove(String(path))
    context.broadcast({ type: 'notes-changed' })
  })
  ipcMain.handle(IPC.notesFolders, (): Promise<string[]> => context.notes.folders())
  ipcMain.handle(
    IPC.notesClearFolderSuggestion,
    async (_event, path: string): Promise<NoteDetail> => {
      const result = await context.notes.clearFolderSuggestion(String(path))
      context.broadcast({ type: 'notes-changed' })
      return result
    }
  )
  ipcMain.handle(IPC.notesSearch, (_event, query: string): Promise<NoteMeta[]> =>
    context.notes.search(String(query ?? ''))
  )
  ipcMain.handle(IPC.notesReveal, (_event, path: string): Promise<void> =>
    context.notes.reveal(String(path))
  )
  ipcMain.handle(IPC.notesResummarize, async (_event, path: string): Promise<void> => {
    const note = await context.notes.get(String(path))
    if (!note) throw new Error('La nota no existe')
    const transcript = await context.notes.readTranscriptMarkdown(note.path)
    if (!transcript) throw new Error('La nota todavía no tiene transcripción')
    context.jobs.enqueue({
      id: randomUUID(),
      baseName: note.baseName,
      notePath: note.path,
      audioPath: note.path,
      micWavPath: null,
      systemWavPath: null,
      durationSeconds: note.durationSeconds,
      language: note.language,
      hasMic: false,
      hasSystem: false,
      meetingDate: note.date || new Date().toISOString()
    })
    toast('info', 'Regenerando el resumen…')
  })
  ipcMain.handle(IPC.notesReprocess, async (_event, path: string): Promise<void> => {
    const note = await context.notes.get(String(path))
    if (!note) throw new Error('La nota no existe')
    if (!note.audio) throw new Error('Esta nota no tiene un archivo de audio para reprocesar')
    const audioPath = join(dirname(note.path), note.audio)
    if (!existsSync(audioPath)) throw new Error('El archivo de audio ya no está junto a la nota')

    const activeJob = context.jobs
      .list()
      .some(
        (job) =>
          normalizePath(job.notePath) === normalizePath(note.path) &&
          !['done', 'failed', 'cancelled'].includes(job.stage)
      )
    if (activeJob) throw new Error('Ya hay un procesamiento en curso para esta nota')

    await copyFile(note.path, `${note.path}.bak`).catch((error) =>
      log.warn('No se pudo respaldar la nota antes de reprocesar', error)
    )

    context.jobs.enqueue({
      id: randomUUID(),
      baseName: note.baseName,
      notePath: note.path,
      audioPath,
      micWavPath: null,
      systemWavPath: null,
      durationSeconds: note.durationSeconds,
      language: note.language,
      hasMic: false,
      hasSystem: false,
      meetingDate: note.date || new Date().toISOString(),
      reprocessAudio: true
    })
    toast('info', 'Reprocesando el audio completo…')
  })

  ipcMain.handle(IPC.foldersCreate, async (_event, path: string) => {
    const result = await context.notes.createFolder(String(path))
    context.broadcast({ type: 'notes-changed' })
    return result
  })
  ipcMain.handle(IPC.foldersRename, async (_event, path: string, newName: string) => {
    assertFolderChangeAllowed()
    const result = await context.notes.renameFolder(String(path), String(newName))
    context.broadcast({ type: 'notes-changed' })
    return result
  })
  ipcMain.handle(IPC.foldersRemove, async (_event, path: string) => {
    assertFolderChangeAllowed()
    const result = await context.notes.removeFolder(String(path))
    context.broadcast({ type: 'notes-changed' })
    return result
  })

  ipcMain.handle(IPC.whisperStatus, (): Promise<WhisperStatus> => context.whisper.status())
  ipcMain.handle(
    IPC.whisperDownloadModel,
    async (_event, modelId: string): Promise<WhisperStatus> => {
      const status = await context.whisper.downloadModel(String(modelId ?? ''))
      toast('success', 'Modelo de transcripción descargado y verificado')
      return status
    }
  )
  ipcMain.handle(
    IPC.whisperRemoveModel,
    async (_event, modelId: string): Promise<WhisperStatus> => {
      assertIdleForModelChange()
      const status = await context.whisper.removeModel(String(modelId ?? ''))
      toast('info', 'Modelo eliminado')
      return status
    }
  )
  ipcMain.handle(IPC.whisperChooseCustom, async (): Promise<WhisperStatus> => {
    assertIdleForModelChange()
    const options = {
      title: 'Elegir un modelo ggml de whisper.cpp',
      properties: ['openFile' as const],
      filters: [{ name: 'Modelo ggml', extensions: ['bin'] }]
    }
    const window = context.getWindow()
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return context.whisper.status()
    context.whisper.validateCustomPath(result.filePaths[0])
    context.settings.update({ whisperModelPath: result.filePaths[0] })
    toast('success', 'Modelo personalizado activo')
    return context.whisper.status()
  })
  ipcMain.handle(IPC.whisperClearCustom, (): Promise<WhisperStatus> => {
    context.settings.update({ whisperModelPath: null })
    return context.whisper.status()
  })
  ipcMain.handle(IPC.whisperDownloadCuda, async (): Promise<WhisperStatus> => {
    const status = await context.whisper.downloadCuda()
    toast('success', 'Paquete CUDA instalado')
    return status
  })
  ipcMain.handle(IPC.whisperCancelDownload, (): void => context.whisper.cancelDownload())

  ipcMain.handle(IPC.llmTest, (): Promise<LlmTestResult> => context.llm.test())
  ipcMain.handle(IPC.llmModels, (): Promise<LlmModelList> => context.llm.listModels())
  ipcMain.handle(IPC.llmKeySet, (_event, key: string): LlmKeyStatus => {
    const status = context.secrets.setApiKey(String(key ?? ''))
    context.broadcast({ type: 'env-changed' })
    return status
  })
  ipcMain.handle(IPC.llmKeyClear, (): LlmKeyStatus => {
    const status = context.secrets.clearApiKey()
    context.broadcast({ type: 'env-changed' })
    return status
  })
  ipcMain.handle(IPC.llmEnvKeyScrub, (): LlmKeyStatus => {
    const status = context.secrets.scrubEnvKey()
    context.broadcast({ type: 'env-changed' })
    return status
  })
  ipcMain.handle(IPC.jevTest, (): Promise<LlmTestResult> => context.jev.test())

  ipcMain.handle(IPC.chatThreads, (_event, scope: ChatScope): ChatThreadSummary[] => {
    if (scope !== 'note' && scope !== 'library') throw new Error('Ámbito de chat inválido')
    return context.chat.threads(scope)
  })
  ipcMain.handle(
    IPC.chatGet,
    (_event, threadId: string): ChatThread | null => context.chat.get(String(threadId))
  )
  ipcMain.handle(IPC.chatOpen, (_event, input: ChatOpenInput): Promise<ChatThread> => {
    if (!input || (input.scope !== 'note' && input.scope !== 'library')) {
      throw new Error('Ámbito de chat inválido')
    }
    return context.chat.open({
      scope: input.scope,
      notePath: input.notePath ? String(input.notePath) : null
    })
  })
  ipcMain.handle(IPC.chatCreate, (): ChatThread => context.chat.createLibrary())
  ipcMain.handle(IPC.chatSend, (_event, input: ChatSendInput): ChatSendResult => {
    if (!input || typeof input.threadId !== 'string') throw new Error('Conversación inválida')
    return context.chat.send({ threadId: input.threadId, message: String(input.message ?? '') })
  })
  ipcMain.handle(IPC.chatRetry, (_event, threadId: string): ChatSendResult =>
    context.chat.retry(String(threadId))
  )
  ipcMain.handle(IPC.chatCancel, (_event, requestId: string): void => {
    context.chat.cancel(String(requestId))
  })
  ipcMain.handle(IPC.chatClear, (_event, threadId: string): ChatThread =>
    context.chat.clear(String(threadId))
  )
  ipcMain.handle(IPC.chatRemove, async (_event, threadId: string): Promise<void> => {
    await context.chat.remove(String(threadId))
  })
  ipcMain.handle(
    IPC.chatUpdateFilters,
    (_event, threadId: string, filters: ChatFilter | null): ChatThreadSummary => {
      return context.chat.updateFilters(String(threadId), filters ?? null)
    }
  )
  ipcMain.handle(IPC.chatBackup, async (_event, threadId: string): Promise<void> => {
    await context.chat.backup(String(threadId))
    toast('success', 'Conversación respaldada en Google Drive')
  })

  ipcMain.handle(IPC.driveStatus, (): DriveStatus => context.drive.status())
  ipcMain.handle(IPC.driveConnect, async (): Promise<DriveStatus> => {
    const status = await context.drive.connect()
    toast('success', 'Google Drive conectado')
    return status
  })
  ipcMain.handle(IPC.driveDisconnect, (): DriveStatus => {
    const status = context.drive.disconnect()
    toast('info', 'Google Drive desconectado')
    return status
  })
  ipcMain.handle(IPC.driveBackupAll, (): Promise<DriveBackupSummary> => context.drive.backupAll())
  ipcMain.handle(IPC.driveBackupNote, async (_event, path: string): Promise<void> => {
    await context.drive.backupNote(String(path))
    toast('success', 'Nota respaldada en Google Drive')
  })

  log.info('IPC registrado')
}

function normalizeChunk(chunk: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (chunk instanceof Uint8Array) {
    return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer
  }
  return chunk
}

function normalizePath(value: string): string {
  return resolve(value).replace(/\\/g, '/').toLowerCase()
}
