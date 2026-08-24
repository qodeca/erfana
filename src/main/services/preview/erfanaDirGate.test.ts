// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { lstat, mkdir, mkdtemp, realpath, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError, ErrorCode } from '../../../shared/errors'
import { resolveErfanaDir } from './erfanaDirGate'

let root: string
let realRoot: string
let outside: string
let realOutside: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'erfana-root-'))
  realRoot = await realpath(root)
  outside = await mkdtemp(join(tmpdir(), 'erfana-out-'))
  realOutside = await realpath(outside)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('resolveErfanaDir', () => {
  it('creates .erfana with 0o700 when absent and returns its real path', async () => {
    const result = await resolveErfanaDir(realRoot)

    expect(result).toBe(join(realRoot, '.erfana'))
    const st = await stat(result)
    expect(st.isDirectory()).toBe(true)
    // Owner-only permission bits (skipped where the platform ignores mode).
    if (process.platform !== 'win32') {
      expect(st.mode & 0o777).toBe(0o700)
    }
  })

  it('keeps a derived temp path inside the gated real directory', async () => {
    const dir = await resolveErfanaDir(realRoot)
    const settingsPath = join(dir, 'settings.json')
    // atomicWriteJSON derives its temp path from dirname(settingsPath); that
    // must stay inside the gated dir, which sits directly under the root.
    expect(dirname(settingsPath)).toBe(dir)
    expect(relative(realRoot, dir)).toBe('.erfana')
  })

  it('returns the existing real directory on a second call', async () => {
    const first = await resolveErfanaDir(realRoot)
    const second = await resolveErfanaDir(realRoot)
    expect(second).toBe(first)
  })

  it('refuses a symlinked .erfana pointing outside the root', async () => {
    await symlink(realOutside, join(realRoot, '.erfana'), 'dir')

    await expect(resolveErfanaDir(realRoot)).rejects.toMatchObject({
      code: ErrorCode.SYMLINK_ATTACK
    })
    // The symlink target must NOT have been written into.
    const linkStat = await lstat(join(realRoot, '.erfana'))
    expect(linkStat.isSymbolicLink()).toBe(true)
  })

  it('refuses a symlinked .erfana pointing to another in-root directory', async () => {
    await mkdir(join(realRoot, 'real-target'))
    await symlink(join(realRoot, 'real-target'), join(realRoot, '.erfana'), 'dir')

    const error = await resolveErfanaDir(realRoot).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(ErrorCode.SYMLINK_ATTACK)
  })
})
