import { app } from 'electron'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  Job,
  RecordingStartInput,
  RecordingStartResult,
  RecordingStopInput
} from '@shared/types'
import type { NoteRepository } from '../notes/repository'
import type { JobRunner } from '../jobs/runner'
import { ChunkFileSink, WavSink } from './sinks'
import { trackFileName } from '@shared/recording-tracks'
import { ensureDir } from '../lib/fs'
import { log } from '../lib/logger'

interface TapMetrics {
  sumSquares: number
  samples: number
  peak: number
  firstAt: number | null
  lastAt: number | null
}

interface ActiveSession {
  id: string
  baseName: string
  notePath: string
  audioPath: string
  partPath: string
  tmpDir: string
  startedAt: string
  startedAtMs: number
  language: string
  hasMic: boolean
  hasSystem: boolean
  webm: ChunkFileSink
  /** Pistas separadas en Opus para conservar la separación de hablantes. */
  trackSinks: { you: ChunkFileSink | null; others: ChunkFileSink | null }
  trackPaths: { you: string | null; others: string | null }
  mic: WavSink | null
  system: WavSink | null
  micWavPath: string | null
  systemWavPath: string | null
  micTap: TapMetrics
  systemTap: TapMetrics
  webmBytes: number
}

export class RecordingSessionManager {
  private sessions = new Map<string, ActiveSession>()

  constructor(
    private readonly notes: NoteRepository,
    private readonly jobs: JobRunner
  ) {}

  isRecording(id?: string): boolean {
    return id ? this.sessions.has(id) : this.sessions.size > 0
  }

  activeIds(): string[] {
    return [...this.sessions.keys()]
  }

  async start(input: RecordingStartInput): Promise<RecordingStartResult> {
    if (!input.hasMic && !input.hasSystem) {
      throw new Error('Selecciona al menos una fuente de audio')
    }
    if (this.sessions.size > 0) throw new Error('Ya hay una grabación en curso')

    const id = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const allocated = await this.notes.allocate(input.startedAt)
    const tmpDir = join(app.getPath('userData'), 'tmp', 'recordings', id)
    ensureDir(tmpDir)

    const webm = new ChunkFileSink(allocated.partPath, allocated.audioPath)
    const audioName = basename(allocated.audioPath)
    const trackPath = (track: 'you' | 'others'): string =>
      join(dirname(allocated.audioPath), trackFileName(audioName, track))
    const youTrackPath = input.hasMic ? trackPath('you') : null
    const othersTrackPath = input.hasSystem ? trackPath('others') : null
    const youTrack = youTrackPath
      ? new ChunkFileSink(youTrackPath.replace(/\.webm$/, '.part.webm'), youTrackPath)
      : null
    const othersTrack = othersTrackPath
      ? new ChunkFileSink(othersTrackPath.replace(/\.webm$/, '.part.webm'), othersTrackPath)
      : null
    const micWavPath = input.hasMic ? join(tmpDir, 'mic.wav') : null
    const systemWavPath = input.hasSystem ? join(tmpDir, 'system.wav') : null
    const mic = micWavPath ? new WavSink(micWavPath) : null
    const system = systemWavPath ? new WavSink(systemWavPath) : null

    try {
      webm.open()
      youTrack?.open()
      othersTrack?.open()
      mic?.open()
      system?.open()
    } catch (error) {
      webm.abort()
      youTrack?.abort()
      othersTrack?.abort()
      mic?.abort()
      system?.abort()
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }

    const session: ActiveSession = {
      id,
      baseName: allocated.baseName,
      notePath: allocated.notePath,
      audioPath: allocated.audioPath,
      partPath: allocated.partPath,
      tmpDir,
      startedAt: input.startedAt,
      startedAtMs: Date.now(),
      language: input.language,
      hasMic: input.hasMic,
      hasSystem: input.hasSystem,
      webm,
      trackSinks: { you: youTrack, others: othersTrack },
      trackPaths: { you: youTrackPath, others: othersTrackPath },
      mic,
      system,
      micWavPath,
      systemWavPath,
      micTap: { sumSquares: 0, samples: 0, peak: 0, firstAt: null, lastAt: null },
      systemTap: { sumSquares: 0, samples: 0, peak: 0, firstAt: null, lastAt: null },
      webmBytes: 0
    }
    this.sessions.set(id, session)
    log.info('Grabación iniciada', {
      id,
      notePath: allocated.notePath,
      hasMic: input.hasMic,
      hasSystem: input.hasSystem
    })

    return {
      id,
      baseName: allocated.baseName,
      notePath: allocated.notePath,
      audioPath: allocated.audioPath,
      micWavPath,
      systemWavPath
    }
  }

  sendWebmChunk(id: string, chunk: ArrayBuffer): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.webm.append(chunk)
    session.webmBytes += chunk.byteLength
  }

  sendPcmChunk(id: string, track: 'mic' | 'system', chunk: ArrayBuffer): void {
    const session = this.sessions.get(id)
    if (!session) return
    const sink = track === 'mic' ? session.mic : session.system
    if (!sink) return
    const metrics = track === 'mic' ? session.micTap : session.systemTap
    const now = Date.now()
    metrics.firstAt ??= now
    metrics.lastAt = now
    measurePcm(chunk, metrics)
    sink.append(chunk)
  }

  appendTrackChunk(id: string, track: 'you' | 'others', chunk: ArrayBuffer | Uint8Array): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.trackSinks[track]?.append(chunk)
  }

  private finalizeTracks(session: ActiveSession): void {
    for (const track of ['you', 'others'] as const) {
      const sink = session.trackSinks[track]
      const path = session.trackPaths[track]
      if (!sink || !path) continue
      const result = sink.finalize()
      // Menos de ~8 KB es un WebM sin audio real: se descarta.
      if (result.bytes < 8_000) {
        void rm(path, { force: true }).catch(() => undefined)
        session.trackPaths[track] = null
      }
    }
  }

  async stop(input: RecordingStopInput): Promise<Job> {
    const session = this.sessions.get(input.id)
    if (!session) throw new Error('La grabación ya no está activa')

    const webmResult = session.webm.finalize()
    this.finalizeTracks(session)
    const micResult = session.mic?.finalize() ?? null
    const systemResult = session.system?.finalize() ?? null
    this.sessions.delete(session.id)

    if (webmResult.bytes === 0 && existsSync(session.audioPath)) {
      await rm(session.audioPath, { force: true }).catch(() => undefined)
    }

    const audioFileName = webmResult.bytes > 0 ? basename(session.audioPath) : null
    const durationSeconds = Math.max(0, Math.round(input.durationSeconds))

    await this.notes.createStub({
      notePath: session.notePath,
      baseName: session.baseName,
      audioFileName,
      date: session.startedAt,
      durationSeconds,
      language: session.language
    })

    const micUsable = Boolean(
      session.micWavPath && micResult && micResult.bytes > 44 && input.micPeak > 0.0002
    )
    const systemUsable = Boolean(
      session.systemWavPath &&
        systemResult &&
        systemResult.bytes > 44 &&
        input.systemPeak > 0.0002
    )

    if (!micUsable && !systemUsable) {
      log.warn('Grabación sin señal detectable', {
        micPeak: input.micPeak,
        systemPeak: input.systemPeak,
        micBytes: micResult?.bytes,
        systemBytes: systemResult?.bytes
      })
    }

    const micRms = tapRms(session.micTap)
    const systemRms = tapRms(session.systemTap)
    const micSeconds = micResult?.seconds ?? 0
    const systemSeconds = systemResult?.seconds ?? 0
    const durationTolerance = Math.max(5, durationSeconds * 0.02)
    const micDurationOk =
      !micUsable || Math.abs(micSeconds - durationSeconds) <= durationTolerance
    const systemDurationOk =
      !systemUsable || Math.abs(systemSeconds - durationSeconds) <= durationTolerance
    const micTapSilent = micUsable && input.micPeak > 0.002 && micRms < 0.0005
    const systemTapSilent = systemUsable && input.systemPeak > 0.002 && systemRms < 0.0005

    const captureIssues: string[] = []
    if (micUsable && !micDurationOk) {
      captureIssues.push(
        `pista de micrófono incompleta (${Math.round(micSeconds)}s de ${durationSeconds}s)`
      )
    }
    if (systemUsable && !systemDurationOk) {
      captureIssues.push(
        `pista del sistema incompleta (${Math.round(systemSeconds)}s de ${durationSeconds}s)`
      )
    }
    if (micTapSilent) captureIssues.push('pista de micrófono sin señal útil')
    if (systemTapSilent) captureIssues.push('pista del sistema sin señal útil')
    const captureIssue = captureIssues.length > 0 ? captureIssues.join('; ') : null

    if (captureIssue) {
      log.warn('Captura por pista no fiable; se usará el audio completo', {
        id: session.id,
        captureIssue,
        micRms,
        systemRms,
        micSeconds,
        systemSeconds,
        durationSeconds,
        micPeak: input.micPeak,
        systemPeak: input.systemPeak
      })
    }

    const job = this.jobs.enqueue({
      id: session.id,
      baseName: session.baseName,
      notePath: session.notePath,
      audioPath: session.audioPath,
      micWavPath: micUsable ? session.micWavPath : null,
      systemWavPath: systemUsable ? session.systemWavPath : null,
      durationSeconds,
      language: session.language,
      hasMic: Boolean(micUsable && !captureIssue),
      hasSystem: Boolean(systemUsable && !captureIssue),
      captureIssue,
      meetingDate: session.startedAt
    })

    log.info('Grabación detenida', {
      id: session.id,
      durationSeconds,
      webmBytes: webmResult.bytes,
      micSeconds: micResult?.seconds,
      systemSeconds: systemResult?.seconds,
      micRms,
      systemRms,
      micFirstMs: session.micTap.firstAt ? session.micTap.firstAt - session.startedAtMs : null,
      micLastMs: session.micTap.lastAt ? session.micTap.lastAt - session.startedAtMs : null,
      systemFirstMs: session.systemTap.firstAt
        ? session.systemTap.firstAt - session.startedAtMs
        : null,
      systemLastMs: session.systemTap.lastAt
        ? session.systemTap.lastAt - session.startedAtMs
        : null,
      captureIssue
    })
    return job
  }

  async cancel(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    session.webm.abort()
    session.trackSinks.you?.abort()
    session.trackSinks.others?.abort()
    session.mic?.abort()
    session.system?.abort()
    for (const track of ['you', 'others'] as const) {
      const path = session.trackPaths[track]
      if (path) await rm(path, { force: true }).catch(() => undefined)
    }
    await rm(session.tmpDir, { recursive: true, force: true }).catch(() => undefined)
    await rm(session.audioPath, { force: true }).catch(() => undefined)
    await rm(session.partPath, { force: true }).catch(() => undefined)
    log.info('Grabación cancelada', id)
  }

  async abortAll(): Promise<void> {
    for (const id of this.activeIds()) {
      await this.cancel(id)
    }
  }
}

function measurePcm(chunk: ArrayBuffer, metrics: TapMetrics): void {
  const samples = new Int16Array(chunk)
  const step = samples.length > 4096 ? 4 : 1
  for (let index = 0; index < samples.length; index += step) {
    const value = samples[index] / 32768
    metrics.sumSquares += value * value
    metrics.samples += 1
    const absolute = Math.abs(value)
    if (absolute > metrics.peak) metrics.peak = absolute
  }
}

function tapRms(metrics: TapMetrics): number {
  return metrics.samples > 0 ? Math.sqrt(metrics.sumSquares / metrics.samples) : 0
}
