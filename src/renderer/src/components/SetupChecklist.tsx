import { Link } from 'react-router-dom'
import { Check, Download, Loader2, Sparkles } from 'lucide-react'
import { useAppStore } from '../store'
import { ProgressBar } from './ProgressBar'
import { errorMessage } from '../lib/errors'
import { formatBytes } from '../lib/format'

export function SetupChecklist(): React.JSX.Element | null {
  const whisper = useAppStore((state) => state.whisper)
  const env = useAppStore((state) => state.env)
  const download = useAppStore((state) => state.download)
  const setWhisper = useAppStore((state) => state.setWhisper)
  const pushToast = useAppStore((state) => state.pushToast)

  const modelReady = Boolean(whisper?.model.present)
  const llmReady = Boolean(env?.llm.configured)
  if (modelReady && llmReady) return null

  const downloadingModel =
    download?.kind === 'model' &&
    (download.status === 'downloading' || download.status === 'verifying')

  const recommended = whisper?.models.find((model) => model.roles.includes('balanced'))
  const recommendedId = recommended?.id ?? whisper?.recommendations?.balanced ?? ''

  const downloadModel = async (): Promise<void> => {
    try {
      const status = await window.chismosito.whisper.downloadModel(recommendedId)
      setWhisper(status)
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  return (
    <div className="rounded-3xl border border-line bg-surface2/60 p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg">Prepara Chismosito</h3>
          <p className="mt-0.5 text-xs text-muted">
            Solo faltan un par de cosas para que tus reuniones se procesen solas.
          </p>

          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="mt-1">
                {modelReady ? (
                  <Check className="size-4 text-olive" />
                ) : (
                  <span className="flex size-4 items-center justify-center rounded-full border border-line text-[10px] text-muted">1</span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Modelo de transcripción local</p>
                <p className="text-xs text-muted">
                  {modelReady
                    ? `Listo. ${whisper?.model.name ?? 'Modelo'} instalado.`
                    : `${recommended ? `${recommended.label} · ${recommended.quant} · ${formatBytes(recommended.bytes)}` : 'Modelo local'} — se descarga una sola vez y nunca sale de tu equipo.`}
                </p>
                {!modelReady && !downloadingModel ? (
                  <button onClick={downloadModel} className="btn-secondary mt-2 h-8 text-xs">
                    <Download className="size-3.5" /> Descargar modelo recomendado
                  </button>
                ) : null}
                {downloadingModel && download ? (
                  <div className="mt-2 max-w-sm">
                    <ProgressBar value={download.percent} className="h-1.5" />
                    <p className="mt-1 text-[10px] text-muted">
                      {formatBytes(download.receivedBytes)} de {formatBytes(download.totalBytes)} ·{' '}
                      {download.percent}%
                    </p>
                  </div>
                ) : null}
                {download?.kind === 'model' && download.status === 'error' ? (
                  <p className="mt-1 text-[11px] text-red-600 dark:text-red-300">{download.message}</p>
                ) : null}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="mt-1">
                {llmReady ? (
                  <Check className="size-4 text-olive" />
                ) : (
                  <span className="flex size-4 items-center justify-center rounded-full border border-line text-[10px] text-muted">2</span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Resumen con LLM</p>
                <p className="text-xs text-muted">
                  {llmReady
                    ? `Conectado con ${env?.llm.model}.`
                    : 'Agrega tu API key de OpenCode en Ajustes para generar resumen, decisiones y acciones.'}
                </p>
                {!llmReady ? (
                  <Link to="/settings?section=llm" className="mt-2 inline-flex text-xs font-medium text-accent hover:underline">
                    Configurar la API key →
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DownloadingIcon(): React.JSX.Element {
  return <Loader2 className="size-4 animate-spin" />
}
