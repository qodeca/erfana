// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Real filesystem, no mocks: a link to a volume root (macOS has one for the
 * startup disk, under /Volumes) must not become a project, whether it is
 * refused by the link check or by the canonical-path check.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { join, parse } from 'node:path'
import { tmpdir } from 'node:os'
import { ErrorCode } from '../../shared/errors'
import { assertAcceptableProjectRoot, validatePath } from './pathSecurity'

// Creating a symbolic link needs a privilege on Windows
describe.skipIf(process.platform === 'win32')('a link to a volume root', () => {
  let dir: string
  let link: string

  beforeEach(() => {
    // Under the working folder, not the temp folder: the temp folder is itself a system path on macOS
    dir = mkdtempSync(join(process.cwd(), 'erfana-rootlink-'))
    link = join(dir, 'disk')
    symlinkSync(parse(tmpdir()).root, link, 'dir')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('is refused by the typed-path validation', async () => {
    await expect(validatePath(link)).rejects.toMatchObject({ code: ErrorCode.SYMLINK_ATTACK })
  })

  it('is refused when its canonical path is checked', () => {
    expect(() => assertAcceptableProjectRoot(realpathSync.native(link))).toThrowError(
      expect.objectContaining({ code: ErrorCode.PATH_SYSTEM_DIR })
    )
  })
})
