// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment file's early confinement (comments-v2 OD-07): every escape rule
 * of the preview's `confinePath`, none of its folder rules.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { PAGE, makeProject, type TempProject } from '../preview/comments/__test-helpers__/commentWriterHarness'
import { confineCommentPath } from './commentPathConfine'

let project: TempProject
let outside: TempProject
let root: string

beforeEach(async () => {
  project = await makeProject()
  outside = await makeProject('erfana-comments-outside-')
  root = await realpath(project.root)
})

afterEach(async () => {
  await project.dispose()
  await outside.dispose()
})

describe('confineCommentPath', () => {
  it.each([
    ['a dot-folder', ['.hidden', 'notes.md']],
    ['node_modules', ['node_modules', 'pkg', 'README.md']],
    ['a build folder', ['dist', 'index.html']],
    ['.git', ['.git', 'page.html']]
  ])('OD-07 confines a file in %s to its real path – no folder rule', async (_name, segments) => {
    await mkdir(project.path(...segments.slice(0, -1)), { recursive: true })
    const page = await project.write(join(...segments), PAGE)

    expect(await confineCommentPath(root, page)).toEqual({ ok: true, realTarget: await realpath(page), rel: join(...segments) })
  })

  it('OD-07 still refuses a folder link that leads out of the project as an escape', async () => {
    await outside.write('page.html', PAGE)
    await symlink(outside.root, project.path('linkdir'), 'junction')

    expect(await confineCommentPath(root, project.path('linkdir', 'page.html'))).toEqual({ ok: false, reason: 'escape' })
  })

  it('OD-07 still refuses a file link that leads out of the project as an escape', async () => {
    const elsewhere = await outside.write('page.html', PAGE)
    await symlink(elsewhere, project.path('out.html'), 'file')

    expect(await confineCommentPath(root, project.path('out.html'))).toEqual({ ok: false, reason: 'escape' })
  })

  it('OD-07 a missing parent or a missing file is missing, never an escape', async () => {
    expect(await confineCommentPath(root, project.path('gone', 'page.html'))).toEqual({ ok: false, reason: 'missing' })
    expect(await confineCommentPath(root, project.path('page.html'))).toEqual({ ok: false, reason: 'missing' })
  })

  it('OD-07 the root itself is no file below it', async () => {
    expect(await confineCommentPath(root, root)).toEqual({ ok: false, reason: 'escape' })
  })
})
