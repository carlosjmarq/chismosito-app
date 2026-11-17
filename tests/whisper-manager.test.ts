import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? paths.userData : paths.userData),
    getAppPath: () => paths.userData,
    isPackaged: false
  },
  net: {
    fetch: async () => {
      throw new Error('sin red en pruebas')
    }
  }
}))

vi.mock('../src/main/whisper/hardware', () => ({
  probeWhisperHardware: async (cudaBinary: boolean) => ({
    vramMb: cudaBinary ? 4096 : null,
    gpuName: cudaBinary ? 'NVIDIA Test' : null,
    vramSource: cudaBinary ? 'nvidia-smi' : 'none',
    ramMb: 16 * 1024,
    cores: 8,
    cudaBinary
  })
}))

const { WhisperManager } = await import('../src/main/whisper/manager')
const { whisperModel } = await import('../src/shared/whisper-models')

type FakeSettings = {
  whisperModel: string
  whisperModelPath: string | null
  whisperDevice: 'auto' | 'cpu' | 'cuda'
}

function settingsStore(initial: Partial<FakeSettings> = {}) {
  const state: FakeSettings = {
    whisperModel: '',
    whisperModelPath: null,
    whisperDevice: 'auto',
    ...initial
  }
  return {
    state,
    get: () => ({ ...state }),
    update: (patch: Partial<FakeSettings>) => {
      Object.assign(state, patch)
      return { ...state }
    }
  }
}

function installCudaBinary(): void {
  const dir = join(paths.userData, 'whisper-cuda', 'Release')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'whisper-cli.exe'), 'stub')
}

function installModel(id: string, padding = 0): void {
  const spec = whisperModel(id)!
  const path = join(paths.userData, 'models', spec.file)
  mkdirSync(join(paths.userData, 'models'), { recursive: true })
  writeFileSync(path, 'ggml')
  truncateSync(path, spec.bytes + padding)
}

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chismosito-whisper-'))
  paths.userData = root
  mkdirSync(join(root, 'models'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('WhisperManager.status', () => {
  it('sin modelos marca missing y recomienda según el equipo', async () => {
    installCudaBinary()
    const manager = new WhisperManager(settingsStore() as never)
    const status = await manager.status()

    expect(status.model.present).toBe(false)
    expect(status.model.source).toBe('missing')
    expect(status.hardware.vramMb).toBe(4096)
    expect(status.recommendations).toEqual({
      fastest: 'large-v3-turbo-q5_0',
      balanced: 'large-v3-turbo-q8_0',
      quality: 'large-v3-q5_0'
    })
    expect(status.models.find((model) => model.roles.includes('quality'))?.id).toBe(
      'large-v3-q5_0'
    )
    expect(status.models.every((model) => !model.installed)).toBe(true)
  })

  it('reconoce un archivo instalado solo si el tamaño coincide', async () => {
    installModel('medium-q5_0')
    installModel('tiny-q5_1', 10)
    const manager = new WhisperManager(settingsStore() as never)
    const status = await manager.status()

    expect(status.models.find((model) => model.id === 'medium-q5_0')?.installed).toBe(true)
    expect(status.models.find((model) => model.id === 'tiny-q5_1')?.installed).toBe(false)
    expect(status.installedBytes).toBe(whisperModel('medium-q5_0')!.bytes)
  })

  it('respeta la elección explícita y el modo automático', async () => {
    installCudaBinary()
    installModel('small-q5_1')
    installModel('large-v3-turbo-q5_0')

    const chosen = new WhisperManager(
      settingsStore({ whisperModel: 'small-q5_1' }) as never
    )
    expect((await chosen.status()).activeModelId).toBe('small-q5_1')

    const auto = new WhisperManager(settingsStore() as never)
    expect((await auto.status()).activeModelId).toBe('large-v3-turbo-q5_0')
  })

  it('en automático prefiere el instalado de mayor calidad', async () => {
    installCudaBinary()
    installModel('tiny-q5_1')
    installModel('medium-q5_0')
    installModel('small-q5_1')
    const manager = new WhisperManager(settingsStore() as never)
    // El recomendado (turbo) no está instalado: gana medium por calidad, no tiny/small por orden.
    expect((await manager.status()).activeModelId).toBe('medium-q5_0')
  })

  it('el modelo personalizado gana y no aparece como del catálogo', async () => {
    installModel('medium-q5_0')
    const custom = join(root, 'my-model.bin')
    writeFileSync(custom, 'ggml')

    const manager = new WhisperManager(
      settingsStore({ whisperModelPath: custom }) as never
    )
    const status = await manager.status()

    expect(status.customPath).toBe(custom)
    expect(status.activeModelId).toBeNull()
    expect(status.model.source).toBe('custom')
    expect(status.model.path).toBe(custom)
    expect(manager.modelPath()).toBe(custom)
  })

  it('migra el archivo legado medium-q5_0', async () => {
    installModel('medium-q5_0')
    const manager = new WhisperManager(settingsStore() as never)
    const status = await manager.status()

    expect(status.activeModelId).toBe('medium-q5_0')
    expect(manager.modelPath()).toBe(join(root, 'models', 'ggml-medium-q5_0.bin'))
  })
})

describe('WhisperManager.removeModel', () => {
  it('no deja borrar el modelo activo', async () => {
    installModel('medium-q5_0')
    const manager = new WhisperManager(
      settingsStore({ whisperModel: 'medium-q5_0' }) as never
    )
    await expect(manager.removeModel('medium-q5_0')).rejects.toThrow(/modelo activo/)
  })

  it('borra los modelos inactivos y actualiza el estado', async () => {
    installModel('medium-q5_0')
    installModel('tiny-q5_1')
    const manager = new WhisperManager(
      settingsStore({ whisperModel: 'medium-q5_0' }) as never
    )

    const after = await manager.removeModel('tiny-q5_1')
    expect(after.models.find((model) => model.id === 'tiny-q5_1')?.installed).toBe(false)
    expect(after.installedBytes).toBe(whisperModel('medium-q5_0')!.bytes)
  })
})

describe('WhisperManager.validateCustomPath', () => {
  it('acepta un .bin con cabecera ggml', () => {
    const custom = join(root, 'ok.bin')
    writeFileSync(custom, Buffer.concat([Buffer.from('ggml'), Buffer.alloc(6 * 1024 * 1024)]))
    const manager = new WhisperManager(settingsStore() as never)
    expect(() => manager.validateCustomPath(custom)).not.toThrow()
  })

  it('rechaza archivos que no son ggml o son muy pequeños', () => {
    const manager = new WhisperManager(settingsStore() as never)
    const wrong = join(root, 'wrong.bin')
    writeFileSync(wrong, Buffer.alloc(6 * 1024 * 1024, 1))
    expect(() => manager.validateCustomPath(wrong)).toThrow(/ggml/)

    const small = join(root, 'small.bin')
    writeFileSync(small, 'ggml')
    expect(() => manager.validateCustomPath(small)).toThrow(/pequeño/)

    expect(() => manager.validateCustomPath(join(root, 'nope.bin'))).toThrow(/no existe/)
  })
})
