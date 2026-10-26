// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Opening drafts and pins (docs/designs/html-preview-comments.md §7.3, §7.7;
 * M-033, M-056).
 */
import { rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import type { CommentDraftOpened, CommentPick } from '../../../../shared/ipc/preview-comment-schema'
import { commentedPage, damagedBlock, insertBefore } from './__test-helpers__/commentedPages'
import { makeProject, type TempProject } from './__test-helpers__/commentWriterHarness'
import { FakeFrame, frameFile, serveLoad, stubFrameFiles, tokenOfTag } from './__test-helpers__/commentServiceHarness'
import { createCommentDraftOpener, placeOf, type DraftOpenerDeps } from './commentDraftOpener'
import type { CommentDraft } from './commentDraftBuilder'
import { createInProcessCommentFileJobs } from './commentFileJobs'
import { CommentFrames } from './commentFrames'
import { CommentKeyStore } from './commentKeyStore'
import { ElementTokenTable } from './ElementTokenTable'

const VIEW = { w: 800, h: 600, dpr: 1, x: 0, y: 0 }
const BINDING = { windowId: 1, panelId: 'panel', session: 1 }

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
})

afterEach(async () => {
  await project.dispose()
})

async function setup(html: string, unsaved = false) {
  const path = await project.write('index.html', html)
  const tokens = new ElementTokenTable()
  const files = stubFrameFiles()
  const top = new FakeFrame(1)
  const frames = new CommentFrames({ tokens, files, mainFrame: () => top })
  const load = serveLoad(tokens, html, path)
  frames.navigated(1, 'u', true)
  files.set(1, frameFile(path))
  const record = await frames.hello(top)
  const keys = new CommentKeyStore<CommentDraft>()
  const emitted: CommentDraftOpened[] = []
  const deps: DraftOpenerDeps = {
    panelId: 'panel',
    binding: BINDING,
    realRoot: project.root,
    keys,
    tokens,
    mainFrame: () => top,
    still: {
      panelId: 'panel',
      contents: { capturePage: vi.fn(), executeJavaScriptInIsolatedWorld: vi.fn(async () => ({ x: 0, y: 0 })) },
      stillFrameCache: { captureFresh: vi.fn(async () => true) },
      lastRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      lastCssSize: () => null,
      isDrawn: () => true
    },
    geometry: { viewRect: () => ({ x: 0, y: 0, width: 800, height: 600 }), contentBounds: () => ({ x: 0, y: 0 }), hostZoom: () => 1, pageZoom: () => 1, cursor: () => ({ x: 7, y: 8 }) },
    accent: [0xa0, 0xa8, 0xff],
    currentPage: () => path,
    hasUnsavedSource: async () => unsaved,
    emit: payload => emitted.push(payload),
    jobs: createInProcessCommentFileJobs(),
    isCurrent: record => frames.get(record.ftn) === record
  }
  const opener = createCommentDraftOpener(deps)
  return { path, tokens, top, record, load, keys, emitted, opener, deps }
}

const pick = (overrides: Partial<CommentPick> = {}): CommentPick => ({ kind: 'menu', via: 'pointer', view: VIEW, ...overrides }) as CommentPick

describe('commentDraftOpener', () => {
  it('opens a draft with its token, the file\'s keys and the unsaved flag', async () => {
    const s = await setup(commentedPage().text, true)
    const token = tokenOfTag(s.load.doc, 'p')
    await s.opener.element(s.top, s.record, s.tokens.lookup(s.record.loadId!, token), pick({ token, tag: 'p', screen: { x: 20, y: 30 } }))
    expect(s.emitted).toHaveLength(1)
    expect(s.emitted[0]).toMatchObject({ kind: 'menu', point: { x: 20, y: 30 }, displayPath: 'index.html', unsavedSource: true, target: { tag: 'p', elementId: 'para' } })
    expect(s.keys.size.drafts).toBe(1)
  })

  it('an element with no tokened ancestor opens "can\'t comment here" – no token, no code', async () => {
    const s = await setup(commentedPage().text)
    await s.opener.element(s.top, s.record, undefined, pick({ kind: 'open', via: 'keyboard', point: { x: 1, y: 2 } }))
    expect(s.emitted[0]).toMatchObject({ kind: 'open', point: { x: 1, y: 2 } })
    expect(s.emitted[0]).not.toHaveProperty('draftToken')
    expect(s.emitted[0]).not.toHaveProperty('code')
  })

  it('M-033 the file changed since the page loaded: the menu says why, and no draft is minted', async () => {
    const s = await setup(commentedPage().text)
    await writeFile(s.path, `${commentedPage().text}\n<!-- edited -->`)
    const token = tokenOfTag(s.load.doc, 'p')
    await s.opener.element(s.top, s.record, s.tokens.lookup(s.record.loadId!, token), pick({ token, tag: 'p' }))
    expect(s.emitted[0]).toMatchObject({ code: ErrorCode.COMMENT_TARGET_MOVED })
    expect(s.keys.size.drafts).toBe(0)
  })

  it('a pin opens its open threads and the damaged blocks on the same element, as keys', async () => {
    const html = insertBefore(commentedPage().text, '<p id="para"', damagedBlock('c-9'))
    const s = await setup(html)
    const pinKey = [...s.record.pins].find(([, pin]) => pin.attention > 0)![0]
    await s.opener.icon(s.top, s.record, pinKey, pick({ kind: 'icon', key: pinKey, via: 'pointer', screen: { x: 0, y: 0 } }))
    expect(s.emitted[0]).toMatchObject({ kind: 'icon', point: { x: 7, y: 8 }, threadKeys: [], blockKeys: [expect.stringMatching(/^b/)] })

    const openKey = [...s.record.pins].find(([, pin]) => pin.threadIds.length > 0)![0]
    await s.opener.icon(s.top, s.record, openKey, pick({ kind: 'icon', key: openKey }))
    expect(s.emitted[1]).toMatchObject({ kind: 'icon', threadKeys: [expect.stringMatching(/^t/)], blockKeys: [] })
  })

  it('a pin whose file changed lists no block keys; an unknown pin opens nothing', async () => {
    const html = insertBefore(commentedPage().text, '<p id="para"', damagedBlock('c-9'))
    const s = await setup(html)
    await writeFile(s.path, `${html}\n`)
    const pinKey = [...s.record.pins].find(([, pin]) => pin.attention > 0)![0]
    await s.opener.icon(s.top, s.record, pinKey, pick({ kind: 'icon', key: pinKey }))
    expect(s.emitted[0]).toMatchObject({ blockKeys: [] })
    await s.opener.icon(s.top, s.record, 'p-none', pick({ kind: 'icon', key: 'p-none' }))
    expect(s.emitted).toHaveLength(1)
  })

  it('a pin lists no block keys when its file is gone, the worker fails, or its load is unknown; a frame with no file opens nothing', async () => {
    const html = insertBefore(commentedPage().text, '<p id="para"', damagedBlock('c-9'))
    const s = await setup(html)
    const pinKey = [...s.record.pins].find(([, pin]) => pin.attention > 0)![0]
    const iconPick = pick({ kind: 'icon', key: pinKey })

    const failing = createCommentDraftOpener({ ...s.deps, jobs: { runJob: async () => ({ kind: 'failed', failure: 'crashed' }) } })
    await failing.icon(s.top, s.record, pinKey, iconPick)
    // A record the frames never held stands in for an unknown load and a frame with no file.
    const anyRecord = createCommentDraftOpener({ ...s.deps, isCurrent: () => true })
    await anyRecord.icon(s.top, { ...s.record, loadId: undefined }, pinKey, iconPick)
    await anyRecord.icon(s.top, { ...s.record, file: undefined }, pinKey, iconPick)
    await rm(s.path)
    await s.opener.icon(s.top, s.record, pinKey, iconPick)

    expect(s.emitted).toHaveLength(3)
    for (const opened of s.emitted) expect(opened).toMatchObject({ kind: 'icon', blockKeys: [] })
  })

  it('M2 a frame that commits another file while the draft opens gets no menu and no draft for the old one', async () => {
    const html = commentedPage().text
    const pathA = await project.write('a.html', html)
    const pathB = await project.write('b.html', html)
    const tokens = new ElementTokenTable()
    const files = stubFrameFiles()
    const top = new FakeFrame(1)
    const child = new FakeFrame(2, top)
    const frames = new CommentFrames({ tokens, files, mainFrame: () => top })
    const loadA = serveLoad(tokens, html, pathA, 'frame')
    frames.navigated(2, 'uA', false)
    files.set(2, frameFile(pathA))
    const record = await frames.hello(child)
    let release!: () => void
    const painted = new Promise<void>(resolve => {
      release = resolve
    })
    const keys = new CommentKeyStore<CommentDraft>()
    const emitted: CommentDraftOpened[] = []
    const opener = createCommentDraftOpener({
      panelId: 'panel',
      binding: BINDING,
      realRoot: project.root,
      keys,
      tokens,
      mainFrame: () => top,
      still: {
        panelId: 'panel',
        contents: {
          capturePage: vi.fn(),
          executeJavaScriptInIsolatedWorld: vi.fn(async () => {
            await painted
            return { x: 0, y: 0 }
          })
        },
        stillFrameCache: { captureFresh: vi.fn(async () => true) },
        lastRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
        lastCssSize: () => null,
        isDrawn: () => true
      },
      geometry: { viewRect: () => ({ x: 0, y: 0, width: 800, height: 600 }), contentBounds: () => ({ x: 0, y: 0 }), hostZoom: () => 1, pageZoom: () => 1, cursor: () => ({ x: 7, y: 8 }) },
      accent: [0xa0, 0xa8, 0xff],
      currentPage: () => pathA,
      hasUnsavedSource: async () => false,
      emit: payload => emitted.push(payload),
      jobs: createInProcessCommentFileJobs(),
      isCurrent: current => frames.get(current.ftn) === current
    })
    const token = tokenOfTag(loadA.doc, 'p')
    const pending = opener.element(child, record, tokens.lookup(record.loadId!, token), pick({ token, tag: 'p' }))
    // While main waits for the paint, the frame commits b.html and says hello.
    serveLoad(tokens, html, pathB, 'frame')
    frames.navigated(2, 'uB', false)
    files.set(2, frameFile(pathB))
    await frames.hello(child)
    release()
    await pending

    expect(emitted).toEqual([])
    expect(keys.size.drafts).toBe(0)
  })

  it('L7 nothing is minted or sent once the view is gone', async () => {
    const html = insertBefore(commentedPage().text, '<p id="para"', damagedBlock('c-9'))
    const s = await setup(html)
    const token = tokenOfTag(s.load.doc, 'p')
    const pinKey = [...s.record.pins].find(([, pin]) => pin.attention > 0)![0]
    const alive = { now: true }
    const gone = createCommentDraftOpener({ ...s.deps, isCurrent: () => alive.now })
    const element = gone.element(s.top, s.record, s.tokens.lookup(s.record.loadId!, token), pick({ token, tag: 'p' }))
    const icon = gone.icon(s.top, s.record, pinKey, pick({ kind: 'icon', key: pinKey }))
    alive.now = false
    await Promise.all([element, icon])

    expect(s.emitted).toEqual([])
    expect(s.keys.size).toEqual({ drafts: 0, keys: 0 })
  })

  it('placeOf: the top frame, a direct child by its window index, a nested frame by its top-level ancestor', () => {
    const top = new FakeFrame(1)
    const first = new FakeFrame(2, top)
    const second = new FakeFrame(3, top)
    const nested = new FakeFrame(4, second)
    expect(placeOf(top, top)).toEqual({ childIndex: -1, nested: false })
    expect(placeOf(first, top)).toEqual({ childIndex: 0, nested: false })
    expect(placeOf(nested, top)).toEqual({ childIndex: 1, nested: true })
    expect(placeOf(first, undefined)).toEqual({ childIndex: -1, nested: false })
  })
})
