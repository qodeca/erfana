// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The frames of one view and the states they are sent
 * (docs/designs/html-preview-comments.md §4.2, §6 "Frames", §7.1 step 2, §8,
 * §19 R3-3, R3-4, R3-13; M-050, M-059, M-064, SEC-09, SEC-19).
 */
import { describe, expect, it, vi } from 'vitest'
import { PreviewCommentPageChannels } from '../../../../shared/ipc/preview-comment-channels'
import { logger } from '../../LoggingService'
import { BASE_PAGE, commentedPage, damagedBlock, insertBefore } from './__test-helpers__/commentedPages'
import { FakeFrame, frameFile, serveLoad, stubFrameFiles } from './__test-helpers__/commentServiceHarness'
import { createCommentFrameBroadcaster, type CommentViewMode } from './commentFrameBroadcaster'
import { CommentFrames, isLiveFrame } from './commentFrames'
import { COMMENT_OVERLAY_THEME } from './commentOverlayTheme'
import { ElementTokenTable } from './ElementTokenTable'

vi.mock('../../LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const PAGE = '/p/index.html'
const FRAME = '/p/frame.html'

function setup() {
  const tokens = new ElementTokenTable()
  const files = stubFrameFiles()
  const top = new FakeFrame(1)
  const frames = new CommentFrames({ tokens, files, mainFrame: () => top })
  return { tokens, files, top, frames }
}

describe('CommentFrames', () => {
  it('M-059 binds each frame\'s first hello to the newest unbound load of its file and scope, once', async () => {
    const { tokens, files, top, frames } = setup()
    const child = new FakeFrame(2, top)
    const pageLoad = serveLoad(tokens, commentedPage().text, PAGE, 'page')
    // The same file shown as the page and inside a frame: two loads, two tables.
    const frameLoad = serveLoad(tokens, commentedPage().text, PAGE, 'frame')
    frames.navigated(1, 'u', true)
    files.set(1, frameFile(PAGE))
    frames.navigated(2, 'u', false)
    files.set(2, frameFile(PAGE))

    const topRecord = await frames.hello(top)
    const childRecord = await frames.hello(child)
    expect(topRecord.loadId).toBe(pageLoad.loadId)
    expect(childRecord.loadId).toBe(frameLoad.loadId)
    expect(topRecord.key).not.toBe(childRecord.key)
    expect(topRecord.pins.size).toBe(2)

    // A second hello of the same document binds nothing new.
    serveLoad(tokens, commentedPage().text, PAGE, 'page')
    expect((await frames.hello(top)).loadId).toBe(pageLoad.loadId)
  })

  it('M-050 a new document needs a new bind; a frame without a commentable file has no load', async () => {
    const { tokens, files, top, frames } = setup()
    serveLoad(tokens, BASE_PAGE, PAGE)
    frames.navigated(1, 'u', true)
    files.set(1, frameFile('/p/notes.md'))
    const record = await frames.hello(top)
    expect(record.loadId).toBeUndefined()
    expect(frames.isCommentable(record)).toBe(false)
    expect(frames.isCommentable(undefined)).toBe(false)
  })

  it('M-059 a page commit drops every child frame\'s record and tables; a frame leaving the tree drops its own', async () => {
    const { tokens, files, top, frames } = setup()
    const child = new FakeFrame(2, top)
    const other = new FakeFrame(3, top)
    serveLoad(tokens, BASE_PAGE, FRAME, 'frame')
    serveLoad(tokens, BASE_PAGE, FRAME, 'frame')
    frames.navigated(2, 'u', false)
    files.set(2, frameFile(FRAME))
    frames.navigated(3, 'u', false)
    files.set(3, frameFile(FRAME))
    await frames.hello(child)
    await frames.hello(other)
    expect(tokens.views().filter(view => view.frameKey !== undefined)).toHaveLength(2)

    child.remove()
    frames.prune()
    expect(frames.get(2)).toBeUndefined()
    expect(frames.get(3)).toBeDefined()
    expect(tokens.views().filter(view => view.frameKey !== undefined)).toHaveLength(1)

    frames.navigated(1, 'u', true)
    expect(frames.all().map(record => record.ftn)).toEqual([1])
    expect(tokens.views().filter(view => view.frameKey !== undefined)).toHaveLength(0)
  })

  it('gives a reload\'s pins fresh keys, never one the page saw before', async () => {
    const { tokens, files, top, frames } = setup()
    serveLoad(tokens, commentedPage().text, PAGE)
    frames.navigated(1, 'u', true)
    files.set(1, frameFile(PAGE))
    const before = [...(await frames.hello(top)).pins.keys()]
    serveLoad(tokens, commentedPage().text, PAGE)
    frames.navigated(1, 'u', true)
    files.set(1, frameFile(PAGE))
    const after = [...(await frames.hello(top)).pins.keys()]
    // Tokens differ per load, so the group ids differ: new keys, never reused ones.
    expect(after).toHaveLength(before.length)
    expect(after.some(key => before.includes(key))).toBe(false)
  })

  it('lists live frames page first, and answers nothing without a page or with a failing tree', () => {
    const { top, frames } = setup()
    const child = new FakeFrame(2, top)
    const gone = new FakeFrame(3, top)
    gone.detached = true
    expect(frames.liveFrames().map(frame => frame.frameTreeNodeId)).toEqual([1, 2])
    expect(frames.frameOf(2)).toBe(child)
    expect(frames.frameOf(3)).toBeUndefined()
    expect(new CommentFrames({ tokens: new ElementTokenTable(), files: stubFrameFiles(), mainFrame: () => undefined }).liveFrames()).toEqual([])
    const broken = { get framesInSubtree(): never { throw new Error('destroyed') } }
    expect(new CommentFrames({ tokens: new ElementTokenTable(), files: stubFrameFiles(), mainFrame: () => broken as never }).liveFrames()).toEqual([])
    expect(isLiveFrame({ ...child, isDestroyed: () => { throw new Error('x') } } as never)).toBe(false)
  })

  it('a prune with no page in the tree keeps every record', () => {
    const tokens = new ElementTokenTable()
    const frames = new CommentFrames({ tokens, files: stubFrameFiles(), mainFrame: () => undefined })
    frames.record(5)
    frames.prune()
    expect(frames.get(5)).toBeDefined()
    frames.clear()
    expect(frames.all()).toEqual([])
  })
})

describe('commentFrameBroadcaster', () => {
  async function bound(mode: Partial<CommentViewMode> = {}) {
    const s = setup()
    const child = new FakeFrame(2, s.top)
    const blank = new FakeFrame(3, s.top)
    const text = insertBefore(commentedPage().text, '<p id="para"', damagedBlock('c-9'))
    serveLoad(s.tokens, text, PAGE)
    serveLoad(s.tokens, BASE_PAGE, FRAME, 'frame')
    s.frames.navigated(1, 'u', true)
    s.files.set(1, frameFile(PAGE))
    s.frames.navigated(2, 'u', false)
    s.files.set(2, frameFile(FRAME))
    await s.frames.hello(s.top)
    await s.frames.hello(child)
    const view = { mode: true, showIcons: true, hidden: false, ...mode }
    const queued: Array<() => void> = []
    const broadcaster = createCommentFrameBroadcaster({ panelId: 'panel', frames: s.frames, mode: () => view, schedule: run => queued.push(run) })
    return { ...s, child, blank, broadcaster, view, queued }
  }

  it('SEC-19 a commentable frame gets the mode, its pins, its child frames and the theme – never a text, a path or an author', async () => {
    const b = await bound()
    const state = b.broadcaster.stateFor(b.top)
    expect(state).toMatchObject({ mode: true, commentable: true, showIcons: true, theme: COMMENT_OVERLAY_THEME })
    const icons = state.icons as Array<Record<string, unknown>>
    expect(icons.map(icon => Object.keys(icon).sort())).toEqual(icons.map(icon => ('runtime' in icon ? ['count', 'key', 'runtime', 'status', 'token'] : ['count', 'key', 'status', 'token'])))
    expect(icons.some(icon => icon.status === 'damaged')).toBe(true)
    // In `WebFrameMain.frames` order, with the opaque key – never the frame id.
    expect(state.childFrames).toEqual([
      { key: b.frames.get(2)!.key, commentable: true },
      { key: b.frames.record(3).key, commentable: false }
    ])
    const text = JSON.stringify(state)
    for (const secret of [PAGE, 'Ada', 'Grace', 'c-1', '"text"']) expect(text).not.toContain(secret)
  })

  it('every other frame gets the mode alone, so clicks are swallowed everywhere (R3-3)', async () => {
    const b = await bound()
    expect(b.broadcaster.stateFor(b.blank, { reveal: 'p1' })).toEqual({ mode: true, theme: COMMENT_OVERLAY_THEME, commentable: false })
  })

  it('M-064 hidden rides on every state while printing; one-shot extras only where asked', async () => {
    const b = await bound({ hidden: true })
    expect(b.broadcaster.stateFor(b.top)).toMatchObject({ hidden: true })
    expect(b.broadcaster.stateFor(b.blank)).toMatchObject({ hidden: true })
    b.view.hidden = false
    expect(b.broadcaster.stateFor(b.top)).not.toHaveProperty('hidden')
    expect(b.broadcaster.stateFor(b.top, { reveal: 'p1', restore: { x: 1, y: 2 }, focusFrame: 'fr2' })).toMatchObject({
      reveal: 'p1',
      restore: { x: 1, y: 2 },
      focusFrame: 'fr2'
    })
  })

  it('broadcastSoon coalesces a tick into one send per live frame', async () => {
    const b = await bound()
    b.broadcaster.broadcastSoon()
    b.broadcaster.broadcastSoon()
    expect(b.queued).toHaveLength(1)
    b.queued[0]()
    for (const frame of [b.top, b.child, b.blank]) {
      expect(frame.send).toHaveBeenCalledTimes(1)
      expect(frame.send.mock.calls[0][0]).toBe(PreviewCommentPageChannels.STATE)
    }
    b.broadcaster.broadcastSoon()
    expect(b.queued).toHaveLength(2)
  })

  it('never sends to a detached frame, logs one failed send per view, and nothing after dispose', async () => {
    const b = await bound()
    b.child.detached = true
    b.broadcaster.send(b.child)
    expect(b.child.send).not.toHaveBeenCalled()
    b.top.send.mockImplementation(() => {
      throw new Error('Render frame was disposed')
    })
    b.broadcaster.send(b.top)
    b.broadcaster.send(b.top)
    expect(vi.mocked(logger.debug)).toHaveBeenCalledTimes(1)
    b.broadcaster.dispose()
    b.broadcaster.broadcastSoon()
    b.broadcaster.broadcast()
    b.broadcaster.send(b.blank)
    expect(b.blank.send).not.toHaveBeenCalled()
  })
})
