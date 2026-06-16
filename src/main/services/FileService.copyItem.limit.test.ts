// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * FileService.copyItem.limit.test.ts
 *
 * Focused unit test for the MAX_COPY_ATTEMPTS boundary in `copyItem`'s
 * name-conflict-resolution loop. Lives in a separate file (vs. the real-disk
 * `FileService.copyItem.test.ts`) because it needs module-level `fs/promises`
 * mocks — mixing mocked and real fs in one test file is fragile on vitest.
 *
 * See `docs/windows/contributing.md` "Test-file split policy" for when to
 * split vs. inline mocks.
 *
 * Why split: the historical real-disk version of this test created 1001 files
 * in a temp dir (~25 s on Windows NTFS + Defender, ~3 s on macOS) to exercise
 * a defensive safety guard that end users will never hit. The mocked version
 * runs in <100 ms cross-platform and asserts the same observable: the throw.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as FsProm from 'fs/promises'
import { MAX_COPY_ATTEMPTS } from './FileService'

vi.mock('fs/promises', () => ({
  // Functions actively used by the conflict-resolution path:
  stat: vi.fn(),
  lstat: vi.fn(),
  readdir: vi.fn(),
  // Functions imported by FileService but which MUST NOT be reached on this
  // code path. Mock as rejecting so an accidental call (e.g. if the limit
  // guard bypass logic ever changes) fails loudly instead of silently
  // resolving to `undefined`.
  cp: vi.fn(async () => {
    throw new Error('cp() must not be called when MAX_COPY_ATTEMPTS is exceeded')
  }),
  copyFile: vi.fn(async () => {
    throw new Error('copyFile() must not be called when MAX_COPY_ATTEMPTS is exceeded')
  }),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
  chmod: vi.fn(),
  readdirent: vi.fn()
} satisfies Partial<typeof FsProm>))

import { stat, lstat, readdir } from 'fs/promises'
import { FileService } from './FileService'

// Cast helper — the real Stats is a complex interface; we only need the
// `.isDirectory()` / `.isFile()` / `.isSymbolicLink()` shape for this path.
const dirStats = {
  isDirectory: () => true,
  isFile: () => false,
  isSymbolicLink: () => false
} as never

const fileStats = {
  isDirectory: () => false,
  isFile: () => true,
  isSymbolicLink: () => false
} as never

describe('FileService.copyItem MAX_COPY_ATTEMPTS overflow guard', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    // `copyItem` calls `stat(sourcePath)` then `stat(targetParentPath)`.
    // Source is a file, target is a directory. Use mockImplementation so each
    // call returns the right shape based on the path argument.
    vi.mocked(stat).mockImplementation(async (p: Parameters<typeof stat>[0]) => {
      const s = String(p)
      if (s.endsWith('/file.md') || s.endsWith('\\file.md')) return fileStats
      return dirStats
    })

    // `symlinkDetector.checkPath` → `lstat`. Return file stats (non-symlink).
    vi.mocked(lstat).mockResolvedValue(fileStats)

    // `checkNameConflict` reads the target dir via `readdir`. Return
    // MAX_COPY_ATTEMPTS+1 conflicting names on every invocation so the
    // per-iteration `copyNumber` counter hits the guard.
    vi.mocked(readdir).mockResolvedValue([
      'file.md',
      ...Array.from({ length: MAX_COPY_ATTEMPTS }, (_, i) => `file (${i + 1}).md`)
    ] as never)
  })

  it('throws when MAX_COPY_ATTEMPTS is exceeded', async () => {
    const fs = new FileService()
    fs.setProjectPath('/proj')

    // Regex matches the constant's current value in the production message.
    // If `MAX_COPY_ATTEMPTS` changes, this assertion fails loudly (not silently)
    // because `MAX_COPY_ATTEMPTS` is imported from the source of truth.
    await expect(fs.copyItem('/proj/file.md', '/proj/folder')).rejects.toThrow(
      new RegExp(`Cannot create more than ${MAX_COPY_ATTEMPTS} copies with the same name`)
    )
  })

  it('exposes MAX_COPY_ATTEMPTS as a module export (source-of-truth check)', () => {
    // Regression guard: if someone inlines the literal `1000` back into the
    // production message without updating this constant, both assertions fail
    // together — making the desync detectable at review time.
    expect(MAX_COPY_ATTEMPTS).toBe(1000)
  })
})
