import { execFile } from 'node:child_process'
import { totalmem, cpus } from 'node:os'
import type { WhisperHardware } from '@shared/whisper-policy'
import { log } from '../lib/logger'

const MIB = 1024 * 1024
const TTL_MS = 60_000

let cached: { at: number; value: WhisperHardware } | null = null

function runFile(file: string, args: string[], timeout = 4_000): Promise<string | null> {
  return new Promise((resolvePromise) => {
    try {
      execFile(file, args, { timeout, windowsHide: true }, (error, stdout) => {
        if (error) {
          resolvePromise(null)
          return
        }
        resolvePromise(String(stdout))
      })
    } catch {
      resolvePromise(null)
    }
  })
}

async function viaNvidiaSmi(): Promise<{ name: string; vramMb: number } | null> {
  const out = await runFile('nvidia-smi', [
    '--query-gpu=name,memory.total',
    '--format=csv,noheader,nounits'
  ])
  if (!out) return null
  const line = out
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0)
  if (!line) return null
  const match = line.match(/^(.*?),\s*(\d+)\s*$/)
  if (!match) return null
  const vramMb = Number(match[2])
  if (!Number.isFinite(vramMb) || vramMb <= 0) return null
  return { name: match[1].trim(), vramMb }
}

/**
 * Algunos drivers no exponen nvidia-smi; el registro guarda la VRAM en 64 bits
 * (AdapterRAM de WMI está limitado a 4 GB y miente).
 */
async function viaRegistry(): Promise<{ name: string; vramMb: number } | null> {
  const key =
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000'
  const out = await runFile('reg', ['query', key])
  if (!out) return null
  const sizeLine = out.split(/\r?\n/).find((line) => /qwMemorySize/i.test(line))
  if (!sizeLine) return null
  const hex = sizeLine.trim().split(/\s+/).pop() ?? ''
  const bytes = Number.parseInt(hex.replace(/^0x/i, ''), 16)
  if (!Number.isFinite(bytes) || bytes <= 0) return null
  const nameLine = out.split(/\r?\n/).find((line) => /DriverDesc/i.test(line))
  const name = nameLine ? nameLine.split(/\s{2,}/).pop()?.trim() ?? null : null
  if (name && !/nvidia/i.test(name)) return null
  return { name: name ?? 'NVIDIA', vramMb: Math.round(bytes / MIB) }
}

export async function probeWhisperHardware(cudaBinary: boolean): Promise<WhisperHardware> {
  const ramMb = Math.round(totalmem() / MIB)
  const cores = cpus().length

  if (cached && Date.now() - cached.at < TTL_MS && cached.value.cudaBinary === cudaBinary) {
    return cached.value
  }

  let gpu = await viaNvidiaSmi()
  let source: WhisperHardware['vramSource'] = gpu ? 'nvidia-smi' : 'none'
  if (!gpu) {
    gpu = await viaRegistry()
    if (gpu) source = 'registry'
  }
  if (!gpu) log.info('Sin GPU NVIDIA detectable: se recomendará un modelo para CPU')

  const value: WhisperHardware = {
    vramMb: gpu?.vramMb ?? null,
    gpuName: gpu?.name ?? null,
    vramSource: source,
    ramMb,
    cores,
    cudaBinary
  }
  cached = { at: Date.now(), value }
  return value
}

export function resetHardwareCache(): void {
  cached = null
}
