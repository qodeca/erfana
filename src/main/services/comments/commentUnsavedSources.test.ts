// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The windows' unsaved editor files (docs/designs/comments/html-preview-comments.md
 * decision 13, §7.8; M-062).
 */
import { mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeProject, PAGE, type TempProject } from '../preview/comments/__test-helpers__/commentWriterHarness'
import { createCommentUnsavedSources, isReportablePath, samePathKey } from './commentUnsavedSources'

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
  await mkdir(project.path('real'))
  await project.write(join('real', 'index.html'), PAGE)
})

afterEach(async () => {
  await project.dispose()
})

describe('commentUnsavedSources', () => {
  it('M-062 a dirty tab reached through a symlinked folder still matches the real path the writer locks', async ({ skip }) => {
    try {
      await symlink(project.path('real'), project.path('linked'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      skip('symlinks are not available here')
    }
    const sources = createCommentUnsavedSources({ projectRoot: () => project.root })
    await sources.set(1, [project.path('linked', 'index.html')])
    expect(await sources.has(1, project.path('real', 'index.html'))).toBe(true)
  })

  it('M-062 per window: another window, or a window that never reported, holds nothing', async () => {
    const sources = createCommentUnsavedSources({ projectRoot: () => project.root })
    await sources.set(1, [project.path('real', 'index.html')])
    expect(await sources.has(2, project.path('real', 'index.html'))).toBe(false)
    expect(await sources.has(1, project.path('real', 'other.html'))).toBe(false)
  })

  it('the newest report replaces the last, and forget drops the window', async () => {
    const sources = createCommentUnsavedSources({ projectRoot: () => project.root })
    await sources.set(1, [project.path('real', 'index.html')])
    await sources.set(1, [])
    expect(await sources.has(1, project.path('real', 'index.html'))).toBe(false)
    await sources.set(1, [project.path('real', 'index.html')])
    sources.forget(1)
    expect(await sources.has(1, project.path('real', 'index.html'))).toBe(false)
  })

  it('a path that does not resolve is kept as written, and a question asked mid-report waits for it', async () => {
    let release: (value: string) => void = () => {}
    const slow = project.path('slow.html')
    const gone = project.path('gone.html')
    const real = project.path('real', 'slow.html')
    const sources = createCommentUnsavedSources({
      projectRoot: () => project.root,
      platform: 'linux',
      realpath: async path => (path === slow ? new Promise(resolve => (release = resolve)) : Promise.reject(new Error('ENOENT')))
    })
    void sources.set(1, [slow, gone])
    const asked = sources.has(1, real)
    release(real)
    expect(await asked).toBe(true)
    expect(await sources.has(1, gone)).toBe(true)
  })

  it('L2 only a fully qualified path inside the project is resolved; a device path or one elsewhere never reaches realpath', async () => {
    const resolved: string[] = []
    const sources = createCommentUnsavedSources({
      projectRoot: () => project.root,
      realpath: async path => {
        resolved.push(path)
        return path
      }
    })
    const inside = project.path('real', 'index.html')
    await sources.set(1, [
      inside,
      String.raw`\\attacker\share\a.html`,
      String.raw`\\?\C:\x\a.html`,
      String.raw`\\.\pipe\x`,
      'relative.html',
      `${project.root}-sibling/a.html`
    ])
    expect(resolved).toEqual([inside])
    expect(await sources.has(1, inside)).toBe(true)

    const noProject = createCommentUnsavedSources({ projectRoot: () => null, realpath: async path => (resolved.push(path), path) })
    await noProject.set(1, [inside])
    expect(resolved).toEqual([inside])
  })

  it('L2 isReportablePath: the rules on Windows paths too', () => {
    // The path rules are the host's (as `commentFileAccess`); the Windows spellings run on a Windows host.
    if (process.platform === 'win32') {
      expect(isReportablePath(String.raw`C:\proj\a.html`, String.raw`C:\proj`, 'win32')).toBe(true)
      expect(isReportablePath('c:/PROJ/a.html', String.raw`C:\proj`, 'win32')).toBe(true)
      expect(isReportablePath(String.raw`\proj\a.html`, String.raw`C:\proj`, 'win32')).toBe(false)
      expect(isReportablePath(String.raw`\\srv\share\proj\a.html`, String.raw`\\srv\share\proj`, 'win32')).toBe(true)
      expect(isReportablePath(String.raw`\\srv\share\other\a.html`, String.raw`C:\proj`, 'win32')).toBe(false)
    }
    // A device prefix is refused even when the root carries the same one.
    expect(isReportablePath('//?/C:/proj/a.html', '//?/C:/proj', 'win32')).toBe(false)
    expect(isReportablePath(String.raw`\??\C:\proj\a.html`, String.raw`\??\C:\proj`, 'win32')).toBe(false)
    expect(isReportablePath(String.raw`\\.\C:\proj\a.html`, String.raw`\\.\C:\proj`, 'win32')).toBe(false)
  })

  it('L4 hasAny does not wait on a lookup that never settles: past its bound it answers unsaved (fail closed)', async () => {
    const page = project.path('real', 'index.html')
    const sources = createCommentUnsavedSources({
      projectRoot: () => project.root,
      realpath: () => new Promise<string>(() => {}),
      lookupMaxWaitMs: 20
    })
    void sources.set(2, [page])
    const started = performance.now()
    expect(await sources.hasAny(project.path('real', 'other.html'))).toBe(true)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('L4 hasAny answers from settled lookups inside its bound', async () => {
    const page = project.path('real', 'index.html')
    const sources = createCommentUnsavedSources({ projectRoot: () => project.root, lookupMaxWaitMs: 5000 })
    await sources.set(1, [page])
    expect(await sources.hasAny(page)).toBe(true)
    expect(await sources.hasAny(project.path('real', 'other.html'))).toBe(false)
  })

  it('compares case-blind on Windows and macOS only', () => {
    expect(samePathKey('/P/Index.HTML', 'win32')).toBe(samePathKey('/p/index.html', 'win32'))
    expect(samePathKey('/P/Index.HTML', 'darwin')).toBe(samePathKey('/p/index.html', 'darwin'))
    expect(samePathKey('/P/Index.HTML', 'linux')).not.toBe(samePathKey('/p/index.html', 'linux'))
  })
})
