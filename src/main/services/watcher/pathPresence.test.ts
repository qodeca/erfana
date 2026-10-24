// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * pathIsPresent against a real temp folder (#252). The error codes a real
 * folder cannot easily produce (EPERM, EBUSY) are in
 * `pathPresence.codes.test.ts`, which mocks `stat` at module scope.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pathIsPresent } from './pathPresence'

describe('pathIsPresent', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'erfana-path-presence-'))
    await writeFile(path.join(dir, 'file.md'), '# here')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('is true for a file on disk', async () => {
    expect(await pathIsPresent(path.join(dir, 'file.md'))).toBe(true)
  })

  it('is false when the file or its folder is gone (ENOENT)', async () => {
    expect(await pathIsPresent(path.join(dir, 'missing.md'))).toBe(false)
    expect(await pathIsPresent(path.join(dir, 'gone-folder', 'file.md'))).toBe(false)
  })

  it('is false when a folder on the way is now a file (ENOTDIR)', async () => {
    expect(await pathIsPresent(path.join(dir, 'file.md', 'child.md'))).toBe(false)
  })

  // A folder the user may not read is still there: no false banner. POSIX modes
  // only, and root ignores them.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'is true when the path cannot be read for now (EACCES)',
    async () => {
      const locked = path.join(dir, 'locked')
      await mkdir(locked)
      await writeFile(path.join(locked, 'file.md'), '# locked')
      await chmod(locked, 0o000)
      try {
        expect(await pathIsPresent(path.join(locked, 'file.md'))).toBe(true)
      } finally {
        await chmod(locked, 0o700)
      }
    }
  )
})
