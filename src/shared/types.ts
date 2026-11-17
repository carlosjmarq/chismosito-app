export type ThemeSetting = 'system' | 'light' | 'dark'
export type WhisperDevice = 'auto' | 'cpu' | 'cuda'
export type NoteStatus =
  | 'recording'
  | 'processing'
  | 'complete'
  | 'summary_failed'
  | 'transcription_failed'
  | 'cancelled'

export type JobStage =
  | 'queued'
  | 'preparing_audio'
  | 'transcribing_mic'
  | 'transcribing_system'
  | 'transcribing_mix'
  | 'merging'
  | 'summarizing'
  | 'finalizing'
  | 'done'
  | 'failed'
  | 'cancelled'

export type DriveSyncState = 'none' | 'pending' | 'synced' | 'failed'

export interface AppSettings {
  notesDir: string
  userName: string
  language: string
  micDeviceId: string | null
  recordMic: boolean
  recordSystem: boolean
  whisperDevice: WhisperDevice
  whisperThreads: number
  /** Id del catálogo ('' = automático según el equipo). */
  whisperModel: string
  whisperModelPath: string | null
  keepTempWav: boolean
  llmModel: string
  folderSuggestions: boolean
  jevModel: string
  closeToTray: boolean
  launchAtLogin: boolean
  hotkey: string
  autoBackup: boolean
  chatAutoBackup: boolean
  driveFolderName: string
  theme: ThemeSetting
  onboardingDismissed: boolean
}

export type LlmKeyState = 'ok' | 'missing' | 'unreadable'

export interface LlmModelOption {
  id: string
  label: string
}

export interface LlmModelList {
  /** true si la lista vino de /models; false si es la de respaldo. */
  ok: boolean
  source: 'api' | 'fallback'
  models: LlmModelOption[]
  error: string | null
  /** Base URL consultada (para mostrar de dónde salió la lista). */
  baseUrl: string
}

export interface LlmKeyStatus {
  configured: boolean
  /** Versión enmascarada de la key (nunca la key completa). */
  hint: string
  storagePath: string
  /** 'unreadable' = el archivo existe pero no se pudo descifrar. */
  state: LlmKeyState
  /** false si la key quedó guardada en claro (archivo heredado sin cifrar). */
  encrypted: boolean
  /** Diagnóstico cuando state es 'unreadable' o el archivo no está cifrado. */
  error: string | null
  /** Quedó una OPENCODE_API_KEY en el .env; conviene limpiarla. */
  keyInEnv: boolean
}

export interface EnvStatus {
  envPath: string
  llm: {
    configured: boolean
    baseUrl: string
    model: string
    source: 'env' | 'default'
    apiKey: LlmKeyStatus
  }
  jev: {
    configured: boolean
    baseUrl: string
    model: string
  }
  google: {
    clientConfigured: boolean
    tokenConfigured: boolean
    folderName: string
  }
  notesDirFromEnv: boolean
}

export interface WhisperModelStatus {
  present: boolean
  path: string
  name: string
  sizeBytes: number
  expectedBytes: number
  source: 'managed' | 'custom' | 'missing'
}

export type WhisperProfile = 'fastest' | 'balanced' | 'quality'

export interface WhisperModelInfo {
  id: string
  label: string
  family: string
  quant: string
  langs: 'multi' | 'en'
  bytes: number
  vramGb: number
  ramGb: number
  installed: boolean
  fit: 'gpu' | 'cpu' | 'ram'
  /** Perfiles para los que este modelo es la sugerencia. */
  roles: WhisperProfile[]
  active: boolean
}

export interface WhisperHardwareInfo {
  vramMb: number | null
  gpuName: string | null
  vramSource: 'nvidia-smi' | 'registry' | 'none'
  ramMb: number
  cores: number
  cudaBinary: boolean
}

export interface WhisperStatus {
  cpuBinary: boolean
  cudaBinary: boolean
  activeDevice: 'cpu' | 'cuda'
  model: WhisperModelStatus
  /** Catálogo con el veredicto para este equipo (multilingüe primero, .en al final). */
  models: WhisperModelInfo[]
  hardware: WhisperHardwareInfo
  /** Sugerencia por perfil para este equipo. */
  recommendations: Record<WhisperProfile, string>
  activeModelId: string | null
  customPath: string | null
  installedBytes: number
  diskFreeBytes: number | null
}

export type DownloadKind = 'model' | 'cuda'
export type DownloadStatus =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'done'
  | 'error'
  | 'cancelled'

export interface DownloadProgress {
  kind: DownloadKind
  /** Modelo del catálogo al que corresponde la descarga. */
  modelId?: string
  status: DownloadStatus
  receivedBytes: number
  totalBytes: number
  percent: number
  message?: string
}

export interface RecordingStartInput {
  hasMic: boolean
  hasSystem: boolean
  startedAt: string
  language: string
}

export interface RecordingStartResult {
  id: string
  baseName: string
  notePath: string
  audioPath: string
  micWavPath: string | null
  systemWavPath: string | null
}

export interface RecordingStopInput {
  id: string
  durationSeconds: number
  micPeak: number
  systemPeak: number
}

export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'stopping'

export interface RecordingStateUpdate {
  phase: RecordingPhase
  recordingId: string | null
  elapsedSeconds: number
}

export interface RecorderSnapshot {
  phase: RecordingPhase
  id: string | null
  elapsedSeconds: number
  micLevel: number
  systemLevel: number
  error: string | null
  warning: string | null
  startedAt: string | null
}

export interface TranscriptLine {
  timestamp: string
  seconds: number
  speaker: string
  text: string
}

export interface NoteMeta {
  path: string
  relativePath: string
  fileName: string
  baseName: string
  title: string
  date: string | null
  durationSeconds: number
  language: string
  audio: string | null
  audioExists: boolean
  folder: string
  suggestedFolder: string | null
  suggestedFolderConfidence: number | null
  tags: string[]
  status: NoteStatus
  llm: string | null
  excerpt: string
  mtimeMs: number
  sizeBytes: number
  drive: DriveSyncState
  driveError: string | null
}

export interface NoteDetail extends NoteMeta {
  raw: string
  content: string
  transcript: TranscriptLine[]
}

export interface NoteUpdateInput {
  path: string
  title?: string
  tags?: string[]
  folder?: string
}

export interface FolderActionResult {
  movedNotes: number
  removedFolders: number
}

export interface Job {
  id: string
  baseName: string
  notePath: string
  audioPath: string
  micWavPath: string | null
  systemWavPath: string | null
  durationSeconds: number
  language: string
  hasMic: boolean
  hasSystem: boolean
  meetingDate: string
  stage: JobStage
  progress: number
  message: string
  error: string | null
  /** Motivo por el que la captura por pista no es fiable; si existe, se usa el audio completo. */
  captureIssue?: string | null
  /** Fuerza a volver a transcribir desde el audio de la nota, ignorando la transcripción previa. */
  reprocessAudio?: boolean
  createdAt: string
  updatedAt: string
  transcriptChars: number
}

export interface DriveStatus {
  clientConfigured: boolean
  connected: boolean
  tokenSource: 'env' | 'stored' | 'none'
  folderName: string
  folderId: string | null
  lastBackupAt: string | null
  autoBackup: boolean
  root: string
  chats: {
    count: number
    lastBackupAt: string | null
  }
}

export interface DriveBackupSummary {
  total: number
  uploaded: number
  skipped: number
  failed: number
  errors: string[]
  chats: {
    uploaded: number
    skipped: number
    failed: number
  }
}

export interface DriveProgress {
  active: boolean
  current: string
  completed: number
  total: number
}

export interface LlmTestResult {
  ok: boolean
  model: string
  latencyMs: number
  error?: string
}

export type ChatScope = 'note' | 'library'

export interface ChatFilter {
  from: string | null
  to: string | null
  folder: string | null
}

export interface ChatSource {
  notePath: string
  title: string
  date: string | null
  timestamp?: string
  seconds?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  sources?: ChatSource[]
  error?: string | null
}

export interface ChatThread {
  id: string
  scope: ChatScope
  notePath: string | null
  noteTitle: string | null
  title: string
  messages: ChatMessage[]
  filters: ChatFilter | null
  createdAt: string
  updatedAt: string
}

export interface ChatThreadSummary {
  id: string
  scope: ChatScope
  notePath: string | null
  noteTitle: string | null
  title: string
  messageCount: number
  filters: ChatFilter | null
  updatedAt: string
}

export interface ChatOpenInput {
  scope: ChatScope
  notePath?: string | null
}

export interface ChatSendInput {
  threadId: string
  message: string
}

export interface ChatSendResult {
  requestId: string
  threadId: string
  userMessage: ChatMessage
}

export type ChatStreamEvent =
  | { type: 'started'; requestId: string; threadId: string }
  | { type: 'status'; requestId: string; threadId: string; label: string }
  | { type: 'delta'; requestId: string; threadId: string; text: string }
  | { type: 'done'; requestId: string; threadId: string; message: ChatMessage }
  | { type: 'error'; requestId: string; threadId: string; message: string }

export interface AppInfo {
  version: string
  platform: string
  userData: string
  appPath: string
  envPath: string
  notesDir: string
}

export type AppCommand = 'start-recording' | 'stop-recording' | 'open-settings' | 'open-note'

export type ToastLevel = 'info' | 'success' | 'error'

export type AppEvent =
  | { type: 'jobs'; jobs: Job[] }
  | { type: 'notes-changed' }
  | { type: 'download'; progress: DownloadProgress }
  | { type: 'drive'; status: DriveStatus }
  | { type: 'drive-progress'; progress: DriveProgress }
  | { type: 'command'; command: AppCommand; notePath?: string }
  | { type: 'recording-state'; state: RecordingStateUpdate }
  | { type: 'chat'; event: ChatStreamEvent }
  | { type: 'toast'; level: ToastLevel; message: string }
  | { type: 'env-changed' }

export interface ChismositoApi {
  app: {
    info(): Promise<AppInfo>
    openPath(path: string): Promise<void>
    revealPath(path: string): Promise<void>
    openExternal(url: string): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
    chooseNotesDir(): Promise<string | null>
  }
  env: {
    status(): Promise<EnvStatus>
  }
  recording: {
    start(input: RecordingStartInput): Promise<RecordingStartResult>
    sendWebmChunk(id: string, chunk: ArrayBuffer): void
    sendPcmChunk(id: string, track: 'mic' | 'system', chunk: ArrayBuffer): void
    stop(input: RecordingStopInput): Promise<Job>
    cancel(id: string): Promise<void>
    setState(state: RecordingStateUpdate): void
  }
  jobs: {
    list(): Promise<Job[]>
    retry(id: string): Promise<void>
    cancel(id: string): Promise<void>
  }
  notes: {
    list(): Promise<NoteMeta[]>
    get(path: string): Promise<NoteDetail | null>
    update(input: NoteUpdateInput): Promise<NoteDetail>
    move(path: string, folder: string | null): Promise<NoteDetail>
    remove(path: string): Promise<void>
    folders(): Promise<string[]>
    clearFolderSuggestion(path: string): Promise<NoteDetail>
    reveal(path: string): Promise<void>
    resummarize(path: string): Promise<void>
    reprocess(path: string): Promise<void>
    search(query: string): Promise<NoteMeta[]>
  }
  folders: {
    create(path: string): Promise<FolderActionResult>
    rename(path: string, newName: string): Promise<FolderActionResult>
    remove(path: string): Promise<FolderActionResult>
  }
  whisper: {
    status(): Promise<WhisperStatus>
    downloadModel(modelId: string): Promise<WhisperStatus>
    removeModel(modelId: string): Promise<WhisperStatus>
    chooseCustom(): Promise<WhisperStatus>
    clearCustom(): Promise<WhisperStatus>
    downloadCuda(): Promise<WhisperStatus>
    cancelDownload(): Promise<void>
  }
  llm: {
    test(): Promise<LlmTestResult>
    models(): Promise<LlmModelList>
    setApiKey(key: string): Promise<LlmKeyStatus>
    clearApiKey(): Promise<LlmKeyStatus>
    scrubEnvKey(): Promise<LlmKeyStatus>
  }
  jev: {
    test(): Promise<LlmTestResult>
  }
  chat: {
    threads(scope: ChatScope): Promise<ChatThreadSummary[]>
    get(threadId: string): Promise<ChatThread | null>
    open(input: ChatOpenInput): Promise<ChatThread>
    create(): Promise<ChatThread>
    send(input: ChatSendInput): Promise<ChatSendResult>
    retry(threadId: string): Promise<ChatSendResult>
    cancel(requestId: string): Promise<void>
    clear(threadId: string): Promise<ChatThread>
    remove(threadId: string): Promise<void>
    updateFilters(threadId: string, filters: ChatFilter | null): Promise<ChatThreadSummary>
    backup(threadId: string): Promise<void>
  }
  drive: {
    status(): Promise<DriveStatus>
    connect(): Promise<DriveStatus>
    disconnect(): Promise<DriveStatus>
    backupAll(): Promise<DriveBackupSummary>
    backupNote(path: string): Promise<void>
  }
  onEvent(listener: (event: AppEvent) => void): () => void
}
