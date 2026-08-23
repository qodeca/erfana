// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Real filesystem, no mocks: the whole point of this module is what
 * `fs.realpath` does with a symlink, which a mock cannot prove.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  assertInsideProject,
  assertNoConfinementEscape,
  classifyConfinement,
  isLexicallyInside,
  OUTSIDE_PROJECT_MESSAGE
} from './projectConfinement'

const skipOnWindows = process.platform === 'win32'

let project: string
let outside: string

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'erfana-confine-'))
  outside = mkdtempSync(join(tmpdir(), 'erfana-outside-'))
})

afterEach(() => {
  rmSync(project, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('isLexicallyInside', () => {
  it('accepts the root itself and a descendant', () => {
    expect(isLexicallyInside(project, project)).toBe(true)
    expect(isLexicallyInside(join(project, 'a', 'b.md'), project)).toBe(true)
  })

  it('rejects a sibling whose name extends the root (prefix boundary)', () => {
    expect(isLexicallyInside(`${project}-evil`, project)).toBe(false)
  })

  it('rejects traversal out of the root', () => {
    expect(isLexicallyInside(join(project, '..', 'elsewhere.md'), project)).toBe(false)
  })
})

describe('classifyConfinement', () => {
  it('reports inside for a real file in the project', async () => {
    const file = join(project, 'note.md')
    writeFileSync(file, '# hi')
    expect(await classifyConfinement(file, project)).toBe('inside')
  })

  it('reports missing for a path that does not exist', async () => {
    expect(await classifyConfinement(join(project, 'gone.md'), project)).toBe('missing')
  })

  it('reports outside for a path that never was in the project', async () => {
    expect(await classifyConfinement(join(outside, 'note.md'), project)).toBe('outside')
  })

  it.skipIf(skipOnWindows)('reports outside for an in-project symlink to a file outside', async () => {
    const target = join(outside, 'secret.txt')
    writeFileSync(target, 'secret')
    const link = join(project, 'innocent.png')
    symlinkSync(target, link, 'file')

    // The lexical stage passes - this is exactly the escape it cannot catch.
    expect(isLexicallyInside(link, project)).toBe(true)
    expect(await classifyConfinement(link, project)).toBe('outside')
  })

  it.skipIf(skipOnWindows)('reports inside for an in-project symlink to an in-project file', async () => {
    const target = join(project, 'real.md')
    writeFileSync(target, '# hi')
    const link = join(project, 'alias.md')
    symlinkSync(target, link, 'file')

    expect(await classifyConfinement(link, project)).toBe('inside')
  })

  it.skipIf(skipOnWindows)('reports unverifiable when realpath fails for a reason other than ENOENT', async () => {
    // A regular file used as a path component makes realpath throw ENOTDIR.
    const file = join(project, 'note.md')
    writeFileSync(file, '# hi')
    expect(await classifyConfinement(join(file, 'child'), project)).toBe('unverifiable')
  })

  it('accepts a root and a file recorded through different aliases of one directory', async () => {
    // macOS hands out /var/folders/... which canonically is /private/var/... .
    // A root stored in one form and a path in the other is the same directory,
    // not an escape.
    const canonicalRoot = await realpath(project)
    mkdirSync(join(project, 'sub'), { recursive: true })
    expect(await classifyConfinement(join(project, 'sub'), canonicalRoot)).toBe('inside')
  })

  it('reports outside, not missing, for a non-existent path out of the project', async () => {
    // Otherwise the verdict would answer "does /Users/x/.ssh/id_rsa exist?".
    expect(await classifyConfinement(join(outside, 'nope', 'gone.md'), project)).toBe('outside')
  })
})

describe('assertInsideProject', () => {
  it('passes for an in-project file', async () => {
    const file = join(project, 'note.md')
    writeFileSync(file, '# hi')
    await expect(assertInsideProject(file, project)).resolves.toBeUndefined()
  })

  it('passes for a missing in-project file so the caller raises its own ENOENT', async () => {
    await expect(assertInsideProject(join(project, 'gone.md'), project)).resolves.toBeUndefined()
  })

  it('rejects when no project is open', async () => {
    await expect(assertInsideProject(join(project, 'note.md'), null)).rejects.toThrow(
      'No project is open'
    )
  })

  it('rejects a non-string path', async () => {
    await expect(assertInsideProject('', project)).rejects.toThrow('Invalid file path')
  })

  it('rejects a path outside the project', async () => {
    await expect(assertInsideProject(join(outside, 'note.md'), project)).rejects.toThrow(
      OUTSIDE_PROJECT_MESSAGE
    )
  })

  it.skipIf(skipOnWindows)('rejects an in-project symlink pointing outside', async () => {
    const target = join(outside, 'secret.txt')
    writeFileSync(target, 'secret')
    const link = join(project, 'innocent.png')
    symlinkSync(target, link, 'file')

    await expect(assertInsideProject(link, project)).rejects.toThrow(OUTSIDE_PROJECT_MESSAGE)
  })
})

describe('assertNoConfinementEscape', () => {
  it('leaves an out-of-project path alone (user-picked files stay readable)', async () => {
    const file = join(outside, 'picked.pdf')
    writeFileSync(file, 'x')
    await expect(assertNoConfinementEscape(file, project)).resolves.toBeUndefined()
  })

  it('is a no-op when no project is open', async () => {
    await expect(assertNoConfinementEscape(join(outside, 'x.md'), null)).resolves.toBeUndefined()
  })

  it.skipIf(skipOnWindows)('rejects an in-project symlink pointing outside', async () => {
    const target = join(outside, 'secret.txt')
    writeFileSync(target, 'secret')
    const link = join(project, 'innocent.png')
    symlinkSync(target, link, 'file')

    await expect(assertNoConfinementEscape(link, project)).rejects.toThrow(OUTSIDE_PROJECT_MESSAGE)
  })
})
