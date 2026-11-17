import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  Cpu,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FolderOpen,
  Gauge,
  HardDrive,
  KeyRound,
  Loader2,
  Mic,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Trash2,
  Volume2
} from 'lucide-react'
import type {
  AppSettings,
  DownloadProgress,
  LlmModelList,
  LlmModelOption,
  LlmTestResult
} from '@shared/types'
import { useAppStore } from '../store'
import { ProgressBar } from '../components/ProgressBar'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { FolderManager } from '../components/FolderManager'
import { ModelPicker } from '../components/ModelPicker'
import { WhisperModelPicker } from '../components/WhisperModelPicker'
import { errorMessage } from '../lib/errors'
import { formatBytes, timeAgo } from '../lib/format'
import { cn } from '../lib/cn'

export function SettingsPage(): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const env = useAppStore((state) => state.env)
  const appInfo = useAppStore((state) => state.appInfo)
  const whisper = useAppStore((state) => state.whisper)
  const drive = useAppStore((state) => state.drive)
  const download = useAppStore((state) => state.download)
  const driveProgress = useAppStore((state) => state.driveProgress)
  const recordingPhase = useAppStore((state) => state.recording.phase)
  const folders = useAppStore((state) => state.folders)
  const setSettings = useAppStore((state) => state.setSettings)
  const setDrive = useAppStore((state) => state.setDrive)
  const setWhisper = useAppStore((state) => state.setWhisper)
  const pushToast = useAppStore((state) => state.pushToast)
  const refreshNotes = useAppStore((state) => state.refreshNotes)
  const refreshWhisper = useAppStore((state) => state.refreshWhisper)
  const refreshDrive = useAppStore((state) => state.refreshDrive)
  const refreshEnv = useAppStore((state) => state.refreshEnv)
  const [searchParams] = useSearchParams()

  const [saving, setSaving] = useState(false)
  const [userName, setUserName] = useState(settings?.userName ?? '')
  const [llmModel, setLlmModel] = useState(settings?.llmModel ?? '')
  const [jevModel, setJevModel] = useState(settings?.jevModel ?? '')
  const [driveFolder, setDriveFolder] = useState(settings?.driveFolderName ?? 'Chismosito')
  const [hotkey, setHotkey] = useState(settings?.hotkey ?? '')
  const [threads, setThreads] = useState(String(settings?.whisperThreads ?? 8))
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([])
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null)
  const [modelList, setModelList] = useState<LlmModelList | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [customModel, setCustomModel] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [savingApiKey, setSavingApiKey] = useState(false)
  const [confirmClearKey, setConfirmClearKey] = useState(false)
  const [scrubbingEnv, setScrubbingEnv] = useState(false)
  const [confirmRemoveModel, setConfirmRemoveModel] = useState<string | null>(null)
  const [testingLlm, setTestingLlm] = useState(false)
  const [llmTest, setLlmTest] = useState<LlmTestResult | null>(null)
  const [testingJev, setTestingJev] = useState(false)
  const [jevTest, setJevTest] = useState<LlmTestResult | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [confirmCuda, setConfirmCuda] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [modelsDir, setModelsDir] = useState('')
  const sectionScrolled = useRef(false)

  useEffect(() => {
    if (!env) return
    // La lista depende de la API key y del endpoint configurados.
    void loadModels()
  }, [env?.llm.configured, env?.llm.baseUrl])

  useEffect(() => {
    if (!settings) return
    setUserName(settings.userName)
    setLlmModel(settings.llmModel)
    setJevModel(settings.jevModel)
    setDriveFolder(settings.driveFolderName)
    setHotkey(settings.hotkey)
    setThreads(String(settings.whisperThreads))
  }, [settings])

  useEffect(() => {
    if (sectionScrolled.current) return
    const section = searchParams.get('section')
    if (!section) return
    const timer = window.setTimeout(() => {
      document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      sectionScrolled.current = true
    }, 250)
    return () => window.clearTimeout(timer)
  }, [searchParams])

  useEffect(() => {
    void refreshDevices()
    const handler = (): void => void refreshDevices()
    navigator.mediaDevices?.addEventListener('devicechange', handler)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', handler)
  }, [])

  useEffect(() => {
    if (!appInfo) return
    setModelsDir(`${appInfo.userData}\\models`)
  }, [appInfo])

  const modelOptions = useMemo<LlmModelOption[]>(() => {
    const list = modelList?.models ?? []
    const saved = settings?.llmModel?.trim()
    if (saved && !list.some((model) => model.id === saved)) {
      return [...list, { id: saved, label: saved }]
    }
    return list
  }, [modelList, settings?.llmModel])

  if (!settings) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <div className="shimmer h-8 w-40 rounded-xl" />
        <div className="shimmer mt-8 h-64 rounded-3xl" />
      </div>
    )
  }

  const update = async (patch: Partial<AppSettings>): Promise<void> => {
    setSaving(true)
    try {
      const next = await window.chismosito.settings.update(patch)
      setSettings(next)
      if (patch.notesDir) {
        await refreshNotes()
      }
      // El modelo activo y el dispositivo se resuelven en main a partir de los
      // ajustes, así que hay que volver a pedir el estado o la UI queda vieja.
      if (
        patch.whisperModel !== undefined ||
        patch.whisperModelPath !== undefined ||
        patch.whisperDevice !== undefined
      ) {
        await refreshWhisper()
      }
    } catch (error) {
      pushToast('error', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const refreshDevices = async (): Promise<void> => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(
        list
          .filter((device) => device.kind === 'audioinput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Micrófono ${index + 1}`
          }))
      )
    } catch {
      setDevices([])
    }
  }

  const askMicPermission = async (): Promise<void> => {
    setMicPermissionError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      await refreshDevices()
    } catch (error) {
      setMicPermissionError(errorMessage(error))
    }
  }

  const chooseNotesDir = async (): Promise<void> => {
    const path = await window.chismosito.settings.chooseNotesDir()
    if (!path) return
    await update({ notesDir: path })
  }

  const downloadModel = async (modelId: string): Promise<void> => {
    try {
      const status = await window.chismosito.whisper.downloadModel(modelId)
      setWhisper(status)
      await refreshWhisper()
      const model = status.models.find((entry) => entry.id === modelId)
      pushToast('success', `Modelo ${model ? `${model.label} · ${model.quant}` : modelId} listo`)
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  const removeModel = async (modelId: string): Promise<void> => {
    try {
      const status = await window.chismosito.whisper.removeModel(modelId)
      setWhisper(status)
      await refreshWhisper()
      pushToast('info', 'Modelo eliminado del disco')
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  const chooseCustomModel = async (): Promise<void> => {
    try {
      setWhisper(await window.chismosito.whisper.chooseCustom())
      await refreshWhisper()
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  const clearCustomModel = async (): Promise<void> => {
    try {
      setWhisper(await window.chismosito.whisper.clearCustom())
      await refreshWhisper()
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  const downloadCuda = async (): Promise<void> => {
    try {
      const status = await window.chismosito.whisper.downloadCuda()
      setWhisper(status)
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  const cancelDownload = async (): Promise<void> => {
    await window.chismosito.whisper.cancelDownload()
  }

  const loadModels = async (): Promise<void> => {
    setLoadingModels(true)
    try {
      setModelList(await window.chismosito.llm.models())
    } catch (error) {
      pushToast('error', errorMessage(error))
    } finally {
      setLoadingModels(false)
    }
  }

  const saveApiKey = async (): Promise<void> => {
    const value = apiKey.trim()
    if (!value) {
      pushToast('error', 'Escribe una API key')
      return
    }
    setSavingApiKey(true)
    try {
      await window.chismosito.llm.setApiKey(value)
      setApiKey('')
      setLlmTest(null)
      setJevTest(null)
      await refreshEnv()
      // Reemplazar una key existente no cambia `env.llm.configured`, así que el
      // efecto que carga la lista no se dispara: la refrescamos aquí.
      if (env?.llm.configured) void loadModels()
      pushToast('success', 'API key guardada')
    } catch (error) {
      pushToast('error', errorMessage(error))
    } finally {
      setSavingApiKey(false)
    }
  }

  const scrubEnvKey = async (): Promise<void> => {
    setScrubbingEnv(true)
    try {
      const status = await window.chismosito.llm.scrubEnvKey()
      await refreshEnv()
      if (status.keyInEnv) {
        pushToast('error', 'No se pudo eliminar OPENCODE_API_KEY del .env')
      } else {
        pushToast(
          'success',
          'OPENCODE_API_KEY eliminada del .env (respaldo .bak sin la key)'
        )
      }
    } catch (error) {
      pushToast('error', errorMessage(error))
    } finally {
      setScrubbingEnv(false)
    }
  }

  const clearApiKey = async (): Promise<void> => {
    try {
      await window.chismosito.llm.clearApiKey()
      setApiKey('')
      setLlmTest(null)
      setJevTest(null)
      await refreshEnv()
      pushToast('success', 'API key eliminada')
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  const testLlm = async (): Promise<void> => {
    setTestingLlm(true)
    setLlmTest(null)
    try {
      setLlmTest(await window.chismosito.llm.test())
    } catch (error) {
      setLlmTest({ ok: false, model: '', latencyMs: 0, error: errorMessage(error) })
    } finally {
      setTestingLlm(false)
    }
  }

  const testJev = async (): Promise<void> => {
    if (jevModel.trim() !== settings.jevModel) {
      await update({ jevModel: jevModel.trim() })
    }
    setTestingJev(true)
    setJevTest(null)
    try {
      setJevTest(await window.chismosito.jev.test())
    } catch (error) {
      setJevTest({ ok: false, model: '', latencyMs: 0, error: errorMessage(error) })
    } finally {
      setTestingJev(false)
    }
  }

  const connectDrive = async (): Promise<void> => {
    setConnecting(true)
    try {
      const status = await window.chismosito.drive.connect()
      setDrive(status)
      await refreshDrive()
    } catch (error) {
      pushToast('error', errorMessage(error))
    } finally {
      setConnecting(false)
    }
  }

  const disconnectDrive = async (): Promise<void> => {
    try {
      const status = await window.chismosito.drive.disconnect()
      setDrive(status)
      pushToast('info', 'Google Drive desconectado')
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  const backupAll = async (): Promise<void> => {
    setBackingUp(true)
    try {
      await window.chismosito.drive.backupAll()
      await refreshDrive()
    } catch (error) {
      pushToast('error', errorMessage(error))
    } finally {
      setBackingUp(false)
    }
  }

  const modelDownloading =
    download?.kind === 'model' && ['downloading', 'extracting'].includes(download.status)
  const cudaDownloading =
    download?.kind === 'cuda' && ['downloading', 'extracting'].includes(download.status)
  const recordingBusy = recordingPhase !== 'idle'

  return (
    <div className="mx-auto w-full max-w-4xl px-7 py-8 lg:px-10 lg:py-10">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
            Chismosito
          </p>
          <h1 className="font-serif text-4xl leading-tight">Ajustes</h1>
          <p className="mt-1 text-sm text-muted">
            Todo se guarda automáticamente en este equipo.
          </p>
        </div>
        <span className="chip">
          {saving ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Guardando
            </>
          ) : (
            <>
              <Save className="size-3" /> Guardado
            </>
          )}
        </span>
      </header>

      <div className="space-y-5">
        <Section
          id="general"
          title="General"
          description="Tu identidad, idioma de transcripción y apariencia."
        >
          <Row label="Tu nombre" hint="Se usa para asignarte acciones en el resumen.">
            <input
              className="field max-w-xs"
              value={userName}
              onChange={(event) => setUserName(event.target.value)}
              onBlur={() => userName !== settings.userName && void update({ userName: userName.trim() })}
              placeholder="Carlos"
            />
          </Row>
          <Row label="Idioma de la reunión" hint="Whisper usa este idioma para transcribir.">
            <select
              className="field max-w-xs"
              value={settings.language}
              onChange={(event) => void update({ language: event.target.value })}
            >
              <option value="es">Español</option>
              <option value="auto">Detectar automáticamente</option>
              <option value="en">Inglés</option>
              <option value="pt">Portugués</option>
              <option value="fr">Francés</option>
              <option value="de">Alemán</option>
              <option value="it">Italiano</option>
              <option value="ja">Japonés</option>
              <option value="zh">Chino</option>
            </select>
          </Row>
          <Row label="Tema" hint="Claro, oscuro o el que use Windows.">
            <select
              className="field max-w-xs"
              value={settings.theme}
              onChange={(event) =>
                void update({ theme: event.target.value as AppSettings['theme'] })
              }
            >
              <option value="system">Sistema</option>
              <option value="light">Claro</option>
              <option value="dark">Oscuro</option>
            </select>
          </Row>
          <Row
            label="Carpeta de notas"
            hint="Ahí viven los .md y sus archivos de audio. Puedes abrirla en Explorer."
          >
            <div className="flex max-w-xl flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-surface2 px-2.5 py-2 text-[11px] text-muted">
                {settings.notesDir}
              </code>
              <button className="btn-secondary h-8 text-xs" onClick={() => void chooseNotesDir()} disabled={recordingBusy} title={recordingBusy ? 'Detén la grabación para cambiar la carpeta' : undefined}>
                <FolderOpen className="size-3.5" /> Cambiar
              </button>
              <button
                className="btn-ghost h-8 px-2 text-xs"
                onClick={() => void window.chismosito.app.openPath(settings.notesDir)}
                title="Abrir carpeta"
              >
                <ExternalLink className="size-3.5" />
              </button>
            </div>
          </Row>
        </Section>

        <Section
          id="folders"
          title="Carpetas"
          description="Organiza tus reuniones. Al eliminar una carpeta, sus notas se mueven a Sin clasificar."
        >
          <FolderManager />
        </Section>

        <Section
          id="audio"
          title="Audio"
          description="De dónde tomamos el audio y cómo se mezcla."
        >
          <Row label="Micrófono" hint="Captura tu voz como hablante «Yo».">
            <Toggle
              checked={settings.recordMic}
              onChange={(value) => void update({ recordMic: value })}
              disabled={recordingBusy}
            />
          </Row>
          <Row label="Audio del sistema" hint="Captura llamadas, videos y lo que suena en tu PC como «Otros».">
            <Toggle
              checked={settings.recordSystem}
              onChange={(value) => void update({ recordSystem: value })}
              disabled={recordingBusy}
            />
          </Row>
          <Row label="Dispositivo de entrada" hint="Si no ves nombres, autoriza el micrófono primero.">
            <div className="flex max-w-xl flex-wrap items-center gap-2">
              <select
                className="field min-w-[220px] flex-1"
                value={settings.micDeviceId ?? ''}
                onChange={(event) =>
                  void update({ micDeviceId: event.target.value || null })
                }
                disabled={recordingBusy}
              >
                <option value="">Micrófono predeterminado</option>
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
              <button className="btn-secondary h-9 text-xs" onClick={() => void askMicPermission()}>
                <Mic className="size-3.5" /> Autorizar
              </button>
            </div>
            {micPermissionError ? (
              <p className="mt-2 text-[11px] text-red-600 dark:text-red-300">{micPermissionError}</p>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
                <Volume2 className="size-3" />
                Usa audífonos para que el audio del sistema no se cuele por el micrófono.
              </p>
            )}
          </Row>
        </Section>

        <Section
          id="transcription"
          title="Transcripción"
          description="whisper.cpp corre en tu equipo. Nada de audio se sube a la nube."
        >
          {whisper ? (
            <WhisperModelPicker
              status={whisper}
              progress={download}
              downloadingId={
                download?.kind === 'model' &&
                (download.status === 'downloading' || download.status === 'verifying')
                  ? (download.modelId ?? null)
                  : null
              }
              onSelect={(id) => void update({ whisperModel: id })}
              onDownload={(id) => void downloadModel(id)}
              onRemove={(id) => setConfirmRemoveModel(id)}
              onChooseCustom={() => void chooseCustomModel()}
              onClearCustom={() => void clearCustomModel()}
              onCancelDownload={() => void cancelDownload()}
            />
          ) : null}

          <Row label="Procesador" hint="auto usa CUDA si el pack está instalado; si falla, cae a CPU.">
            <select
              className="field max-w-xs"
              value={settings.whisperDevice}
              onChange={(event) =>
                void update({ whisperDevice: event.target.value as AppSettings['whisperDevice'] })
              }
            >
              <option value="auto">Automático</option>
              <option value="cpu">CPU</option>
              <option value="cuda">GPU NVIDIA (CUDA)</option>
            </select>
          </Row>

          <div className="rounded-2xl border border-line bg-surface2/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  {whisper?.cudaBinary ? (
                    <Check className="size-4 text-olive" />
                  ) : (
                    <Cpu className="size-4 text-muted" />
                  )}
                  <p className="text-sm font-medium">
                    Aceleración CUDA {whisper?.cudaBinary ? 'instalada' : 'opcional'}
                  </p>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  {whisper?.cudaBinary
                    ? `Activo: ${whisper.activeDevice === 'cuda' ? 'GPU' : 'CPU (según tu selección)'}.`
                    : 'Pack para NVIDIA (~650 MB). Transcribe varias veces más rápido en reuniones largas.'}
                </p>
              </div>
              {!whisper?.cudaBinary ? (
                <button
                  className="btn-secondary h-9 text-xs"
                  onClick={() => setConfirmCuda(true)}
                  disabled={cudaDownloading}
                >
                  {cudaDownloading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  Descargar pack
                </button>
              ) : null}
            </div>
            {cudaDownloading && download ? (
              <div className="mt-3">
                <ProgressBar
                  value={download.percent}
                  className="h-1.5"
                  indeterminate={download.status === 'extracting'}
                />
                <p className="mt-1.5 text-[10px] text-muted">
                  {download.status === 'extracting'
                    ? 'Extrayendo el paquete…'
                    : `${formatBytes(download.receivedBytes)} de ${formatBytes(download.totalBytes)} · ${download.percent}%`}
                </p>
              </div>
            ) : null}
          </div>

          <Row label="Hilos de CPU" hint="Más hilos no siempre es más rápido. Prueba 6–8.">
            <input
              type="number"
              min={1}
              max={32}
              className="field max-w-[110px]"
              value={threads}
              onChange={(event) => setThreads(event.target.value)}
              onBlur={() => {
                const value = Math.max(1, Math.min(32, Number(threads) || 8))
                setThreads(String(value))
                if (value !== settings.whisperThreads) void update({ whisperThreads: value })
              }}
            />
          </Row>
          <Row
            label="Conservar WAV temporales"
            hint="Solo para depurar. Ocupa ~115 MB por hora y se borra al terminar."
          >
            <Toggle
              checked={settings.keepTempWav}
              onChange={(value) => void update({ keepTempWav: value })}
            />
          </Row>
          <Row label="Binario de whisper" hint="Se incluye con la aplicación; el pack CUDA es aparte.">
            <span className="text-xs text-muted">
              {whisper?.cpuBinary ? 'whisper-cli.exe presente' : 'Falta whisper-cli.exe'}
            </span>
          </Row>
        </Section>

        <Section
          id="llm"
          title="Resumen con LLM"
          description="La transcripción se envía al proveedor configurado para generar la nota."
        >
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface2/50 px-4 py-3 text-xs">
            {env?.llm.configured ? (
              <Check className="size-4 text-olive" />
            ) : (
              <AlertTriangle className="size-4 text-gold" />
            )}
            <span className="font-medium">{env?.llm.configured ? 'API key configurada' : 'Falta la API key'}</span>
            {env?.llm.configured && env.llm.apiKey.hint ? (
              <>
                <span className="text-muted">·</span>
                <span className="font-mono text-muted">{env.llm.apiKey.hint}</span>
              </>
            ) : null}
            <span className="text-muted">·</span>
            <span className="break-all text-muted">{env?.llm.baseUrl}</span>
          </div>

          {env?.llm.apiKey.state === 'unreadable' ? (
            <div className="rounded-2xl border border-gold/40 bg-surface2/60 px-4 py-3 text-xs leading-relaxed">
              <p className="font-medium text-ink">No se pudo cargar la API key</p>
              <p className="mt-1 break-words text-muted">
                {env.llm.apiKey.error ??
                  'No se pudo leer el archivo de la key.'}{' '}
                Si la key estaba en el .env, sigue ahí; pega la key de nuevo para reemplazarla.
              </p>
            </div>
          ) : null}

          {env?.llm.configured && !env.llm.apiKey.encrypted ? (
            <div className="rounded-2xl border border-gold/40 bg-surface2/60 px-4 py-3 text-xs leading-relaxed">
              <p className="font-medium text-ink">La API key está guardada sin cifrar</p>
              <p className="mt-1 break-words text-muted">
                {env.llm.apiKey.error ??
                  'Windows no ofreció cifrado cuando se guardó.'}{' '}
                Vuelve a guardarla para cifrarla con DPAPI.
              </p>
            </div>
          ) : null}

          {env?.llm.apiKey.keyInEnv ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gold/40 bg-surface2/60 px-4 py-3 text-xs leading-relaxed">
              <AlertTriangle className="size-4 shrink-0 text-gold" />
              <span className="min-w-0 flex-1 break-words text-muted">
                Todavía hay una <code>OPENCODE_API_KEY</code> en texto plano en el .env.{' '}
                {env.llm.configured
                  ? 'Chismosito usa la de Ajustes; puedes borrar la del archivo.'
                  : 'No hay key en Ajustes: la app no usará la del archivo. Configúrala en Ajustes o bórrala.'}
              </span>
              <button
                className="btn-secondary h-8 text-xs"
                onClick={() => void scrubEnvKey()}
                disabled={scrubbingEnv}
              >
                {scrubbingEnv ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                Limpiar .env
              </button>
            </div>
          ) : null}

          <Row
            label="API key de OpenCode"
            hint="Se guarda cifrada con DPAPI y nunca se envía al renderer."
          >
            <div className="max-w-xl space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="field flex-1"
                  type={showApiKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveApiKey()
                  }}
                  placeholder={
                    env?.llm.apiKey.configured
                      ? 'Pega una key nueva para reemplazarla'
                      : 'Pega tu API key de OpenCode'
                  }
                />
                <button
                  className="btn-ghost h-9 px-2"
                  onClick={() => setShowApiKey((value) => !value)}
                  title={showApiKey ? 'Ocultar' : 'Mostrar'}
                  aria-label={showApiKey ? 'Ocultar API key' : 'Mostrar API key'}
                >
                  {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
                <button
                  className="btn-primary h-9 text-xs"
                  onClick={() => void saveApiKey()}
                  disabled={savingApiKey || !apiKey.trim()}
                >
                  {savingApiKey ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  Guardar
                </button>
                {env?.llm.apiKey.configured ? (
                  <button
                    className="btn-secondary h-9 text-xs"
                    onClick={() => setConfirmClearKey(true)}
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
              <p className="text-[10px] leading-relaxed text-muted">
                La misma key se usa para el resumen, el chat y Jev. Se aplica al instante, sin
                reiniciar la app, y solo se guarda si Windows puede cifrarla (DPAPI). Créala en
                OpenCode Console → API keys.
              </p>
              <p className="break-all text-[10px] leading-relaxed text-muted/70">
                Archivo: {env?.llm.apiKey.storagePath ?? 'secrets.json'}
              </p>
            </div>
          </Row>

          <Row
            label="Modelo"
            hint="Lista del plan OpenCode Go con tu API key. “Default del .env” usa LLM_MODEL."
          >
            <div className="max-w-xl space-y-2">
              <ModelPicker
                value={settings.llmModel}
                defaultLabel={`Default del .env (${env?.llm.model ?? 'deepseek-v4.1-flash'})`}
                options={modelOptions}
                loading={loadingModels}
                onRefresh={() => void loadModels()}
                onChange={(id) => {
                  setCustomModel(false)
                  setLlmModel(id)
                  if (id !== settings.llmModel) void update({ llmModel: id })
                }}
                onCustom={() => {
                  setCustomModel(true)
                  setLlmModel(settings.llmModel)
                }}
              />

              {customModel ? (
                <input
                  className="field"
                  autoFocus
                  value={llmModel}
                  onChange={(event) => setLlmModel(event.target.value)}
                  onBlur={() => {
                    if (llmModel.trim() !== settings.llmModel) {
                      void update({ llmModel: llmModel.trim() })
                    }
                  }}
                  placeholder="deepseek-v4.1-flash"
                />
              ) : null}

              {settings.llmModel === 'claude-sonnet-5' ? (
                <p className="text-[10px] leading-relaxed text-gold">
                  claude-sonnet-5 no está en el plan Go. Para usarlo, cambia LLM_BASE_URL a
                  https://opencode.ai/inference/openai/v1 en el .env y reinicia la app.
                </p>
              ) : null}

              <p className="break-all text-[10px] leading-relaxed text-muted">
                {modelList?.ok
                  ? `${modelList.models.length} modelos desde ${modelList.baseUrl}`
                  : `Lista local de respaldo (${modelList?.error ?? 'sin conexión'}).`}
              </p>
              <p className="text-[10px] leading-relaxed text-muted">
                deepseek-v4.1-flash es el más económico; claude-haiku-5.5 el más rápido del plan
                Go. Si un modelo aparece bloqueado, actívalo en{' '}
                <button
                  className="underline underline-offset-2 hover:no-underline"
                  onClick={() =>
                    void window.chismosito.app.openExternal('https://opencode.ai/console')
                  }
                >
                  OpenCode Console → Models
                </button>{' '}
                y revisa los créditos del workspace.
              </p>
            </div>
          </Row>

          <Row
            label="Sugerir carpeta al terminar"
            hint="Jev analiza el resumen y propone una carpeta existente. Solo para notas nuevas sin carpeta."
          >
            <Toggle
              checked={settings.folderSuggestions}
              onChange={(value) => void update({ folderSuggestions: value })}
            />
          </Row>

          <Row
            label="Modelo de Jev"
            hint="Jev es un modelo de decisión de OpenCode. La versión Free es gratis por tiempo limitado."
          >
            <div className="max-w-xl space-y-2">
              <input
                className="field"
                value={jevModel}
                onChange={(event) => setJevModel(event.target.value)}
                onBlur={() =>
                  jevModel !== settings.jevModel && void update({ jevModel: jevModel.trim() })
                }
                placeholder={env?.jev.model}
              />
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['jev-1.13-free', 'Gratis'],
                  ['jev-1.13', 'Pago']
                ].map(([model, label]) => (
                  <button
                    key={model}
                    onClick={() => {
                      setJevModel(model)
                      void update({ jevModel: model })
                    }}
                    className="chip hover:border-accent/40 hover:text-accent"
                  >
                    {label}: {model}
                  </button>
                ))}
              </div>
              <p className="break-all text-[10px] leading-relaxed text-muted">
                Endpoint: {env?.jev.baseUrl}
              </p>
              {env && folders.length === 0 ? (
                <p className="text-[10px] leading-relaxed text-gold">
                  Crea al menos una carpeta en la sección Carpetas para recibir sugerencias.
                </p>
              ) : null}
            </div>
          </Row>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn-secondary h-9 text-xs"
              onClick={() => void testJev()}
              disabled={testingJev || !env?.jev.configured}
            >
              {testingJev ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Probar Jev
            </button>
            {jevTest ? (
              <span
                className={cn(
                  'text-[11px]',
                  jevTest.ok ? 'text-olive' : 'text-red-600 dark:text-red-300'
                )}
              >
                {jevTest.ok
                  ? `OK · ${jevTest.model} · ${jevTest.latencyMs} ms`
                  : jevTest.error || 'Falló la conexión con Jev'}
              </span>
            ) : null}
          </div>

          <p className="rounded-xl border border-line bg-surface2/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
            Jev recibe el título, el resumen, las decisiones, las acciones y los temas de la
            reunión. No recibe el audio ni la transcripción completa.
          </p>

          <Row
            label="Endpoint y modelos por defecto"
            hint="La URL y los modelos por defecto se leen del .env; reinicia la app después de editarlo. La API key ya no vive ahí."
          >
            <div className="max-w-xl space-y-2">
              <code className="block break-all rounded-lg bg-surface2 px-2.5 py-2 text-[11px] text-muted">
                {env?.envPath}
              </code>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-secondary h-8 text-xs"
                  onClick={() =>
                    env?.envPath &&
                    void window.chismosito.app.openPath(env.envPath).catch((error) =>
                      pushToast('error', errorMessage(error))
                    )
                  }
                >
                  <KeyRound className="size-3.5" /> Abrir .env
                </button>
                <button
                  className="btn-ghost h-8 text-xs"
                  onClick={() => {
                    if (!env?.envPath) return
                    void navigator.clipboard.writeText(env.envPath)
                    pushToast('success', 'Ruta copiada')
                  }}
                >
                  Copiar ruta
                </button>
              </div>
            </div>
          </Row>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn-secondary h-9 text-xs"
              onClick={() => void testLlm()}
              disabled={testingLlm || !env?.llm.configured}
            >
              {testingLlm ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Probar conexión
            </button>
            {llmTest ? (
              <span
                className={cn(
                  'text-[11px]',
                  llmTest.ok ? 'text-olive' : 'text-red-600 dark:text-red-300'
                )}
              >
                {llmTest.ok
                  ? `OK · ${llmTest.model} · ${llmTest.latencyMs} ms`
                  : llmTest.error || 'Falló la conexión'}
              </span>
            ) : null}
          </div>

          <p className="rounded-xl border border-line bg-surface2/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
            El chat de cada reunión y el chat global usan este mismo modelo. Solo se envía al
            proveedor la transcripción o los fragmentos relevantes de las notas que consultes.
          </p>
        </Section>

        <Section
          id="drive"
          title="Google Drive"
          description="Respaldo unidireccional de las notas y su audio a una carpeta administrada por la app."
        >
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface2/50 px-4 py-3 text-xs">
            {drive?.connected ? (
              <Cloud className="size-4 text-olive" />
            ) : (
              <CloudOff className="size-4 text-muted" />
            )}
            <span className="font-medium">
              {drive?.connected ? 'Conectado' : 'Sin conectar'}
            </span>
            {drive?.connected ? (
              <>
                <span className="text-muted">·</span>
                <span className="text-muted">token: {drive.tokenSource}</span>
                <span className="text-muted">·</span>
                <span className="text-muted">último respaldo: {timeAgo(drive.lastBackupAt)}</span>
              </>
            ) : null}
          </div>

          {!env?.google.clientConfigured ? (
            <div className="rounded-2xl border border-line bg-surface2/40 p-4 text-xs leading-relaxed text-muted">
              <p className="font-medium text-ink">Faltan las credenciales de Google</p>
              <ol className="mt-2 list-decimal space-y-1 pl-4">
                <li>Crea un proyecto en Google Cloud Console y habilita la API de Drive.</li>
                <li>Configura la pantalla de consentimiento (tipo External).</li>
                <li>Crea un cliente OAuth de tipo «Desktop app».</li>
                <li>
                  Copia <code>GOOGLE_CLIENT_ID</code> y <code>GOOGLE_CLIENT_SECRET</code> al .env.
                </li>
              </ol>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="btn-secondary h-8 text-xs"
                  onClick={() =>
                    void window.chismosito.app.openExternal(
                      'https://console.cloud.google.com/apis/credentials'
                    )
                  }
                >
                  <ExternalLink className="size-3.5" /> Abrir Google Cloud
                </button>
                <button
                  className="btn-ghost h-8 text-xs"
                  onClick={() =>
                    env?.envPath &&
                    void window.chismosito.app.openPath(env.envPath).catch((error) =>
                      pushToast('error', errorMessage(error))
                    )
                  }
                >
                  Abrir .env
                </button>
              </div>
            </div>
          ) : drive?.connected ? (
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-secondary h-9 text-xs"
                onClick={() => setConfirmDisconnect(true)}
              >
                <CloudOff className="size-3.5" /> Desconectar
              </button>
              <button
                className="btn-primary h-9 text-xs"
                onClick={() => void backupAll()}
                disabled={backingUp}
              >
                {backingUp ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Cloud className="size-3.5" />
                )}
                Respaldar todo ahora
              </button>
            </div>
          ) : (
            <button className="btn-primary h-9 text-xs" onClick={() => void connectDrive()} disabled={connecting}>
              {connecting ? <Loader2 className="size-3.5 animate-spin" /> : <Cloud className="size-3.5" />}
              {connecting ? 'Esperando autorización en el navegador…' : 'Conectar Google Drive'}
            </button>
          )}

          {driveProgress?.active ? (
            <div className="rounded-2xl border border-line bg-surface p-3">
              <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
                <span className="truncate">{driveProgress.current || 'Preparando respaldo…'}</span>
                <span>
                  {driveProgress.completed}/{driveProgress.total}
                </span>
              </div>
              <ProgressBar
                value={driveProgress.total ? (driveProgress.completed / driveProgress.total) * 100 : 0}
                className="h-1.5"
              />
            </div>
          ) : null}

          <Row label="Carpeta en Drive" hint="La app la crea y administra; no necesita existir antes.">
            <input
              className="field max-w-xs"
              value={driveFolder}
              onChange={(event) => setDriveFolder(event.target.value)}
              onBlur={() =>
                driveFolder.trim() &&
                driveFolder !== settings.driveFolderName &&
                void update({ driveFolderName: driveFolder.trim() })
              }
            />
          </Row>
          <Row label="Respaldo automático" hint="Se activa al terminar de procesar cada reunión.">
            <Toggle
              checked={settings.autoBackup}
              onChange={(value) => void update({ autoBackup: value })}
            />
          </Row>
          <Row
            label="Respaldar conversaciones"
            hint="Sube los chats a Conversaciones/ en Drive al terminar cada respuesta."
          >
            <Toggle
              checked={settings.chatAutoBackup}
              onChange={(value) => void update({ chatAutoBackup: value })}
            />
          </Row>
          <Row label="Conversaciones en Drive" hint="Historial de chats respaldado en tu cuenta.">
            <span className="text-xs text-muted">
              {drive?.chats.count ?? 0} respaldada(s) · último:{' '}
              {timeAgo(drive?.chats.lastBackupAt ?? null)}
            </span>
          </Row>
          <p className="flex items-start gap-2 rounded-xl border border-line bg-surface2/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
            <Shield className="mt-0.5 size-3.5 shrink-0" />
            Se usa el permiso mínimo «drive.file». Si tu cliente OAuth está en modo Testing, el token
            expira a los 7 días; publica la app en producción (sin verificar) para evitarlo.
          </p>
        </Section>

        <Section
          id="desktop"
          title="Escritorio"
          description="Cómo se comporta Chismosito cuando no lo estás mirando."
        >
          <Row label="Cerrar a la bandeja" hint="Sigue grabando y procesando en segundo plano.">
            <Toggle
              checked={settings.closeToTray}
              onChange={(value) => void update({ closeToTray: value })}
            />
          </Row>
          <Row label="Iniciar con Windows" hint="Abre Chismosito al iniciar sesión.">
            <Toggle
              checked={settings.launchAtLogin}
              onChange={(value) => void update({ launchAtLogin: value })}
            />
          </Row>
          <Row label="Atajo global" hint="Inicia o detiene la grabación. Ejemplo: CommandOrControl+Shift+R.">
            <div className="max-w-sm space-y-1">
              <input
                className="field"
                value={hotkey}
                onChange={(event) => setHotkey(event.target.value)}
                onBlur={() => {
                  const value = hotkey.trim()
                  if (value && value !== settings.hotkey) void update({ hotkey: value })
                }}
              />
              <p className="text-[10px] text-muted">
                Si Windows ya usa ese atajo, la app te avisará y podrás cambiarlo.
              </p>
            </div>
          </Row>
        </Section>

        <Section
          id="advanced"
          title="Información y avanzado"
          description="Rutas de datos para depurar o respaldar manualmente."
        >
          <Row label="Versión" hint="Chismosito para Windows 11.">
            <span className="text-xs text-muted">{appInfo?.version}</span>
          </Row>
          <Row label="Datos de la aplicación" hint="Ajustes, logs, modelos y estado de trabajos.">
            <button
              className="btn-secondary h-8 text-xs"
              onClick={() => void window.chismosito.app.openPath(appInfo?.userData ?? '')}
            >
              <FolderOpen className="size-3.5" /> Abrir carpeta
            </button>
          </Row>
          <Row label="Modelos" hint="Si borras los modelos, se vuelven a descargar desde Ajustes.">
            <div className="flex items-center gap-2">
              <code className="max-w-[320px] truncate rounded-lg bg-surface2 px-2 py-1 text-[11px] text-muted">
                {modelsDir}
              </code>
              <button
                className="btn-ghost h-8 px-2 text-xs"
                onClick={() => void window.chismosito.app.openPath(modelsDir).catch(() => undefined)}
              >
                <FolderOpen className="size-3.5" />
              </button>
            </div>
          </Row>
          <Row
            label="Archivo .env"
            hint="Endpoints, modelos por defecto y credenciales de Google. La API key de OpenCode ya no vive aquí."
          >
            <div className="flex flex-wrap items-center gap-2">
              <code className="max-w-[320px] truncate rounded-lg bg-surface2 px-2 py-1 text-[11px] text-muted">
                {env?.envPath}
              </code>
              <button
                className="btn-ghost h-8 px-2 text-xs"
                onClick={() => void window.chismosito.app.openPath(env?.envPath ?? '').catch(() => undefined)}
              >
                <ExternalLink className="size-3.5" />
              </button>
            </div>
          </Row>
          <Row label="Diagnóstico" hint="Los logs locales ayudan a encontrar errores.">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <HardDrive className="size-3.5" /> logs/app.log
            </span>
          </Row>
        </Section>
      </div>

      <ConfirmDialog
        open={confirmCuda}
        title="Descargar pack CUDA"
        description="Son ~650 MB de descarga y ~1.5 GB en disco. Requiere una GPU NVIDIA. Si falla, Chismosito usará CPU automáticamente."
        confirmLabel="Descargar"
        onClose={() => setConfirmCuda(false)}
        onConfirm={() => void downloadCuda()}
      />
      <ConfirmDialog
        open={confirmRemoveModel !== null}
        title="Eliminar modelo"
        description="Se borra el archivo del disco. Puedes volver a descargarlo cuando quieras; tus notas y audios no se tocan."
        confirmLabel="Eliminar"
        destructive
        onClose={() => setConfirmRemoveModel(null)}
        onConfirm={() => {
          if (confirmRemoveModel) void removeModel(confirmRemoveModel)
        }}
      />
      <ConfirmDialog
        open={confirmClearKey}
        title="Quitar la API key"
        description="Se borrará de secrets.json y del respaldo .env.bak. Sin key no habrá resumen, chat ni sugerencias de carpeta; la transcripción sigue funcionando."
        confirmLabel="Quitar"
        destructive
        onClose={() => setConfirmClearKey(false)}
        onConfirm={() => void clearApiKey()}
      />
      <ConfirmDialog
        open={confirmDisconnect}
        title="Desconectar Google Drive"
        description="Se borrará el token local. Los archivos que ya están en Drive no se eliminan."
        confirmLabel="Desconectar"
        destructive
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() => void disconnectDrive()}
      />
    </div>
  )
}

function Section({
  id,
  title,
  description,
  children
}: {
  id: string
  title: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section id={id} className="scroll-mt-6 rounded-3xl border border-line bg-surface p-6">
      <div className="mb-5">
        <h2 className="font-serif text-2xl leading-tight">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="grid gap-2 sm:grid-cols-[220px_1fr] sm:gap-5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint ? (
          <p className="mt-0.5 break-words text-[11px] leading-relaxed text-muted">{hint}</p>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-6 w-11 items-center rounded-full p-0.5 transition-colors disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-line'
      )}
    >
      <span
        className={cn(
          'size-5 rounded-full bg-white shadow transition-transform',
          checked && 'translate-x-5'
        )}
      />
    </button>
  )
}
