import './bootstrap-paths'
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  session,
  desktopCapturer,
  screen,
  globalShortcut,
  shell,
  dialog,
  Notification,
  powerSaveBlocker,
  ipcMain,
  protocol
} from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { AppEvent, AppSettings, RecordingPhase, RecordingStateUpdate } from '@shared/types'
import { IPC } from '@shared/constants'
import { SettingsStore, settingsFile } from './settings'
import { SecretStore, secretsFile } from './secrets'
import { NoteRepository } from './notes/repository'
import { WhisperManager } from './whisper/manager'
import { LlmClient } from './llm/summarizer'
import { JevClient } from './llm/jev'
import { DriveManager } from './drive/manager'
import { JobRunner } from './jobs/runner'
import { RecordingSessionManager } from './audio/session'
import { ChatStore } from './chat/store'
import { ChatAssistant } from './chat/assistant'
import { registerIpc, type MainContext } from './ipc'
import { registerMediaProtocol } from './media'
import { ensureEnvFile } from './env'
import { ensureDir } from './lib/fs'
import { log } from './lib/logger'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let context: MainContext | null = null
let watcher: FSWatcher | null = null
let notesRefreshTimer: NodeJS.Timeout | null = null
let isQuitting = false
let pendingQuit = false
let recordingPhase: RecordingPhase = 'idle'
let recordingStartedAt: number | null = null
let trayTimer: NodeJS.Timeout | null = null
let powerBlocker: number | null = null
let lastHotkeyError: string | null = null

app.setAppUserModelId('com.carlos.chismosito')
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9333')
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'chismosito-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false
    }
  }
])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  log.info(`Chismosito ${app.getVersion()} iniciando`, {
    userData: app.getPath('userData'),
    packaged: app.isPackaged
  })

  Menu.setApplicationMenu(null)
  setupPermissions()
  ensureEnvFile()

  const settings = new SettingsStore(settingsFile())
  const secrets = new SecretStore(secretsFile())
  const notes = new NoteRepository(settings)
  const whisper = new WhisperManager(settings)
  const llm = new LlmClient(settings, secrets)
  const jev = new JevClient(settings, secrets)
  const chats = new ChatStore(join(app.getPath('userData'), 'chats'), () => settings.get().notesDir)
  await chats.init()

  const drive = new DriveManager({
    settings,
    notes,
    chats,
    emitStatus: (status) => broadcast({ type: 'drive', status }),
    emitProgress: (progress) => broadcast({ type: 'drive-progress', progress }),
    emitToast: (level, message) => toast(level, message)
  })
  notes.setDriveStateProvider((relativePath, mtimeMs) => drive.noteState(relativePath, mtimeMs))
  notes.onMoved((oldPath, newPath) => {
    chats.remapNote(oldPath, newPath)
    drive.handleMove(oldPath, newPath)
    context?.jobs.handleNoteMove(oldPath, newPath)
  })
  notes.onDeleted((notePath) => {
    chats.removeForNote(notePath)
    drive.handleDelete(notePath)
    context?.jobs.removeForNote(notePath)
  })

  const chat = new ChatAssistant({
    settings,
    notes,
    chats,
    llm,
    broadcast,
    backupChat: (threadId) => drive.backupChat(threadId),
    chatAutoBackupEnabled: () => drive.chatAutoBackupEnabled(),
    onChatDeleted: (thread) => drive.handleChatDelete(thread)
  })

  const jobs = new JobRunner({
    settings,
    notes,
    whisper,
    llm,
    jev,
    emitJobs: (entries) => broadcast({ type: 'jobs', jobs: entries }),
    emitToast: (level, message) => toast(level, message),
    emitLiveSegment: (notePath, segment) =>
      broadcast({ type: 'transcript-live', notePath, segment }),
    onNoteChanged: () => broadcast({ type: 'notes-changed' }),
    backupNote: (notePath) => drive.backupNote(notePath),
    driveEnabled: () => drive.autoBackupEnabled()
  })
  const sessions = new RecordingSessionManager(notes, jobs)

  whisper.onProgress((progress) => broadcast({ type: 'download', progress }))

  const ctx: MainContext = {
    settings,
    secrets,
    notes,
    jobs,
    sessions,
    whisper,
    llm,
    jev,
    drive,
    chat,
    broadcast,
    setRecordingState,
    afterSettingsUpdate,
    afterRecordingStopped: () => {
      if (pendingQuit) finishQuit()
    },
    getWindow: () => mainWindow,
    chooseNotesDir: async () => {
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, {
            title: 'Elegir carpeta de MeetingNotes',
            properties: ['openDirectory', 'createDirectory']
          })
        : await dialog.showOpenDialog({
            title: 'Elegir carpeta de MeetingNotes',
            properties: ['openDirectory', 'createDirectory']
          })
      return result.canceled ? null : result.filePaths[0]
    }
  }
  context = ctx

  ensureDir(settings.get().notesDir)
  registerMediaProtocol(() => settings.get().notesDir)
  registerIpc(ctx)
  registerTray()
  registerHotkey()
  applyLaunchAtLogin(settings.get())
  startWatcher()

  await jobs.init()
  createWindow()
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showWindow()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#f7f3ec',
    title: 'Chismosito',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      webSecurity: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    const closeToTray = context?.settings.get().closeToTray ?? true
    const busy = recordingPhase !== 'idle'
    if (closeToTray || busy) {
      event.preventDefault()
      mainWindow?.hide()
      return
    }
    isQuitting = true
    app.quit()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL()
    if (current && url !== current) event.preventDefault()
  })

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

function sendCommand(command: 'start-recording' | 'stop-recording' | 'open-settings' | 'open-note', notePath?: string): void {
  showWindow()
  if (!mainWindow) return
  const payload: AppEvent = { type: 'command', command, notePath }
  const send = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.event, payload)
  }
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send)
  else send()
}

function broadcast(event: AppEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.event, event)
  }
}

function toast(level: 'info' | 'success' | 'error', message: string): void {
  broadcast({ type: 'toast', level, message })
  if (level === 'success' && mainWindow && !mainWindow.isVisible()) {
    try {
      const notification = new Notification({ title: 'Chismosito', body: message })
      notification.on('click', () => showWindow())
      notification.show()
    } catch (error) {
      log.warn('No se pudo mostrar la notificación', error)
    }
  }
}

function setupPermissions(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (['media', 'display-capture', 'fullscreen', 'clipboard-sanitized-write'].includes(permission)) {
      callback(true)
      return
    }
    callback(false)
  })
  ses.setPermissionCheckHandler((_webContents, permission) => {
    return ['media', 'display-capture', 'fullscreen', 'clipboard-sanitized-write'].includes(permission)
  })

  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        if (!request.videoRequested) {
          callback(null)
          return
        }
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false
        })
        if (sources.length === 0) {
          callback(null)
          return
        }
        const primary = screen.getPrimaryDisplay()
        const source = sources.find((entry) => String(entry.display_id) === String(primary.id)) ?? sources[0]
        if (request.audioRequested) {
          callback({ video: source, audio: 'loopback' })
        } else {
          callback({ video: source })
        }
      } catch (error) {
        log.error('No se pudo conceder la captura de pantalla/audio', error)
        callback(null)
      }
    },
    { useSystemPicker: false }
  )
  log.info('Permisos de media y loopback configurados')
}

function resourcePath(...parts: string[]): string {
  return app.isPackaged
    ? join(process.resourcesPath, ...parts)
    : join(app.getAppPath(), 'resources', ...parts)
}

function registerTray(): void {
  if (tray) {
    updateTray()
    return
  }
  const icon = trayIcon(false)
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Chismosito')
  tray.on('click', () => showWindow())
  updateTray()
}

function trayIcon(recording: boolean): Electron.NativeImage {
  const file = recording ? 'tray-recording.png' : 'tray.png'
  const path = resourcePath('tray', file)
  if (!existsSync(path)) return nativeImage.createEmpty()
  return nativeImage.createFromPath(path).resize({ width: 16, height: 16 })
}

function updateTray(): void {
  if (!tray) return
  const busy = recordingPhase === 'recording'
  const stopping = recordingPhase === 'stopping' || recordingPhase === 'starting'
  tray.setImage(trayIcon(busy))
  const menu = Menu.buildFromTemplate([
    {
      label: 'Abrir Chismosito',
      click: () => showWindow()
    },
    { type: 'separator' },
    {
      label: busy ? 'Detener grabación' : 'Iniciar grabación',
      enabled: !stopping,
      click: () => {
        if (recordingPhase === 'recording') sendCommand('stop-recording')
        else if (recordingPhase === 'idle') sendCommand('start-recording')
      }
    },
    { type: 'separator' },
    {
      label: 'Ajustes…',
      click: () => sendCommand('open-settings')
    },
    {
      label: 'Salir',
      click: () => requestQuit()
    }
  ])
  tray.setContextMenu(menu)
  updateTrayTooltip()
}

function updateTrayTooltip(): void {
  if (!tray) return
  if (recordingPhase === 'recording' && recordingStartedAt) {
    const elapsed = Math.max(0, Math.floor((Date.now() - recordingStartedAt) / 1000))
    tray.setToolTip(`Chismosito — grabando ${formatElapsed(elapsed)}`)
  } else {
    tray.setToolTip('Chismosito')
  }
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function setRecordingState(state: RecordingStateUpdate): void {
  const wasRecording = recordingPhase === 'recording'
  recordingPhase = state.phase
  if (state.phase === 'recording') {
    recordingStartedAt = Date.now() - state.elapsedSeconds * 1000
    if (!trayTimer) {
      trayTimer = setInterval(updateTrayTooltip, 5000)
    }
    if (powerBlocker === null) {
      powerBlocker = powerSaveBlocker.start('prevent-app-suspension')
    }
  } else {
    recordingStartedAt = null
    if (trayTimer) {
      clearInterval(trayTimer)
      trayTimer = null
    }
    if (powerBlocker !== null) {
      try {
        powerSaveBlocker.stop(powerBlocker)
      } catch {
        // ignore
      }
      powerBlocker = null
    }
  }
  if (wasRecording !== (state.phase === 'recording')) updateTray()
  else updateTrayTooltip()
  broadcast({ type: 'recording-state', state })
}

function registerHotkey(): void {
  if (!context) return
  globalShortcut.unregisterAll()
  const hotkey = context.settings.get().hotkey
  const ok = globalShortcut.register(hotkey, () => {
    if (recordingPhase === 'recording') {
      sendCommand('stop-recording')
      return
    }
    if (recordingPhase === 'idle') {
      sendCommand('start-recording')
    }
  })
  if (!ok) {
    lastHotkeyError = `No se pudo registrar el atajo ${hotkey}. Cambia otro en Ajustes.`
    log.warn(lastHotkeyError)
    toast('error', lastHotkeyError)
  } else {
    lastHotkeyError = null
  }
}

function applyLaunchAtLogin(settings: AppSettings): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtLogin,
      path: process.execPath,
      args: []
    })
  } catch (error) {
    log.warn('No se pudo configurar el inicio con Windows', error)
  }
}

function afterSettingsUpdate(previous: AppSettings, next: AppSettings): void {
  if (previous.hotkey !== next.hotkey) registerHotkey()
  if (previous.launchAtLogin !== next.launchAtLogin) applyLaunchAtLogin(next)
  if (previous.notesDir !== next.notesDir) {
    ensureDir(next.notesDir)
    context?.notes.invalidate()
    startWatcher()
    broadcast({ type: 'notes-changed' })
  }
  updateTray()
}

function startWatcher(): void {
  if (!context) return
  if (watcher) {
    void watcher.close()
    watcher = null
  }
  const dir = context.settings.get().notesDir
  ensureDir(dir)
  watcher = watch(dir, {
    ignoreInitial: true,
    depth: 6,
    ignored: (path) => path.split(/[\\/]/).some((part) => part.startsWith('.') && part.length > 1)
  })
  watcher.on('all', () => {
    context?.notes.invalidate()
    if (notesRefreshTimer) clearTimeout(notesRefreshTimer)
    notesRefreshTimer = setTimeout(() => {
      notesRefreshTimer = null
      broadcast({ type: 'notes-changed' })
    }, 400)
  })
  watcher.on('error', (error) => log.warn('Watcher de notas', error))
}

function requestQuit(): void {
  if (pendingQuit) return
  const activeJobs =
    context?.jobs
      .list()
      .some((job) => !['done', 'failed', 'cancelled'].includes(job.stage)) ?? false
  const recording = recordingPhase !== 'idle'

  if (recording || activeJobs) {
    const detail = recording
      ? 'Se detendrá la grabación, se guardará la nota y el procesamiento continuará al volver a abrir.'
      : 'Hay reuniones procesándose. El trabajo se reanudará al volver a abrir Chismosito.'
    const choice = dialog.showMessageBoxSync({
      type: 'question',
      title: recording ? 'Grabación en curso' : 'Procesamiento en curso',
      message: recording ? 'Hay una grabación en curso.' : 'Hay reuniones procesándose.',
      detail,
      buttons: ['Salir de todos modos', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    if (choice !== 0) return
    pendingQuit = true
    if (recording) {
      sendCommand('stop-recording')
      setTimeout(() => {
        if (pendingQuit) {
          log.warn('Salida forzada: la grabación no se detuvo a tiempo')
          isQuitting = true
          app.exit(0)
        }
      }, 15_000)
    } else {
      finishQuit()
    }
    return
  }
  isQuitting = true
  app.quit()
}

function finishQuit(): void {
  pendingQuit = false
  isQuitting = true
  setTimeout(() => app.quit(), 400)
}

app.on('before-quit', () => {
  isQuitting = true
  context?.jobs.abortForQuit()
  context?.chat.dispose()
  globalShortcut.unregisterAll()
  if (watcher) {
    void watcher.close()
    watcher = null
  }
  if (trayTimer) {
    clearInterval(trayTimer)
    trayTimer = null
  }
})

app.on('window-all-closed', () => {
  if (!isQuitting && context && !context.settings.get().closeToTray) {
    isQuitting = true
    app.quit()
  }
})

app.on('will-quit', () => {
  ipcMain.removeAllListeners()
  tray?.destroy()
  tray = null
})

process.on('uncaughtException', (error) => {
  log.error('Excepción no capturada', error)
})
process.on('unhandledRejection', (reason) => {
  log.error('Promesa rechazada sin manejar', reason)
})
