import { describe, expect, it } from 'vitest'
import {
  LEGACY_MODEL_ID,
  WHISPER_MODELS,
  whisperModel,
  whisperModelName,
  whisperModelUrl
} from '../src/shared/whisper-models'

describe('catálogo de whisper', () => {
  it('tiene 33 modelos con ids y archivos únicos', () => {
    expect(WHISPER_MODELS).toHaveLength(33)
    expect(new Set(WHISPER_MODELS.map((model) => model.id)).size).toBe(33)
    expect(new Set(WHISPER_MODELS.map((model) => model.file)).size).toBe(33)
  })

  it('todos traen tamaño, sha256 y estimaciones', () => {
    for (const model of WHISPER_MODELS) {
      expect(model.bytes).toBeGreaterThan(10_000_000)
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(model.vramGb).toBeGreaterThan(model.ramGb - 0.5)
      expect(model.ramGb).toBeGreaterThan(0)
    }
  })

  it('respeta la disponibilidad real de cuantizaciones', () => {
    // q5_0 no existe por debajo de medium; q5_1 no existe de medium en adelante.
    for (const family of ['tiny', 'base', 'small']) {
      expect(whisperModel(`${family}-q5_1`)).toBeDefined()
      expect(whisperModel(`${family}-q5_0`)).toBeUndefined()
    }
    expect(whisperModel('medium-q5_0')).toBeDefined()
    expect(whisperModel('medium-q5_1')).toBeUndefined()
    // large-v3 no tiene q8_0; large-v2 sí.
    expect(whisperModel('large-v3-q8_0')).toBeUndefined()
    expect(whisperModel('large-v2-q8_0')).toBeDefined()
    expect(whisperModel('large-v1-f16')).toBeDefined()
  })

  it('deja los modelos solo-inglés al final y marcados', () => {
    const langs = WHISPER_MODELS.map((model) => model.langs)
    const firstEnglish = langs.indexOf('en')
    expect(firstEnglish).toBeGreaterThan(0)
    expect(langs.slice(firstEnglish).every((value) => value === 'en')).toBe(true)
    expect(new Set(langs.slice(0, firstEnglish))).toEqual(new Set(['multi']))
    // tiny, base, small y medium × 3 cuantizaciones cada uno.
    expect(WHISPER_MODELS.filter((model) => model.langs === 'en')).toHaveLength(12)
    expect(WHISPER_MODELS.filter((model) => model.langs === 'multi')).toHaveLength(21)
  })

  it('mantiene el legado medium-q5_0 y su URL', () => {
    const legacy = whisperModel(LEGACY_MODEL_ID)
    expect(legacy?.file).toBe('ggml-medium-q5_0.bin')
    expect(legacy?.bytes).toBe(539_212_467)
    expect(whisperModelUrl(legacy!)).toBe(
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin'
    )
    expect(whisperModelName(legacy!)).toBe('Medium · q5_0')
  })
})
