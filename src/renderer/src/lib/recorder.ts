import type {
  AppSettings,
  Job,
  RecorderSnapshot
} from '@shared/types'
import { useAppStore } from '../store'

const MIX_SAMPLE_RATE = 48_000
const PCM_SAMPLE_RATE = 16_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function floatToInt16(input: Float32Array): ArrayBuffer {
  const output = new Int16Array(input.length)
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return output.buffer
}

function isAllowedError(error: unknown): boolean {
  const name = (error as { name?: string })?.name
  return name === 'NotAllowedError' || name === 'SecurityError'
}

function micErrorMessage(error: unknown): string {
  if (isAllowedError(error)) {
    return 'Windows bloqueó el micrófono. Revisa Configuración › Privacidad y seguridad › Micrófono y permite el acceso a las aplicaciones de escritorio.'
  }
  if ((error as { name?: string })?.name === 'NotFoundError') {
    return 'No se encontró ningún micrófono conectado.'
  }
  return `No se pudo abrir el micrófono: ${(error as Error)?.message ?? 'error desconocido'}`
}

function systemErrorMessage(error: unknown): string {
  if (isAllowedError(error)) {
    return 'No se pudo iniciar la captura de pantalla/audio del sistema. Si usaste el atajo global, abre Chismosito y pulsa Grabar: Windows exige un clic para autorizar la captura.'
  }
  return `No se pudo capturar el audio del sistema: ${(error as Error)?.message ?? 'error desconocido'}`
}

class RecorderController {
  private snapshot: RecorderSnapshot = {
    phase: 'idle',
    id: null,
    elapsedSeconds: 0,
    micLevel: 0,
    systemLevel: 0,
    error: null,
    warning: null,
    startedAt: null
  }
  private listeners = new Set<(snapshot: RecorderSnapshot) => void>()
  private mixContext: AudioContext | null = null
  private tapContext: AudioContext | null = null
  private tapSink: MediaStreamAudioDestinationNode | null = null
  private tapConsumer: MediaRecorder | null = null
  private recorder: MediaRecorder | null = null
  /** Pistas separadas (micrófono y sistema) para conservar quién habla. */
  private trackRecorders: Array<{
    track: 'you' | 'others'
    recorder: MediaRecorder
  }> = []
  private micStream: MediaStream | null = null
  private systemStream: MediaStream | null = null
  private tapStreams: MediaStream[] = []
  private tapSources: MediaStreamAudioSourceNode[] = []
  private worklets: AudioWorkletNode[] = []
  private micAnalyser: AnalyserNode | null = null
  private systemAnalyser: AnalyserNode | null = null
  private levelBuffer = new Float32Array(1024)
  private peaks = { mic: 0, system: 0 }
  private startedAtMs = 0
  private tickTimer: number | null = null
  private chunkChain: Promise<void> = Promise.resolve()
  private sessionId: string | null = null
  private tapWarned = false

  subscribe(listener: (snapshot: RecorderSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): RecorderSnapshot {
    return this.snapshot
  }

  private set(patch: Partial<RecorderSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener(this.snapshot)
  }

  private fail(message: string): void {
    this.set({ error: message, phase: 'idle', id: null, micLevel: 0, systemLevel: 0 })
    useAppStore.getState().pushToast('error', message)
  }

  async start(settings: AppSettings): Promise<void> {
    if (this.snapshot.phase !== 'idle') return
    if (!settings.recordMic && !settings.recordSystem) {
      this.fail('Activa al menos una fuente de audio en Ajustes.')
      return
    }

    this.set({
      phase: 'starting',
      error: null,
      warning: null,
      elapsedSeconds: 0,
      micLevel: 0,
      systemLevel: 0
    })
    this.peaks = { mic: 0, system: 0 }
    this.tapWarned = false
    this.chunkChain = Promise.resolve()

    try {
      let warning: string | null = null

      if (settings.recordMic) {
        try {
          this.micStream = await this.openMicrophone(settings)
        } catch (error) {
          throw new Error(micErrorMessage(error))
        }
        if (!this.micStream) throw new Error('No se pudo abrir el micrófono.')
      }

      if (settings.recordSystem) {
        try {
          this.systemStream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 1, max: 2 } },
            audio: true
          })
        } catch (error) {
          throw new Error(systemErrorMessage(error))
        }
        if (this.systemStream.getAudioTracks().length === 0) {
          throw new Error(
            'Windows no entregó la pista de audio del sistema. Verifica que haya un dispositivo de salida activo y vuelve a intentarlo.'
          )
        }
      }

      if (!this.micStream && !this.systemStream) {
        throw new Error('No hay ninguna fuente de audio disponible.')
      }

      this.mixContext = new AudioContext({ sampleRate: MIX_SAMPLE_RATE })
      await this.mixContext.resume()
      const destination = this.mixContext.createMediaStreamDestination()
      destination.channelCount = 1
      destination.channelCountMode = 'explicit'

      if (this.micStream) {
        const source = this.mixContext.createMediaStreamSource(this.micStream)
        const gain = this.mixContext.createGain()
        gain.gain.value = 1
        this.micAnalyser = this.mixContext.createAnalyser()
        this.micAnalyser.fftSize = 1024
        this.micAnalyser.smoothingTimeConstant = 0.4
        source.connect(gain).connect(this.micAnalyser).connect(destination)
      }
      if (this.systemStream) {
        const source = this.mixContext.createMediaStreamSource(this.systemStream)
        const gain = this.mixContext.createGain()
        gain.gain.value = 1
        this.systemAnalyser = this.mixContext.createAnalyser()
        this.systemAnalyser.fftSize = 1024
        this.systemAnalyser.smoothingTimeConstant = 0.4
        source.connect(gain).connect(this.systemAnalyser).connect(destination)
      }

      this.startedAtMs = Date.now()
      const startedAt = new Date(this.startedAtMs).toISOString()

      const result = await window.chismosito.recording.start({
        hasMic: Boolean(this.micStream),
        hasSystem: Boolean(this.systemStream),
        startedAt,
        language: settings.language
      })
      this.sessionId = result.id
      this.tapContext = this.createTapContext()
      await this.tapContext.resume()
      this.tapContext.onstatechange = this.handleTapStateChange
      await this.tapContext.audioWorklet.addModule(
        new URL('worklets/pcm-tap.js', document.baseURI).toString()
      )
      if (this.micStream) this.attachTap(this.micStream, 'mic')
      if (this.systemStream) this.attachTap(this.systemStream, 'system')

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      this.recorder = new MediaRecorder(destination.stream, {
        mimeType,
        audioBitsPerSecond: 48_000
      })
      this.recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return
        this.chunkChain = this.chunkChain.then(async () => {
          const buffer = await event.data.arrayBuffer()
          if (this.sessionId) {
            window.chismosito.recording.sendWebmChunk(this.sessionId, buffer)
          }
        })
      }
      this.recorder.start(1000)

      // Graba también cada pista por separado: la re-transcripción conserva
      // así «Yo» y «Otros» exactos, sin adivinar por la transcripción previa.
      const trackStreams: Array<{
        track: 'you' | 'others'
        stream: MediaStream
      }> = []
      if (this.micStream) {
        trackStreams.push({
          track: 'you',
          stream: new MediaStream(this.micStream.getAudioTracks())
        })
      }
      if (this.systemStream) {
        trackStreams.push({
          track: 'others',
          stream: new MediaStream(this.systemStream.getAudioTracks())
        })
      }
      for (const entry of trackStreams) {
        try {
          const recorder = new MediaRecorder(entry.stream, {
            mimeType,
            audioBitsPerSecond: 32_000
          })
          recorder.ondataavailable = (event) => {
            if (event.data.size === 0) return
            this.chunkChain = this.chunkChain.then(async () => {
              const buffer = await event.data.arrayBuffer()
              if (this.sessionId) {
                window.chismosito.recording.sendTrackChunk(this.sessionId, entry.track, buffer)
              }
            })
          }
          recorder.start(1000)
          this.trackRecorders.push({ track: entry.track, recorder })
        } catch {
          // Si una pista no se puede grabar, la app sigue con el audio mezclado.
        }
      }

      this.set({
        phase: 'recording',
        id: result.id,
        startedAt,
        error: null,
        warning,
        elapsedSeconds: 0
      })
      window.chismosito.recording.setState({
        phase: 'recording',
        recordingId: result.id,
        elapsedSeconds: 0
      })

      this.tickTimer = window.setInterval(() => this.tick(), 200)

      if (warning) useAppStore.getState().pushToast('info', warning)
    } catch (error) {
      const message = (error as Error).message || 'No se pudo iniciar la grabación'
      const orphanId = this.sessionId
      await this.cleanup()
      if (orphanId) {
        await window.chismosito.recording.cancel(orphanId).catch(() => undefined)
      }
      this.fail(message)
    }
  }

  private async openMicrophone(settings: AppSettings): Promise<MediaStream> {
    const base: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
    if (settings.micDeviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: { ...base, deviceId: { exact: settings.micDeviceId } }
        })
      } catch (error) {
        if ((error as { name?: string })?.name !== 'OverconstrainedError') throw error
        useAppStore
          .getState()
          .pushToast('info', 'El micrófono elegido no está disponible; se usará el predeterminado.')
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio: base })
  }

  private createTapContext(): AudioContext {
    // `sinkId: none` evita que el contexto quede atado al dispositivo de salida.
    // Si el runtime no lo soporta, seguimos sin conectar nada al destination.
    const options = {
      sampleRate: PCM_SAMPLE_RATE,
      sinkId: { type: 'none' }
    } as AudioContextOptions & { sinkId: { type: 'none' } }
    try {
      return new AudioContext(options)
    } catch {
      return new AudioContext({ sampleRate: PCM_SAMPLE_RATE })
    }
  }

  private handleTapStateChange = (): void => {
    const context = this.tapContext
    if (!context || this.snapshot.phase !== 'recording' || context.state === 'running') return
    void context.resume().catch(() => undefined)
    if (!this.tapWarned) {
      this.tapWarned = true
      useAppStore
        .getState()
        .pushToast(
          'info',
          'La captura por pista se interrumpió; al detener se transcribirá el audio completo como respaldo.'
        )
    }
  }

  private attachTap(stream: MediaStream, track: 'mic' | 'system'): void {
    if (!this.tapContext) return
    const clone = new MediaStream(stream.getAudioTracks().map((audioTrack) => audioTrack.clone()))
    this.tapStreams.push(clone)
    const source = this.tapContext.createMediaStreamSource(clone)
    this.tapSources.push(source)
    const node = new AudioWorkletNode(this.tapContext, 'pcm-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { track }
    })
    node.port.onmessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== 'pcm') return
      const samples = new Float32Array(event.data.samples as ArrayBuffer)
      const pcm = floatToInt16(samples)
      if (this.sessionId) {
        window.chismosito.recording.sendPcmChunk(this.sessionId, track, pcm)
      }
    }
    // El worklet se conecta a un MediaStreamDestination (sin hardware). Conectar
    // un worklet a `context.destination` con ganancia 0 hace que Chromium lo pase
    // a baja prioridad y produzca dropouts en grabaciones largas.
    this.tapSink ??= this.tapContext.createMediaStreamDestination()
    if (!this.tapConsumer) {
      try {
        this.tapConsumer = new MediaRecorder(this.tapSink.stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm',
          audioBitsPerSecond: 16_000
        })
        this.tapConsumer.ondataavailable = () => undefined
        // El MediaRecorder actúa como consumidor real: obliga a Chromium a
        // renderizar el grafo a tiempo real aunque la salida sea inaudible.
        this.tapConsumer.start(5000)
      } catch (error) {
        console.warn('No se pudo iniciar el consumidor de la captura PCM', error)
      }
    }
    source.connect(node).connect(this.tapSink)
    this.worklets.push(node)
  }

  private tick(): void {
    if (this.snapshot.phase !== 'recording') return
    const elapsed = Math.floor((Date.now() - this.startedAtMs) / 1000)
    const micLevel = this.readLevel(this.micAnalyser, 'mic')
    const systemLevel = this.readLevel(this.systemAnalyser, 'system')
    this.set({ elapsedSeconds: elapsed, micLevel, systemLevel })
  }

  private readLevel(analyser: AnalyserNode | null, track: 'mic' | 'system'): number {
    if (!analyser) return 0
    analyser.getFloatTimeDomainData(this.levelBuffer)
    let sum = 0
    let peak = 0
    for (let i = 0; i < this.levelBuffer.length; i += 1) {
      const value = this.levelBuffer[i]
      sum += value * value
      const absolute = Math.abs(value)
      if (absolute > peak) peak = absolute
    }
    const rms = Math.sqrt(sum / this.levelBuffer.length)
    if (rms > this.peaks[track]) this.peaks[track] = rms
    return Math.min(1, rms * 7)
  }

  async stop(): Promise<Job | null> {
    if (this.snapshot.phase !== 'recording' || !this.sessionId) {
      if (this.snapshot.phase === 'starting') {
        useAppStore
          .getState()
          .pushToast('info', 'La grabación todavía se está preparando. Espera un momento.')
      }
      return null
    }

    const sessionId = this.sessionId
    const durationSeconds = Math.max(0, Math.round((Date.now() - this.startedAtMs) / 1000))
    const micPeak = this.peaks.mic
    const systemPeak = this.peaks.system
    this.set({ phase: 'stopping', micLevel: 0, systemLevel: 0 })
    window.chismosito.recording.setState({
      phase: 'stopping',
      recordingId: sessionId,
      elapsedSeconds: durationSeconds
    })

    try {
      for (const node of this.worklets) {
        node.port.postMessage({ type: 'flush' })
      }
      await sleep(250)

      for (const entry of this.trackRecorders) {
        if (entry.recorder.state === 'inactive') continue
        await new Promise<void>((resolvePromise) => {
          const timeout = window.setTimeout(resolvePromise, 2000)
          entry.recorder.addEventListener(
            'stop',
            () => {
              window.clearTimeout(timeout)
              resolvePromise()
            },
            { once: true }
          )
          entry.recorder.stop()
        })
      }
      this.trackRecorders = []

      if (this.recorder && this.recorder.state !== 'inactive') {
        await new Promise<void>((resolvePromise) => {
          const timeout = window.setTimeout(resolvePromise, 2000)
          this.recorder?.addEventListener(
            'stop',
            () => {
              window.clearTimeout(timeout)
              resolvePromise()
            },
            { once: true }
          )
          this.recorder?.stop()
        })
      }
      await this.chunkChain.catch(() => undefined)
      await sleep(150)

      await this.cleanup()

      const job = await window.chismosito.recording.stop({
        id: sessionId,
        durationSeconds,
        micPeak,
        systemPeak
      })
      this.set({
        phase: 'idle',
        id: null,
        elapsedSeconds: 0,
        micLevel: 0,
        systemLevel: 0,
        error: null,
        warning: null,
        startedAt: null
      })
      window.chismosito.recording.setState({
        phase: 'idle',
        recordingId: null,
        elapsedSeconds: 0
      })
      useAppStore.getState().pushToast('info', 'Grabación guardada. Transcribiendo en segundo plano…')
      void useAppStore.getState().refreshJobs()
      return job
    } catch (error) {
      await this.cleanup()
      await window.chismosito.recording.cancel(sessionId).catch(() => undefined)
      this.fail(`No se pudo cerrar la grabación: ${(error as Error).message}`)
      return null
    }
  }

  async cancel(): Promise<void> {
    const sessionId = this.sessionId
    if (this.snapshot.phase === 'idle') return
    this.set({ phase: 'stopping' })
    try {
      await this.cleanup()
      if (sessionId) await window.chismosito.recording.cancel(sessionId)
    } finally {
      this.set({
        phase: 'idle',
        id: null,
        elapsedSeconds: 0,
        micLevel: 0,
        systemLevel: 0,
        error: null,
        startedAt: null
      })
      window.chismosito.recording.setState({
        phase: 'idle',
        recordingId: null,
        elapsedSeconds: 0
      })
      useAppStore.getState().pushToast('info', 'Grabación descartada.')
    }
  }

  private async cleanup(): Promise<void> {
    if (this.tickTimer) {
      window.clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    for (const node of this.worklets) {
      try {
        node.port.postMessage({ type: 'flush' })
        node.disconnect()
      } catch {
        // ignore
      }
    }
    this.worklets = []
    for (const source of this.tapSources) {
      try {
        source.disconnect()
      } catch {
        // ignore
      }
    }
    this.tapSources = []
    this.tapSink = null
    if (this.tapConsumer && this.tapConsumer.state !== 'inactive') {
      try {
        this.tapConsumer.stop()
      } catch {
        // ignore
      }
    }
    this.tapConsumer = null
    if (this.tapContext) this.tapContext.onstatechange = null

    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop()
      } catch {
        // ignore
      }
    }
    this.recorder = null

    const contexts = [this.tapContext, this.mixContext]
    this.tapContext = null
    this.mixContext = null
    for (const context of contexts) {
      if (!context) continue
      try {
        await context.close()
      } catch {
        // ignore
      }
    }

    for (const stream of [this.micStream, this.systemStream, ...this.tapStreams]) {
      stream?.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          // ignore
        }
      })
    }
    this.micStream = null
    this.systemStream = null
    this.tapStreams = []
    this.micAnalyser = null
    this.systemAnalyser = null
    this.sessionId = null
    this.peaks = { mic: 0, system: 0 }
    this.tapWarned = false
    this.chunkChain = Promise.resolve()
  }
}

export const recorder = new RecorderController()
