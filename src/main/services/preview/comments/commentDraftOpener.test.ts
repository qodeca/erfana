// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Opening drafts and pins (docs/designs/comments/html-preview-comments.md §7.3, §7.7;
 * M-033, M-056; review findings M1, M4, L3).
 */
import { rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentDraftOpened, CommentPick } from '../../../../shared/ipc/preview-comment-schema'
import { CommentDraftOpenedSchema } from '../../../../shared/ipc/preview-comment-schema'
import type { InstrumentedDocument } from './commentParseCore'
import { commentedPage, damagedBlock, insertBefore } from './__test-helpers__/commentedPages'
import { makeProject, type TempProject } from './__test-helpers__/commentWriterHarness'
import { FakeFrame, frameFile, serveLoad, stubFrameFiles, tokenOfTag } from './__test-helpers__/commentServiceHarness'
import { createCommentDraftOpener, pinPickOf, placeOf, type DraftOpenerDeps } from './commentDraftOpener'
import type { CommentDraft } from './commentDraftBuilder'
import { createInProcessCommentFileJobs } from '../../comments/commentFileJobs'
import { CommentFrames } from './commentFrames'
import { CommentKeyStore } from '../../comments/commentKeyStore'
import type { PinGroup } from './commentPins'
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

async function setup(html: string) {
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
    emit: payload => emitted.push(payload),
    jobs: createInProcessCommentFileJobs(),
    isCurrent: record => frames.get(record.ftn) === record
  }
  const opener = createCommentDraftOpener(deps)
  return { path, tokens, top, record, load, keys, emitted, opener, deps }
}

const pick = (overrides: Partial<CommentPick> = {}): CommentPick => ({ kind: 'menu', via: 'pointer', view: VIEW, ...overrides }) as CommentPick

/** Every token of `tag` in the served document, in source order. */
function tokensOfTag(doc: InstrumentedDocument, tag: string): string[] {
  const code = doc.tagNames.indexOf(tag)
  const out: string[] = []
  doc.tagCodes.forEach((value, index) => {
    if (value === code) out.push(doc.tokens.slice(index * 12, (index + 1) * 12))
  })
  return out
}

const DRAFT_KEY = /^[0-9a-f]{32}$/

describe('commentDraftOpener', () => {
  it('opens a draft with its token, its element key and the file\'s keys – and no unsaved flag (L3)', async () => {
    const s = await setup(commentedPage().text)
    const token = tokenOfTag(s.load.doc, 'p')
    await s.opener.element(s.top, s.record, s.tokens.lookup(s.record.loadId!, token), pick({ token, tag: 'p', screen: { x: 20, y: 30 } }))
    expect(s.emitted).toHaveLength(1)
    expect(s.emitted[0]).toMatchObject({ kind: 'menu', point: { x: 20, y: 30 }, displayPath: 'index.html', draftKey: expect.stringMatching(DRAFT_KEY), target: { tag: 'p', elementId: 'para' } })
    expect(s.emitted[0]).not.toHaveProperty('unsavedSource')
    expect(CommentDraftOpenedSchema.safeParse(s.emitted[0]).success).toBe(true)
    expect(s.keys.size.drafts).toBe(1)
  })

  it('M1 two id-less elements on one line get two element keys; the same element picked again gets its own back, and no path shows', async () => {
    const html = '<!doctype html><html><body>\n<div>first</div><div>second</div>\n</body></html>'
    const s = await setup(html)
    const [first, second] = tokensOfTag(s.load.doc, 'div')
    const open = (token: string) => s.opener.element(s.top, s.record, s.tokens.lookup(s.record.loadId!, token), pick({ token, tag: 'div' }))
    await open(first)
    await open(second)
    await open(first)
    const keys = s.emitted.map(event => event.draftKey)
    expect(keys[0]).toMatch(DRAFT_KEY)
    expect(keys[1]).toMatch(DRAFT_KEY)
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[2]).toBe(keys[0])
    // Both share line and tag – what the renderer keyed on before.
    expect(s.emitted[0].target).toMatchObject({ tag: 'div', line: 2 })
    expect(s.emitted[1].target).toMatchObject({ tag: 'div', line: 2 })
    // `filePath` is the schema's project path; no other field carries it. The
    // root is JSON-escaped first, so its backslashes match on Windows too.
    const root = JSON.stringify(project.root).slice(1, -1)
    for (const event of s.emitted) expect(JSON.stringify({ ...event, filePath: undefined })).not.toContain(root)
  })

  it('an element with no tokened ancestor opens "can\'t comment here" – no token, no code', async () => {
    const s = await setup(commentedPage().text)
    await s.opener.element(s.top, s.record, undefined, pick({ kind: 'open', via: 'keyboard', point: { x: 1, y: 2 } }))
    expect(s.emitted[0]).toMatchObject({ kind: 'open', point: { x: 1, y: 2 } })
    expect(s.emitted[0]).not.toHaveProperty('draftToken')
    expect(s.emitted[0]).not.toHaveProperty('code')
  })

  it('M-033 the file changed since the page loaded: no draft is minted, and the menu opens with none to offer', async () => {
    const s = await setup(commentedPage().text)
    await writeFile(s.path, `${commentedPage().text}\n<!-- edited -->`)
    const token = tokenOfTag(s.load.doc, 'p')
    await s.opener.element(s.top, s.record, s.tokens.lookup(s.record.loadId!, token), pick({ token, tag: 'p' }))
    expect(s.emitted[0]).toMatchObject({ kind: 'menu', fileKey: expect.stringMatching(/^f/) })
    for (const absent of ['draftToken', 'draftKey', 'target', 'code']) expect(s.emitted[0]).not.toHaveProperty(absent)
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

  it('§10.4 a pin offers "New comment": a draft on the pin\'s element, bound to this view, with its element key and target', async () => {
    const s = await setup(commentedPage().text)
    const [openKey, pin] = [...s.record.pins].find(([, group]) => group.threadIds.length > 0)!
    await s.opener.icon(s.top, s.record, openKey, pick({ kind: 'icon', key: openKey }))
    const opened = s.emitted[0]
    if (opened.kind !== 'icon' || opened.draftToken === undefined) throw new Error('the pin carried no draft')
    expect(opened).toMatchObject({ draftToken: expect.stringMatching(/^[0-9a-f]{32}$/), draftKey: expect.stringMatching(DRAFT_KEY), target: { line: expect.any(Number) } })
    expect(opened).not.toHaveProperty('unsavedSource')
    // The same element through a menu: the same session draft.
    const entry0 = s.tokens.lookup(s.record.loadId!, pin.token)!
    await s.opener.element(s.top, s.record, entry0, pick({ token: pin.token, tag: entry0.tagName }))
    expect(s.emitted[1].draftKey).toBe(opened.draftKey)
    expect(s.keys.claimDraft(opened.draftToken, { ...BINDING, session: 2 }).ok).toBe(false)
    const claim = s.keys.claimDraft(opened.draftToken, BINDING)
    if (!claim.ok) throw new Error('the draft was not this view\'s')
    // The block goes before the pin's own element, as a menu on that element would put it.
    const entry = s.tokens.lookup(s.record.loadId!, pin.token)!
    expect(claim.value).toMatchObject({ realPath: s.path, offset: entry.startOffset, frame: false })
    expect(claim.value.anchor.tag).toBe(entry.tagName)
  })

  it('a pin on a JS-built element offers its draft on that element; the page\'s own description is never used', () => {
    const view = { w: 1, h: 1, dpr: 1, x: 0, y: 0 }
    const iconPick = pick({ kind: 'icon', key: 'p1', view, runtime: { path: 'div:nth-of-type(1)', tag: 'div' } })
    const group: PinGroup = { id: 'g', token: 'aaaaaaaaaaaa', threadIds: ['c-1'], attention: 0, count: 1, status: 'open' }
    expect(pinPickOf(group, iconPick)).toEqual({ kind: 'icon', via: 'pointer', view })
    expect(pinPickOf({ ...group, runtime: { path: 'span:nth-of-type(2)', tag: 'span' } }, iconPick)).toEqual({
      kind: 'icon',
      via: 'pointer',
      view,
      runtime: { path: 'span:nth-of-type(2)', tag: 'span' }
    })
    // A stored runtime element no pick could name gets no "New comment" rather than one on its ancestor.
    expect(pinPickOf({ ...group, runtime: { path: 'span', tag: 'x<y' } }, iconPick)).toBeUndefined()
  })

  it('M4 a pin with a damaged block reads its file once and runs ONE job for its blocks and its draft', async () => {
    const html = insertBefore(commentedPage().text, '<p id="para"', damagedBlock('c-9'))
    const s = await setup(html)
    const runner = createInProcessCommentFileJobs()
    const runJob = vi.fn(runner.runJob.bind(runner))
    const counted = createCommentDraftOpener({ ...s.deps, jobs: { runJob } as typeof runner })
    const pinKey = [...s.record.pins].find(([, pin]) => pin.attention > 0)![0]
    await counted.icon(s.top, s.record, pinKey, pick({ kind: 'icon', key: pinKey }))
    expect(runJob).toHaveBeenCalledTimes(1)
    expect(runJob.mock.calls[0][1]).toMatchObject({ kind: 'pin', blocks: true, pick: {} })
    expect(s.emitted[0]).toMatchObject({ kind: 'icon', blockKeys: [expect.stringMatching(/^b/)], draftToken: expect.any(String), draftKey: expect.stringMatching(DRAFT_KEY) })
    // A pin with nothing needing attention asks for no blocks – still one job, for the draft.
    runJob.mockClear()
    const openKey = [...s.record.pins].find(([, pin]) => pin.attention === 0)![0]
    await counted.icon(s.top, s.record, openKey, pick({ kind: 'icon', key: openKey }))
    expect(runJob).toHaveBeenCalledTimes(1)
    expect(runJob.mock.calls[0][1]).toMatchObject({ kind: 'pin', blocks: false })
  })

  it('a pin whose file changed lists no block keys; an unknown pin opens nothing', async () => {
    const html = insertBefore(commentedPage().text, '<p id="para"', damagedBlock('c-9'))
    const s = await setup(html)
    await writeFile(s.path, `${html}\n`)
    const pinKey = [...s.record.pins].find(([, pin]) => pin.attention > 0)![0]
    await s.opener.icon(s.top, s.record, pinKey, pick({ kind: 'icon', key: pinKey }))
    expect(s.emitted[0]).toMatchObject({ blockKeys: [] })
    // Nor a draft: the element is no longer where the page was served from.
    expect(s.emitted[0]).not.toHaveProperty('draftToken')
    expect(s.keys.size.drafts).toBe(0)
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
