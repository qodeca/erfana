// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the splitter drag-freeze controller (issue #124, part 1 §1.5).
 *
 * Real jsdom document and window, so event propagation is the browser's: a
 * bubble-phase `pointermove` listener on `document` stands in for dockview's
 * sash handler (`splitview.js`), which is exactly the listener a held move must
 * never reach. Frames and the clock are fakes the tests step by hand.
 *
 * @see previewDragFreeze.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  afterTwoFrames,
  browserFrames,
  createDragFreezeController,
  DRAG_FREEZE_LOG_MESSAGE,
  DRAG_FREEZE_LOG_REASON,
  type DragFreezeController,
  type DragFreezeDeps,
  type FrameScheduler
} from './previewDragFreeze'

const PANEL = 'preview-1'

/** Pending animation frames, run by {@link frame}. */
let queued = new Map<number, () => void>()
let nextFrameId = 1
const frames: FrameScheduler = {
  request: (callback) => {
    const id = nextFrameId++
    queued.set(id, callback)
    return id
  },
  cancel: (id) => {
    queued.delete(id)
  }
}

/** Runs every frame queued so far, once. */
function frame(): void {
  const due = [...queued.values()]
  queued = new Map()
  for (const callback of due) callback()
}

let sash: HTMLElement
let elsewhere: HTMLElement
/** Stands in for dockview: sees only the moves the freeze lets through. */
const dockview = vi.fn()
let controller: DragFreezeController | null = null

/** Builds a pointer-like event; jsdom's `MouseEvent` carries position and buttons. */
function pointerEvent(type: string, x: number, buttons: number, pointerId?: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 100, buttons })
  if (pointerId !== undefined) Object.defineProperty(event, 'pointerId', { value: pointerId })
  return event
}

const press = (target: HTMLElement = sash, x = 100, pointerId?: number): void => {
  target.dispatchEvent(pointerEvent('pointerdown', x, 1, pointerId))
}
const move = (x: number, buttons = 1, pointerId?: number): void => {
  sash.dispatchEvent(pointerEvent('pointermove', x, buttons, pointerId))
}
const up = (type = 'pointerup', pointerId?: number): void => {
  sash.dispatchEvent(pointerEvent(type, 150, 0, pointerId))
}

/** Mounts a controller over fakes; the handles let a test play main and the store. */
function setup(overrides: Partial<DragFreezeDeps> = {}) {
  let clock = 0
  let applied: ((panelId: string, visible: boolean) => void) | null = null
  let liveChanged: (() => void) | null = null
  const live = new Set([PANEL])
  const calls: string[] = []
  const deps: DragFreezeDeps = {
    document,
    window,
    now: () => clock,
    frames,
    visiblePreviewPanel: vi.fn(() => PANEL),
    isPanelLive: (panelId) => live.has(panelId),
    subscribeLive: (listener) => {
      liveChanged = listener
      return () => {
        liveChanged = null
      }
    },
    subscribeVisibilityApplied: (listener) => {
      applied = listener
      return () => {
        applied = null
      }
    },
    beginHide: vi.fn((panelId: string) => {
      calls.push(`hide:${panelId}`)
    }),
    pushBounds: vi.fn((panelId: string) => {
      calls.push(`push:${panelId}`)
    }),
    endHide: vi.fn(() => {
      calls.push('show')
    }),
    log: vi.fn(),
    ...overrides
  }
  const created = createDragFreezeController(deps)
  controller = created
  return {
    controller: created,
    deps,
    calls,
    advance: (ms: number) => {
      clock += ms
    },
    /** Main reports what it applied. */
    applied: (panelId: string, visible: boolean) => applied?.(panelId, visible),
    /** The panel's view goes away (crash, suspend, eviction). */
    loseView: (panelId: string) => {
      live.delete(panelId)
      liveChanged?.()
    },
    subscribed: () => applied !== null && liveChanged !== null
  }
}

/** Drives a drag to the point where main has confirmed the hide. */
function freeze(h: ReturnType<typeof setup>): void {
  press()
  move(110)
  h.applied(PANEL, false)
}

beforeEach(() => {
  queued = new Map()
  nextFrameId = 1
  dockview.mockClear()
  sash = document.createElement('div')
  sash.className = 'dv-sash'
  elsewhere = document.createElement('div')
  document.body.append(sash, elsewhere)
  document.addEventListener('pointermove', dockview)
})

afterEach(() => {
  controller?.dispose()
  controller = null
  document.removeEventListener('pointermove', dockview)
  sash.remove()
  elsewhere.remove()
  vi.unstubAllGlobals()
})

describe('previewDragFreeze – engaging', () => {
  it('engages only beyond the threshold, and passes the moves before it', () => {
    const h = setup()
    press()
    move(103) // 3 px: not beyond
    expect(h.deps.beginHide).not.toHaveBeenCalled()
    expect(dockview).toHaveBeenCalledTimes(1)
    expect(h.controller.phase()).toBe('armed')

    move(104)
    expect(h.deps.beginHide).toHaveBeenCalledWith(PANEL)
    expect(h.controller.phase()).toBe('holding')
  })

  it('reads the visible preview once, when the drag engages', () => {
    const h = setup()
    press()
    expect(h.deps.visiblePreviewPanel).not.toHaveBeenCalled()
    move(110)
    move(140)
    expect(h.deps.visiblePreviewPanel).toHaveBeenCalledTimes(1)
  })

  it('ignores a press that is not on a sash', () => {
    const h = setup()
    press(elsewhere)
    move(150)
    expect(h.controller.phase()).toBe('idle')
    expect(h.deps.beginHide).not.toHaveBeenCalled()
  })

  it('arms on an element inside a sash', () => {
    const inner = document.createElement('span')
    sash.append(inner)
    const h = setup()
    press(inner)
    expect(h.controller.phase()).toBe('armed')
  })

  it('registers nothing for a click with no movement', () => {
    const h = setup()
    press()
    up()
    press()
    move(102)
    up()
    expect(h.deps.beginHide).not.toHaveBeenCalled()
    expect(h.deps.endHide).not.toHaveBeenCalled()
    expect(h.controller.phase()).toBe('idle')
  })

  it('leaves the drag alone when no live preview is on screen', () => {
    const h = setup({ visiblePreviewPanel: () => null })
    press()
    move(110)
    move(150)
    expect(h.controller.phase()).toBe('passive')
    expect(h.deps.beginHide).not.toHaveBeenCalled()
    // Nothing held: the sash follows the pointer as it always did.
    expect(dockview).toHaveBeenCalledTimes(2)
    up()
    expect(h.controller.phase()).toBe('idle')
    expect(h.deps.endHide).not.toHaveBeenCalled()
  })

  it('ignores a second pointer while a drag is armed', () => {
    const h = setup()
    press(sash, 100, 1)
    move(160, 1, 2)
    up('pointerup', 2)
    expect(h.deps.beginHide).not.toHaveBeenCalled()
    expect(h.controller.phase()).toBe('armed')
    move(110, 1, 1)
    expect(h.controller.phase()).toBe('holding')
  })
})

describe('previewDragFreeze – holding until main confirms', () => {
  it('holds every move, the engaging one included, until the hide is confirmed', () => {
    const h = setup()
    press()
    move(110)
    move(120)
    expect(dockview).not.toHaveBeenCalled()

    h.applied(PANEL, false)
    expect(h.controller.phase()).toBe('frozen')
    move(130)
    // Dockview reads the absolute position, so the first move through loses no distance.
    expect(dockview).toHaveBeenCalledTimes(1)
    expect((dockview.mock.calls[0][0] as MouseEvent).clientX).toBe(130)
  })

  it('is not released by a show, or by another panel’s hide', () => {
    const h = setup()
    press()
    move(110)
    h.applied(PANEL, true)
    h.applied('preview-2', false)
    expect(h.controller.phase()).toBe('holding')
  })

  it('logs a hide confirmed more than 150 ms after the hold began, with the time', () => {
    const h = setup()
    press()
    move(110)
    h.advance(151.4)
    h.applied(PANEL, false)
    expect(h.deps.log).toHaveBeenCalledWith('info', DRAG_FREEZE_LOG_MESSAGE, {
      reason: DRAG_FREEZE_LOG_REASON.hideSlow,
      panelId: PANEL,
      elapsedMs: 151
    })
  })

  it('does not log a hide confirmed within 150 ms', () => {
    const h = setup()
    press()
    move(110)
    h.advance(150)
    h.applied(PANEL, false)
    expect(h.deps.log).not.toHaveBeenCalled()
  })

  it('stops holding at once, and logs it, when the panel loses its live view', () => {
    const h = setup()
    press()
    move(110)
    h.loseView(PANEL)
    expect(h.deps.log).toHaveBeenCalledWith('info', DRAG_FREEZE_LOG_MESSAGE, {
      reason: DRAG_FREEZE_LOG_REASON.holdAbandoned,
      panelId: PANEL
    })
    move(120)
    expect(dockview).toHaveBeenCalledTimes(1)
    // A live-store change outside a hold is nothing to act on.
    h.loseView('preview-2')
    expect(h.deps.log).toHaveBeenCalledTimes(1)
  })

  it('releases at once, and logs it, when the drag ends before the hide is confirmed', () => {
    const h = setup()
    press()
    move(110)
    up()
    expect(h.deps.log).toHaveBeenCalledWith('warn', DRAG_FREEZE_LOG_MESSAGE, {
      reason: DRAG_FREEZE_LOG_REASON.hideUnconfirmed,
      panelId: PANEL
    })
    // The layout never moved, so there is nothing to push.
    expect(h.calls).toEqual([`hide:${PANEL}`, 'show'])
    expect(h.controller.phase()).toBe('idle')
  })
})

describe('previewDragFreeze – the release', () => {
  it('waits two frames, pushes the settled bounds, then shows the page', () => {
    const h = setup()
    freeze(h)
    move(150)
    up()
    expect(h.controller.phase()).toBe('releasing')
    frame()
    expect(h.deps.endHide).not.toHaveBeenCalled()
    frame()
    expect(h.calls).toEqual([`hide:${PANEL}`, `push:${PANEL}`, 'show'])
    expect(h.controller.phase()).toBe('idle')
  })

  it.each([
    ['pointerup', () => up('pointerup')],
    ['pointercancel', () => up('pointercancel')],
    ['lostpointercapture', () => sash.dispatchEvent(new Event('lostpointercapture', { bubbles: true }))],
    ['contextmenu', () => up('contextmenu')],
    ['a window blur', () => window.dispatchEvent(new Event('blur'))],
    ['a move with no button pressed', () => move(160, 0)]
  ])('ends the drag on %s', (_name, endSignal) => {
    const h = setup()
    freeze(h)
    endSignal()
    frame()
    frame()
    expect(h.deps.endHide).toHaveBeenCalledTimes(1)
    expect(h.controller.phase()).toBe('idle')
  })

  it('ends an armed drag on a move with no button pressed', () => {
    const h = setup()
    press()
    move(101, 0)
    expect(h.controller.phase()).toBe('idle')
  })

  it('holds the buttonless move that ends an unconfirmed hold, too', () => {
    const h = setup()
    press()
    move(110)
    move(160, 0)
    expect(dockview).not.toHaveBeenCalled()
    expect(h.controller.phase()).toBe('idle')
  })

  it('finishes a pending release at once when a new drag starts on a sash', () => {
    const h = setup()
    freeze(h)
    up()
    press()
    expect(h.calls).toEqual([`hide:${PANEL}`, `push:${PANEL}`, 'show'])
    expect(h.controller.phase()).toBe('armed')
    frame()
    frame()
    expect(h.deps.endHide).toHaveBeenCalledTimes(1)
  })

  it('lets a pending release run its frames when the press is elsewhere', () => {
    const h = setup()
    freeze(h)
    up()
    press(elsewhere)
    expect(h.deps.endHide).not.toHaveBeenCalled()
    frame()
    frame()
    expect(h.deps.endHide).toHaveBeenCalledTimes(1)
  })

  it('ends a drag whose end signal was lost when the next press arrives', () => {
    const h = setup()
    press()
    move(110)
    // No `pointerup` ever came (S14); the next press on the sash ends the old drag.
    press()
    expect(h.calls).toEqual([`hide:${PANEL}`, 'show'])
    expect(h.controller.phase()).toBe('armed')
  })
})

describe('previewDragFreeze – dispose', () => {
  it('releases a registered occluder, stops listening and unsubscribes, once', () => {
    const h = setup()
    press()
    move(110)
    h.controller.dispose()
    h.controller.dispose()
    expect(h.deps.endHide).toHaveBeenCalledTimes(1)
    expect(h.subscribed()).toBe(false)

    press()
    move(150)
    expect(h.deps.beginHide).toHaveBeenCalledTimes(1)
    expect(dockview).toHaveBeenCalledTimes(1)
  })

  it('drops a pending release, still showing the page', () => {
    const h = setup()
    freeze(h)
    up()
    h.controller.dispose()
    frame()
    frame()
    expect(h.calls).toEqual([`hide:${PANEL}`, 'show'])
  })

  it('releases nothing when no drag was hiding a page', () => {
    const h = setup()
    press()
    h.controller.dispose()
    expect(h.deps.endHide).not.toHaveBeenCalled()
  })
})

describe('afterTwoFrames', () => {
  it('runs on the second frame, and a cancel before it runs stops it', () => {
    const run = vi.fn()
    afterTwoFrames(frames, run)
    frame()
    expect(run).not.toHaveBeenCalled()
    frame()
    expect(run).toHaveBeenCalledTimes(1)

    const dropped = vi.fn()
    const cancel = afterTwoFrames(frames, dropped)
    frame()
    cancel()
    frame()
    expect(dropped).not.toHaveBeenCalled()
    // Safe after the run, too.
    cancel()
  })

  it('schedules on the browser’s own frames', () => {
    const request = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 7
    })
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const run = vi.fn()

    expect(browserFrames.request(run)).toBe(7)
    browserFrames.cancel(7)

    expect(run).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith(7)
  })
})
