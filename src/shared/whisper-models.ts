/**
 * Catálogo de modelos ggml de whisper.cpp (repo ggerganov/whisper.cpp en
 * HuggingFace). Las tallas y los sha256 salen del índice de HuggingFace; las
 * estimaciones de VRAM/RAM son pesos + overhead de CUDA/CPU con margen aparte
 * (ver whisper-policy.ts), no medidas de un equipo concreto.
 */

export type WhisperModelLangs = 'multi' | 'en'

export interface WhisperModelSpec {
  id: string
  file: string
  family: string
  quant: string
  langs: WhisperModelLangs
  bytes: number
  sha256: string
  /** VRAM estimada en GB con el pack CUDA (pesos + contexto + buffers). */
  vramGb: number
  /** RAM estimada en GB transcripción por CPU (pesos + buffers). */
  ramGb: number
  label: string
}

export const WHISPER_URL_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/'

/** Modelo que la app descargaba antes de existir el catálogo (migración). */
export const LEGACY_MODEL_ID = 'medium-q5_0'

export const WHISPER_MODELS: WhisperModelSpec[] = [
  {
    id: 'tiny-f16',
    file: 'ggml-tiny.bin',
    family: 'tiny',
    quant: 'f16',
    langs: 'multi',
    bytes: 77691713,
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
    vramGb: 0.52,
    ramGb: 0.27,
    label: 'Tiny'
  },
  {
    id: 'tiny-q8_0',
    file: 'ggml-tiny-q8_0.bin',
    family: 'tiny',
    quant: 'q8_0',
    langs: 'multi',
    bytes: 43537433,
    sha256: 'c2085835d3f50733e2ff6e4b41ae8a2b8d8110461e18821b09a15c40c42d1cca',
    vramGb: 0.49,
    ramGb: 0.24,
    label: 'Tiny'
  },
  {
    id: 'tiny-q5_1',
    file: 'ggml-tiny-q5_1.bin',
    family: 'tiny',
    quant: 'q5_1',
    langs: 'multi',
    bytes: 32152673,
    sha256: '818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7',
    vramGb: 0.48,
    ramGb: 0.23,
    label: 'Tiny'
  },
  {
    id: 'base-f16',
    file: 'ggml-base.bin',
    family: 'base',
    quant: 'f16',
    langs: 'multi',
    bytes: 147951465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    vramGb: 0.64,
    ramGb: 0.34,
    label: 'Base'
  },
  {
    id: 'base-q8_0',
    file: 'ggml-base-q8_0.bin',
    family: 'base',
    quant: 'q8_0',
    langs: 'multi',
    bytes: 81768585,
    sha256: 'c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9',
    vramGb: 0.58,
    ramGb: 0.28,
    label: 'Base'
  },
  {
    id: 'base-q5_1',
    file: 'ggml-base-q5_1.bin',
    family: 'base',
    quant: 'q5_1',
    langs: 'multi',
    bytes: 59707625,
    sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
    vramGb: 0.56,
    ramGb: 0.26,
    label: 'Base'
  },
  {
    id: 'small-f16',
    file: 'ggml-small.bin',
    family: 'small',
    quant: 'f16',
    langs: 'multi',
    bytes: 487601967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    vramGb: 1.07,
    ramGb: 0.65,
    label: 'Small'
  },
  {
    id: 'small-q8_0',
    file: 'ggml-small-q8_0.bin',
    family: 'small',
    quant: 'q8_0',
    langs: 'multi',
    bytes: 264464607,
    sha256: '49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f',
    vramGb: 0.87,
    ramGb: 0.45,
    label: 'Small'
  },
  {
    id: 'small-q5_1',
    file: 'ggml-small-q5_1.bin',
    family: 'small',
    quant: 'q5_1',
    langs: 'multi',
    bytes: 190085487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
    vramGb: 0.80,
    ramGb: 0.38,
    label: 'Small'
  },
  {
    id: 'medium-f16',
    file: 'ggml-medium.bin',
    family: 'medium',
    quant: 'f16',
    langs: 'multi',
    bytes: 1533763059,
    sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208',
    vramGb: 2.19,
    ramGb: 1.63,
    label: 'Medium'
  },
  {
    id: 'medium-q8_0',
    file: 'ggml-medium-q8_0.bin',
    family: 'medium',
    quant: 'q8_0',
    langs: 'multi',
    bytes: 823369779,
    sha256: '42a1ffcbe4167d224232443396968db4d02d4e8e87e213d3ee2e03095dea6502',
    vramGb: 1.53,
    ramGb: 0.97,
    label: 'Medium'
  },
  {
    id: 'medium-q5_0',
    file: 'ggml-medium-q5_0.bin',
    family: 'medium',
    quant: 'q5_0',
    langs: 'multi',
    bytes: 539212467,
    sha256: '19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f',
    vramGb: 1.26,
    ramGb: 0.70,
    label: 'Medium'
  },
  {
    id: 'large-v3-turbo-q5_0',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    family: 'large-v3',
    quant: 'turbo-q5_0',
    langs: 'multi',
    bytes: 574041195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    vramGb: 1.53,
    ramGb: 0.73,
    label: 'Large v3'
  },
  {
    id: 'large-v3-turbo-q8_0',
    file: 'ggml-large-v3-turbo-q8_0.bin',
    family: 'large-v3',
    quant: 'turbo-q8_0',
    langs: 'multi',
    bytes: 874188075,
    sha256: '317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1',
    vramGb: 1.81,
    ramGb: 1.01,
    label: 'Large v3'
  },
  {
    id: 'large-v3-turbo',
    file: 'ggml-large-v3-turbo.bin',
    family: 'large-v3',
    quant: 'turbo',
    langs: 'multi',
    bytes: 1624555275,
    sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
    vramGb: 2.51,
    ramGb: 1.71,
    label: 'Large v3'
  },
  {
    id: 'large-v3-f16',
    file: 'ggml-large-v3.bin',
    family: 'large-v3',
    quant: 'f16',
    langs: 'multi',
    bytes: 3095033483,
    sha256: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2',
    vramGb: 3.88,
    ramGb: 3.08,
    label: 'Large v3'
  },
  {
    id: 'large-v3-q5_0',
    file: 'ggml-large-v3-q5_0.bin',
    family: 'large-v3',
    quant: 'q5_0',
    langs: 'multi',
    bytes: 1081140203,
    sha256: 'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1',
    vramGb: 2.01,
    ramGb: 1.21,
    label: 'Large v3'
  },
  {
    id: 'large-v2-f16',
    file: 'ggml-large-v2.bin',
    family: 'large-v2',
    quant: 'f16',
    langs: 'multi',
    bytes: 3094623691,
    sha256: '9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487',
    vramGb: 3.88,
    ramGb: 3.08,
    label: 'Large v2'
  },
  {
    id: 'large-v2-q8_0',
    file: 'ggml-large-v2-q8_0.bin',
    family: 'large-v2',
    quant: 'q8_0',
    langs: 'multi',
    bytes: 1656129691,
    sha256: 'fef54e6d898246a65c8285bfa83bd1807e27fadf54d5d4e81754c47634737e8c',
    vramGb: 2.54,
    ramGb: 1.74,
    label: 'Large v2'
  },
  {
    id: 'large-v2-q5_0',
    file: 'ggml-large-v2-q5_0.bin',
    family: 'large-v2',
    quant: 'q5_0',
    langs: 'multi',
    bytes: 1080732091,
    sha256: '3a214837221e4530dbc1fe8d734f302af393eb30bd0ed046042ebf4baf70f6f2',
    vramGb: 2.01,
    ramGb: 1.21,
    label: 'Large v2'
  },
  {
    id: 'large-v1-f16',
    file: 'ggml-large-v1.bin',
    family: 'large-v1',
    quant: 'f16',
    langs: 'multi',
    bytes: 3094623691,
    sha256: '7d99f41a10525d0206bddadd86760181fa920438b6b33237e3118ff6c83bb53d',
    vramGb: 3.88,
    ramGb: 3.08,
    label: 'Large v1'
  },
  {
    id: 'tiny.en-f16',
    file: 'ggml-tiny.en.bin',
    family: 'tiny',
    quant: 'f16',
    langs: 'en',
    bytes: 77704715,
    sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
    vramGb: 0.52,
    ramGb: 0.27,
    label: 'Tiny (inglés)'
  },
  {
    id: 'tiny.en-q8_0',
    file: 'ggml-tiny.en-q8_0.bin',
    family: 'tiny',
    quant: 'q8_0',
    langs: 'en',
    bytes: 43550795,
    sha256: '5bc2b3860aa151a4c6e7bb095e1fcce7cf12c7b020ca08dcec0c6d018bb7dd94',
    vramGb: 0.49,
    ramGb: 0.24,
    label: 'Tiny (inglés)'
  },
  {
    id: 'tiny.en-q5_1',
    file: 'ggml-tiny.en-q5_1.bin',
    family: 'tiny',
    quant: 'q5_1',
    langs: 'en',
    bytes: 32166155,
    sha256: 'c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b',
    vramGb: 0.48,
    ramGb: 0.23,
    label: 'Tiny (inglés)'
  },
  {
    id: 'base.en-f16',
    file: 'ggml-base.en.bin',
    family: 'base',
    quant: 'f16',
    langs: 'en',
    bytes: 147964211,
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    vramGb: 0.64,
    ramGb: 0.34,
    label: 'Base (inglés)'
  },
  {
    id: 'base.en-q8_0',
    file: 'ggml-base.en-q8_0.bin',
    family: 'base',
    quant: 'q8_0',
    langs: 'en',
    bytes: 81781811,
    sha256: 'a4d4a0768075e13cfd7e19df3ae2dbc4a68d37d36a7dad45e8410c9a34f8c87e',
    vramGb: 0.58,
    ramGb: 0.28,
    label: 'Base (inglés)'
  },
  {
    id: 'base.en-q5_1',
    file: 'ggml-base.en-q5_1.bin',
    family: 'base',
    quant: 'q5_1',
    langs: 'en',
    bytes: 59721011,
    sha256: '4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f',
    vramGb: 0.56,
    ramGb: 0.26,
    label: 'Base (inglés)'
  },
  {
    id: 'small.en-f16',
    file: 'ggml-small.en.bin',
    family: 'small',
    quant: 'f16',
    langs: 'en',
    bytes: 487614201,
    sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
    vramGb: 1.07,
    ramGb: 0.65,
    label: 'Small (inglés)'
  },
  {
    id: 'small.en-q8_0',
    file: 'ggml-small.en-q8_0.bin',
    family: 'small',
    quant: 'q8_0',
    langs: 'en',
    bytes: 264477561,
    sha256: '67a179f608ea6114bd3fdb9060e762b588a3fb3bd00c4387971be4d177958067',
    vramGb: 0.87,
    ramGb: 0.45,
    label: 'Small (inglés)'
  },
  {
    id: 'small.en-q5_1',
    file: 'ggml-small.en-q5_1.bin',
    family: 'small',
    quant: 'q5_1',
    langs: 'en',
    bytes: 190098681,
    sha256: 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30',
    vramGb: 0.80,
    ramGb: 0.38,
    label: 'Small (inglés)'
  },
  {
    id: 'medium.en-f16',
    file: 'ggml-medium.en.bin',
    family: 'medium',
    quant: 'f16',
    langs: 'en',
    bytes: 1533774781,
    sha256: 'cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356',
    vramGb: 2.19,
    ramGb: 1.63,
    label: 'Medium (inglés)'
  },
  {
    id: 'medium.en-q8_0',
    file: 'ggml-medium.en-q8_0.bin',
    family: 'medium',
    quant: 'q8_0',
    langs: 'en',
    bytes: 823382461,
    sha256: '43fa2cd084de5a04399a896a9a7a786064e221365c01700cea4666005218f11c',
    vramGb: 1.53,
    ramGb: 0.97,
    label: 'Medium (inglés)'
  },
  {
    id: 'medium.en-q5_0',
    file: 'ggml-medium.en-q5_0.bin',
    family: 'medium',
    quant: 'q5_0',
    langs: 'en',
    bytes: 539225533,
    sha256: '76733e26ad8fe1c7a5bf7531a9d41917b2adc0f20f2e4f5531688a8c6cd88eb0',
    vramGb: 1.26,
    ramGb: 0.70,
    label: 'Medium (inglés)'
  }
]

export const WHISPER_MODEL_BY_ID: Map<string, WhisperModelSpec> = new Map(
  WHISPER_MODELS.map((model) => [model.id, model])
)

export function whisperModel(id: string | null | undefined): WhisperModelSpec | undefined {
  if (!id) return undefined
  return WHISPER_MODEL_BY_ID.get(id)
}

/** "Medium · q5_0" / "Medium (inglés) · q5_0". */
export function whisperModelName(spec: WhisperModelSpec): string {
  return `${spec.label} · ${spec.quant}`
}

export function whisperModelUrl(spec: WhisperModelSpec): string {
  return `${WHISPER_URL_BASE}${spec.file}`
}
