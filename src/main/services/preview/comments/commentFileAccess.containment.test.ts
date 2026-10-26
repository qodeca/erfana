// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The deciding containment check of `confineCommentFile` holds on its own
 * (security review F1): even when `confinePath` answers that a file outside
 * the root is fine, the exact compare of the two realpaths refuses it.
 *
 * Split from `commentFileAccess.test.ts` because the module-scope
 * `previewPathResolve` mock hoists (docs/windows/contributing.md, test-file
 * split policy). `realPathWithin` stays real; only `confinePath` is replaced.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ confinePath: vi.fn() }))

vi.mock('../previewPathResolve', async importOriginal => {
  const actual = await importOriginal<typeof import('../previewPathResolve')>()
  return { ...actual, confinePath: hooks.confinePath }
})

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PAGE, makeProject, snapshot, type TempProject } from './__test-helpers__/commentWriterHarness'
import { confineCommentFile } from './commentFileAccess'
import { refused } from './commentRefusals'

/** U+212A KELVIN SIGN, which `toLowerCase` folds to `k`. */
const KELVIN = String.fromCharCode(0x212a)

let parent: TempProject

beforeEach(async () => {
  parent = await makeProject('erfana-comments-containment-')
  hooks.confinePath.mockReset()
})

afterEach(async () => {
  await parent.dispose()
})

describe('confineCommentFile – the exact containment check (F1)', () => {
  it.each([
    ['a sibling whose name only case-folds to the root', `proj${KELVIN}`],
    ['a sibling whose name starts with the root', 'projk-other']
  ])('refuses %s even when confinePath lets it through', async (_name, siblingName) => {
    await mkdir(parent.path('projk'))
    await mkdir(parent.path(siblingName))
    const outsidePage = await parent.write(join(siblingName, 'page.html'), PAGE)
    const before = await snapshot(outsidePage)
    hooks.confinePath.mockResolvedValue({ ok: true, realTarget: outsidePage, rel: 'page.html' })

    const result = await confineCommentFile(
      { realRoot: parent.path('projk'), filePath: parent.path('projk', 'page.html') },
      { platform: 'win32' }
    )

    expect(result).toEqual(refused('outside-project'))
    expect(hooks.confinePath).toHaveBeenCalledWith(parent.path('projk'), parent.path('projk', 'page.html'))
    expect(await snapshot(outsidePage)).toEqual(before)
  })
})
