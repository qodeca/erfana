// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Containment is decided by an exact compare of realpaths, never by
 * `path.relative` (security review F1). On win32 `path.relative` folds case
 * with JavaScript's `toLowerCase`, which maps U+212A KELVIN SIGN to `k`, while
 * NTFS keeps `proj<U+212A>` and `projk` as two folders. A junction inside the
 * root that points at the sibling `proj<U+212A>` used to be served as if the
 * sibling were the root itself.
 *
 * The Kelvin sign is built with `String.fromCharCode`, never typed or escaped,
 * so no tool can silently turn it into a plain `K`.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KELVIN, KELVIN_SIBLING_IS_DISTINCT } from './__test-helpers__/kelvinSibling'
import { confinePath, realPathWithin, resolveConfined } from './previewPathResolve'

describe('realPathWithin – exact containment', () => {
  const root = win32.join('C:/', 'work', 'projk')

  it('is what path.relative is not: a Kelvin-sign sibling stays outside on win32', () => {
    const outside = win32.join('C:/', 'work', `proj${KELVIN}`, 'a.html')
    // The fold this guards against, in the platform function itself.
    expect(win32.relative(root, outside)).toBe('a.html')
    expect(realPathWithin(root, outside, win32.sep)).toBeUndefined()
  })

  it('returns the remainder of a path inside the root, and nothing for the root or a prefix twin', () => {
    expect(realPathWithin(root, win32.join(root, 'pages', 'a.html'), win32.sep)).toBe(
      win32.join('pages', 'a.html')
    )
    expect(realPathWithin(root, root, win32.sep)).toBeUndefined()
    expect(realPathWithin(root, `${root}2${win32.sep}a.html`, win32.sep)).toBeUndefined()
    // Exact means case too: realpath spells the root the same way every time.
    expect(
      realPathWithin(root, win32.join('C:/', 'work', 'PROJK', 'a.html'), win32.sep)
    ).toBeUndefined()
  })

  it('accepts a root that already ends with the separator (a drive root)', () => {
    const driveRoot = win32.join('C:/')
    expect(driveRoot.endsWith(win32.sep)).toBe(true)
    expect(realPathWithin(driveRoot, win32.join('C:/', 'a.html'), win32.sep)).toBe('a.html')
    expect(realPathWithin('/', '/a.html', '/')).toBe('a.html')
  })
})

// Needs both folders on disk: a case-insensitive APFS volume folds them into one.
describe.skipIf(!KELVIN_SIBLING_IS_DISTINCT)('preview confinement – U+212A sibling folder (F1)', () => {
  let base: string
  let realRoot: string
  let sibling: string

  beforeEach(() => {
    base = realpathSync.native(mkdtempSync(join(tmpdir(), 'preview-casefold-')))
    realRoot = join(base, 'projk')
    sibling = join(base, `proj${KELVIN}`)
    mkdirSync(realRoot)
    mkdirSync(sibling)
    writeFileSync(join(realRoot, 'index.html'), '<p>inside</p>')
    writeFileSync(join(sibling, 'secret.html'), '<p>outside</p>')
    // A junction needs no privilege on Windows; elsewhere the type is ignored.
    symlinkSync(sibling, join(realRoot, 'link'), 'junction')
    realRoot = realpathSync.native(realRoot)
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('resolveConfined refuses a file reached through a junction to the Kelvin-sign sibling', async () => {
    expect(await resolveConfined(realRoot, ['link', 'secret.html'])).toEqual({
      ok: false,
      status: 403,
      reason: 'path-escape'
    })
  })

  it('confinePath calls the same file an escape', async () => {
    expect(await confinePath(realRoot, join(realRoot, 'link', 'secret.html'))).toEqual({
      ok: false,
      reason: 'escape'
    })
  })

  it('still serves a file that really is inside the root', async () => {
    const result = await resolveConfined(realRoot, ['index.html'])
    expect(result.ok && result.body.toString()).toBe('<p>inside</p>')
    expect(await confinePath(realRoot, join(realRoot, 'index.html'))).toEqual({
      ok: true,
      realTarget: join(realRoot, 'index.html'),
      rel: 'index.html'
    })
  })
})
