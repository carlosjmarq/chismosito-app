import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Cpu,
  Download,
  FilePlus2,
  Gauge,
  Search,
  Trash2,
  X
} from 'lucide-react'
import type {
  DownloadProgress,
  WhisperModelInfo,
  WhisperProfile,
  WhisperStatus
} from '@shared/types'
import { formatBytes } from '../lib/format'
import { cn } from '../lib/cn'

interface WhisperModelPickerProps {
  status: WhisperStatus
  progress: DownloadProgress | null
  downloadingId: string | null
  onSelect: (id: string) => void
  onDownload: (id: string) => void
  onRemove: (id: string) => void
  onChooseCustom: () => void
  onClearCustom: () => void
  onCancelDownload: () => void
}

const ROLE_LABEL: Record<WhisperProfile, string> = {
  fastest: 'Más rápido',
  balanced: 'Equilibrado',
  quality: 'Mejor calidad'
}

function fitLabel(model: WhisperModelInfo, cudaBinary: boolean): string {
  if (model.fit === 'ram') return 'No cabe en tu RAM'
  if (model.fit === 'gpu') return 'Cabe en tu GPU'
  return cudaBinary ? 'Solo CPU (lento)' : 'CPU'
}

export function WhisperModelPicker({
  status,
  progress,
  downloadingId,
  onSelect,
  onDownload,
  onRemove,
  onChooseCustom,
  onClearCustom,
  onCancelDownload
}: WhisperModelPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const active = status.models.find((model) => model.active)
  const custom = status.customPath
  const recommended = status.models.find((model) =>
    model.roles.includes('balanced')
  )

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    searchRef.current?.focus()
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const match = (model: WhisperModelInfo): boolean =>
      !needle ||
      model.label.toLowerCase().includes(needle) ||
      model.quant.toLowerCase().includes(needle) ||
      model.family.toLowerCase().includes(needle)

    const filtered = status.models.filter(match)
    return {
      suggested: filtered.filter((model) => model.roles.length > 0),
      multi: filtered.filter((model) => model.langs === 'multi' && model.roles.length === 0),
      english: filtered.filter((model) => model.langs === 'en')
    }
  }, [query, status.models])

  const hardware = status.hardware
  const hardwareLine =
    hardware.vramMb && hardware.gpuName
      ? `${hardware.gpuName} · ${(hardware.vramMb / 1024).toFixed(1)} GB VRAM · ${(
          hardware.ramMb / 1024
        ).toFixed(0)} GB RAM`
      : `Sin GPU NVIDIA detectada · ${(hardware.ramMb / 1024).toFixed(0)} GB RAM · CPU`

  const triggerLabel = custom
    ? 'Modelo personalizado'
    : active
      ? `${active.label} · ${active.quant}`
      : recommended
        ? `${recommended.label} · ${recommended.quant}`
        : 'Elige un modelo'
  const triggerSub = custom
    ? custom
    : downloadingId
      ? `Descargando ${progress?.percent ?? 0}%`
      : active
        ? `${formatBytes(active.bytes)} · ${fitLabel(active, status.cudaBinary)}`
        : 'Sin modelo instalado'

  const renderRow = (model: WhisperModelInfo): React.JSX.Element => {
    const downloading = downloadingId === model.id
    const badgeColor =
      model.fit === 'ram'
        ? 'text-red-600 dark:text-red-300'
        : model.fit === 'gpu'
          ? 'text-olive'
          : 'text-gold'
    return (
      <li key={model.id} className="border-t border-line/40 first:border-t-0">
        <div
          className={cn(
            'flex items-start gap-2 px-3 py-2',
            model.active ? 'bg-surface2/70' : 'bg-transparent'
          )}
        >
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              if (model.installed) onSelect(model.id)
              else onDownload(model.id)
            }}
            title={
              model.installed
                ? `Usar ${model.label} · ${model.quant}`
                : `Descargar ${model.label} · ${model.quant} para poder usarlo`
            }
            className="min-w-0 flex-1 text-left"
          >
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm text-ink">
                {model.label} · {model.quant}
              </span>
              {model.langs === 'en' ? (
                <span
                  className="chip border-gold/40 px-1.5 py-0 text-[9px] text-gold"
                  title="Modelo solo para inglés: si la reunión es en otro idioma, transcribirá mal."
                >
                  EN
                </span>
              ) : null}
              {model.roles.map((role) => (
                <span
                  key={role}
                  className={cn(
                    'chip px-1.5 py-0 text-[9px]',
                    role === 'quality'
                      ? 'border-gold/40 text-gold'
                      : role === 'balanced'
                        ? 'border-accent/40 text-accent'
                        : 'border-olive/40 text-olive'
                  )}
                >
                  {ROLE_LABEL[role]}
                </span>
              ))}
              {model.active ? (
                <span className="chip px-1.5 py-0 text-[9px] text-olive">Activo</span>
              ) : null}
              {model.installed && !model.active ? (
                <span className="chip px-1.5 py-0 text-[9px]">Instalado</span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-[10px] text-muted">
              {formatBytes(model.bytes)} · GPU {model.vramGb.toFixed(2)} GB · RAM{' '}
              {model.ramGb.toFixed(2)} GB ·{' '}
              <span className={badgeColor}>{fitLabel(model, status.cudaBinary)}</span>
            </span>
            {downloading && progress ? (
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface2">
                <span
                  className="block h-full rounded-full bg-accent transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </span>
            ) : null}
          </button>
          <div className="flex shrink-0 items-center gap-1 pt-0.5">
            {downloading ? (
              <button
                type="button"
                className="text-[10px] text-muted underline hover:no-underline"
                onClick={onCancelDownload}
              >
                Cancelar
              </button>
            ) : model.installed ? (
              model.active ? (
                <Check className="size-4 text-olive" />
              ) : (
                <button
                  type="button"
                  className="rounded-full p-1 text-muted hover:bg-surface2 hover:text-red-500"
                  onClick={() => onRemove(model.id)}
                  title="Eliminar del disco"
                  aria-label={`Eliminar ${model.label} ${model.quant}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )
            ) : (
              <button
                type="button"
                className="rounded-full p-1 text-muted hover:bg-surface2 hover:text-accent"
                onClick={() => onDownload(model.id)}
                disabled={Boolean(downloadingId)}
                title="Descargar"
                aria-label={`Descargar ${model.label} ${model.quant}`}
              >
                <Download className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </li>
    )
  }

  return (
    <div className="rounded-2xl border border-line bg-surface2/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">{hardwareLine}</p>
          <p className="mt-1 text-[10px] text-muted">
            {status.installedBytes > 0
              ? `Modelos en disco: ${formatBytes(status.installedBytes)}`
              : 'Aún no hay modelos descargados'}
            {status.diskFreeBytes !== null
              ? ` · libre en disco: ${formatBytes(status.diskFreeBytes)}`
              : ''}
          </p>
        </div>
        {downloadingId ? (
          <button className="text-[10px] text-muted underline hover:no-underline" onClick={onCancelDownload}>
            Cancelar descarga
          </button>
        ) : null}
      </div>

      <div ref={rootRef} className="relative mt-3">
        <button
          type="button"
          className={cn('field flex w-full items-center justify-between gap-3 text-left', open && 'border-accent/50')}
          onClick={() => setOpen((state) => !state)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm text-ink">{triggerLabel}</span>
            <span className="block truncate text-[10px] text-muted">{triggerSub}</span>
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
        </button>

        {open ? (
          <div className="fade-up absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
            <div className="relative border-b border-line/60 px-3 py-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <input
                ref={searchRef}
                className="w-full bg-transparent pl-6 text-sm text-ink placeholder:text-muted/70 focus:outline-none"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por talla o cuantización…"
                spellCheck={false}
                autoComplete="off"
                aria-label="Buscar modelo"
              />
            </div>

            <ul role="listbox" className="max-h-80 overflow-y-auto">
              {groups.suggested.length > 0 ? (
                <>
                  <li className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wide text-accent">
                    Sugeridos para tu equipo
                  </li>
                  {groups.suggested.map(renderRow)}
                </>
              ) : null}
              {groups.multi.length > 0 ? (
                <li className="px-3 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-wide text-muted">
                  Multilingüe
                </li>
              ) : null}
              {groups.multi.map(renderRow)}
              <li
                className="flex items-center gap-1 px-3 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-wide text-muted"
                title="Estos modelos solo transcriben inglés: en otros idiomas la salida será incorrecta."
              >
                Solo inglés
                <span className="text-[8px] normal-case tracking-normal text-muted/70">
                  (no transcriben español)
                </span>
              </li>
              {groups.english.map(renderRow)}
            </ul>
          </div>
        ) : null}
      </div>

      {downloadingId && progress ? (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="mt-1 text-[10px] text-muted">
            {progress.status === 'verifying'
              ? 'Verificando sha256…'
              : `${formatBytes(progress.receivedBytes)} de ${formatBytes(progress.totalBytes)} · ${progress.percent}%`}
          </p>
        </div>
      ) : null}
      {progress?.kind === 'model' && progress.status === 'error' ? (
        <p className="mt-2 text-[11px] text-red-600 dark:text-red-300">{progress.message}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/50 pt-3">
        {custom ? (
          <>
            <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted">
              <FilePlus2 className="size-3.5 shrink-0" />
              <span className="truncate" title={custom}>
                {custom}
              </span>
            </span>
            <button className="btn-ghost h-7 text-[10px]" onClick={onClearCustom}>
              <X className="size-3" /> Quitar
            </button>
          </>
        ) : (
          <button className="btn-secondary h-7 text-[10px]" onClick={onChooseCustom}>
            <FilePlus2 className="size-3" /> Usar un modelo propio (.bin)
          </button>
        )}
        <span className="flex items-center gap-1 text-[10px] text-muted">
          {status.activeDevice === 'cuda' ? (
            <>
              <Gauge className="size-3" /> GPU (CUDA)
            </>
          ) : (
            <>
              <Cpu className="size-3" /> CPU · {status.hardware.cores} hilos
            </>
          )}
        </span>
      </div>
    </div>
  )
}
