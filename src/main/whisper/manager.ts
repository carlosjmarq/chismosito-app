import { app, net } from 'electron'
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, statfsSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { CUDA_URL, CUDA_ZIP_NAME, VAD_FILE_NAME } from '@shared/constants'
import { VAD_MODEL } from '@shared/whisper-vad'
import {
  LEGACY_MODEL_ID,
  WHISPER_MODELS,
  whisperModel,
  whisperModelName,
  whisperModelUrl,
  type WhisperModelSpec
} from '@shared/whisper-models'
import {
  describeWhisperModels,
  QUALITY_ORDER,
  recommendWhisperProfiles,
  type WhisperHardware
} from '@shared/whisper-policy'
import type {
  DownloadProgress,
  WhisperHardwareInfo,
  WhisperModelInfo,
  WhisperStatus
} from '@shared/types'
import type { SettingsStore } from '../settings'
import { ensureDir, formatBytes, writeAtomic } from '../lib/fs'
import { log } from '../lib/logger'
import { downloadModelFile, type DownloadPhase } from './download'
import { probeWhisperHardware } from './hardware'

type ProgressListener = (progress: DownloadProgress) => void

const IDLE: DownloadProgress = {
  kind: 'model',
  status: 'idle',
  receivedBytes: 0,
  totalBytes: 0,
  percent: 0
}

interface ModelIndexEntry {
  bytes: number
  sha256: string
  verifiedAt: string
}

interface ModelIndex {
  version: 1
  models: Record<string, ModelIndexEntry>
}

export interface ActiveModel {
  id: string | null
  path: string
  /** 'custom' cuando viene de una ruta elegida a mano. */
  source: 'managed' | 'custom' | 'missing'
}

export class WhisperManager {
  private progress: DownloadProgress = { ...IDLE }
  private abortController: AbortController | null = null
  private listener: ProgressListener | null = null

  constructor(private readonly settings: SettingsStore) {}

  onProgress(listener: ProgressListener): void {
    this.listener = listener
  }

  private emit(progress: DownloadProgress): void {
    this.progress = progress
    this.listener?.(progress)
  }

  progressState(): DownloadProgress {
    return { ...this.progress }
  }

  modelsDir(): string {
    return join(app.getPath('userData'), 'models')
  }

  private indexPath(): string {
    return join(this.modelsDir(), 'index.json')
  }

  private readIndex(): ModelIndex {
    try {
      if (!existsSync(this.indexPath())) return { version: 1, models: {} }
      const parsed = JSON.parse(readFileSync(this.indexPath(), 'utf8')) as Partial<ModelIndex>
      return { version: 1, models: parsed.models ?? {} }
    } catch (error) {
      log.warn('No se pudo leer models/index.json', error)
      return { version: 1, models: {} }
    }
  }

  private writeIndex(index: ModelIndex): void {
    ensureDir(this.modelsDir())
    writeAtomic(this.indexPath(), JSON.stringify(index, null, 2))
  }

  private legacyPath(): string {
    const spec = whisperModel(LEGACY_MODEL_ID)
    return join(this.modelsDir(), spec?.file ?? 'ggml-medium-q5_0.bin')
  }

  private pathFor(spec: WhisperModelSpec): string {
    return join(this.modelsDir(), spec.file)
  }

  installedIds(): Set<string> {
    const ids = new Set<string>()
    for (const spec of WHISPER_MODELS) {
      const path = this.pathFor(spec)
      try {
        if (existsSync(path) && statSyncSize(path) === spec.bytes) ids.add(spec.id)
      } catch {
        // archivo ilegible: se trata como no instalado
      }
    }
    return ids
  }

  isInstalled(id: string): boolean {
    const spec = whisperModel(id)
    if (!spec) return false
    try {
      return existsSync(this.pathFor(spec)) && statSyncSize(this.pathFor(spec)) === spec.bytes
    } catch {
      return false
    }
  }

  async hardware(): Promise<WhisperHardware> {
    return probeWhisperHardware(this.hasCuda())
  }

  private async recommendation(): Promise<{
    hardware: WhisperHardware
    recommendedId: string
    recommendations: WhisperStatus['recommendations']
  }> {
    const hardware = await this.hardware()
    const { profiles } = recommendWhisperProfiles(hardware)
    return { hardware, recommendedId: profiles.balanced, recommendations: profiles }
  }

  /**
   * Modelo activo: ruta manual > elección explícita > recomendado para el
   * equipo > cualquier modelo instalado > legado (medium-q5_0).
   */
  resolveActive(recommendedId: string): ActiveModel {
    const settings = this.settings.get()
    const custom = settings.whisperModelPath?.trim()
    if (custom) {
      return { id: null, path: custom, source: existsSync(custom) ? 'custom' : 'missing' }
    }

    const chosen = whisperModel(settings.whisperModel)
    if (chosen && this.isInstalled(chosen.id)) {
      return { id: chosen.id, path: this.pathFor(chosen), source: 'managed' }
    }

    const recommended = whisperModel(recommendedId)
    if (recommended && this.isInstalled(recommended.id)) {
      return { id: recommended.id, path: this.pathFor(recommended), source: 'managed' }
    }

    const installed = this.bestInstalled()
    if (installed) {
      return { id: installed.id, path: this.pathFor(installed), source: 'managed' }
    }

    const legacy = this.legacyPath()
    if (existsSync(legacy)) {
      return { id: LEGACY_MODEL_ID, path: legacy, source: 'managed' }
    }

    const fallback = whisperModel(settings.whisperModel) ?? recommended
    return {
      id: fallback?.id ?? null,
      path: fallback ? this.pathFor(fallback) : this.legacyPath(),
      source: 'missing'
    }
  }

  /** En modo automático, el instalado de mayor calidad (no el primero del catálogo). */
  private bestInstalled(): WhisperModelSpec | undefined {
    for (const id of QUALITY_ORDER) {
      if (this.isInstalled(id)) return whisperModel(id)
    }
    return WHISPER_MODELS.find((spec) => this.isInstalled(spec.id))
  }

  modelPath(): string {
    const settings = this.settings.get()
    const custom = settings.whisperModelPath?.trim()
    if (custom) return custom
    const chosen = whisperModel(settings.whisperModel)
    if (chosen && this.isInstalled(chosen.id)) return this.pathFor(chosen)
    const installed = this.bestInstalled()
    if (installed) return this.pathFor(installed)
    const legacy = this.legacyPath()
    if (existsSync(legacy)) return legacy
    return chosen ? this.pathFor(chosen) : legacy
  }

  private whisperRoot(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'whisper')
      : join(app.getAppPath(), 'resources', 'whisper')
  }

  private resourcesWhisperDir(): string {
    return join(this.whisperRoot(), 'win32-x64', 'Release')
  }

  cpuCliPath(): string {
    return join(this.resourcesWhisperDir(), 'whisper-cli.exe')
  }

  cudaDir(): string {
    return join(app.getPath('userData'), 'whisper-cuda')
  }

  cudaCliPath(): string | null {
    const direct = join(this.cudaDir(), 'Release', 'whisper-cli.exe')
    if (existsSync(direct)) return direct
    const flat = join(this.cudaDir(), 'whisper-cli.exe')
    if (existsSync(flat)) return flat
    return null
  }

  hasCpu(): boolean {
    return existsSync(this.cpuCliPath())
  }

  hasCuda(): boolean {
    return this.cudaCliPath() !== null
  }

  /**
   * Modelo silero VAD. Se prefiere el descargado y verificado (v6.2.0); si no
   * está, se usa el que viene incluido con la app (v5.1.2).
   */
  vadPath(): string {
    const downloaded = join(this.modelsDir(), VAD_MODEL.file)
    return existsSync(downloaded) ? downloaded : join(this.whisperRoot(), VAD_FILE_NAME)
  }

  hasVad(): boolean {
    try {
      return existsSync(this.vadPath())
    } catch {
      return false
    }
  }

  activeDevice(): 'cpu' | 'cuda' {
    const setting = this.settings.get().whisperDevice
    if (setting === 'cpu') return 'cpu'
    if (setting === 'cuda') return this.hasCuda() ? 'cuda' : 'cpu'
    return this.hasCuda() ? 'cuda' : 'cpu'
  }

  private installedBytes(): number {
    let total = 0
    for (const spec of WHISPER_MODELS) {
      if (!this.isInstalled(spec.id)) continue
      total += spec.bytes
    }
    return total
  }

  private diskFree(): number | null {
    try {
      const stats = statfsSync(this.modelsDir())
      return Number(stats.bavail) * Number(stats.bsize)
    } catch {
      return null
    }
  }

  async status(): Promise<WhisperStatus> {
    const { hardware, recommendedId, recommendations } = await this.recommendation()
    const active = this.resolveActive(recommendedId)

    const models: WhisperModelInfo[] = describeWhisperModels(hardware).map((entry) => ({
      id: entry.spec.id,
      label: entry.spec.label,
      family: entry.spec.family,
      quant: entry.spec.quant,
      langs: entry.spec.langs,
      bytes: entry.spec.bytes,
      vramGb: entry.spec.vramGb,
      ramGb: entry.spec.ramGb,
      installed: this.isInstalled(entry.spec.id),
      fit: entry.fit,
      roles: entry.roles,
      active: entry.spec.id === active.id && active.source === 'managed'
    }))

    const activeSpec = whisperModel(active.id ?? undefined)
    const activeSize = (() => {
      try {
        return existsSync(active.path) ? statSyncSize(active.path) : 0
      } catch {
        return 0
      }
    })()

    const hardwareInfo: WhisperHardwareInfo = {
      vramMb: hardware.vramMb,
      gpuName: hardware.gpuName,
      vramSource: hardware.vramSource,
      ramMb: hardware.ramMb,
      cores: hardware.cores,
      cudaBinary: hardware.cudaBinary
    }

    return {
      cpuBinary: this.hasCpu(),
      cudaBinary: this.hasCuda(),
      activeDevice: this.activeDevice(),
      model: {
        present: active.source !== 'missing',
        path: active.path,
        name: activeSpec ? whisperModelName(activeSpec) : basename(active.path),
        sizeBytes: activeSize,
        expectedBytes: activeSpec?.bytes ?? activeSize,
        source: active.source === 'custom' ? 'custom' : active.source === 'managed' ? 'managed' : 'missing'
      },
      models,
      hardware: hardwareInfo,
      recommendations,
      activeModelId: active.source === 'managed' ? active.id : null,
      customPath: this.settings.get().whisperModelPath?.trim() || null,
      installedBytes: this.installedBytes(),
      diskFreeBytes: this.diskFree(),
      vad: { present: this.hasVad(), path: this.vadPath(), bytes: VAD_MODEL.bytes }
    }
  }

  async downloadModel(modelId: string): Promise<WhisperStatus> {
    const spec = whisperModel(modelId)
    if (!spec) throw new Error('Modelo desconocido')
    if (this.abortController) throw new Error('Ya hay una descarga en curso')

    const target = this.pathFor(spec)
    ensureDir(this.modelsDir())

    const free = this.diskFree()
    if (free !== null && free < spec.bytes * 1.2) {
      throw new Error(
        `No hay espacio suficiente en disco: necesitas ${formatBytes(spec.bytes * 1.2)} y hay ${formatBytes(free)}.`
      )
    }

    const controller = new AbortController()
    this.abortController = controller

    const progressFrom = (
      phase: DownloadPhase,
      received: number,
      total: number
    ): DownloadProgress => ({
      kind: 'model',
      modelId: spec.id,
      status: phase === 'verifying' ? 'verifying' : 'downloading',
      receivedBytes: received,
      totalBytes: total,
      percent: total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0
    })

    try {
      this.emit(progressFrom('downloading', 0, spec.bytes))
      await downloadModelFile({
        url: whisperModelUrl(spec),
        target,
        expectedBytes: spec.bytes,
        sha256: spec.sha256,
        signal: controller.signal,
        fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) =>
          net.fetch(input as string, init as never)) as typeof fetch,
        onProgress: ({ receivedBytes, totalBytes, phase }) => {
          this.emit(progressFrom(phase, receivedBytes, totalBytes))
        }
      })

      const index = this.readIndex()
      index.models[spec.id] = {
        bytes: spec.bytes,
        sha256: spec.sha256,
        verifiedAt: new Date().toISOString()
      }
      this.writeIndex(index)

      this.emit({
        kind: 'model',
        modelId: spec.id,
        status: 'done',
        receivedBytes: spec.bytes,
        totalBytes: spec.bytes,
        percent: 100
      })
      log.info(`Modelo ${spec.id} descargado y verificado`)
      return this.status()
    } catch (error) {
      const aborted = controller.signal.aborted
      this.emit({
        kind: 'model',
        modelId: spec.id,
        status: aborted ? 'cancelled' : 'error',
        receivedBytes: this.progress.receivedBytes,
        totalBytes: this.progress.totalBytes,
        percent: this.progress.percent,
        message: aborted ? 'Descarga cancelada' : (error as Error).message
      })
      if (!aborted) log.error('Error descargando modelo', error)
      throw error
    } finally {
      this.abortController = null
    }
  }

  async removeModel(modelId: string): Promise<WhisperStatus> {
    const spec = whisperModel(modelId)
    if (!spec) throw new Error('Modelo desconocido')
    const { recommendedId } = await this.recommendation()
    const active = this.resolveActive(recommendedId)
    if (active.source === 'managed' && active.id === spec.id) {
      throw new Error('No puedes eliminar el modelo activo. Elige otro antes de borrarlo.')
    }
    if (this.abortController) throw new Error('Espera a que termine la descarga en curso')

    const path = this.pathFor(spec)
    await rm(path, { force: true })
    await rm(`${path}.part`, { force: true })

    const index = this.readIndex()
    if (index.models[spec.id]) {
      delete index.models[spec.id]
      this.writeIndex(index)
    }
    log.info(`Modelo ${spec.id} eliminado`)
    return this.status()
  }

  /** Valida un archivo .bin elegido a mano (cabecera ggml y tamaño mínimo). */
  validateCustomPath(path: string): void {
    if (!existsSync(path)) throw new Error('El archivo no existe')
    const stats = statSyncSafe(path)
    if (!stats || stats < 5 * 1024 * 1024) throw new Error('El archivo es demasiado pequeño para un modelo ggml')
    const fd = openSync(path, 'r')
    try {
      const header = Buffer.alloc(4)
      readSync(fd, header, 0, 4, 0)
      if (header.toString('utf8') !== 'ggml') {
        throw new Error('El archivo no parece un modelo ggml de whisper.cpp')
      }
    } finally {
      closeSync(fd)
    }
  }

  async downloadVad(): Promise<WhisperStatus> {
    if (this.abortController) throw new Error('Ya hay una descarga en curso')
    if (this.hasVad()) return this.status()
    const controller = new AbortController()
    this.abortController = controller
    try {
      this.emit({
        kind: 'vad',
        status: 'downloading',
        receivedBytes: 0,
        totalBytes: VAD_MODEL.bytes,
        percent: 0
      })
      await downloadModelFile({
        url: VAD_MODEL.url,
        target: this.vadPath(),
        expectedBytes: VAD_MODEL.bytes,
        sha256: VAD_MODEL.sha256,
        signal: controller.signal,
        fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) =>
          net.fetch(input as string, init as never)) as typeof fetch,
        onProgress: ({ receivedBytes, totalBytes, phase }) => {
          this.emit({
            kind: 'vad',
            status: phase === 'verifying' ? 'verifying' : 'downloading',
            receivedBytes,
            totalBytes,
            percent: totalBytes > 0 ? Math.min(100, Math.floor((receivedBytes / totalBytes) * 100)) : 0
          })
        }
      })
      this.emit({
        kind: 'vad',
        status: 'done',
        receivedBytes: VAD_MODEL.bytes,
        totalBytes: VAD_MODEL.bytes,
        percent: 100
      })
      log.info('Modelo VAD descargado y verificado')
      return this.status()
    } catch (error) {
      const aborted = controller.signal.aborted
      this.emit({
        kind: 'vad',
        status: aborted ? 'cancelled' : 'error',
        receivedBytes: this.progress.receivedBytes,
        totalBytes: this.progress.totalBytes,
        percent: this.progress.percent,
        message: aborted ? 'Descarga cancelada' : (error as Error).message
      })
      if (!aborted) log.error('Error descargando el modelo VAD', error)
      throw error
    } finally {
      this.abortController = null
    }
  }

  async downloadCuda(): Promise<WhisperStatus> {
    if (this.abortController) throw new Error('Ya hay una descarga en curso')
    const controller = new AbortController()
    this.abortController = controller
    const tmpZip = join(app.getPath('temp'), CUDA_ZIP_NAME)
    const dest = this.cudaDir()

    try {
      this.emit({
        kind: 'cuda',
        status: 'downloading',
        receivedBytes: 0,
        totalBytes: 0,
        percent: 0
      })
      const response = await net.fetch(CUDA_URL, {
        signal: controller.signal,
        redirect: 'follow'
      })
      if (!response.ok || !response.body) {
        throw new Error(`No se pudo descargar el paquete CUDA (HTTP ${response.status})`)
      }
      const total = Number(response.headers.get('content-length') ?? 0)
      let received = 0
      let lastEmit = 0
      const counter = new TransformCounter((bytes) => {
        received += bytes
        const now = Date.now()
        if (now - lastEmit > 250) {
          lastEmit = now
          this.emit({
            kind: 'cuda',
            status: 'downloading',
            receivedBytes: received,
            totalBytes: total,
            percent: total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0
          })
        }
      })
      await pipeline(
        Readable.fromWeb(response.body as never),
        counter,
        createWriteStream(tmpZip, { flags: 'w' })
      )

      this.emit({
        kind: 'cuda',
        status: 'extracting',
        receivedBytes: received,
        totalBytes: total || received,
        percent: total ? 100 : 0,
        message: 'Extrayendo paquete CUDA…'
      })
      await rm(dest, { recursive: true, force: true })
      ensureDir(dest)
      await extractZip(tmpZip, dest)
      await rm(tmpZip, { force: true })
      if (!this.hasCuda()) throw new Error('El paquete CUDA no contiene whisper-cli.exe')
      this.emit({
        kind: 'cuda',
        status: 'done',
        receivedBytes: received,
        totalBytes: received,
        percent: 100
      })
      return this.status()
    } catch (error) {
      const aborted = controller.signal.aborted
      this.emit({
        kind: 'cuda',
        status: aborted ? 'cancelled' : 'error',
        receivedBytes: this.progress.receivedBytes,
        totalBytes: this.progress.totalBytes,
        percent: this.progress.percent,
        message: aborted ? 'Descarga cancelada' : (error as Error).message
      })
      if (!aborted) log.error('Error descargando CUDA', error)
      throw error
    } finally {
      this.abortController = null
    }
  }

  cancelDownload(): void {
    this.abortController?.abort()
  }
}

function statSyncSize(path: string): number {
  return statSync(path).size
}

function statSyncSafe(path: string): number | null {
  try {
    return statSyncSize(path)
  } catch {
    return null
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

async function extractZip(zipPath: string, destination: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('tar', ['-xf', zipPath, '-C', destination], {
      windowsHide: true
    })
    let errorText = ''
    child.stderr?.on('data', (chunk) => {
      errorText += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`No se pudo extraer el paquete: ${errorText.trim() || `código ${code}`}`))
    })
  })
}

class TransformCounter extends Transform {
  constructor(private readonly onBytes: (bytes: number) => void) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.onBytes(chunk.length)
    this.push(chunk)
    callback()
  }
}
