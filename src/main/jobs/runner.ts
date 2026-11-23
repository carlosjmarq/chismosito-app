import { app } from 'electron'
import { existsSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Job, JobStage, LiveSegment } from '@shared/types'
import { MISSING_KEY_MESSAGE } from '@shared/constants'
import type { SettingsStore } from '../settings'
import type { NoteRepository } from '../notes/repository'
import type { WhisperManager } from '../whisper/manager'
import { runWhisper, type RawSegment } from '../whisper/runner'
import { cleanSegmentText, mergeSpeakers, renderTranscript } from '../whisper/merge'
import { withMixWav } from '../audio/ffmpeg'
import { assignSpeakers, nearestSpeaker, parseSpeakerTimeline } from '../whisper/relabel'
import { MIN_TRACK_PEAK, wavPeak } from '../whisper/wav-peak'
import type { LlmClient } from '../llm/summarizer'
import type { JevClient, FolderSuggestion } from '../llm/jev'
import { ensureDir, writeAtomic } from '../lib/fs'
import { log } from '../lib/logger'

export interface NewJobInput {
  id: string
  baseName: string
  notePath: string
  audioPath: string
  micWavPath: string | null
  systemWavPath: string | null
  transcribeAudioPath?: string | null
  durationSeconds: number
  language: string
  hasMic: boolean
  hasSystem: boolean
  meetingDate: string
  captureIssue?: string | null
  reprocessAudio?: boolean
}

interface JobRunnerDeps {
  settings: SettingsStore
  notes: NoteRepository
  whisper: WhisperManager
  llm: LlmClient
  jev: JevClient
  emitJobs: (jobs: Job[]) => void
  emitToast: (level: 'info' | 'success' | 'error', message: string) => void
  emitLiveSegment?: (notePath: string, segment: LiveSegment) => void
  onNoteChanged: () => void
  backupNote?: (notePath: string) => Promise<void>
  driveEnabled?: () => boolean
}

const STAGE_MESSAGES: Record<JobStage, string> = {
  queued: 'En cola',
  preparing_audio: 'Preparando el audio completo',
  transcribing_mic: 'Transcribiendo tu voz',
  transcribing_system: 'Transcribiendo a los demás',
  transcribing_mix: 'Transcribiendo el audio completo',
  merging: 'Uniendo la transcripción',
  summarizing: 'Generando resumen y acciones',
  finalizing: 'Guardando la nota',
  done: 'Listo',
  failed: 'Error',
  cancelled: 'Cancelado'
}

export class JobRunner {
  private jobs: Job[] = []
  private running = false
  private quitting = false
  private currentAbort: AbortController | null = null
  private currentJobId: string | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private readonly filePath = join(app.getPath('userData'), 'jobs.json')

  constructor(private readonly deps: JobRunnerDeps) {}

  async init(): Promise<void> {
    ensureDir(dirname(this.filePath))
    try {
      const { readFile } = await import('node:fs/promises')
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as Job[]
      if (Array.isArray(raw)) {
        this.jobs = raw.filter((job) => job && typeof job.id === 'string')
      }
    } catch {
      this.jobs = []
    }

    const beforeCleanup = this.jobs.length
    this.jobs = this.jobs.filter((job) => {
      if (!job.notePath || existsSync(job.notePath)) return true
      if (!['done', 'failed', 'cancelled'].includes(job.stage)) {
        log.warn(`Se descarta el trabajo ${job.id}: la nota ya no existe`)
      }
      return false
    })
    if (this.jobs.length !== beforeCleanup) this.save()

    let resumed = false
    for (const job of this.jobs) {
      if (!['done', 'failed', 'cancelled'].includes(job.stage)) {
        job.stage = 'queued'
        job.progress = 0
        job.message = STAGE_MESSAGES.queued
        job.error = null
        resumed = true
      }
    }
    if (resumed) this.save()
    this.kick()
  }

  removeForNote(notePath: string): void {
    const target = normalizePath(notePath)
    const matches = this.jobs.filter((job) => normalizePath(job.notePath) === target)
    if (matches.length === 0) return

    const includesCurrent = matches.some((job) => job.id === this.currentJobId)
    this.jobs = this.jobs.filter((job) => normalizePath(job.notePath) !== target)
    if (includesCurrent) this.currentAbort?.abort()
    this.saveNow()
    this.deps.emitJobs(this.list())
  }

  handleNoteMove(oldPath: string, newPath: string): void {
    const target = normalizePath(oldPath)
    let changed = false
    for (const job of this.jobs) {
      if (normalizePath(job.notePath) !== target) continue
      job.notePath = newPath
      job.baseName = basename(newPath, '.md')
      job.audioPath = newPath.replace(/\.md$/i, '.webm')
      job.updatedAt = new Date().toISOString()
      changed = true
    }
    if (!changed) return
    this.saveNow()
    this.deps.emitJobs(this.list())
  }

  list(): Job[] {
    return [...this.jobs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }

  abortForQuit(): void {
    this.quitting = true
    const current = this.jobs.find((job) => job.id === this.currentJobId)
    if (current) {
      current.stage = 'queued'
      current.progress = 0
      current.message = 'Se reanudará al abrir Chismosito'
      current.error = null
      current.updatedAt = new Date().toISOString()
      this.saveNow()
    }
    this.currentAbort?.abort()
  }

  enqueue(input: NewJobInput): Job {
    const now = new Date().toISOString()
    const job: Job = {
      id: input.id || randomUUID(),
      baseName: input.baseName,
      notePath: input.notePath,
      audioPath: input.audioPath,
      micWavPath: input.micWavPath,
      systemWavPath: input.systemWavPath,
      transcribeAudioPath: input.transcribeAudioPath ?? null,
      durationSeconds: input.durationSeconds,
      language: input.language,
      hasMic: input.hasMic,
      hasSystem: input.hasSystem,
      meetingDate: input.meetingDate || now,
      captureIssue: input.captureIssue ?? null,
      reprocessAudio: Boolean(input.reprocessAudio),
      stage: 'queued',
      progress: 0,
      message: STAGE_MESSAGES.queued,
      error: null,
      createdAt: now,
      updatedAt: now,
      transcriptChars: 0
    }
    this.jobs.unshift(job)
    this.prune()
    this.changed()
    this.kick()
    return job
  }

  async retry(id: string): Promise<void> {
    const job = this.jobs.find((entry) => entry.id === id)
    if (!job || this.currentJobId === id) return
    job.stage = 'queued'
    job.progress = 0
    job.error = null
    job.message = STAGE_MESSAGES.queued
    job.updatedAt = new Date().toISOString()
    this.changed()
    this.kick()
  }

  async cancel(id: string): Promise<void> {
    const job = this.jobs.find((entry) => entry.id === id)
    if (!job) return
    if (this.currentJobId === id && this.currentAbort) {
      this.currentAbort.abort()
      return
    }
    if (['done', 'failed', 'cancelled'].includes(job.stage)) return
    job.stage = 'cancelled'
    job.message = STAGE_MESSAGES.cancelled
    job.error = 'Cancelado por el usuario'
    job.updatedAt = new Date().toISOString()
    this.changed()
  }

  private prune(): void {
    const finished = this.jobs.filter((job) => ['done', 'failed', 'cancelled'].includes(job.stage))
    if (finished.length <= 25) return
    const keep = new Set(finished.slice(0, 25).map((job) => job.id))
    this.jobs = this.jobs.filter(
      (job) => !['done', 'failed', 'cancelled'].includes(job.stage) || keep.has(job.id)
    )
  }

  private changed(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.save()
      this.deps.emitJobs(this.list())
    }, 250)
  }

  private saveNow(): void {
    try {
      writeAtomic(this.filePath, JSON.stringify(this.jobs, null, 2))
    } catch (error) {
      log.error('No se pudo guardar jobs.json', error)
    }
  }

  private save(): void {
    this.saveNow()
  }

  private update(job: Job, patch: Partial<Job>): void {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() })
    this.changed()
  }

  private kick(): void {
    if (this.running || this.quitting) return
    const next = this.jobs
      .filter((job) => job.stage === 'queued')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0]
    if (!next) return
    this.running = true
    this.currentJobId = next.id
    this.currentAbort = new AbortController()
    void this.process(next)
      .catch((error) => log.error('Error inesperado procesando trabajo', error))
      .finally(() => {
        this.running = false
        this.currentJobId = null
        this.currentAbort = null
        this.saveNow()
        this.deps.emitJobs(this.list())
        if (!this.quitting) this.kick()
      })
  }

  private cancelled(job: Job): boolean {
    return this.currentJobId === job.id && Boolean(this.currentAbort?.signal.aborted)
  }

  private async process(job: Job): Promise<void> {
    const signal = this.currentAbort?.signal
    const settings = this.deps.settings.get()
    const startedAt = Date.now()
    let transcriptWritten = false

    try {
      const note = await this.deps.notes.get(job.notePath)
      const existingTranscript = note
        ? await this.deps.notes.readTranscriptMarkdown(job.notePath)
        : null
      const hasAudioFile = Boolean(
        job.audioPath &&
          existsSync(job.audioPath) &&
          /\.(webm|wav)$/i.test(job.audioPath)
      )

      let tapIssue = job.captureIssue?.trim() || null
      let availableMic =
        !tapIssue && job.micWavPath && existsSync(job.micWavPath) ? job.micWavPath : null
      let availableSystem =
        !tapIssue && job.systemWavPath && existsSync(job.systemWavPath)
          ? job.systemWavPath
          : null

      // Un WAV truncado es peor que no tener WAV: whisper alucina sobre él.
      if (availableMic && !(await this.wavLooksComplete(availableMic, job.durationSeconds))) {
        log.warn('La pista del micrófono está incompleta; se usará el audio completo', availableMic)
        availableMic = null
        tapIssue = tapIssue ?? 'pista de micrófono incompleta'
      }
      if (
        availableSystem &&
        !(await this.wavLooksComplete(availableSystem, job.durationSeconds))
      ) {
        log.warn('La pista del sistema está incompleta; se usará el audio completo', availableSystem)
        availableSystem = null
        tapIssue = tapIssue ?? 'pista del sistema incompleta'
      }

      const retranscribe =
        job.transcribeAudioPath && existsSync(job.transcribeAudioPath)
          ? job.transcribeAudioPath
          : null
      const summaryOnly = Boolean(
        !job.reprocessAudio &&
          !retranscribe &&
          existingTranscript &&
          !availableMic &&
          !availableSystem &&
          (!tapIssue || !hasAudioFile)
      )
      const mixOnly = Boolean(
        !summaryOnly &&
          !retranscribe &&
          (job.reprocessAudio ||
            Boolean(tapIssue) ||
            (!availableMic && !availableSystem))
      )

      if (mixOnly && !hasAudioFile) {
        throw new Error(
          job.reprocessAudio
            ? 'No se encontró el audio de esta nota para reprocesar.'
            : 'No hay audio utilizable para transcribir esta reunión.'
        )
      }

      let transcriptText = ''

      if (summaryOnly && existingTranscript) {
        transcriptText = existingTranscript
        this.update(job, {
          stage: 'merging',
          progress: 62,
          message: 'Recuperando transcripción existente'
        })
      } else {
        const devices: Array<'cpu' | 'cuda'> = [this.deps.whisper.activeDevice()]
        let micSegments: RawSegment[] = []
        let systemSegments: RawSegment[] = []
        let mixSegments: RawSegment[] = []
        const timeline = retranscribe ? parseSpeakerTimeline(existingTranscript) : []

        const transcribe = async (
          wav: string | null,
          kind: 'mic' | 'system' | 'mixed'
        ): Promise<RawSegment[]> => {
          if (!wav || !existsSync(wav)) return []
          // Pista sin señal real: whisper alucinaría frases sobre el ruido.
          const peak = await wavPeak(wav).catch(() => 1)
          if (peak < MIN_TRACK_PEAK) {
            log.info(`Pista ${kind} sin señal (pico ${peak.toFixed(4)}); se omite`)
            return []
          }
          const stage: JobStage =
            kind === 'mic'
              ? 'transcribing_mic'
              : kind === 'system'
                ? 'transcribing_system'
                : 'transcribing_mix'
          const stageMessage =
            kind === 'mixed' ? 'Re-transcribiendo con el modelo activo' : STAGE_MESSAGES[stage]
          const base = kind === 'mic' ? 8 : kind === 'system' ? 34 : 10
          const span = kind === 'mixed' ? 50 : 26
          this.update(job, { stage, progress: base, message: stageMessage })

          const attempt = async (device: 'cpu' | 'cuda'): Promise<RawSegment[]> =>
            runWhisper({
              // Sin contexto previo en todas las pistas: en tramos sin voz el
              // prompt se retroalimenta y el modelo inventa frases.
              noContext: true,
              vadModelPath:
                settings.vadEnabled && this.deps.whisper.hasVad()
                  ? this.deps.whisper.vadPath()
                  : null,
              cliPath:
                device === 'cuda'
                  ? this.deps.whisper.cudaCliPath() ?? this.deps.whisper.cpuCliPath()
                  : this.deps.whisper.cpuCliPath(),
              modelPath: this.deps.whisper.modelPath(),
              wavPath: wav,
              language: job.language,
              device,
              threads: settings.whisperThreads,
              signal,
              onSegment: (segment) => {
                const nearest = nearestSpeaker(timeline, Math.max(0, segment.fromMs))
                const speaker: 'Yo' | 'Otros' =
                  kind === 'mic' ? 'Yo' : kind === 'system' ? 'Otros' : nearest === 'Yo' ? 'Yo' : 'Otros'
                const text = cleanSegmentText(segment.text)
                if (!text) return
                this.deps.emitLiveSegment?.(job.notePath, {
                  speaker,
                  fromMs: Math.max(0, segment.fromMs),
                  toMs: Math.max(segment.fromMs, segment.toMs),
                  text
                })
              },
              onProgress: (percent) => {
                this.update(job, {
                  progress: Math.min(60, Math.round(base + (percent / 100) * span)),
                  message: `${stageMessage} · ${percent}%`
                })
              }
            })

          try {
            return await attempt(devices[0])
          } catch (error) {
            if (devices[0] === 'cuda' && !signal?.aborted) {
              log.warn('CUDA falló, reintentando en CPU', error)
              devices[0] = 'cpu'
              this.deps.emitToast(
                'info',
                'La transcripción con GPU falló; se reintenta con CPU.'
              )
              return attempt('cpu')
            }
            throw error
          }
        }

        if (retranscribe) {
          // Audio mezclado: una sola pista, y se recuperan los hablantes del
          // timeline de la transcripción anterior.
          const segments = await transcribe(retranscribe, 'mixed')
          if (signal?.aborted) throw new Error('Procesamiento cancelado')
          transcriptText = renderTranscript(assignSpeakers(segments, timeline)).markdown
        } else if (mixOnly) {
          this.update(job, {
            stage: 'preparing_audio',
            progress: 4,
            message: STAGE_MESSAGES.preparing_audio
          })
          mixSegments = await withMixWav(job.audioPath, signal, (wavPath) =>
            transcribe(wavPath, 'mixed')
          )
          if (signal?.aborted) throw new Error('Procesamiento cancelado')

          this.update(job, { stage: 'merging', progress: 62, message: STAGE_MESSAGES.merging })
          const merged = mergeSpeakers([], mixSegments).map((segment) => ({
            ...segment,
            speaker: 'Mixto' as const
          }))
          transcriptText = renderTranscript(merged).markdown
        } else {
          if (availableMic) micSegments = await transcribe(availableMic, 'mic')
          if (signal?.aborted) throw new Error('Procesamiento cancelado')
          if (availableSystem) systemSegments = await transcribe(availableSystem, 'system')
          if (signal?.aborted) throw new Error('Procesamiento cancelado')

          this.update(job, { stage: 'merging', progress: 62, message: STAGE_MESSAGES.merging })
          const merged = mergeSpeakers(micSegments, systemSegments)
          transcriptText = renderTranscript(merged).markdown
        }

        if (!transcriptText.trim()) {
          throw new Error(
            retranscribe
              ? 'No se detectó voz en el audio guardado. Revisa que el audio no estuviera silenciado.'
              : mixOnly
                ? 'No se detectó voz en el audio completo. Revisa que el audio no estuviera silenciado.'
                : 'No se detectó voz en la grabación. Revisa que el micrófono y el audio del sistema no estuvieran silenciados.'
          )
        }

        if (mixOnly && !job.reprocessAudio) {
          this.deps.emitToast(
            'info',
            'La captura por pista no fue fiable; se transcribió el audio completo sin separar hablantes.'
          )
        }

        await this.deps.notes.writeResult(job.notePath, {
          summary: null,
          transcript: transcriptText,
          llm: null,
          status: 'processing'
        })
        transcriptWritten = true
        this.update(job, { transcriptChars: transcriptText.length })
      }

      let summary: Awaited<ReturnType<LlmClient['summarize']>> | null = null
      let summaryError: string | null = null
      if (!this.deps.llm.configured()) {
        summaryError = MISSING_KEY_MESSAGE
      } else {
        this.update(job, {
          stage: 'summarizing',
          progress: 66,
          message: STAGE_MESSAGES.summarizing
        })
        try {
          summary = await this.deps.llm.summarize(
            transcriptText,
            {
              date: new Date(job.meetingDate || job.createdAt).toISOString(),
              durationSeconds: job.durationSeconds,
              language: job.language,
              userName: settings.userName
            },
            signal,
            job.id
          )
        } catch (error) {
          summaryError = (error as Error).message
          log.warn('Resumen falló', error)
        }
      }

      if (signal?.aborted) throw new Error('Procesamiento cancelado')

      let folderSuggestion: FolderSuggestion | null = null
      if (summary && !note?.folder && settings.folderSuggestions && this.deps.jev.configured()) {
        try {
          const folders = await this.deps.notes.folders()
          if (folders.length > 0) {
            this.update(job, {
              stage: 'summarizing',
              progress: 90,
              message: 'Sugiriendo carpeta…'
            })
            folderSuggestion = await this.deps.jev.suggestFolder({
              title: summary.title,
              summary: summary.summary,
              topics: summary.topics,
              folders,
              index: await this.deps.notes.index()
            })
          }
        } catch (error) {
          log.warn('No se pudo calcular la sugerencia de carpeta', error)
        }
      }
      if (signal?.aborted) throw new Error('Procesamiento cancelado')

      this.update(job, { stage: 'finalizing', progress: 94, message: STAGE_MESSAGES.finalizing })
      await this.deps.notes.writeResult(job.notePath, {
        summary: summary?.summary ?? null,
        transcript: transcriptText,
        llm: summary?.model ?? null,
        status: summary ? 'complete' : 'summary_failed',
        title: summary?.title,
        topics: summary?.topics,
        suggestedFolder: folderSuggestion?.folder ?? null,
        suggestedFolderConfidence: folderSuggestion?.confidence ?? null
      })
      this.deps.onNoteChanged()

      if (summary?.title) {
        this.deps.emitToast('success', `Nota lista: ${summary.title}`)
      } else if (summaryError) {
        this.deps.emitToast('info', `Transcripción lista. No se pudo resumir: ${summaryError}`)
      }

      this.update(job, {
        stage: 'done',
        progress: 100,
        message: STAGE_MESSAGES.done,
        error: summaryError
      })

      if (this.deps.driveEnabled?.()) {
        this.deps
          .backupNote?.(job.notePath)
          .catch((error) => this.deps.emitToast('error', `Respaldo en Drive falló: ${error.message}`))
      }

      log.info(`Trabajo ${job.id} terminado en ${Math.round((Date.now() - startedAt) / 1000)}s`)
    } catch (error) {
      if (this.quitting) {
        this.update(job, {
          stage: 'queued',
          progress: 0,
          message: 'Se reanudará al abrir Chismosito',
          error: null
        })
        this.saveNow()
        return
      }
      const aborted = this.cancelled(job)
      const message = aborted ? 'Procesamiento cancelado' : (error as Error).message
      log.warn(`Trabajo ${job.id} falló`, error)

      if (!transcriptWritten) {
        try {
          await this.deps.notes.setStatus(
            job.notePath,
            aborted ? 'cancelled' : 'transcription_failed'
          )
          this.deps.onNoteChanged()
        } catch (statusError) {
          log.error('No se pudo actualizar el estado de la nota', statusError)
        }
      } else if (!aborted) {
        try {
          await this.deps.notes.setStatus(job.notePath, 'summary_failed')
        } catch {
          // ignore
        }
      }

      this.update(job, {
        stage: aborted ? 'cancelled' : 'failed',
        message: aborted ? STAGE_MESSAGES.cancelled : STAGE_MESSAGES.failed,
        error: message,
        progress: aborted ? job.progress : 100
      })

      if (!aborted) this.deps.emitToast('error', `No se pudo procesar la reunión: ${message}`)
    } finally {
      if (transcriptWritten && !this.deps.settings.get().keepTempWav) {
        await this.cleanupTemp(job).catch((error) =>
          log.warn('No se pudieron borrar los WAV temporales', error)
        )
      }
    }
  }

  private async wavLooksComplete(path: string, durationSeconds: number): Promise<boolean> {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return true
    try {
      const info = await stat(path)
      const seconds = Math.max(0, (info.size - 44) / (16_000 * 2))
      const tolerance = Math.max(5, durationSeconds * 0.05)
      return Math.abs(seconds - durationSeconds) <= tolerance
    } catch {
      return false
    }
  }

  private async cleanupTemp(job: Job): Promise<void> {
    if (job.transcribeAudioPath) {
      await rm(job.transcribeAudioPath, { force: true })
      await rm(dirname(job.transcribeAudioPath), { recursive: true, force: true })
    }
    for (const path of [job.micWavPath, job.systemWavPath]) {
      if (!path) continue
      await rm(path, { force: true })
    }
    if (job.micWavPath) {
      await rm(dirname(job.micWavPath), { recursive: true, force: true })
    } else if (job.systemWavPath) {
      await rm(dirname(job.systemWavPath), { recursive: true, force: true })
    }
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase()
}
