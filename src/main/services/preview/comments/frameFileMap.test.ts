// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which file each frame shows (docs/designs/html-preview-comments.md §4.2
 * "frameFileMap"; M-050, SEC-09).
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfineVerdict } from '../previewPathResolve'
import { makeProject, PAGE, type TempProject } from './__test-helpers__/commentWriterHarness'
import { createFrameFileMap, previewUrlSegments } from './frameFileMap'

const TOKEN = 'tok123'
const url = (path: string): string => `erfana-preview://${TOKEN}/${path}`

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
  await project.write('index.html', PAGE)
  await mkdir(project.path('docs'))
  await project.write(join('docs', 'Frame Page.HTM'), PAGE)
  await project.write('notes.md', '# notes')
})

afterEach(async () => {
  await project.dispose()
})

function map() {
  return createFrameFileMap({ token: TOKEN, realRoot: project.root, projectPath: project.root })
}

describe('previewUrlSegments', () => {
  it('SEC-09 only this view\'s own preview URL names a file', () => {
    expect(previewUrlSegments(url('docs/a%20b.html'), TOKEN)).toEqual(['docs', 'a b.html'])
    for (const other of [
      'erfana-preview://other/index.html',
      'about:blank',
      'about:srcdoc',
      'https://example.com/index.html',
      `erfana-preview://${TOKEN}:8080/index.html`,
      `erfana-preview://user@${TOKEN}/index.html`,
      `erfana-preview://${TOKEN}/`,
      `erfana-preview://${TOKEN}/%E0%A4%A`,
      `erfana-preview://${TOKEN}/a%2Fb.html`,
      `erfana-preview://${TOKEN}/a%5Cb.html`,
      `erfana-preview://${TOKEN}/a%00b.html`,
      'not a url'
    ]) {
      expect(previewUrlSegments(other, TOKEN), other).toBeUndefined()
    }
  })
})

describe('createFrameFileMap', () => {
  it('M-050 a committed document records its confined real path, project path and display path', async () => {
    const files = map()
    files.navigated(1, url('index.html'))
    files.navigated(2, url('docs/Frame%20Page.HTM'))
    files.navigated(3, url('notes.md'))

    expect(await files.fileOf(1)).toEqual({
      realPath: project.path('index.html'),
      projectPath: project.path('index.html'),
      displayPath: 'index.html',
      commentable: true
    })
    expect(await files.fileOf(2)).toMatchObject({ displayPath: 'docs/Frame Page.HTM', commentable: true })
    // A frame showing a non-HTML file is known, but cannot take comments.
    expect(await files.fileOf(3)).toMatchObject({ displayPath: 'notes.md', commentable: false })
    expect(files.peek(1)?.realPath).toBe(project.path('index.html'))
  })

  it('M-050 a frame on about:blank, another token or a missing or escaping file has no file', async () => {
    const files = map()
    files.navigated(1, 'about:blank')
    files.navigated(2, 'erfana-preview://other/index.html')
    files.navigated(3, url('gone.html'))
    files.navigated(4, url('..%2F..%2Fetc%2Fpasswd'))
    for (const id of [1, 2, 3, 4]) expect(await files.fileOf(id)).toBeUndefined()
    expect(files.peek(3)).toBeUndefined()
    expect(await files.fileOf(99)).toBeUndefined()
  })

  it('M-050 a frame that navigates away to a non-preview address loses its file', async () => {
    const files = map()
    files.navigated(1, url('index.html'))
    expect(await files.fileOf(1)).toBeDefined()
    files.navigated(1, 'about:blank')
    expect(await files.fileOf(1)).toBeUndefined()
  })

  it('SEC-09 a newer navigation of the same frame wins over an older one still confining', async () => {
    const releases: Array<(verdict: ConfineVerdict) => void> = []
    const files = createFrameFileMap({
      token: TOKEN,
      realRoot: '/root',
      projectPath: '/root',
      platform: 'linux',
      confine: () => new Promise(resolve => releases.push(resolve))
    })
    files.navigated(1, url('a.html'))
    const first = files.fileOf(1)
    files.navigated(1, url('b.html'))
    releases[1]({ ok: true, realTarget: '/root/b.html', rel: 'b.html' })
    releases[0]({ ok: true, realTarget: '/root/a.html', rel: 'a.html' })
    expect((await first)?.realPath).toBe('/root/b.html')
    expect(files.peek(1)?.realPath).toBe('/root/b.html')
  })

  it('SEC-09 a confinement that throws reads as no file', async () => {
    const files = createFrameFileMap({
      token: TOKEN,
      realRoot: '/root',
      projectPath: '/root',
      confine: () => Promise.reject(new Error('EACCES'))
    })
    files.navigated(1, url('a.html'))
    expect(await files.fileOf(1)).toBeUndefined()
  })

  it('retain forgets every frame no longer in the tree, and clear forgets all', async () => {
    const files = map()
    files.navigated(1, url('index.html'))
    files.navigated(2, url('index.html'))
    await files.fileOf(2)
    files.retain(new Set([1]))
    expect(await files.fileOf(2)).toBeUndefined()
    expect(await files.fileOf(1)).toBeDefined()
    files.clear()
    expect(await files.fileOf(1)).toBeUndefined()
  })
})
