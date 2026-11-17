import { describe, expect, it } from 'vitest'
import {
  describeWhisperModels,
  modelFit,
  recommendWhisperModel,
  recommendWhisperProfiles,
  type WhisperHardware
} from '../src/shared/whisper-policy'
import { whisperModel } from '../src/shared/whisper-models'

const gb = 1024

function hw(overrides: Partial<WhisperHardware> = {}): WhisperHardware {
  return {
    vramMb: null,
    gpuName: null,
    vramSource: 'none',
    ramMb: 16 * gb,
    cores: 8,
    cudaBinary: false,
    ...overrides
  }
}

function cuda(vramMb: number, ramMb = 16 * gb): WhisperHardware {
  return hw({ vramMb, ramMb, cudaBinary: true, gpuName: 'NVIDIA Test', vramSource: 'nvidia-smi' })
}

describe('recommendWhisperProfiles', () => {
  it('con 4 GB ofrece rápido, equilibrado y máxima calidad', () => {
    const { profiles, reason } = recommendWhisperProfiles(cuda(4 * gb))
    expect(reason).toBe('gpu')
    expect(profiles).toEqual({
      fastest: 'large-v3-turbo-q5_0',
      balanced: 'large-v3-turbo-q8_0',
      quality: 'large-v3-q5_0'
    })
  })

  it('con 12 GB la máxima calidad es f16', () => {
    const { profiles } = recommendWhisperProfiles(cuda(12 * gb))
    expect(profiles.quality).toBe('large-v3-f16')
    expect(profiles.balanced).toBe('large-v3-turbo-q8_0')
    expect(profiles.fastest).toBe('large-v3-turbo-q5_0')
  })

  it('con 6 GB la calidad ya es f16 (cabe con margen) y el equilibrio es turbo q8_0', () => {
    const { profiles } = recommendWhisperProfiles(cuda(6 * gb))
    expect(profiles.quality).toBe('large-v3-f16')
    expect(profiles.balanced).toBe('large-v3-turbo-q8_0')
  })

  it('con poca VRAM baja de familia sin salirse del presupuesto', () => {
    for (const vram of [3 * gb, 2 * gb]) {
      const { profiles, reason } = recommendWhisperProfiles(cuda(vram))
      expect(reason).toBe('gpu')
      for (const id of Object.values(profiles)) {
        expect(whisperModel(id)!.vramGb * 1024).toBeLessThanOrEqual(vram * 0.85)
      }
    }
    // 1 GB aprieta tanto que los tres perfiles colapsan en el mismo modelo.
    const small = recommendWhisperProfiles(cuda(1 * gb))
    expect(small.reason).toBe('gpu')
    expect(new Set(Object.values(small.profiles)).size).toBe(1)
    expect(whisperModel(small.profiles.quality)!.family).toBe('small')

    const none = recommendWhisperProfiles(cuda(400))
    expect(none.reason).toBe('cpu')
    expect(whisperModel(none.profiles.balanced)!.family).toBe('small')
  })

  it('sin GPU calcula perfiles de CPU y nunca pasa de small', () => {
    const { profiles, reason } = recommendWhisperProfiles(hw({ ramMb: 16 * gb }))
    expect(reason).toBe('cpu')
    expect(profiles).toEqual({
      fastest: 'tiny-q5_1',
      balanced: 'small-q5_1',
      quality: 'small-f16'
    })
    for (const id of Object.values(profiles)) {
      expect(['small', 'base', 'tiny']).toContain(whisperModel(id)!.family)
    }
  })

  it('con RAM corta elige lo que entra en memoria', () => {
    const { profiles } = recommendWhisperProfiles(hw({ ramMb: 3 * gb }))
    for (const id of Object.values(profiles)) {
      expect(whisperModel(id)!.ramGb * 1024).toBeLessThanOrEqual(3 * gb * 0.85)
    }
  })

  it('ignora la VRAM si el pack CUDA no está instalado', () => {
    const { profiles, reason } = recommendWhisperProfiles(
      hw({ vramMb: 12 * gb, cudaBinary: false, gpuName: 'NVIDIA sin pack' })
    )
    expect(reason).toBe('cpu')
    expect(whisperModel(profiles.quality)!.family).toBe('small')
  })

  it('el alias recommendWhisperModel devuelve el perfil equilibrado', () => {
    const hardware = cuda(4 * gb)
    expect(recommendWhisperModel(hardware)).toEqual({
      recommendedId: recommendWhisperProfiles(hardware).profiles.balanced,
      reason: 'gpu'
    })
  })
})

describe('modelFit', () => {
  it('marca GPU, CPU y RAM según el equipo', () => {
    const medium = whisperModel('medium-q5_0')!
    expect(modelFit(medium, cuda(4 * gb))).toBe('gpu')
    expect(modelFit(medium, cuda(1 * gb))).toBe('cpu')
    expect(modelFit(medium, hw())).toBe('cpu')
    expect(modelFit(whisperModel('large-v3-f16')!, hw({ ramMb: 2 * gb }))).toBe('ram')
  })

  it('respeta el margen del 15 % de VRAM', () => {
    const model = whisperModel('large-v3-q5_0')!
    const justBarely = Math.ceil((model.vramGb * 1024) / 0.85)
    expect(modelFit(model, cuda(justBarely - 64))).toBe('cpu')
    expect(modelFit(model, cuda(justBarely + 64))).toBe('gpu')
  })
})

describe('describeWhisperModels', () => {
  it('pone lo sugerido primero (rápido → equilibrado → calidad) y los .en al final', () => {
    const entries = describeWhisperModels(cuda(4 * gb))

    expect(entries.slice(0, 3).map((entry) => entry.spec.id)).toEqual([
      'large-v3-turbo-q5_0',
      'large-v3-turbo-q8_0',
      'large-v3-q5_0'
    ])
    expect(entries.slice(0, 3).map((entry) => entry.roles[0])).toEqual([
      'fastest',
      'balanced',
      'quality'
    ])
    // El resto mantiene el orden del catálogo y los .en siguen al final.
    expect(entries.slice(3).every((entry) => entry.roles.length === 0)).toBe(true)
    expect(entries[entries.length - 1].spec.langs).toBe('en')
    expect(entries.filter((entry) => entry.spec.langs === 'multi')).toHaveLength(21)
  })

  it('en CPU también sube lo sugerido al principio', () => {
    const entries = describeWhisperModels(hw({ ramMb: 16 * gb }))
    expect(entries[0].spec.id).toBe('tiny-q5_1')
    expect(entries[1].spec.id).toBe('small-q5_1')
    expect(entries[2].spec.id).toBe('small-f16')
    expect(entries[0].roles).toEqual(['fastest'])
  })

  it('un modelo puede acumular dos perfiles cuando coinciden', () => {
    const entries = describeWhisperModels(hw({ ramMb: 3 * gb }))
    const fastest = entries.find((entry) => entry.roles.includes('fastest'))
    expect(fastest?.roles).toContain('fastest')
    // Con RAM corta los perfiles colapsan: sigue apareciendo primero.
    expect(entries[0].roles.length).toBeGreaterThan(0)
  })
})
