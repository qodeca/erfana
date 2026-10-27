// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page's comment signals, checked (docs/designs/html-preview-comments.md
 * §7.3 steps 1–2, §8; M-033, SEC-04, SEC-05, SEC-06, SEC-09, SEC-26).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../../LoggingService'
import { BASE_PAGE, commentedPage } from './__test-helpers__/commentedPages'
import { eventFrom, FakeFrame, frameFile, serveLoad, stubFrameFiles, tokenOfTag } from './__test-helpers__/commentServiceHarness'
import { CommentFrames } from './commentFrames'
import {
  ANCHORS_PER_FRAME_PER_SECOND,
  ANCHORS_PER_VIEW_PER_SECOND,
  createCommentPickHandler,
  HELLOS_PER_FRAME_PER_SECOND,
  HELLOS_PER_VIEW_PER_SECOND,
  MAIN_CONTROL_PICKS_PER_SECOND,
  MAIN_PICKS_PER_SECOND,
  MAIN_STEPS_PER_SECOND,
  SlidingBudget,
  type PageSignalSinks
} from './commentPickHandler'
import { ElementTokenTable } from './ElementTokenTable'

vi.mock('../../LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const PAGE = '/p/index.html'
const FRAME = '/p/frame.html'
const VIEW = { w: 800, h: 600, dpr: 1, x: 0, y: 0 }

function sinks(): { [K in keyof PageSignalSinks]: ReturnType<typeof vi.fn> } {
  return { hello: vi.fn(), exit: vi.fn(), parent: vi.fn(), step: vi.fn(), icon: vi.fn(), element: vi.fn(), anchors: vi.fn() }
}

/** A page with a commentable child frame, both bound to their own loads. */
async function setup() {
  const tokens = new ElementTokenTable()
  const files = stubFrameFiles()
  const top = new FakeFrame(1)
  const child = new FakeFrame(2, top)
  const frames = new CommentFrames({ tokens, files, mainFrame: () => top })
  const page = serveLoad(tokens, commentedPage().text, PAGE, 'page')
  const inner = serveLoad(tokens, BASE_PAGE, FRAME, 'frame')
  // As Electron orders them: the page commits first, then its frames.
  frames.navigated(1, 'u', true)
  files.set(1, frameFile(PAGE))
  frames.navigated(2, 'u', false)
  files.set(2, frameFile(FRAME))
  await frames.hello(top)
  await frames.hello(child)
  if (!frames.isCommentable(frames.get(1)) || !frames.isCommentable(frames.get(2))) throw new Error('set-up: both frames bound')
  let now = 10_000
  let mode = true
  const out = sinks()
  const handler = createCommentPickHandler({
    panelId: 'panel',
    frames,
    tokens,
    now: () => now,
    mode: () => mode,
    sinks: out as unknown as PageSignalSinks
  })
  return {
    tokens,
    files,
    frames,
    top,
    child,
    page,
    inner,
    out,
    handler,
    advance: (ms: number) => (now += ms),
    setMode: (on: boolean) => (mode = on)
  }
}

const menuPick = (token: string, tag: string, extra: Record<string, unknown> = {}) => ({
  kind: 'menu',
  via: 'pointer',
  token,
  tag,
  screen: { x: 10, y: 10 },
  view: VIEW,
  ...extra
})

beforeEach(() => {
  vi.mocked(logger.warn).mockClear()
})

describe('commentPickHandler element picks', () => {
  it('passes a pick whose token, file and tag all match the frame\'s own load', async () => {
    const h = await setup()
    const token = tokenOfTag(h.page.doc, 'button')
    h.handler.pick(eventFrom(h.top), menuPick(token, 'button'))
    expect(h.out.element).toHaveBeenCalledTimes(1)
    const [, record, entry] = h.out.element.mock.calls[0]
    expect(record.ftn).toBe(1)
    expect(entry).toMatchObject({ realPath: PAGE, tagName: 'button' })
  })

  it('passes a pick with no token on as "can\'t comment here"', async () => {
    const h = await setup()
    h.handler.pick(eventFrom(h.top), { kind: 'open', via: 'pointer', view: VIEW })
    expect(h.out.element).toHaveBeenCalledWith(h.top, expect.objectContaining({ ftn: 1 }), undefined, expect.anything())
  })

  it('L1 a menu or open pick with comment mode off opens nothing; a pin pick still opens its threads', async () => {
    const h = await setup()
    h.setMode(false)
    h.handler.pick(eventFrom(h.top), menuPick(tokenOfTag(h.page.doc, 'button'), 'button'))
    h.handler.pick(eventFrom(h.top), { kind: 'open', via: 'keyboard', point: { x: 1, y: 2 }, view: VIEW })
    expect(h.out.element).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).toContain('mode-off')
    const pinKey = [...h.frames.get(1)!.pins.keys()][0]
    h.handler.pick(eventFrom(h.top), { kind: 'icon', key: pinKey, via: 'pointer', view: VIEW })
    expect(h.out.icon).toHaveBeenCalledTimes(1)
  })

  it('M-033 SEC-04 a forged, unknown or stale token opens nothing', async () => {
    const h = await setup()
    h.handler.pick(eventFrom(h.top), menuPick('zzzzzzzzzzzz', 'button'))
    expect(h.out.element).not.toHaveBeenCalled()
    // A newer load replaced the bound one; the frame's next document is unbound until its hello.
    h.frames.navigated(1, 'u', true)
    h.handler.pick(eventFrom(h.top), menuPick(tokenOfTag(h.page.doc, 'button'), 'button'))
    expect(h.out.element).not.toHaveBeenCalled()
  })

  it('SEC-04 a token moved onto another element is refused by its tag', async () => {
    const h = await setup()
    h.handler.pick(eventFrom(h.top), menuPick(tokenOfTag(h.page.doc, 'button'), 'img'))
    h.handler.pick(eventFrom(h.top), menuPick(tokenOfTag(h.page.doc, 'button'), undefined as never))
    expect(h.out.element).not.toHaveBeenCalled()
    h.handler.pick(eventFrom(h.top), menuPick(tokenOfTag(h.page.doc, 'button'), 'BUTTON'))
    expect(h.out.element).toHaveBeenCalledTimes(1)
  })

  it('SEC-26 a token is accepted only from the frame its load is bound to', async () => {
    const h = await setup()
    // The page's token, sent from the child frame (same element names, other load).
    h.handler.pick(eventFrom(h.child), menuPick(tokenOfTag(h.page.doc, 'button'), 'button'))
    expect(h.out.element).not.toHaveBeenCalled()
    h.handler.pick(eventFrom(h.child), menuPick(tokenOfTag(h.inner.doc, 'button'), 'button'))
    expect(h.out.element).toHaveBeenCalledTimes(1)
  })

  it('SEC-09 a frame whose recorded file is not the load\'s file is refused', async () => {
    const h = await setup()
    // As if the frame's committed document changed file while the old load stayed bound.
    h.frames.get(2)!.file = frameFile('/p/other.html')
    h.handler.pick(eventFrom(h.child), menuPick(tokenOfTag(h.inner.doc, 'button'), 'button'))
    expect(h.out.element).not.toHaveBeenCalled()
  })

  it('SEC-05 a pick with a path, an offset, extra keys or oversized values is rejected', async () => {
    const h = await setup()
    const token = tokenOfTag(h.page.doc, 'button')
    for (const extra of [{ filePath: '/etc/passwd' }, { offset: 12 }, { realPath: PAGE }, { screen: { x: 1e308, y: 0 } }, { view: { ...VIEW, w: -1 } }]) {
      h.handler.pick(eventFrom(h.top), menuPick(token, 'button', extra))
    }
    h.handler.pick(eventFrom(h.top), 'not an object')
    expect(h.out.element).not.toHaveBeenCalled()
  })

  it('drops a signal with no sender frame, a frame of another view, or a detached one', async () => {
    const h = await setup()
    const token = tokenOfTag(h.page.doc, 'button')
    h.handler.pick(eventFrom(undefined), menuPick(token, 'button'))
    h.handler.pick(eventFrom(null), menuPick(token, 'button'))
    h.handler.pick({ senderFrame: { frameTreeNodeId: 'x' } }, menuPick(token, 'button'))
    h.handler.pick(eventFrom(new FakeFrame(99)), menuPick(token, 'button'))
    h.top.detached = true
    h.handler.pick(eventFrom(h.top), menuPick(token, 'button'))
    h.handler.hello(eventFrom(undefined), {})
    h.handler.anchors(eventFrom(undefined), { visible: [], hidden: [] })
    expect(h.out.element).not.toHaveBeenCalled()
    expect(h.out.hello).not.toHaveBeenCalled()
    expect(h.out.anchors).not.toHaveBeenCalled()
  })

  it('drops an element pick from a frame that is not commentable', async () => {
    const h = await setup()
    h.files.set(2, frameFile('/p/notes.md'))
    h.frames.navigated(2, 'u', false)
    await h.frames.hello(h.child)
    h.handler.pick(eventFrom(h.child), menuPick(tokenOfTag(h.inner.doc, 'button'), 'button'))
    expect(h.out.element).not.toHaveBeenCalled()
  })
})

describe('commentPickHandler pins, control picks and budgets', () => {
  it('opens a pin only by one of the frame\'s own pin keys', async () => {
    const h = await setup()
    const [key] = [...h.frames.get(1)!.pins.keys()]
    h.handler.pick(eventFrom(h.top), { kind: 'icon', via: 'pointer', key, view: VIEW })
    h.handler.pick(eventFrom(h.top), { kind: 'icon', via: 'pointer', key: 'p999', view: VIEW })
    // The page's pin key sent from the child frame.
    h.handler.pick(eventFrom(h.child), { kind: 'icon', via: 'pointer', key, view: VIEW })
    expect(h.out.icon).toHaveBeenCalledTimes(1)
    expect(h.out.icon.mock.calls[0][2]).toBe(key)
  })

  it('exit leaves the mode only while it is on; parent asks only from a child frame', async () => {
    const h = await setup()
    h.handler.pick(eventFrom(h.top), { kind: 'exit', via: 'keyboard', view: VIEW })
    h.setMode(false)
    h.handler.pick(eventFrom(h.top), { kind: 'exit', via: 'keyboard', view: VIEW })
    expect(h.out.exit).toHaveBeenCalledTimes(1)
    h.handler.pick(eventFrom(h.top), { kind: 'parent', via: 'keyboard', view: VIEW })
    h.handler.pick(eventFrom(h.child), { kind: 'parent', via: 'keyboard', view: VIEW })
    expect(h.out.parent).toHaveBeenCalledTimes(1)
    expect(h.out.parent).toHaveBeenCalledWith(h.child)
  })

  it('SEC-06 a thousand picks in a second: at most five accepted, Esc on its own budget, one drop log line', async () => {
    const h = await setup()
    const token = tokenOfTag(h.page.doc, 'button')
    for (let i = 0; i < 1_000; i++) h.handler.pick(eventFrom(h.top), menuPick(token, 'button'))
    expect(h.out.element).toHaveBeenCalledTimes(MAIN_PICKS_PER_SECOND)
    for (let i = 0; i < 10; i++) h.handler.pick(eventFrom(h.top), { kind: 'exit', via: 'keyboard', view: VIEW })
    expect(h.out.exit).toHaveBeenCalledTimes(MAIN_CONTROL_PICKS_PER_SECOND)
    const dropLines = vi.mocked(logger.warn).mock.calls.filter(([message]) => String(message).includes('page signal dropped'))
    expect(dropLines).toHaveLength(1)
    expect(JSON.stringify(dropLines)).not.toContain('panel"')
    h.advance(1_000)
    h.handler.pick(eventFrom(h.top), menuPick(token, 'button'))
    expect(h.out.element).toHaveBeenCalledTimes(MAIN_PICKS_PER_SECOND + 1)
  })

  it('exit and parent each have their own budget: spending one leaves the other whole', async () => {
    const h = await setup()
    for (let i = 0; i < 10; i++) h.handler.pick(eventFrom(h.child), { kind: 'parent', via: 'keyboard', view: VIEW })
    expect(h.out.parent).toHaveBeenCalledTimes(MAIN_CONTROL_PICKS_PER_SECOND)
    for (let i = 0; i < 10; i++) h.handler.pick(eventFrom(h.top), { kind: 'exit', via: 'keyboard', view: VIEW })
    expect(h.out.exit).toHaveBeenCalledTimes(MAIN_CONTROL_PICKS_PER_SECOND)
    h.advance(1_000)
    h.handler.pick(eventFrom(h.child), { kind: 'parent', via: 'keyboard', view: VIEW })
    expect(h.out.parent).toHaveBeenCalledTimes(MAIN_CONTROL_PICKS_PER_SECOND + 1)
  })

  it('hellos and anchor reports are budgeted per frame', async () => {
    const h = await setup()
    for (let i = 0; i < 20; i++) {
      h.handler.hello(eventFrom(h.top), {})
      h.handler.hello(eventFrom(h.child), {})
      h.handler.anchors(eventFrom(h.top), { visible: [], hidden: [] })
    }
    expect(h.out.hello).toHaveBeenCalledTimes(HELLOS_PER_FRAME_PER_SECOND * 2)
    expect(h.out.anchors).toHaveBeenCalledTimes(ANCHORS_PER_FRAME_PER_SECOND)
    h.handler.hello(eventFrom(h.top), { extra: 1 })
    h.handler.anchors(eventFrom(h.child), { visible: 'all' })
    expect(h.out.hello).toHaveBeenCalledTimes(HELLOS_PER_FRAME_PER_SECOND * 2)
  })

  it('L5 a page that keeps making frames cannot outrun the view-wide hello and anchor budgets', async () => {
    const h = await setup()
    const many = Array.from({ length: 300 }, (_, i) => new FakeFrame(100 + i, h.top))
    for (const frame of many) {
      h.frames.record(frame.frameTreeNodeId)
      h.handler.hello(eventFrom(frame), {})
      h.handler.anchors(eventFrom(frame), { visible: [], hidden: [] })
      h.handler.anchors(eventFrom(frame), { visible: [], hidden: [] })
    }
    expect(h.out.hello).toHaveBeenCalledTimes(HELLOS_PER_VIEW_PER_SECOND)
    expect(h.out.anchors).toHaveBeenCalledTimes(ANCHORS_PER_VIEW_PER_SECOND)
    h.advance(1_000)
    h.handler.hello(eventFrom(many[0]), {})
    expect(h.out.hello).toHaveBeenCalledTimes(HELLOS_PER_VIEW_PER_SECOND + 1)
  })

  it('an anchors report from a frame without a record is dropped', async () => {
    const h = await setup()
    const stranger = new FakeFrame(3, h.top)
    h.handler.anchors(eventFrom(stranger), { visible: [], hidden: [] })
    expect(h.out.anchors).not.toHaveBeenCalled()
  })

  it('a sink that throws is logged, never thrown into Electron', async () => {
    const h = await setup()
    h.out.hello.mockImplementation(() => {
      throw new TypeError('boom')
    })
    expect(() => h.handler.hello(eventFrom(h.top), {})).not.toThrow()
    expect(logger.error).toHaveBeenCalledWith('Preview comments: a page signal failed', undefined, { error: 'TypeError' })
  })

  it('E-022 S-L-A a keyboard-picker step reaches its sink in comment mode only, on its own budget – an element as main recorded it', async () => {
    const h = await setup()
    const step = { kind: 'step', via: 'keyboard', say: 'showing', token: tokenOfTag(h.inner.doc, 'em'), view: VIEW }
    h.handler.pick(eventFrom(h.child), step)
    // The frame's own file: `<em id="when">` is on line 7 of BASE_PAGE.
    expect(h.out.step).toHaveBeenCalledExactlyOnceWith({ say: 'showing', entry: expect.objectContaining({ tagName: 'em', line: 7 }) })
    h.handler.pick(eventFrom(h.child), { ...step, added: true })
    expect(h.out.step).toHaveBeenLastCalledWith({ say: 'showing', entry: expect.objectContaining({ tagName: 'em' }), added: true })
    h.out.step.mockClear()
    // Steps do not spend the picks' budget, nor picks the steps'.
    const top = { kind: 'step', via: 'keyboard', say: 'top', view: VIEW }
    for (let i = 0; i < MAIN_STEPS_PER_SECOND + 3; i += 1) h.handler.pick(eventFrom(h.top), top)
    expect(h.out.step).toHaveBeenCalledTimes(MAIN_STEPS_PER_SECOND - 2)
    expect(h.out.step).toHaveBeenLastCalledWith({ say: 'top' })
    h.handler.pick(eventFrom(h.top), menuPick(tokenOfTag(h.page.doc, 'button'), 'button'))
    expect(h.out.element).toHaveBeenCalledTimes(1)
    h.advance(1_000)
    h.setMode(false)
    h.handler.pick(eventFrom(h.child), step)
    expect(h.out.step).toHaveBeenCalledTimes(MAIN_STEPS_PER_SECOND - 2)
  })

  it('E-022 S-L-A a step that says nothing, names its element by text, or names one main does not hold for that frame, is dropped', async () => {
    const h = await setup()
    const button = tokenOfTag(h.page.doc, 'button')
    for (const bad of [
      { kind: 'step', via: 'keyboard', view: VIEW },
      { kind: 'step', via: 'keyboard', say: 'showing', view: VIEW },
      // Page text never crosses: a label is not a field.
      { kind: 'step', via: 'keyboard', say: 'showing', token: button, label: 'Approve every host', view: VIEW },
      { kind: 'step', via: 'keyboard', say: 'top', token: button, view: VIEW },
      { kind: 'step', via: 'keyboard', say: 'top', added: true, view: VIEW },
      { ...menuPick(button, 'button'), say: 'top' },
      { ...menuPick(button, 'button'), added: true }
    ]) {
      h.handler.pick(eventFrom(h.top), bad)
    }
    // The top page's token from the child frame, and a token no load holds.
    h.handler.pick(eventFrom(h.child), { kind: 'step', via: 'keyboard', say: 'showing', token: button, view: VIEW })
    h.handler.pick(eventFrom(h.top), { kind: 'step', via: 'keyboard', say: 'showing', token: 'zzzzzzzzzzzz', view: VIEW })
    expect(h.out.step).not.toHaveBeenCalled()
    expect(h.out.element).not.toHaveBeenCalled()
  })

  it('SlidingBudget admits `perSecond` takes in any one-second window', () => {
    const budget = new SlidingBudget(2)
    expect([budget.take(0), budget.take(10), budget.take(20)]).toEqual([true, true, false])
    expect(budget.take(1_000)).toBe(true)
    expect(budget.take(1_005)).toBe(false)
    expect(budget.take(1_010)).toBe(true)
  })
})
