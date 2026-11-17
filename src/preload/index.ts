import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants'
import type { AppEvent, ChismositoApi } from '../shared/types'

const api: ChismositoApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openPath: (path) => ipcRenderer.invoke(IPC.appOpenPath, path),
    revealPath: (path) => ipcRenderer.invoke(IPC.appRevealPath, path),
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    chooseNotesDir: () => ipcRenderer.invoke(IPC.settingsChooseDir)
  },
  env: {
    status: () => ipcRenderer.invoke(IPC.envStatus)
  },
  recording: {
    start: (input) => ipcRenderer.invoke(IPC.recordingStart, input),
    sendWebmChunk: (id, chunk) => ipcRenderer.send(IPC.recordingWebmChunk, id, chunk),
    sendPcmChunk: (id, track, chunk) =>
      ipcRenderer.send(IPC.recordingPcmChunk, id, track, chunk),
    stop: (input) => ipcRenderer.invoke(IPC.recordingStop, input),
    cancel: (id) => ipcRenderer.invoke(IPC.recordingCancel, id),
    setState: (state) => ipcRenderer.send(IPC.recordingState, state)
  },
  jobs: {
    list: () => ipcRenderer.invoke(IPC.jobsList),
    retry: (id) => ipcRenderer.invoke(IPC.jobsRetry, id),
    cancel: (id) => ipcRenderer.invoke(IPC.jobsCancel, id)
  },
  notes: {
    list: () => ipcRenderer.invoke(IPC.notesList),
    get: (path) => ipcRenderer.invoke(IPC.notesGet, path),
    update: (input) => ipcRenderer.invoke(IPC.notesUpdate, input),
    move: (path, folder) => ipcRenderer.invoke(IPC.notesMove, path, folder),
    remove: (path) => ipcRenderer.invoke(IPC.notesDelete, path),
    folders: () => ipcRenderer.invoke(IPC.notesFolders),
    clearFolderSuggestion: (path) =>
      ipcRenderer.invoke(IPC.notesClearFolderSuggestion, path),
    reveal: (path) => ipcRenderer.invoke(IPC.notesReveal, path),
    resummarize: (path) => ipcRenderer.invoke(IPC.notesResummarize, path),
    reprocess: (path) => ipcRenderer.invoke(IPC.notesReprocess, path),
    search: (query) => ipcRenderer.invoke(IPC.notesSearch, query)
  },
  folders: {
    create: (path) => ipcRenderer.invoke(IPC.foldersCreate, path),
    rename: (path, newName) => ipcRenderer.invoke(IPC.foldersRename, path, newName),
    remove: (path) => ipcRenderer.invoke(IPC.foldersRemove, path)
  },
  whisper: {
    status: () => ipcRenderer.invoke(IPC.whisperStatus),
    downloadModel: (modelId) => ipcRenderer.invoke(IPC.whisperDownloadModel, modelId),
    removeModel: (modelId) => ipcRenderer.invoke(IPC.whisperRemoveModel, modelId),
    chooseCustom: () => ipcRenderer.invoke(IPC.whisperChooseCustom),
    clearCustom: () => ipcRenderer.invoke(IPC.whisperClearCustom),
    downloadCuda: () => ipcRenderer.invoke(IPC.whisperDownloadCuda),
    cancelDownload: () => ipcRenderer.invoke(IPC.whisperCancelDownload)
  },
  llm: {
    test: () => ipcRenderer.invoke(IPC.llmTest),
    models: () => ipcRenderer.invoke(IPC.llmModels),
    setApiKey: (key) => ipcRenderer.invoke(IPC.llmKeySet, key),
    clearApiKey: () => ipcRenderer.invoke(IPC.llmKeyClear),
    scrubEnvKey: () => ipcRenderer.invoke(IPC.llmEnvKeyScrub)
  },
  jev: {
    test: () => ipcRenderer.invoke(IPC.jevTest)
  },
  chat: {
    threads: (scope) => ipcRenderer.invoke(IPC.chatThreads, scope),
    get: (threadId) => ipcRenderer.invoke(IPC.chatGet, threadId),
    open: (input) => ipcRenderer.invoke(IPC.chatOpen, input),
    create: () => ipcRenderer.invoke(IPC.chatCreate),
    send: (input) => ipcRenderer.invoke(IPC.chatSend, input),
    retry: (threadId) => ipcRenderer.invoke(IPC.chatRetry, threadId),
    cancel: (requestId) => ipcRenderer.invoke(IPC.chatCancel, requestId),
    clear: (threadId) => ipcRenderer.invoke(IPC.chatClear, threadId),
    remove: (threadId) => ipcRenderer.invoke(IPC.chatRemove, threadId),
    updateFilters: (threadId, filters) =>
      ipcRenderer.invoke(IPC.chatUpdateFilters, threadId, filters),
    backup: (threadId) => ipcRenderer.invoke(IPC.chatBackup, threadId)
  },
  drive: {
    status: () => ipcRenderer.invoke(IPC.driveStatus),
    connect: () => ipcRenderer.invoke(IPC.driveConnect),
    disconnect: () => ipcRenderer.invoke(IPC.driveDisconnect),
    backupAll: () => ipcRenderer.invoke(IPC.driveBackupAll),
    backupNote: (path) => ipcRenderer.invoke(IPC.driveBackupNote, path)
  },
  onEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AppEvent): void => listener(payload)
    ipcRenderer.on(IPC.event, wrapped)
    return () => ipcRenderer.removeListener(IPC.event, wrapped)
  }
}

contextBridge.exposeInMainWorld('chismosito', api)
