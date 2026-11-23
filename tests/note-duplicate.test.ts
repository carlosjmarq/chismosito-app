import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: {
    trashItem: async () => undefined,
    showItemInFolder: () => undefined,
    openPath: async () => ''
  }
}))

const { NoteRepository } = await import('../src/main/notes/repository')

const NOTE = `---
title: "Planificación Q4"
date: "2026-11-14T15:30:00-06:00"
duration_seconds: 3720
language: "es"
audio: "2026-11-14-15-30.webm"
folder: ""
suggested_folder: null
suggested_folder_confidence: null
tags: ["q4"]
source: "chismosito"
llm: "deepseek-v4.1-flash"
status: "complete"
created_at: "2026-11-14T15:30:00-06:00"
updated_at: "2026-11-14T16:30:00-06:00"
---

# Planificación Q4 — 14 de noviembre de 2026, 15:30

## Resumen

- Punto uno.

## Transcripción

[00:00:12] **Yo:** Hola a todos.
[00:00:31] **Otros:** Buenas.
`

let root = ''

function repo(): InstanceType<typeof NoteRepository> {
  const settings = { get: () => ({ notesDir: root }) }
  return new NoteRepository(settings as never)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chismosito-notes-'))
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, '2026-11-14-15-30.md'), NOTE)
  writeFileSync(join(root, '2026-11-14-15-30.webm'), Buffer.alloc(1024, 1))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('NoteRepository.duplicate', () => {
  it('copia la nota y su audio con título (copia) y timestamps nuevos', async () => {
    const original = readFileSync(join(root, '2026-11-14-15-30.md'), 'utf8')
    const copy = await repo().duplicate(join(root, '2026-11-14-15-30.md'))

    const copyFile = join(root, '2026-11-14-15-30-copia.md')
    expect(copy.path.replace(/\\/g, '/')).toBe(copyFile.replace(/\\/g, '/'))
    expect(existsSync(copyFile)).toBe(true)
    expect(existsSync(join(root, '2026-11-14-15-30-copia.webm'))).toBe(true)

    const text = readFileSync(copyFile, 'utf8')
    expect(text).toContain('title: "Planificación Q4 (copia)"')
    expect(text).toContain('# Planificación Q4 (copia) —')
    expect(text).toContain('audio: "2026-11-14-15-30-copia.webm"')
    expect(text).toContain('[00:00:12] **Yo:** Hola a todos.')
    expect(text).toContain('created_at: "2026-')

    // El original queda intacto.
    expect(readFileSync(join(root, '2026-11-14-15-30.md'), 'utf8')).toBe(original)
    expect(copy.title).toBe('Planificación Q4 (copia)')
  })

  it('no pisa copias anteriores', async () => {
    const repository = repo()
    await repository.duplicate(join(root, '2026-11-14-15-30.md'))
    const second = await repository.duplicate(join(root, '2026-11-14-15-30.md'))

    expect(existsSync(join(root, '2026-11-14-15-30-copia-02.md'))).toBe(true)
    expect(existsSync(join(root, '2026-11-14-15-30-copia-02.webm'))).toBe(true)
    expect(second.title).toBe('Planificación Q4 (copia)')
  })

  it('duplica notas sin audio sin inventar uno', async () => {
    rmSync(join(root, '2026-11-14-15-30.webm'))
    const copy = await repo().duplicate(join(root, '2026-11-14-15-30.md'))

    expect(existsSync(join(root, '2026-11-14-15-30-copia.webm'))).toBe(false)
    expect(readFileSync(join(root, '2026-11-14-15-30-copia.md'), 'utf8')).toContain(
      'audio: "2026-11-14-15-30.webm"'
    )
    // El front-matter conserva la referencia, aunque el audio no exista en disco.
    expect(copy.audio).toBeNull()
  })
})
