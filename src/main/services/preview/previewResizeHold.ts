// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The window-edge resize hold of one window (issue #124, WI-10; answers 4 and
 * 6, part 1 §1.5).
 *
 * While a person drags a window edge, the host repaints at the new size before
 * the renderer's bounds push reaches a native preview view, so for the whole
 * drag the page can sit over Erfana's own toolbar. The hold hides every shown
 * view of the window for the drag, and shows each one again only at a layout
 * measured after the drag ended.
 *
 * - `resizing()` – every `will-resize`. A shown view that is not held yet is
 *   hidden (`hold()`: no `visibilityApplied`, the cached still published) and
 *   `resizeHold {held: true}` is emitted. Every call restarts the idle
 *   maximum, which ends a hold whose `resized` never comes as if it had.
 * - `resized()` – the drag ended. Each held view is asked for its settled
 *   layout (`resizeHold {held: false}`) and waits for it.
 * - `settled(panelId)` – the forced push answering the ask reached the view.
 *   Its settle timer is cleared first, then the hold ends.
 * - A settle timeout logs M9 and asks again. From the second one on, a view
 *   whose bounds were applied after `resized` is shown at them; a view with
 *   none is asked again at every timeout. No view is shown at bounds that
 *   predate the drag's end.
 *
 * ONE RELEASE (RX2-4, RA3-2). The settled push, the second timeout and the
 * idle maximum all end a view's hold through its visibility owner's
 * `release()` – called here and nowhere else – which reads the LATEST wanted
 * state: a view whose panel was covered during the hold (a dialog, a menu)
 * stays hidden. The renderer hears `visibilityApplied` either way.
 *
 * Holds no Electron object. The app entry turns the window's `will-resize` and
 * `resized` into `setResizeHold` calls, which the service hands to
 * {@link createResizeHoldRegistry}: one hold per window, dropped when the
 * window closes.
 */

import type { DropReporter } from '../../../shared/dropReporter'
import type { PreviewEmitters } from '../../../shared/ipc/preview-types'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { RESIZE_HOLD_DROP_REASON, createMainDropReporter } from './previewBoundsDropLog'
import type { PreviewLiveVisibility } from './previewLiveVisibility'

/** The slice of one view's visibility owner the hold drives. */
export type PreviewResizeHoldTarget = Pick<PreviewLiveVisibility, 'hold' | 'release' | 'isWanted'>

/** One live view of the window. */
export interface PreviewResizeHoldView {
  readonly panelId: string
  /** Compared by identity: a panel whose view was replaced mid-hold has a new target. */
  readonly target: PreviewResizeHoldTarget
}

/** What the hold of one window needs. */
export interface PreviewWindowResizeHoldDeps {
  /** The window's live views, asked afresh at every step. */
  readonly views: () => readonly PreviewResizeHoldView[]
  readonly emit: Pick<PreviewEmitters, 'resizeHold'>
  /** Milliseconds, for M9's rate cap. */
  readonly now: () => number
}

/** The window-edge resize hold of one window. */
export interface PreviewWindowResizeHold {
  /** `will-resize`: hold every shown view not held yet, and restart the idle maximum. */
  resizing(): void
  /** `resized`, or the idle maximum: ask every held view for its settled layout. */
  resized(): void
  /** A bounds push reached `panelId`'s view. */
  boundsApplied(panelId: string): void
  /** The settled push reached `panelId`'s view: clear its settle timer, then release it. */
  settled(panelId: string): void
  /** Drop every hold and timer, emitting nothing: the window is closing. */
  dispose(): void
}

/** One held view. */
interface PanelHold {
  readonly target: PreviewResizeHoldTarget
  /** M9's scope: this view's hold, so the ask-again loop logs once per window of the cap. */
  readonly drops: DropReporter
  /** Bounds reached the view after the drag ended. */
  boundsSinceResized: boolean
  /** Settle timeouts since the drag ended. */
  timeouts: number
  timer: ReturnType<typeof setTimeout> | undefined
}

/** The settle timeout from which bounds applied after `resized` are shown; the first only asks again. */
const SHOW_FROM_TIMEOUT = 2

/** Create the resize hold of one window. */
export function createWindowResizeHold(deps: PreviewWindowResizeHoldDeps): PreviewWindowResizeHold {
  const holds = new Map<string, PanelHold>()
  /** The drag has ended, and the held views wait for their settled layout. */
  let settling = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const announce = (panelId: string, held: boolean): void => deps.emit.resizeHold?.(panelId, held)

  function stopTimer(hold: PanelHold): void {
    clearTimeout(hold.timer)
    hold.timer = undefined
  }

  /** Forget a hold without releasing it. */
  function forget(panelId: string, hold: PanelHold): void {
    stopTimer(hold)
    holds.delete(panelId)
    if (holds.size === 0) settling = false
  }

  /** Whether `hold`'s view is still the panel's live view. */
  function isLive(panelId: string, hold: PanelHold, views = deps.views()): boolean {
    return views.some((view) => view.panelId === panelId && view.target === hold.target)
  }

  /** Forget the holds whose view went away: there is nothing left to show or ask about. */
  function prune(views: readonly PreviewResizeHoldView[]): void {
    for (const [panelId, hold] of holds) {
      if (!isLive(panelId, hold, views)) forget(panelId, hold)
    }
  }

  function resizing(): void {
    const views = deps.views()
    prune(views)
    for (const { panelId, target } of views) {
      const hold = holds.get(panelId)
      if (hold !== undefined) {
        // The edge moves again before the layout settled: back to holding, and
        // the renderer's forced push for the earlier end no longer counts.
        if (settling) {
          stopTimer(hold)
          announce(panelId, true)
        }
      } else if (target.isWanted()) {
        target.hold()
        holds.set(panelId, {
          target,
          drops: createMainDropReporter({ now: deps.now }),
          boundsSinceResized: false,
          timeouts: 0,
          timer: undefined
        })
        announce(panelId, true)
      }
    }
    settling = false
    clearTimeout(idleTimer)
    idleTimer =
      holds.size > 0 ? setTimeout(resized, PREVIEW_LIMITS.RESIZE_HOLD_MAX_IDLE_MS) : undefined
  }

  function resized(): void {
    clearTimeout(idleTimer)
    idleTimer = undefined
    if (settling) return
    prune(deps.views())
    if (holds.size === 0) return
    settling = true
    for (const [panelId, hold] of holds) {
      hold.boundsSinceResized = false
      hold.timeouts = 0
      ask(panelId, hold)
    }
  }

  /** Ask the renderer for the view's settled layout, and wait for it. */
  function ask(panelId: string, hold: PanelHold): void {
    announce(panelId, false)
    hold.timer = setTimeout(
      () => onSettleTimeout(panelId, hold),
      PREVIEW_LIMITS.RESIZE_HOLD_SETTLE_TIMEOUT_MS
    )
  }

  function onSettleTimeout(panelId: string, hold: PanelHold): void {
    hold.timer = undefined
    if (!isLive(panelId, hold)) {
      forget(panelId, hold)
      return
    }
    hold.timeouts += 1
    // A settled layout that sends nothing is still shown – but only at bounds
    // measured after the drag ended.
    if (hold.timeouts >= SHOW_FROM_TIMEOUT && hold.boundsSinceResized) {
      release(panelId, hold)
      return
    }
    hold.drops.report({ reason: RESIZE_HOLD_DROP_REASON.noSettledPush, level: 'warn', panelId })
    ask(panelId, hold)
  }

  /** The one way a hold ends: the view's own release reads what is wanted now. */
  function release(panelId: string, hold: PanelHold): void {
    forget(panelId, hold)
    hold.target.release()
  }

  function boundsApplied(panelId: string): void {
    const hold = holds.get(panelId)
    if (hold !== undefined && settling) hold.boundsSinceResized = true
  }

  function settled(panelId: string): void {
    const hold = holds.get(panelId)
    // Only an answer to the ask counts: a forced push that lands while the
    // edge still moves would show the page mid-drag.
    if (hold === undefined || !settling) return
    // The timer first (RA3-2): a push that beat it must not also log M9 and ask again.
    stopTimer(hold)
    if (!isLive(panelId, hold)) {
      forget(panelId, hold)
      return
    }
    release(panelId, hold)
  }

  function dispose(): void {
    clearTimeout(idleTimer)
    idleTimer = undefined
    for (const hold of holds.values()) stopTimer(hold)
    holds.clear()
    settling = false
  }

  return { resizing, resized, boundsApplied, settled, dispose }
}

/** What the per-window registry needs. */
export interface PreviewResizeHoldRegistryDeps {
  /** A window's live views, asked afresh at every step. */
  readonly views: (windowId: number) => readonly PreviewResizeHoldView[]
  readonly emit: Pick<PreviewEmitters, 'resizeHold'>
  /** Milliseconds, for M9's rate cap. */
  readonly now: () => number
}

/** Every window's resize hold, keyed by window id (issue #124, QG-6 A4). */
export interface PreviewResizeHoldRegistry {
  /** `will-resize` (`held` true) or `resized` (`held` false) for `windowId`. */
  set(windowId: number, held: boolean): void
  /** Bounds reached `panelId`'s view in `windowId`; `settled` when they answer the ask. */
  boundsApplied(windowId: number, panelId: string, settled: boolean): void
  /** The window is closing: drop its hold, timers and all. */
  closeWindow(windowId: number): void
  /** Drop every window's hold. */
  dispose(): void
}

/** Create the registry of every window's resize hold. */
export function createResizeHoldRegistry(
  deps: PreviewResizeHoldRegistryDeps
): PreviewResizeHoldRegistry {
  const holds = new Map<number, PreviewWindowResizeHold>()

  function set(windowId: number, held: boolean): void {
    let hold = holds.get(windowId)
    if (hold === undefined) {
      // A `resized` with no `will-resize` before it (a programmatic resize) ends nothing.
      if (!held) return
      hold = createWindowResizeHold({
        views: () => deps.views(windowId),
        emit: deps.emit,
        now: deps.now
      })
      holds.set(windowId, hold)
    }
    if (held) hold.resizing()
    else hold.resized()
  }

  function boundsApplied(windowId: number, panelId: string, settled: boolean): void {
    const hold = holds.get(windowId)
    hold?.boundsApplied(panelId)
    if (settled) hold?.settled(panelId)
  }

  function closeWindow(windowId: number): void {
    holds.get(windowId)?.dispose()
    holds.delete(windowId)
  }

  function dispose(): void {
    for (const hold of holds.values()) hold.dispose()
    holds.clear()
  }

  return { set, boundsApplied, closeWindow, dispose }
}
