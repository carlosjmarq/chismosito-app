import type { WhisperProfile } from './types'
import { WHISPER_MODELS, whisperModel, type WhisperModelSpec } from './whisper-models'

export type { WhisperProfile }

export interface WhisperHardware {
  /** VRAM en MiB, o null si no hay GPU NVIDIA detectable. */
  vramMb: number | null
  gpuName: string | null
  vramSource: 'nvidia-smi' | 'registry' | 'none'
  ramMb: number
  cores: number
  /** El pack CUDA está instalado y whisper-cli.exe existe. */
  cudaBinary: boolean
}

export type WhisperModelFit = 'gpu' | 'cpu' | 'ram'

/** Margen para el escritorio/driver: nunca prometemos el 100 % de la VRAM. */
const GPU_BUDGET = 0.85
const RAM_BUDGET = 0.85

/**
 * Escaleras por perfil. Se recorren de arriba abajo y gana la primera que
 * entre en el equipo, así que el resultado sale del hardware y no de un
 * default escrito a mano.
 */
const GPU_PROFILES: Record<WhisperProfile, string[]> = {
  // Máxima calidad que quepa, sin mirar la velocidad.
  quality: [
    'large-v3-f16',
    'large-v3-q5_0',
    'large-v3-turbo-f16',
    'large-v3-turbo-q8_0',
    'medium-f16',
    'medium-q8_0',
    'medium-q5_0',
    'small-f16',
    'small-q8_0',
    'small-q5_1',
    'base-f16',
    'base-q8_0',
    'base-q5_1',
    'tiny-f16',
    'tiny-q8_0',
    'tiny-q5_1'
  ],
  // Mejor relación calidad/velocidad: turbo con cuantización alta.
  balanced: [
    'large-v3-turbo-q8_0',
    'large-v3-turbo-q5_0',
    'medium-q8_0',
    'medium-q5_0',
    'small-q8_0',
    'small-q5_1',
    'base-q8_0',
    'base-q5_1',
    'tiny-q8_0',
    'tiny-q5_1'
  ],
  // Lo más rápido que sigue sirviendo para reuniones.
  fastest: ['large-v3-turbo-q5_0', 'medium-q5_0', 'small-q5_1', 'base-q5_1', 'tiny-q5_1']
}

const CPU_PROFILES: Record<WhisperProfile, string[]> = {
  // En CPU no se pasa de small: medium tarda ~2x realtime y no compensa.
  quality: ['small-f16', 'small-q8_0', 'small-q5_1', 'base-f16', 'base-q8_0', 'base-q5_1', 'tiny-q5_1'],
  balanced: ['small-q5_1', 'base-q8_0', 'base-q5_1', 'tiny-q8_0', 'tiny-q5_1'],
  fastest: ['tiny-q5_1', 'tiny-q8_0', 'base-q5_1', 'base-q8_0']
}

/** Orden de preferencia por calidad (también se usa para el modo automático). */
export const QUALITY_ORDER = [
  'large-v3-f16',
  'large-v3-q5_0',
  'large-v3-turbo-f16',
  'large-v3-turbo-q8_0',
  'large-v3-turbo-q5_0',
  'medium-f16',
  'medium-q8_0',
  'medium-q5_0',
  'small-f16',
  'small-q8_0',
  'small-q5_1',
  'base-f16',
  'base-q8_0',
  'base-q5_1',
  'tiny-f16',
  'tiny-q8_0',
  'tiny-q5_1'
]

export function modelFit(spec: WhisperModelSpec, hardware: WhisperHardware): WhisperModelFit {
  if (spec.ramGb * 1024 > hardware.ramMb * RAM_BUDGET) return 'ram'
  const vram = hardware.cudaBinary ? hardware.vramMb : null
  if (vram && vram > 0 && spec.vramGb * 1024 <= vram * GPU_BUDGET) return 'gpu'
  return 'cpu'
}

function firstFit(
  candidateIds: string[],
  hardware: WhisperHardware,
  accept: (fit: WhisperModelFit) => boolean
): string | null {
  for (const id of candidateIds) {
    const spec = whisperModel(id)
    if (!spec) continue
    if (accept(modelFit(spec, hardware))) return id
  }
  return null
}

export interface WhisperRecommendation {
  recommendedId: string
  reason: 'gpu' | 'cpu'
}

export interface WhisperRecommendationSet {
  /** Relleno con el modelo que corresponde a cada perfil. */
  profiles: Record<WhisperProfile, string>
  reason: 'gpu' | 'cpu'
}

/**
 * Modelo sugerido para este equipo. Prefiere GPU cuando hay pack CUDA y VRAM
 * suficiente; si no, cae a CPU y elige la talla según RAM. Siempre devuelve un
 * id del catálogo, aunque no quepa: la UI lo marca como "solo CPU".
 */
/**
 * Tres perfiles para el mismo equipo: lo más rápido, el equilibrio y la
 * máxima calidad que entra. Nunca devuelve un modelo que no quepa en RAM, y en
 * GPU exige que entre en la VRAM (si no, el perfil se calcula en modo CPU).
 */
export function recommendWhisperProfiles(hardware: WhisperHardware): WhisperRecommendationSet {
  const gpu = Boolean(hardware.cudaBinary && hardware.vramMb && hardware.vramMb > 0)
  const grofiles = gpu ? GPU_PROFILES : CPU_PROFILES
  const accept = (fit: WhisperModelFit): boolean => (gpu ? fit === 'gpu' : fit !== 'ram')

  const pick = (ladder: string[]): string | null => firstFit(ladder, hardware, accept)

  const quality = pick(grofiles.quality)
  const balanced = pick(grofiles.balanced)
  const fastest = pick(grofiles.fastest)

  const fallback = quality ?? balanced ?? fastest ?? 'tiny-q5_1'
  const profiles: Record<WhisperProfile, string> = {
    fastest: fastest ?? fallback,
    balanced: balanced ?? fallback,
    quality: quality ?? fallback
  }

  if (gpu && quality) return { profiles, reason: 'gpu' }

  // Sin GPU (o sin nada que entre en VRAM): recalcular con las escaleras de CPU.
  const cpuPick = (ladder: string[]): string | null => firstFit(ladder, hardware, (fit) => fit !== 'ram')
  const cpuQuality = cpuPick(CPU_PROFILES.quality)
  const cpuBalanced = cpuPick(CPU_PROFILES.balanced)
  const cpuFastest = cpuPick(CPU_PROFILES.fastest)
  const cpuFallback = cpuQuality ?? cpuBalanced ?? cpuFastest ?? 'tiny-q5_1'

  return {
    profiles: {
      fastest: cpuFastest ?? cpuFallback,
      balanced: cpuBalanced ?? cpuFallback,
      quality: cpuQuality ?? cpuFallback
    },
    reason: 'cpu'
  }
}

/** Compatibilidad: el perfil equilibrado es el "recomendado" de antes. */
export function recommendWhisperModel(hardware: WhisperHardware): WhisperRecommendation {
  const { profiles, reason } = recommendWhisperProfiles(hardware)
  return { recommendedId: profiles.balanced, reason }
}

export interface WhisperCatalogueEntry {
  spec: WhisperModelSpec
  fit: WhisperModelFit
  roles: WhisperProfile[]
}

/** Catálogo con el veredicto por equipo, en el orden de presentación. */
/** Orden de presentación de los perfiles: el más rápido primero. */
const ROLE_ORDER: WhisperProfile[] = ['fastest', 'balanced', 'quality']

/**
 * Catálogo ordenado para la UI: primero lo sugerido para este equipo (rápido,
 * equilibrado, calidad), después el resto de multilingües en orden de catálogo
 * y al final los modelos solo-inglés.
 */
export function describeWhisperModels(hardware: WhisperHardware): WhisperCatalogueEntry[] {
  const { profiles } = recommendWhisperProfiles(hardware)
  const byId = new Map<string, WhisperProfile[]>()
  for (const role of ROLE_ORDER) {
    const id = profiles[role]
    byId.set(id, [...(byId.get(id) ?? []), role])
  }

  const rank = (roles: WhisperProfile[]): number =>
    roles.length === 0 ? ROLE_ORDER.length : ROLE_ORDER.indexOf(roles[0])

  return WHISPER_MODELS.map((spec, index) => ({
    spec,
    fit: modelFit(spec, hardware),
    roles: byId.get(spec.id) ?? [],
    index
  }))
    .sort((a, b) => {
      const langA = a.spec.langs === 'en' ? 1 : 0
      const langB = b.spec.langs === 'en' ? 1 : 0
      if (langA !== langB) return langA - langB
      const rankA = rank(a.roles)
      const rankB = rank(b.roles)
      if (rankA !== rankB) return rankA - rankB
      return a.index - b.index
    })
    .map(({ index: _index, ...entry }) => entry)
}
