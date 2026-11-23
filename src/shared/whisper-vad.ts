/**
 * Modelo de detección de voz (VAD) de whisper.cpp: corta el audio en tramos
 * con voz antes de transcribir, así los silencios no generan alucinaciones.
 * Vive en el repo ggml-org/whisper-vad de HuggingFace.
 */
export const VAD_MODEL = {
  id: 'silero-v6.2.0',
  file: 'ggml-silero-v6.2.0.bin',
  bytes: 885_098,
  sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987',
  url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin'
} as const

export type VadModelSpec = typeof VAD_MODEL
