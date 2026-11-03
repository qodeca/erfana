// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Real-path confinement of a served local folder (spec 025, 025-FR-005
 * rule 1; ADR 0012 decision 8), on a real temporary folder.
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openConfinedFile, type ConfinedFile } from './localConfinedFile'

let base: string
let root: string
const never = (): boolean => false

/** Symlinks need a privilege on Windows; the link cases run where they can be made. */
let canLink = true

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'erfana-local-')))
  root = join(base, 'site')
  await mkdir(join(root, 'assets'), { recursive: true })
  await mkdir(join(root, '.hidden'))
  await mkdir(join(base, 'outside'))
  await writeFile(join(root, 'index.html'), '<p>hi</p>')
  await writeFile(join(root, 'assets', 'app.js'), 'x')
  await writeFile(join(root, 'empty.txt'), '')
  await writeFile(join(root, '.hidden', 'secret.txt'), 'secret')
  await writeFile(join(base, 'outside', 'canary.txt'), 'CANARY')
  try {
    await symlink(join(base, 'outside', 'canary.txt'), join(root, 'link-out.txt'))
    await symlink(join(base, 'outside'), join(root, 'dir-out'), 'dir')
    await symlink(join(root, 'index.html'), join(root, 'link-in.html'))
    await symlink(join(root, '.hidden'), join(root, 'visible'), 'dir')
  } catch {
    canLink = false
  }
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

async function opened(segments: string[], veto: (p: string) => boolean = never): Promise<ConfinedFile> {
  const result = await openConfinedFile(root, segments, veto)
  if (result.ok) await result.handle.close()
  return result
}

describe('openConfinedFile', () => {
  it('opens a regular file inside the folder, with its size, extension and real path', async () => {
    const result = await openConfinedFile(root, ['assets', 'app.js'], never)
    expect(result).toMatchObject({ ok: true, size: 1, ext: '.js', realPath: join(root, 'assets', 'app.js') })
    if (result.ok) {
      expect((await result.handle.readFile()).toString()).toBe('x')
      await result.handle.close()
    }
  })

  it('opens an empty file', async () => {
    expect(await opened(['empty.txt'])).toMatchObject({ ok: true, size: 0 })
  })

  it('answers 404 for a missing file, a missing folder and a folder', async () => {
    expect(await opened(['nope.html'])).toEqual({ ok: false, status: 404 })
    expect(await opened(['nope', 'x.html'])).toEqual({ ok: false, status: 404 })
    expect(await opened(['assets'])).toEqual({ ok: false, status: 404 })
  })

  it('refuses a file the veto names, after resolving it', async () => {
    const seen: string[] = []
    const veto = (p: string): boolean => {
      seen.push(p)
      return true
    }
    expect(await opened(['index.html'], veto)).toEqual({ ok: false, status: 403 })
    expect(seen).toEqual([join(root, 'index.html')])
  })

  it.runIf(process.platform !== 'win32')('refuses a final-component link that leads out of the folder', async () => {
    if (!canLink) return
    expect((await opened(['link-out.txt'])).ok).toBe(false)
  })

  it('refuses a folder link that leads out of the folder', async () => {
    if (!canLink) return
    expect(await opened(['dir-out', 'canary.txt'])).toEqual({ ok: false, status: 403 })
  })

  it('refuses a folder link that leads into a dot-folder', async () => {
    if (!canLink) return
    expect(await opened(['visible', 'secret.txt'])).toEqual({ ok: false, status: 403 })
  })

  it('refuses a path whose resolved form names a dot-folder', async () => {
    expect(await opened(['.hidden', 'secret.txt'])).toEqual({ ok: false, status: 403 })
  })

  it('refuses a dot-file at the top of the folder even though it exists', async () => {
    await writeFile(join(root, '.env'), 'TOKEN=fake')
    expect(await opened(['.env'])).toEqual({ ok: false, status: 403 })
  })

  it('refuses `..` segments that climb out of the folder, by the parent real path', async () => {
    expect(await opened(['..', 'outside', 'canary.txt'])).toEqual({ ok: false, status: 403 })
    expect(await opened(['assets', '..', '..', 'outside', 'canary.txt'])).toEqual({ ok: false, status: 403 })
  })

  it('opens a file reached through `..` that stays inside the folder', async () => {
    expect(await opened(['assets', '..', 'index.html'])).toMatchObject({ ok: true, realPath: join(root, 'index.html') })
  })

  it('refuses the folder itself, named by no segment', async () => {
    expect((await opened([])).ok).toBe(false)
  })

  it.runIf(process.platform !== 'win32')('refuses a final-component link even when it stays inside the folder', async () => {
    if (!canLink) return
    expect(await opened(['link-in.html'])).toEqual({ ok: false, status: 404 })
  })

  it('serves a case variant of a file on a case-insensitive volume, never one outside', async () => {
    const insensitive = existsSync(join(root, 'INDEX.HTML'))
    const variant = await opened(['INDEX.HTML'])
    expect(variant.ok).toBe(insensitive)
    // A sibling whose name only differs in case from the folder is still outside.
    expect((await openConfinedFile(join(base, 'SITE'), ['..', 'outside', 'canary.txt'], never)).ok).toBe(false)
  })
})
