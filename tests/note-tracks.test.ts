import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackFileName, trackFilesFor } from '../src/shared/recording-tracks'

const trashed: string[] = []

vi.mock('electron', () => ({
  shell: {
    trashItem: async (path: string) => {
      trashed.push(path)
    },
    showItemInFolder: () => undefined,
    openPath: async () => ''
  }
}))

const { NoteRepository } = await import('../src/main/notes/repository')
const { hasTrackFiles } = await import('../src/main/notes/retranscribe')

const NOTE = `---
title: "Reunión con pistas"
date: "2026-11-14T15:30:00-06:00"
duration_seconds: 600
language: "es"
audio: "2026-11-14-15-30.webm"
folder: ""
suggested_folder: null
suggested_folder_confidence: null
tags: []
source: "chismosito"
llm: null
status: "complete"
created_at: "2026-11-14T15:30:00-06:00"
updated_at: "2026-11-14T15:30:00-06:00"
---

# Reunión con pistas — 14 de noviembre de 2026, 15:30

## Transcripción

[00:00:12] **Yo:** Hola.
`

let root = ''

function repo(): InstanceType<typeof NoteRepository> {
  const settings = { get: () => ({ notesDir: root }) }
  return new NoteRepository(settings as never)
}

function setup(): void {
  writeFileSync(join(root, '2026-11-14-15-30.md'), NOTE)
  writeFileSync(join(root, '2026-11-14-15-30.webm'), Buffer.alloc(256, 1))
  writeFileSync(join(root, '2026-11-14-15-30-yo.webm'), Buffer.alloc(128, 2))
  writeFileSync(join(root, '2026-11-14-15-30-otros.webm'), Buffer.alloc(128, 3))
}

beforeEach(() => {
  trashed.length = 0
  root = mkdtempSync(join(tmpdir(), 'chismosito-tracks-'))
  mkdirSync(root, { recursive: true })
  setup()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('nombres de pista', () => {
  it('deriva los nombres del audio de la nota', () => {
    expect(trackFileName('2026-11-14-15-30.webm', 'you')).toBe('2026-11-14-15-30-yo.webm')
    expect(trackFileName('2026-11-14-15-30.webm', 'others')).toBe('2026-11-14-15-30-otros.webm')
    expect(trackFileName('sin-extension', 'you')).toBe('sin-extension-yo.webm')
  })

  it('detecta qué pistas existen', () => {
    const present = trackFilesFor('2026-11-14-15-30.webm', (name) => name.endsWith('-yo.webm'))
    expect(present).toEqual({ you: '2026-11-14-15-30-yo.webm', others: null })
    expect(trackFilesFor('2026-11-14-15-30.webm', () => false)).toEqual({
      you: null,
      others: null
    })
  })
})

describe('detección de pistas para re-transcribir', () => {
  it('usa las pistas solo si existen las dos', async () => {
    const { writeFileSync: write, rmSync: remove } = await import('node:fs')
    const name = '2026-11-14-15-30.webm'
    expect(hasTrackFiles(root, name)).toBe(true)

    remove(join(root, '2026-11-14-15-30-otros.webm'))
    expect(hasTrackFiles(root, name)).toBe(false)

    write(join(root, '2026-11-14-15-30-otros.webm'), 'x')
    write(join(root, '2026-11-14-15-30-yo.webm'), 'x')
    expect(hasTrackFiles(root, name)).toBe(true)

    remove(join(root, '2026-11-14-15-30-yo.webm'))
    expect(hasTrackFiles(root, name)).toBe(false)
  })
})

describe('repository con tres archivos por nota', () => {
  it('duplica el mezclado y sus dos pistas', async () => {
    await repo().duplicate(join(root, '2026-11-14-15-30.md'))
    const files = readdirSync(root).sort()
    expect(files).toEqual([
      '2026-11-14-15-30-copia-otros.webm',
      '2026-11-14-15-30-copia-yo.webm',
      '2026-11-14-15-30-copia.md',
      '2026-11-14-15-30-copia.webm',
      '2026-11-14-15-30-otros.webm',
      '2026-11-14-15-30-yo.webm',
      '2026-11-14-15-30.md',
      '2026-11-14-15-30.webm'
    ])
    expect(readFileSync(join(root, '2026-11-14-15-30-copia-yo.webm')).equals(Buffer.alloc(128, 2))).toBe(true)
  })

  it('mueve las pistas junto con el audio al cambiar de carpeta', async () => {
    const repository = repo()
    await repository.createFolder('Producto')
    await repository.move(join(root, '2026-11-14-15-30.md'), 'Producto')

    expect(existsSync(join(root, 'Producto', '2026-11-14-15-30-yo.webm'))).toBe(true)
    expect(existsSync(join(root, 'Producto', '2026-11-14-15-30-otros.webm'))).toBe(true)
    expect(existsSync(join(root, '2026-11-14-15-30-yo.webm'))).toBe(false)
  })

  it('envía la nota, el audio y las pistas a la papelera', async () => {
    await repo().remove(join(root, '2026-11-14-15-30.md'))
    expect(trashed.map((path) => path.split(/[\\/]/).pop()).sort()).toEqual([
      '2026-11-14-15-30-otros.webm',
      '2026-11-14-15-30-yo.webm',
      '2026-11-14-15-30.md',
      '2026-11-14-15-30.webm'
    ])
  })
})
