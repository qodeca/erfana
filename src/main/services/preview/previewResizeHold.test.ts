// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The window-edge resize hold (issue #124, WI-10; part 1 §1.5): the state
 * machine in `previewResizeHold.ts` driving REAL visibility owners
 * (`previewLiveVisibility.ts`) over fake native views, windows and emitters.
 * Fake timers only.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

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

import { logger } from '../LoggingService'
import { BOUNDS_DROP_MESSAGE } from '../../../shared/dropReporter'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import type { PreviewStillFrame } from '../../../shared/ipc/preview-types'
import { RESIZE_HOLD_DROP_REASON } from './previewBoundsDropLog'
import { createPreviewLiveVisibility, type PreviewLiveVisibility } from './previewLiveVisibility'
import {
  createWindowResizeHold,
  type PreviewResizeHoldView,
  type PreviewWindowResizeHold
} from './previewResizeHold'
import type { PreviewViewHandle } from './PreviewSessionFactory'

const SETTLE = PREVIEW_LIMITS.RESIZE_HOLD_SETTLE_TIMEOUT_MS
const IDLE = PREVIEW_LIMITS.RESIZE_HOLD_MAX_IDLE_MS
const PANEL = 'preview-a'
const FRAME: PreviewStillFrame = {
  dataUrl: 'data:image/png;base64,AAAA',
  width: 4,
  height: 4,
  capturedAt: 1,
  cssWidth: 640,
  cssHeight: 480,
  stale: true
}
/** The context of an M9 line for {@link PANEL}. */
const M9 = { source: 'main', reason: RESIZE_HOLD_DROP_REASON.noSettledPush, panelId: stablePathDigest(PANEL) }

/** The emitter the visibility owners and the hold both write to. */
interface Emit {
  visibilityApplied: Mock<(panelId: string, visible: boolean) => void>
  stillFrameChanged: Mock<(panelId: string, frame: PreviewStillFrame) => void>
  resizeHold: Mock<(panelId: string, held: boolean) => void>
}

function makeEmit(): Emit {
  return { visibilityApplied: vi.fn(), stillFrameChanged: vi.fn(), resizeHold: vi.fn() }
}

/** One live view: a real visibility owner over a fake native view. */
interface FakeView extends PreviewResizeHoldView {
  readonly visibility: PreviewLiveVisibility
  readonly setVisible: Mock<(visible: boolean) => void>
  readonly setBounds: Mock<(bounds: unknown) => void>
  readonly addChildView: Mock<(view: unknown) => void>
  readonly captureIfStale: Mock<(...args: unknown[]) => Promise<void>>
  setDefunct(value: boolean): void
}

function makeView(emit: Emit, panelId = PANEL): FakeView {
  let defunct = false
  const setVisible = vi.fn<(visible: boolean) => void>()
  const setBounds = vi.fn<(bounds: unknown) => void>()
  const addChildView = vi.fn<(view: unknown) => void>()
  const captureIfStale = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve())
  const visibility = createPreviewLiveVisibility({
    panelId,
    view: { setVisible, setBounds, setBackgroundColor: vi.fn() } as unknown as PreviewViewHandle,
    window: { isDestroyed: () => false, contentView: { addChildView, removeChildView: vi.fn() } },
    contents: { capturePage: vi.fn() },
    emit,
    stillFrameCache: { get: () => FRAME, captureIfStale },
    lastRect: () => ({ x: 10, y: 20, width: 800, height: 600 }),
    lastCssSize: () => ({ width: 640, height: 480 }),
    isDefunct: () => defunct
  })
  return {
    panelId,
    target: visibility,
    visibility,
    setVisible,
    setBounds,
    addChildView,
    captureIfStale,
    setDefunct: (value) => {
      defunct = value
    }
  }
}

function makeHold(views: FakeView[], emit: Emit): PreviewWindowResizeHold {
  return createWindowResizeHold({ views: () => views, emit, now: () => Date.now() })
}

/** One emitter, one shown view and its window's hold. */
function setup(): { emit: Emit; view: FakeView; views: FakeView[]; hold: PreviewWindowResizeHold } {
  const emit = makeEmit()
  const view = makeView(emit)
  const views = [view]
  return { emit, view, views, hold: makeHold(views, emit) }
}

/** The context of every M9 line written so far. */
function m9Lines(): unknown[] {
  return vi
    .mocked(logger.warn)
    .mock.calls.filter(([message]) => message === BOUNDS_DROP_MESSAGE)
    .map(([, context]) => context)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('previewResizeHold – while the edge moves', () => {
  it('hides a shown view with no visibility report, and publishes its cached still', () => {
    const emit = makeEmit()
    const shown = makeView(emit)
    const hidden = makeView(emit, 'preview-b')
    hidden.visibility.set(false)
    vi.clearAllMocks()

    makeHold([shown, hidden], emit).resizing()

    expect(shown.setVisible.mock.calls).toEqual([[false]])
    expect(emit.stillFrameChanged).toHaveBeenCalledWith(PANEL, FRAME)
    expect(emit.visibilityApplied).not.toHaveBeenCalled()
    expect(emit.resizeHold.mock.calls).toEqual([[PANEL, true]])
    // A view nobody sees is left alone.
    expect(hidden.setVisible).not.toHaveBeenCalled()
  })

  it('announces a hold once, however many will-resize events the drag fires', () => {
    const { emit, view, hold } = setup()

    hold.resizing()
    hold.resizing()
    hold.resizing()

    expect(emit.resizeHold).toHaveBeenCalledTimes(1)
    expect(view.setVisible).toHaveBeenCalledTimes(1)
  })

  it('holds a view shown mid-drag at the next will-resize', () => {
    const { emit, view, hold } = setup()
    view.visibility.set(false)
    hold.resizing()
    expect(emit.resizeHold).not.toHaveBeenCalled()

    view.visibility.set(true)
    hold.resizing()

    expect(emit.resizeHold.mock.calls).toEqual([[PANEL, true]])
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('ignores a settled push while the edge still moves', () => {
    const { emit, view, hold } = setup()
    hold.resizing()

    hold.settled(PANEL)

    expect(view.setVisible).not.toHaveBeenCalledWith(true)
    expect(emit.visibilityApplied).not.toHaveBeenCalled()
  })

  it('captures nothing while held, and keeps no frame a hold interrupted', () => {
    const { view, hold } = setup()
    view.visibility.captureWhileVisible()
    const options = view.captureIfStale.mock.calls[0][3] as {
      shouldKeep: () => boolean
      cssSize: unknown
    }
    expect(options.cssSize).toEqual({ width: 640, height: 480 })
    expect(options.shouldKeep()).toBe(true)

    hold.resizing()

    expect(options.shouldKeep()).toBe(false)
    view.visibility.captureWhileVisible()
    expect(view.captureIfStale).toHaveBeenCalledTimes(1)
  })
})

describe('previewResizeHold – ending a hold', () => {
  it('a settled push shows the view, topmost, and reports it', () => {
    const { emit, view, hold } = setup()
    hold.resizing()
    hold.resized()
    expect(emit.resizeHold.mock.calls).toEqual([
      [PANEL, true],
      [PANEL, false]
    ])

    hold.settled(PANEL)

    expect(view.addChildView).toHaveBeenCalledTimes(1)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(emit.visibilityApplied.mock.calls).toEqual([[PANEL, true]])
  })

  it('a settled push clears the settle timer: no M9 and no second held: false', () => {
    const { emit, hold } = setup()
    hold.resizing()
    hold.resized()
    vi.advanceTimersByTime(SETTLE - 1)

    hold.settled(PANEL)
    vi.advanceTimersByTime(IDLE * 2)

    expect(m9Lines()).toEqual([])
    expect(emit.resizeHold.mock.calls).toEqual([
      [PANEL, true],
      [PANEL, false]
    ])
    expect(emit.visibilityApplied).toHaveBeenCalledTimes(1)
  })

  it('records a show asked for during the hold, and applies it at the release', () => {
    const { emit, view, hold } = setup()
    hold.resizing()

    view.visibility.set(false)
    view.visibility.set(true)

    expect(view.setVisible.mock.calls).toEqual([[false]])
    expect(emit.visibilityApplied).not.toHaveBeenCalled()
    hold.resized()
    hold.settled(PANEL)
    expect(emit.visibilityApplied.mock.calls).toEqual([[PANEL, true]])
  })

  it('an occluder raised mid-hold stays covered after the release', () => {
    const { emit, view, hold } = setup()
    hold.resizing()
    // A dialog opens over the panel while the edge moves.
    view.visibility.set(false)

    hold.resized()
    hold.settled(PANEL)

    expect(view.addChildView).not.toHaveBeenCalled()
    expect(view.setVisible).not.toHaveBeenCalledWith(true)
    expect(emit.visibilityApplied.mock.calls).toEqual([[PANEL, false]])
  })

  it('the second timeout shows the view at the last bounds applied after resized', () => {
    const { emit, view, hold } = setup()
    hold.resizing()
    hold.resized()
    // The settled layout, pushed without the forced flag.
    hold.boundsApplied(PANEL)

    vi.advanceTimersByTime(SETTLE)
    // The first timeout only asks again.
    expect(emit.resizeHold.mock.calls).toEqual([
      [PANEL, true],
      [PANEL, false],
      [PANEL, false]
    ])
    expect(m9Lines()).toEqual([M9])
    expect(emit.visibilityApplied).not.toHaveBeenCalled()

    vi.advanceTimersByTime(SETTLE)
    expect(emit.visibilityApplied.mock.calls).toEqual([[PANEL, true]])
    // Shown where the bounds module put it: the hold moves nothing.
    expect(view.setBounds).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SETTLE * 4)
    expect(emit.resizeHold).toHaveBeenCalledTimes(3)
  })

  it('never shows a view at bounds from before resized: it asks again at every timeout, M9 through the reporter', () => {
    const { emit, hold } = setup()
    hold.resizing()
    // Applied mid-drag: it predates the drag's end.
    hold.boundsApplied(PANEL)
    hold.resized()

    vi.advanceTimersByTime(SETTLE * 4)

    expect(emit.visibilityApplied).not.toHaveBeenCalled()
    // `resized` and each of the four timeouts ask.
    expect(emit.resizeHold.mock.calls.filter(([, held]) => !held)).toHaveLength(5)
    // One line per rate window, not one per timeout.
    expect(m9Lines()).toEqual([M9])

    vi.advanceTimersByTime(PREVIEW_LIMITS.BOUNDS_DROP_LOG_WINDOW_MS)
    expect(m9Lines()).toEqual([M9, { ...M9, suppressed: 9 }])

    // A push at last ends it.
    hold.settled(PANEL)
    expect(emit.visibilityApplied.mock.calls).toEqual([[PANEL, true]])
  })

  it('the idle maximum ends a hold that never hears resized; every will-resize restarts it', () => {
    const { emit, hold } = setup()
    hold.resizing()
    vi.advanceTimersByTime(IDLE - 1)
    hold.resizing()
    vi.advanceTimersByTime(IDLE - 1)
    expect(emit.resizeHold.mock.calls).toEqual([[PANEL, true]])

    vi.advanceTimersByTime(1)
    expect(emit.resizeHold.mock.calls).toEqual([
      [PANEL, true],
      [PANEL, false]
    ])

    hold.settled(PANEL)
    expect(emit.visibilityApplied.mock.calls).toEqual([[PANEL, true]])
  })

  const RELEASE_PATHS: Record<string, (hold: PreviewWindowResizeHold) => void> = {
    'the settled push': (hold) => {
      hold.resized()
      hold.settled(PANEL)
    },
    'the second timeout': (hold) => {
      hold.resized()
      hold.boundsApplied(PANEL)
      vi.advanceTimersByTime(SETTLE * 2)
    },
    'the idle maximum': (hold) => {
      vi.advanceTimersByTime(IDLE)
      hold.settled(PANEL)
    }
  }

  it.each(
    Object.keys(RELEASE_PATHS).flatMap((path) => [
      { path, wanted: true },
      { path, wanted: false }
    ])
  )('$path ends it through one release() at the latest wanted state ($wanted)', ({ path, wanted }) => {
    const { emit, view, hold } = setup()
    const release = vi.spyOn(view.visibility, 'release')
    hold.resizing()
    if (!wanted) view.visibility.set(false)

    RELEASE_PATHS[path](hold)

    expect(release).toHaveBeenCalledTimes(1)
    expect(emit.visibilityApplied.mock.calls).toEqual([[PANEL, wanted]])
    expect(view.setVisible).toHaveBeenLastCalledWith(wanted)
  })
})

describe('previewResizeHold – views that go away, and the window closing', () => {
  it('forgets a view that goes away mid-hold: nothing is shown or asked for', () => {
    const { emit, views, hold } = setup()
    hold.resizing()

    views.length = 0
    hold.resized()
    vi.advanceTimersByTime(IDLE * 2)

    expect(emit.resizeHold.mock.calls).toEqual([[PANEL, true]])
    expect(m9Lines()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drops the hold of a view replaced mid-hold at its next timeout, and ignores a late push', () => {
    const { emit, view, views, hold } = setup()
    const release = vi.spyOn(view.visibility, 'release')
    hold.resizing()
    hold.resized()

    // The panel's view was rebuilt: same panel, new visibility owner.
    views[0] = makeView(emit)
    vi.advanceTimersByTime(SETTLE)
    hold.settled(PANEL)

    expect(m9Lines()).toEqual([])
    expect(release).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a settled push for a view replaced mid-hold releases nothing', () => {
    const { emit, view, views, hold } = setup()
    const release = vi.spyOn(view.visibility, 'release')
    hold.resizing()
    hold.resized()

    views[0] = makeView(emit)
    hold.settled(PANEL)

    expect(release).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases a view that went defunct mid-hold without a word', () => {
    const { emit, view, hold } = setup()
    hold.resizing()
    view.setDefunct(true)

    hold.resized()
    hold.settled(PANEL)

    expect(view.setVisible).not.toHaveBeenCalledWith(true)
    expect(emit.visibilityApplied).not.toHaveBeenCalled()
  })

  it('a new will-resize before the layout settled goes back to holding', () => {
    const { emit, hold } = setup()
    hold.resizing()
    hold.resized()

    hold.resizing()
    expect(emit.resizeHold.mock.calls).toEqual([
      [PANEL, true],
      [PANEL, false],
      [PANEL, true]
    ])
    // The answer to the earlier end arrives too late to count, and its settle
    // timer went with the new drag.
    hold.settled(PANEL)
    vi.advanceTimersByTime(SETTLE)
    expect(m9Lines()).toEqual([])
    expect(emit.visibilityApplied).not.toHaveBeenCalled()

    hold.resized()
    hold.settled(PANEL)
    expect(emit.visibilityApplied.mock.calls).toEqual([[PANEL, true]])
  })

  it('resized with nothing held, or said twice, does nothing more', () => {
    const { emit, view, hold } = setup()
    hold.resized()
    expect(emit.resizeHold).not.toHaveBeenCalled()

    view.visibility.set(false)
    hold.resizing()
    expect(vi.getTimerCount()).toBe(0)

    view.visibility.set(true)
    hold.resizing()
    hold.resized()
    hold.resized()
    expect(emit.resizeHold.mock.calls).toEqual([
      [PANEL, true],
      [PANEL, false]
    ])
  })

  it('dispose drops every hold and timer, emitting nothing', () => {
    const { emit, hold } = setup()
    hold.resizing()
    hold.resized()

    hold.dispose()
    vi.advanceTimersByTime(IDLE * 2)

    expect(vi.getTimerCount()).toBe(0)
    expect(emit.resizeHold.mock.calls).toEqual([
      [PANEL, true],
      [PANEL, false]
    ])
    expect(emit.visibilityApplied).not.toHaveBeenCalled()
  })
})

describe('previewResizeHold – the one caller of release() (RA3-2)', () => {
  const HERE = fileURLToPath(new URL('.', import.meta.url))
  const MAIN_ROOT = join(HERE, '..', '..')

  it('no other main module ends a resize hold, and the state machine ends one in one place', () => {
    const offenders = (readdirSync(MAIN_ROOT, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.ts') && !file.includes('.test.'))
      .filter((file) => file !== join('services', 'preview', 'previewResizeHold.ts'))
      .filter((file) =>
        /\bvisibility\s*\??\.\s*release\s*\(|resizeHoldTarget\(\)\s*\??\.\s*(?:release|hold)\s*\(/.test(
          readFileSync(join(MAIN_ROOT, file), 'utf8')
        )
      )
    expect(offenders).toEqual([])

    const own = readFileSync(join(HERE, 'previewResizeHold.ts'), 'utf8')
    expect(own.match(/\.release\(\)/g)).toHaveLength(1)
  })
})
