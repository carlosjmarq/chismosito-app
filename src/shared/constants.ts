export const IPC = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChooseDir: 'settings:choose-dir',

  envStatus: 'env:status',

  appInfo: 'app:info',
  appOpenPath: 'app:open-path',
  appRevealPath: 'app:reveal-path',
  appOpenExternal: 'app:open-external',

  recordingStart: 'recording:start',
  recordingWebmChunk: 'recording:webm-chunk',
  recordingTrackChunk: 'recording:track-chunk',
  recordingPcmChunk: 'recording:pcm-chunk',
  recordingStop: 'recording:stop',
  recordingCancel: 'recording:cancel',
  recordingState: 'recording:state',

  jobsList: 'jobs:list',
  jobsRetry: 'jobs:retry',
  jobsCancel: 'jobs:cancel',

  notesList: 'notes:list',
  notesGet: 'notes:get',
  notesUpdate: 'notes:update',
  notesMove: 'notes:move',
  notesDelete: 'notes:delete',
  notesFolders: 'notes:folders',
  notesClearFolderSuggestion: 'notes:clear-folder-suggestion',
  notesReveal: 'notes:reveal',
  notesResummarize: 'notes:resummarize',
  notesReprocess: 'notes:reprocess',
  notesRetranscribeBegin: 'notes:retranscribe-begin',
  notesRetranscribeChunk: 'notes:retranscribe-chunk',
  notesRetranscribeFinish: 'notes:retranscribe-finish',
  notesRetranscribeCancel: 'notes:retranscribe-cancel',
  notesDuplicate: 'notes:duplicate',
  notesAudioBytes: 'notes:audio-bytes',
  notesSearch: 'notes:search',

  foldersCreate: 'folders:create',
  foldersRename: 'folders:rename',
  foldersRemove: 'folders:remove',

  whisperStatus: 'whisper:status',
  whisperDownloadModel: 'whisper:download-model',
  whisperRemoveModel: 'whisper:remove-model',
  whisperChooseCustom: 'whisper:choose-custom',
  whisperClearCustom: 'whisper:clear-custom',
  whisperDownloadCuda: 'whisper:download-cuda',
  whisperDownloadVad: 'whisper:download-vad',
  whisperCancelDownload: 'whisper:cancel-download',

  llmTest: 'llm:test',
  llmModels: 'llm:models',
  llmKeySet: 'llm:key-set',
  llmKeyClear: 'llm:key-clear',
  llmEnvKeyScrub: 'llm:env-key-scrub',
  jevTest: 'jev:test',

  chatThreads: 'chat:threads',
  chatGet: 'chat:get',
  chatOpen: 'chat:open',
  chatCreate: 'chat:create',
  chatSend: 'chat:send',
  chatRetry: 'chat:retry',
  chatCancel: 'chat:cancel',
  chatClear: 'chat:clear',
  chatRemove: 'chat:remove',
  chatUpdateFilters: 'chat:update-filters',
  chatBackup: 'chat:backup',

  driveStatus: 'drive:status',
  driveConnect: 'drive:connect',
  driveDisconnect: 'drive:disconnect',
  driveBackupAll: 'drive:backup-all',
  driveBackupNote: 'drive:backup-note',

  event: 'app:event'
} as const

export const CUDA_ZIP_NAME = 'whisper-bin-win-cuda-12.4.0-x64.zip'
export const CUDA_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/b5454/${CUDA_ZIP_NAME}`
export const VAD_FILE_NAME = 'ggml-silero-v5.1.2.bin'
export const VAD_EXPECTED_BYTES = 885_098

export const MISSING_KEY_MESSAGE =
  'Falta la API key de OpenCode. Agrégala en Ajustes → Resumen con LLM.'

export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+R'
export const DEFAULT_LLM_BASE_URL = 'https://opencode.ai/inference/go/openai/v1'
export const DEFAULT_LLM_MODEL = 'deepseek-v4.1-flash'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
