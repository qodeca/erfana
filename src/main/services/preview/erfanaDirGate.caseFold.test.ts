// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `.erfana` gate decides containment by an exact compare of realpaths,
 * never by `path.relative` (security review F1, the rule previewPathResolve
 * decides with). On win32 `path.relative` folds case with JavaScript's
 * `toLowerCase`, which maps U+212A KELVIN SIGN to `k`, while NTFS keeps
 * `proj<U+212A>` and `projk` as two folders. A `.erfana` swapped – after the
 * gate's symlink check – for a junction into the sibling `proj<U+212A>/.erfana`
 * used to pass as the root's own `.erfana`, so the allowlist write-back would
 * have landed in the sibling.
 *
 * The swap is the race the gate's last step exists for: `lstat` is wrapped so
 * the test replaces the real directory right after the symlink check saw it.
 * The Kelvin sign is built with `String.fromCharCode`, never typed or escaped,
 * so no tool can silently turn it into a plain `K`.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'

const hooks = vi.hoisted(() => ({
  /** Runs after the real `lstat` of a path, before the gate sees the result. */
  afterLstat: undefined as ((path: string) => void) | undefined
}))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: async (path: string) => {
      const stats = await actual.lstat(path)
      hooks.afterLstat?.(path)
      return stats
    }
  }
})

import { resolveErfanaDir } from './erfanaDirGate'
import { realPathWithin } from './previewPathResolve'

const KELVIN = String.fromCharCode(0x212a)
const ESCAPE = {
  code: ErrorCode.SYMLINK_ATTACK,
  message: 'Resolved .erfana directory escapes the project root'
}

let base: string
let realRoot: string
let siblingErfana: string
let outsideDir: string

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-gate-casefold-')))
  const root = join(base, 'projk')
  mkdirSync(join(root, '.erfana'), { recursive: true })
  siblingErfana = join(base, `proj${KELVIN}`, '.erfana')
  mkdirSync(siblingErfana, { recursive: true })
  outsideDir = join(base, 'elsewhere')
  mkdirSync(outsideDir)
  realRoot = realpathSync.native(root)
})

afterEach(() => {
  hooks.afterLstat = undefined
  rmSync(base, { recursive: true, force: true })
})

/**
 * Replace the root's real `.erfana` with a junction to `target` right after
 * the gate's `lstat` saw a plain directory. A junction needs no privilege on
 * Windows; elsewhere the type is ignored and a directory symlink is made.
 */
function swapAfterSymlinkCheck(target: string): void {
  const erfana = join(realRoot, '.erfana')
  hooks.afterLstat = path => {
    if (path !== erfana) return
    hooks.afterLstat = undefined
    rmdirSync(erfana)
    symlinkSync(target, erfana, 'junction')
  }
}

describe('realPathWithin – the .erfana rule', () => {
  it('is what path.relative is not: the Kelvin-sign sibling’s .erfana stays outside on win32', () => {
    const root = win32.join('C:/', 'work', 'projk')
    const sibling = win32.join('C:/', 'work', `proj${KELVIN}`, '.erfana')
    // The fold this guards against, in the platform function itself.
    expect(win32.relative(root, sibling)).toBe('.erfana')
    expect(realPathWithin(root, sibling, win32.sep)).toBeUndefined()
    expect(realPathWithin(root, win32.join(root, '.erfana'), win32.sep)).toBe('.erfana')
  })
})

describe('resolveErfanaDir – U+212A sibling folder (F1)', () => {
  it('refuses a .erfana swapped, after the symlink check, for a junction into the Kelvin-sign sibling', async () => {
    swapAfterSymlinkCheck(siblingErfana)

    await expect(resolveErfanaDir(realRoot)).rejects.toMatchObject(ESCAPE)
    expect(hooks.afterLstat).toBeUndefined()
    // What the old `relative` rule saw on this file system: on win32 the
    // sibling folded into the root's own `.erfana` and was accepted.
    const seen = relative(realRoot, realpathSync.native(join(realRoot, '.erfana')))
    expect(seen).toBe(
      process.platform === 'win32' ? '.erfana' : join('..', `proj${KELVIN}`, '.erfana')
    )
  })

  it('refuses a .erfana swapped the same way for a junction to an unrelated folder', async () => {
    swapAfterSymlinkCheck(outsideDir)

    await expect(resolveErfanaDir(realRoot)).rejects.toMatchObject(ESCAPE)
    expect(hooks.afterLstat).toBeUndefined()
  })

  it('still returns the root’s own real .erfana', async () => {
    expect(await resolveErfanaDir(realRoot)).toBe(join(realRoot, '.erfana'))
  })
})
