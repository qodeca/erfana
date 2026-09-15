// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The frame events of one live view (issue #124, WI-14; part 2 §2.5–§2.8).
 * The page scopes are the real ones, with their real timers, so an entry that
 * reaches the wrong page – or a page that is gone – would show here. The fake
 * contents emits Electron 39's argument shapes, as spikes S4, S10 and S11 saw
 * them, and counts a new frame into `framesInSubtree` when it is created (S12).
 * The frame guard's tests live in `previewFrameEvents.guard.test.ts`; both use
 * `__test-helpers__/previewFrameEventsHarness.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import {
  SRCDOC_TOO_DEEP_ENTRY,
  describeFramesOverLimit
} from '../../../shared/previewFrameBadgeText'
import { logger } from '../LoggingService'
import {
  ERR_ABORTED,
  ERR_BLOCKED_BY_CLIENT,
  OTHER_TOKEN,
  OWN_TOKEN,
  PID,
  makeView,
  own
} from './__test-helpers__/previewFrameEventsHarness'
import { ERR_BLOCKED_BY_CSP, ERR_BLOCKED_BY_RESPONSE } from './previewFrameGuard'

const { MAX_FRAME_DEPTH, MAX_FRAMES_PER_PAGE, FRAME_OVER_LIMIT_QUIET_MS } = PREVIEW_LIMITS

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})


describe('the failed-load writer (S10)', () => {
  it.each([
    ['a remote frame', ERR_BLOCKED_BY_CSP, 'https://remote.example.com/page', 'frame-remote', 'https://remote.example.com/page'],
    ['a response that refused to be framed', ERR_BLOCKED_BY_RESPONSE, 'https://remote.example.com/x', 'frame-remote', 'https://remote.example.com/x'],
    ['another token', ERR_BLOCKED_BY_CSP, `erfana-preview://${OTHER_TOKEN}/x.html`, 'frame-escape', `erfana-preview://${OTHER_TOKEN}/x.html`],
    ['a data: frame', ERR_BLOCKED_BY_CSP, 'data:text/html,<p>big</p>', 'frame-remote', 'data:'],
    ['a script-made blob: frame', ERR_BLOCKED_BY_CSP, `blob:erfana-preview://${OWN_TOKEN}/6f1c`, 'frame-remote', 'blob:']
  ])('lists %s', (_name, code, url, type, resourceUrlOrHost) => {
    const view = makeView()

    view.failFrame(view.createFrame(), code, url)

    expect(view.entries()).toEqual([{ type, resourceUrlOrHost }])
  })

  it('lists a link out of a frame that showed a document by scheme and host only', () => {
    const view = makeView()
    const frame = view.createFrame()
    view.commitFrame(frame)

    view.failFrame(frame, ERR_BLOCKED_BY_CSP, 'https://evil.example/steal?token=1')

    expect(view.entries()).toEqual([{ type: 'frame-link-blocked', resourceUrlOrHost: 'https://evil.example' }])
  })

  // A frame made by script with no `src` first commits an empty `about:blank`: no document the page named.
  it.each([
    ['a script-made blob: frame as remote, by its scheme', ['about:blank'], `blob:erfana-preview://${OWN_TOKEN}/6f1c`, 'frame-remote', 'blob:'],
    ['a script-made frame given a remote src, by its full URL', ['about:blank'], 'https://remote.example.com/p?q=1', 'frame-remote', 'https://remote.example.com/p?q=1'],
    ['a link out of a frame that then showed a document, by scheme and host', ['about:blank', own('/child.html')], 'https://evil.example/steal?token=1', 'frame-link-blocked', 'https://evil.example']
  ])('after an about:blank commit, lists %s', (_name, commits, url, type, resourceUrlOrHost) => {
    const view = makeView()
    const frame = view.createFrame()
    for (const commitUrl of commits) view.commitFrame(frame, commitUrl)

    view.failFrame(frame, ERR_BLOCKED_BY_CSP, url)

    expect(view.entries()).toEqual([{ type, resourceUrlOrHost }])
  })

  it('lists nothing for the filter’s own cancel, other codes, the main frame or the own token', () => {
    const view = makeView()
    const frame = view.createFrame()

    view.failFrame(frame, ERR_BLOCKED_BY_CLIENT, 'https://remote.example.com/')
    view.failFrame(frame, ERR_ABORTED, 'https://remote.example.com/')
    view.failFrame(frame, ERR_BLOCKED_BY_CSP, 'https://remote.example.com/', true)
    view.failFrame(frame, ERR_BLOCKED_BY_CSP, own('/child.html'))

    expect(view.entries()).toEqual([])
  })

  it('skips a frame that is already gone', () => {
    const view = makeView()
    const frame = view.createFrame()
    view.forget(frame)

    view.failFrame(frame, ERR_BLOCKED_BY_CSP, 'https://remote.example.com/')
    view.emit('did-fail-provisional-load', {}, ERR_BLOCKED_BY_CSP, 'ERR', 'https://x.example/', false, 'pid', 1)

    expect(view.entries()).toEqual([])
  })

  it("skips every frame when Electron's lookup is unavailable, and never throws", () => {
    const view = makeView({ withLookup: false })

    expect(() =>
      view.failFrame(view.createFrame(), ERR_BLOCKED_BY_CSP, 'https://remote.example.com/')
    ).not.toThrow()
    expect(view.entries()).toEqual([])
  })

  it('one frame seen by the request filter and the writer gives one entry', () => {
    const view = makeView()
    const url = 'https://remote.example.com/page'
    view.holder.committed().frameRefusals.record('frame-remote', url)

    view.failFrame(view.createFrame(), ERR_BLOCKED_BY_CSP, url)

    expect(view.entries()).toEqual([{ type: 'frame-remote', resourceUrlOrHost: url }])
  })

  it('a bad own token: every src frame is refused -30, and each is listed (WI-13)', () => {
    const view = makeView({ ownToken: 'not a token' })

    view.failFrame(view.createFrame(), ERR_BLOCKED_BY_CSP, own('/a.html'))
    view.failFrame(view.createFrame(), ERR_BLOCKED_BY_CSP, own('/b.html'))

    expect(view.entries().map((entry) => entry.type)).toEqual(['frame-escape', 'frame-escape'])
  })
})

describe('srcdoc frames (S11, answer 9)', () => {
  it('a srcdoc frame deeper than MAX_FRAME_DEPTH is shown and listed once per page', () => {
    const view = makeView()
    const parent = view.createChain(MAX_FRAME_DEPTH)

    view.startSrcdoc(view.createFrame(parent))
    view.startSrcdoc(view.createFrame(parent))

    expect(view.entries()).toEqual([{ type: 'frame-too-deep', resourceUrlOrHost: SRCDOC_TOO_DEEP_ENTRY }])
  })

  it('60 srcdoc frames are shown and listed once, with the count past the cap', () => {
    const view = makeView()
    for (let i = 0; i < 60; i += 1) {
      view.startSrcdoc(view.createFrame())
    }
    vi.advanceTimersByTime(FRAME_OVER_LIMIT_QUIET_MS * 3)

    expect(view.entries()).toEqual([
      {
        type: 'frame-over-limit',
        resourceUrlOrHost: describeFramesOverLimit(60 - MAX_FRAMES_PER_PAGE, 'srcdoc')
      }
    ])
  })

  it('ignores the main frame, same-document steps, src documents and frames already shown', () => {
    const view = makeView()
    const deep = view.createChain(MAX_FRAME_DEPTH + 1)
    view.commitFrame(deep, 'about:srcdoc')

    view.emit('did-start-navigation', { url: 'about:srcdoc', isMainFrame: true, isSameDocument: false, frame: view.main })
    view.emit('did-start-navigation', { url: 'about:srcdoc', isMainFrame: false, isSameDocument: true, frame: deep })
    view.emit('did-start-navigation', { url: own('/x.html'), isMainFrame: false, isSameDocument: false, frame: deep })
    view.startSrcdoc(null)
    view.startSrcdoc(deep)

    expect(view.entries()).toEqual([])
  })

  it('a srcdoc frame that cannot be read is logged, not listed', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const view = makeView()
    const throwing = {
      get frameTreeNodeId(): number {
        throw new Error('Render frame was disposed')
      },
      parent: view.main
    }

    view.startSrcdoc(throwing)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(view.entries()).toEqual([])
  })
})

describe('every writer goes to the page on screen (RS14, RX2-1)', () => {
  it('a move within the quiet time leaves B without an over-limit entry', () => {
    const view = makeView()
    for (let i = 1; i <= MAX_FRAMES_PER_PAGE + 10; i += 1) {
      view.navigate(view.createFrame(), own(`/f${i}.html`))
    }

    vi.advanceTimersByTime(FRAME_OVER_LIMIT_QUIET_MS - 1)
    view.holder.beginPending()
    view.holder.commit()
    vi.advanceTimersByTime(FRAME_OVER_LIMIT_QUIET_MS * 4)

    expect(view.entries()).toEqual([])
  })

  it("A's frame event during B's pending load stays out of B's badge", () => {
    const view = makeView()
    const frameOfA = view.createFrame()
    view.holder.beginPending()

    view.failFrame(frameOfA, ERR_BLOCKED_BY_CSP, 'https://remote.example.com/')
    view.navigate(view.createFrame(), 'https://other.example.com/')
    expect(view.entries()).toHaveLength(2)
    expect(view.holder.forMainDocument().failures()).toEqual([])

    view.holder.commit()
    expect(view.entries()).toEqual([])
  })

  it('a CDN refused inside a frame reaches the band through the page on screen; a framing line never does', () => {
    const view = makeView()
    const frame = view.createFrame()

    view.emit('console-message', {
      level: 'error',
      message: `Framing 'https://remote.example.com/' violates the following Content Security Policy directive: "frame-src erfana-preview://${OWN_TOKEN}". The request has been blocked.`,
      frame
    })
    expect(view.hostBlocked).not.toHaveBeenCalled()

    view.emit('console-message', {
      level: 'error',
      message: `Loading the script 'https://cdn.example.com/lib.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval' erfana-preview:". The action has been blocked.`,
      frame
    })
    expect(view.hostBlocked).toHaveBeenCalledTimes(1)
    expect(view.hostBlocked.mock.calls[0][1]).toBe('https://cdn.example.com')
  })
})

describe('dispose', () => {
  it('detaches every listener, and later events change nothing', () => {
    const view = makeView()
    const frame = view.createFrame()
    expect(view.listenerCount()).toBe(6)

    view.events.dispose()
    view.events.dispose()

    expect(view.listenerCount()).toBe(0)
    view.failFrame(frame, ERR_BLOCKED_BY_CSP, 'https://remote.example.com/')
    view.emit('did-frame-navigate', {}, own('/a.html'), 200, 'OK', false, PID, frame.routingId)
    expect(view.entries()).toEqual([])
  })
})
