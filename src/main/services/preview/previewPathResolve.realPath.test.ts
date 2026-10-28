// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `resolveConfined` names the file it read (HTML Preview comments,
 * docs/designs/comments/html-preview-comments.md §4.2 "previewPathResolve.ts"): the
 * confined, fully resolved `realPath` – the key the token table and the
 * comment writer use for the file.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveConfined } from './previewPathResolve'

let root: string

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-realpath-')))
  mkdirSync(join(root, 'pages'))
  writeFileSync(join(root, 'pages', 'index.html'), '<p>x</p>')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveConfined – realPath', () => {
  it('returns the real path of the file it served, with its body and extension', async () => {
    const result = await resolveConfined(root, ['pages', 'index.html'])
    expect(result).toEqual({
      ok: true,
      body: Buffer.from('<p>x</p>'),
      ext: '.html',
      realPath: realpathSync.native(join(root, 'pages', 'index.html'))
    })
  })

  it.skipIf(process.platform === 'win32')(
    'names the link TARGET when a folder on the way is a symlink',
    async () => {
      symlinkSync(join(root, 'pages'), join(root, 'alias'), 'dir')
      const result = await resolveConfined(root, ['alias', 'index.html'])
      expect(result.ok && result.realPath).toBe(join(root, 'pages', 'index.html'))
    }
  )
})
