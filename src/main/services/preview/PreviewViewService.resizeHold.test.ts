// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The window-edge resize hold through the service (issue #124, WI-10; part 1
 * §1.5): `setResizeHold` keeps one hold per window over that window's views, a
 * settled push that reaches its view ends the hold, and the window's entry goes
 * – timers and all – with `closeWindow`. The live view is a stand-in whose
 * visibility owner is a fake target; `previewResizeHold.test.ts` drives the
 * real one. Split from `PreviewViewService.test.ts`, which is not grown. Fake
 * timers only.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

/** A stand-in live view, as the tests see it. */
interface StandInView {
  readonly panelId: string
  readonly setBounds: Mock<(...args: unknown[]) => boolean>
  readonly target: {
    hold: Mock<() => void>
    release: Mock<() => void>
    isWanted: Mock<() => boolean>
  }
}

/** Every stand-in live view built, in order. */
const views = vi.hoisted(() => [] as StandInView[])

vi.mock('../LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

vi.mock('./PreviewLiveView', () => ({
  PreviewLiveView: class {
    readonly panelId: string
    readonly projectPath: string
    readonly setBounds = vi.fn(() => true)
    readonly setZoomLevel = vi.fn()
    readonly setVisibility = vi.fn()
    readonly load = vi.fn(() => Promise.resolve())
    readonly teardown = vi.fn(() => Promise.resolve())
    readonly target = { hold: vi.fn(), release: vi.fn(), isWanted: vi.fn(() => true) }

    constructor(params: { panelId: string; projectPath: string }) {
      this.panelId = params.panelId
      this.projectPath = params.projectPath
      views.push(this as unknown as StandInView)
    }

    resizeHoldTarget(): unknown {
      return this.target
    }
  }
}))

import { logger } from '../LoggingService'
import { BOUNDS_DROP_MESSAGE } from '../../../shared/dropReporter'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import type { PreviewFailureEmit } from './PreviewFailureLog'
import { createPreviewFailureLog } from './PreviewFailureLog'
import type { PreviewSession, PreviewSessionLike, PreviewViewHandle } from './PreviewSessionFactory'
import { NO_VIEW_DROP_REASON } from './previewBoundsDropLog'
import {
  PreviewViewService,
  type PreviewViewDeps,
  type PreviewWindowLike
} from './PreviewViewService'

const SETTLE = PREVIEW_LIMITS.RESIZE_HOLD_SETTLE_TIMEOUT_MS
const IDLE = PREVIEW_LIMITS.RESIZE_HOLD_MAX_IDLE_MS
const RECT = { x: 0, y: 0, width: 400, height: 300 }

function makeWindow(id: number): PreviewWindowLike {
  return {
    id,
    isDestroyed: () => false,
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 })
  } as unknown as PreviewWindowLike
}

const WINDOW_1 = makeWindow(1)
const WINDOW_2 = makeWindow(2)

/** A built session; the stand-in view never touches it. */
function fakeSession(): PreviewSession {
  return {
    view: {
      webContents: { isDestroyed: () => false, destroy: vi.fn() }
    } as unknown as PreviewViewHandle,
    session: {} as PreviewSessionLike,
    token: 'deadbeefdeadbeefdeadbeefdeadbeef',
    realRoot: '/proj',
    partition: 'erfana-preview-test',
    teardown: vi.fn(),
    release: vi.fn(() => Promise.resolve())
  }
}

/** The service on fakes; `open` hands back the stand-in it built. */
function makeHarness(): {
  service: PreviewViewService
  resizeHold: Mock<(panelId: string, held: boolean) => void>
  open: (panelId: string, window: PreviewWindowLike) => Promise<StandInView>
} {
  const resizeHold = vi.fn<(panelId: string, held: boolean) => void>()
  // Only what the service itself reads; the stand-in view ignores the rest.
  const deps = {
    sessionFactory: { create: vi.fn(() => Promise.resolve(fakeSession())), forgetRecycled: vi.fn() },
    registry: { rebuildCsp: vi.fn(), revoke: vi.fn() },
    emit: {
      allowlistChanged: vi.fn(),
      loadStateChanged: vi.fn(),
      failuresChanged: vi.fn(),
      resizeHold
    },
    createFailureLog: (onEmit: PreviewFailureEmit) => createPreviewFailureLog({ onEmit }),
    getProjectPath: () => '/proj',
    getAllowedHosts: () => [],
    getZoomFactor: () => 1,
    now: () => Date.now()
  } as unknown as PreviewViewDeps
  const service = new PreviewViewService(deps)
  return {
    service,
    resizeHold,
    open: async (panelId, window) => {
      await expect(
        service.open({ panelId, filePath: `/proj/${panelId}.html`, bounds: RECT }, window)
      ).resolves.toEqual({ ok: true })
      return views[views.length - 1]
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  views.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PreviewViewService – the window-edge resize hold', () => {
  it('holds the shown views of the window being resized, and no other window', async () => {
    const h = makeHarness()
    const a = await h.open('preview-a', WINDOW_1)
    const b = await h.open('preview-b', WINDOW_2)

    h.service.setResizeHold(1, true)

    expect(a.target.hold).toHaveBeenCalledTimes(1)
    expect(b.target.hold).not.toHaveBeenCalled()
    expect(h.resizeHold.mock.calls).toEqual([['preview-a', true]])
  })

  it('leaves a view of that window alone while nobody sees it', async () => {
    const h = makeHarness()
    const hidden = await h.open('preview-a', WINDOW_1)
    hidden.target.isWanted.mockReturnValue(false)

    h.service.setResizeHold(1, true)

    expect(hidden.target.hold).not.toHaveBeenCalled()
    expect(h.resizeHold).not.toHaveBeenCalled()
  })

  it('still applies, and logs as usual, the pushes a hold receives', async () => {
    const h = makeHarness()
    const a = await h.open('preview-a', WINDOW_1)
    h.service.setResizeHold(1, true)

    h.service.setBounds('preview-a', RECT, 5)

    expect(a.setBounds).toHaveBeenCalledWith(RECT, 5, false)
    expect(a.target.release).not.toHaveBeenCalled()
  })

  it('a settled push that reaches its view ends the hold; one the view dropped does not', async () => {
    const h = makeHarness()
    const a = await h.open('preview-a', WINDOW_1)
    h.service.setResizeHold(1, true)
    h.service.setResizeHold(1, false)

    // Dropped by the view (a stale seq, a rect clamped to nothing).
    a.setBounds.mockReturnValueOnce(false)
    h.service.setBounds('preview-a', RECT, 5, false, true)
    expect(a.target.release).not.toHaveBeenCalled()

    h.service.setBounds('preview-a', RECT, 6, false, true)
    expect(a.target.release).toHaveBeenCalledTimes(1)
  })

  it('shows at the second timeout the bounds a plain push applied after resized', async () => {
    const h = makeHarness()
    const a = await h.open('preview-a', WINDOW_1)
    h.service.setResizeHold(1, true)
    h.service.setResizeHold(1, false)

    h.service.setBounds('preview-a', RECT, 5)
    vi.advanceTimersByTime(SETTLE)
    expect(a.target.release).not.toHaveBeenCalled()

    vi.advanceTimersByTime(SETTLE)
    expect(a.target.release).toHaveBeenCalledTimes(1)
  })

  it('a resized with no hold before it starts nothing', async () => {
    const h = makeHarness()
    await h.open('preview-a', WINDOW_1)
    const baseline = vi.getTimerCount()

    h.service.setResizeHold(1, false)

    expect(h.resizeHold).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(baseline)
  })

  it('a settled push for a panel with no view is M4, and ends nothing', () => {
    const h = makeHarness()

    h.service.setBounds('preview-x', RECT, 1, false, true)

    expect(logger.info).toHaveBeenCalledWith(
      BOUNDS_DROP_MESSAGE,
      expect.objectContaining({ reason: NO_VIEW_DROP_REASON.beforeInstall })
    )
    expect(h.resizeHold).not.toHaveBeenCalled()
  })
})

describe('PreviewViewService – the hold-map entry goes with the window', () => {
  it('closeWindow drops that window’s hold, timers and all, and leaves the other window’s', async () => {
    const h = makeHarness()
    await h.open('preview-a', WINDOW_1)
    await h.open('preview-b', WINDOW_2)
    const baseline = vi.getTimerCount()
    h.service.setResizeHold(1, true)
    h.service.setResizeHold(2, true)
    expect(vi.getTimerCount()).toBe(baseline + 2)

    await h.service.closeWindow(1)

    expect(vi.getTimerCount()).toBe(baseline + 1)
    vi.advanceTimersByTime(IDLE)
    expect(h.resizeHold.mock.calls).toEqual([
      ['preview-a', true],
      ['preview-b', true],
      ['preview-b', false]
    ])
  })

  it('closeWindow drops the hold even when no view is left to drain', async () => {
    const h = makeHarness()
    await h.open('preview-a', WINDOW_1)
    const baseline = vi.getTimerCount()
    h.service.setResizeHold(1, true)
    await h.service.close('preview-a')

    await h.service.closeWindow(1)

    expect(vi.getTimerCount()).toBe(baseline)
  })

  it('dispose drops every window’s hold', async () => {
    const h = makeHarness()
    await h.open('preview-a', WINDOW_1)
    const baseline = vi.getTimerCount()
    h.service.setResizeHold(1, true)

    await h.service.dispose()
    vi.advanceTimersByTime(IDLE * 2)

    expect(vi.getTimerCount()).toBe(baseline)
    expect(h.resizeHold.mock.calls).toEqual([['preview-a', true]])
  })
})
