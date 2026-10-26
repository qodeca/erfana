// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A draft from a pick, read again from disk (docs/designs/
 * html-preview-comments.md §7.3 step 3, decisions 16–17, 35, §19 R3-11;
 * M-033, M-054, M-055, M-056).
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import { logger } from '../../LoggingService'
import type { CommentPick } from '../../../../shared/ipc/preview-comment-schema'
import { makeProject, PAGE, type TempProject } from './__test-helpers__/commentWriterHarness'
import { frameFile, serveLoad, tokenOfTag } from './__test-helpers__/commentServiceHarness'
import { buildDraft, cutText, EXCERPT_MAX_CHARS, lineAt } from './commentDraftBuilder'
import { createInProcessCommentFileJobs } from './commentFileJobs'
import { ElementTokenTable } from './ElementTokenTable'

vi.mock('../../LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const VIEW = { w: 800, h: 600, dpr: 1, x: 0, y: 40 }

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
})

afterEach(async () => {
  await project.dispose()
})

/** Serve `html` from `rel`, then build the draft for the first `tag`'s token. */
async function draftFor(rel: string, html: string, tag: string, pick: Partial<CommentPick> = {}, change?: (path: string) => Promise<void>) {
  const path = await project.write(rel, html)
  const tokens = new ElementTokenTable()
  const { loadId, doc } = serveLoad(tokens, html, path)
  const token = tokenOfTag(doc, tag)
  const entry = tokens.lookup(loadId, token)!
  await change?.(path)
  return buildDraft({
    realRoot: project.root,
    file: frameFile(path),
    entry,
    pick: { kind: 'menu', via: 'pointer', token, tag, view: VIEW, ...pick } as CommentPick,
    frame: false,
    pageRealPath: path,
    jobs: createInProcessCommentFileJobs()
  })
}

describe('buildDraft', () => {
  it('builds the draft from disk: the element\'s offset, anchor, line and start-tag excerpt', async () => {
    const built = await draftFor('index.html', PAGE, 'button', { ws: 'preserve' })
    if (!built.ok) throw new Error(`draft: ${built.code}`)
    expect(built.target).toEqual({ tag: 'button', elementId: 'buy', classes: ['cta'], line: 7, excerpt: '<button id="buy" class="cta">' })
    expect(built.draft).toMatchObject({
      realRoot: project.root,
      realPath: project.path('index.html'),
      offset: PAGE.indexOf('<button'),
      ws: 'preserve',
      view: VIEW,
      pageRealPath: project.path('index.html'),
      frame: false
    })
    expect(built.draft.anchor).toMatchObject({ tag: 'button', id: 'buy' })
  })

  it('M-033 the file changed since it was served, or the token\'s offset now names another element: TARGET_MOVED', async () => {
    const changed = await draftFor('index.html', PAGE, 'button', {}, path => writeFile(path, PAGE.replace('Buy now', 'Buy later')))
    expect(changed).toEqual({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED })
  })

  it('M-056 the file deleted after the page loaded: FILE_GONE', async () => {
    const gone = await draftFor('index.html', PAGE, 'button', {}, path => rm(path))
    expect(gone).toEqual({ ok: false, code: ErrorCode.COMMENT_FILE_GONE })
  })

  it('a file that cannot take comments says why (git conflict markers)', async () => {
    const conflicted = PAGE.replace('  <main>', '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\n  <main>')
    expect(await draftFor('index.html', conflicted, 'button')).toEqual({ ok: false, code: ErrorCode.COMMENT_FILE_CONFLICTED })
  })

  it('M-055 a page in a dot-folder or dist/ is never a draft; a gitignored page is', async () => {
    await mkdir(project.path('.hidden'))
    await mkdir(project.path('dist'))
    await writeFile(project.path('.gitignore'), 'ignored.html\n')
    expect(await draftFor(join('.hidden', 'page.html'), PAGE, 'button')).toEqual({ ok: false, code: ErrorCode.COMMENT_PATH_REFUSED })
    expect(await draftFor(join('dist', 'page.html'), PAGE, 'button')).toEqual({ ok: false, code: ErrorCode.COMMENT_PATH_REFUSED })
    expect((await draftFor('ignored.html', PAGE, 'button')).ok).toBe(true)
  })

  it('M-054 a page-sent snapshot for a path that names an element in the file is dropped', async () => {
    const built = await draftFor('index.html', PAGE, 'p', {
      runtime: { path: 'em:nth-of-type(1)', tag: 'em', snapshot: '<em>today</em>' }
    })
    if (!built.ok) throw new Error('draft')
    expect(built.draft.anchor.runtime).toMatchObject({ path: 'em:nth-of-type(1)', tag: 'em' })
    expect(built.draft.anchor.runtime).not.toHaveProperty('snapshot')
    expect(built.target.runtime).toEqual({ tag: 'em' })
  })

  it('M-054 a JS-built element keeps its stripped snapshot and quote', async () => {
    const built = await draftFor('index.html', PAGE, 'p', {
      runtime: {
        path: 'span:nth-of-type(1)',
        tag: 'span',
        quote: { exact: 'Live', prefix: '', suffix: '' },
        snapshot: '<span data-erfana-el="abcdefghijk2">Live</span>'
      }
    })
    if (!built.ok) throw new Error('draft')
    expect(built.draft.anchor.runtime).toMatchObject({ path: 'span:nth-of-type(1)', tag: 'span', snapshotSource: 'page', quote: { exact: 'Live' } })
    expect(built.draft.anchor.runtime?.snapshot).not.toContain('data-erfana-el')
    expect(built.target.runtime?.snapshotBytes).toBeGreaterThan(0)
  })

  it('places a block inside a hydrated region before the region\'s container, with the element below it and no layout', async () => {
    const page = PAGE.replace('  <main>', '  <div id="app" data-server-rendered="true"><ul><li>One</li><li>Two</li></ul></div>\n  <main>')
    const built = await draftFor('index.html', page, 'li', { ws: 'preserve' })
    if (!built.ok) throw new Error(`draft: ${built.code}`)
    expect(built.draft.offset).toBe(page.indexOf('<div id="app"'))
    expect(built.draft).not.toHaveProperty('ws')
    expect(built.draft.anchor.runtime).toMatchObject({ path: 'ul:nth-of-type(1) > li:nth-of-type(1)', tag: 'li' })
    expect(built.target).toMatchObject({ tag: 'div', elementId: 'app', runtime: { tag: 'li' } })
  })

  it('R3-12 a parse the worker could not run opens no draft: WRITE_FAILED, logged by digest only', async () => {
    const path = await project.write('index.html', PAGE)
    const tokens = new ElementTokenTable()
    const { loadId, doc } = serveLoad(tokens, PAGE, path)
    const token = tokenOfTag(doc, 'button')
    const built = await buildDraft({
      realRoot: project.root,
      file: frameFile(path),
      entry: tokens.lookup(loadId, token)!,
      pick: { kind: 'menu', via: 'pointer', token, tag: 'button', view: VIEW } as CommentPick,
      frame: false,
      jobs: { runJob: async () => ({ kind: 'failed', failure: 'timeout' }) }
    })
    expect(built).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED })
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).toContain('timeout')
    expect(logged).not.toContain('index.html')
  })

  it('a runtime path over its cap opens no draft and names no error', async () => {
    const built = await draftFor('index.html', PAGE, 'p', {
      runtime: { path: Array.from({ length: 200 }, () => 'span:nth-of-type(1)').join(' > '), tag: 'span' }
    })
    expect(built).toEqual({ ok: false })
  })
})

describe('lineAt and cutText', () => {
  it('counts 1-based lines and never cuts a surrogate pair', () => {
    expect(lineAt('a\nb\nc', 0)).toBe(1)
    expect(lineAt('a\nb\nc', 2)).toBe(2)
    expect(lineAt('a\nb\nc', 4)).toBe(3)
    expect(cutText('abc', 5)).toBe('abc')
    expect(cutText('ab😀', 3)).toBe('ab')
    expect(cutText('x'.repeat(EXCERPT_MAX_CHARS + 5), EXCERPT_MAX_CHARS)).toHaveLength(EXCERPT_MAX_CHARS)
  })
})
