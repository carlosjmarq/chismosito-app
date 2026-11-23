import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { WavSink } from '../audio/sinks'
import { ensureDir } from '../lib/fs'
import { log } from '../lib/logger'

const SAMPLE_RATE = 16_000
const MAX_SAMPLES = SAMPLE_RATE * 3600 * 6

export type RetranscribeMode = 'tracks' | 'mixed'

interface Session {
  id: string
  notePath: string
  dir: string
  mode: RetranscribeMode
  sinks: { mixed: WavSink | null; you: WavSink | null; others: WavSink | null }
  paths: { mixed: string; you: string; others: string }
}

/**
 * Recibe el audio ya decodificado (16 kHz mono int16) que manda el renderer y
 * lo deja en WAVs temporales para re-transcribir.
 *
 * Si la nota guarda pistas separadas (`-yo`/`-otros`) se reconstruyen dos WAV
 * y la transcripción conserva «Yo/Otros» exactos; si solo hay audio mezclado,
 * se usa una sola pista y los hablantes se aproximan desde la transcripción
 * anterior.
 */
export class RetranscribeSessions {
  private sessions = new Map<string, Session>()

  begin(notePath: string, mode: RetranscribeMode): { id: string; needs: Array<'mixed' | 'you' | 'others'> } {
    const id = randomUUID()
    const dir = join(app.getPath('userData'), 'tmp', 'retranscribe', id)
    ensureDir(dir)
    const paths = {
      mixed: join(dir, 'audio.wav'),
      you: join(dir, 'you.wav'),
      others: join(dir, 'others.wav')
    }

    const sink = (path: string): WavSink => {
      const wav = new WavSink(path, SAMPLE_RATE, 1, 16)
      wav.open()
      return wav
    }

    const session: Session =
      mode === 'tracks'
        ? {
            id,
            notePath,
            dir,
            mode,
            sinks: { mixed: null, you: sink(paths.you), others: sink(paths.others) },
            paths
          }
        : {
            id,
            notePath,
            dir,
            mode,
            sinks: { mixed: sink(paths.mixed), you: null, others: null },
            paths
          }

    this.sessions.set(id, session)
    return { id, needs: mode === 'tracks' ? ['you', 'others'] : ['mixed'] }
  }

  append(id: string, track: 'mixed' | 'you' | 'others', chunk: ArrayBuffer | Uint8Array): void {
    const session = this.sessions.get(id)
    if (!session) throw new Error('La re-transcripción ya no está activa')
    const sink = session.sinks[track]
    if (!sink) return
    sink.append(chunk)
  }

  finish(id: string): {
    mode: RetranscribeMode
    notePath: string
    wavPath: string | null
    youWavPath: string | null
    othersWavPath: string | null
    dir: string
  } {
    const session = this.sessions.get(id)
    if (!session) throw new Error('La re-transcripción ya no está activa')
    this.sessions.delete(id)

    const finalize = (path: string, sink: WavSink | null): string | null => {
      if (!sink) return null
      const result = sink.finalize()
      if (result.bytes <= 44) return null
      return path
    }

    const mixed = finalize(session.paths.mixed, session.sinks.mixed)
    const you = finalize(session.paths.you, session.sinks.you)
    const others = finalize(session.paths.others, session.sinks.others)

    if (session.mode === 'tracks' && !you && !others) {
      throw new Error('No se pudo preparar el audio de las pistas')
    }
    if (session.mode === 'mixed' && !mixed) {
      throw new Error('No se pudo preparar el audio para re-transcribir')
    }

    return {
      mode: session.mode,
      notePath: session.notePath,
      wavPath: mixed,
      youWavPath: you,
      othersWavPath: others,
      dir: session.dir
    }
  }

  async cancel(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    await rm(session.dir, { recursive: true, force: true }).catch((error) =>
      log.warn('No se pudo borrar el audio temporal de re-transcripción', error)
    )
  }
}

let instance: RetranscribeSessions | null = null

export function retranscribeSessions(): RetranscribeSessions {
  if (!instance) instance = new RetranscribeSessions()
  return instance
}

export function hasTrackFiles(dir: string, audioName: string): boolean {
  const base = audioName.replace(/\.[^.]+$/, '')
  const ext = audioName.slice(base.length) || '.webm'
  return (
    existsSync(join(dir, `${base}-yo${ext}`)) && existsSync(join(dir, `${base}-otros${ext}`))
  )
}
