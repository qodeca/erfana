// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Splitter drag freeze, renderer half (issue #124, part 1 §1.5; user answers 4
 * and 6; UX spec §4).
 *
 * The native preview view paints above all DOM, so a splitter drag that moves
 * the layout faster than the bounds loop follows it would draw the page over
 * the toolbar, the tree or the terminal for a frame. During a drag the page is
 * therefore hidden and its still picture shown:
 *
 * | Moment | What happens |
 * |---|---|
 * | `pointerdown` on `.dv-sash` | armed; nothing visible |
 * | first move beyond the threshold | if a live preview is on screen: hide it through the overlay guard (the `drag` occluder) and HOLD further moves until main confirms the hide |
 * | hide confirmed | moves flow again; dockview lays out while the view is hidden |
 * | the drag ends | two animation frames, a fresh bounds push, then the occluder goes and the guard shows the page at the settled rect |
 *
 * Holding works because dockview listens for `pointermove` on `document`
 * (`splitview.js`), and a capture-phase listener on `window` runs first: its
 * `stopImmediatePropagation` keeps the move from dockview. Dockview reads the
 * ABSOLUTE pointer position, so a held move loses no distance – the next one
 * that passes puts the sash where the pointer is.
 *
 * Pure: document, window, clock, animation frames, the store reads and the
 * logger are all injected, so every edge is testable without a layout.
 * `useSplitterDragFreeze` mounts the one production instance.
 *
 * @module services/preview/previewDragFreeze
 * @see docs/design/design-issue-124-part1.md §1.5
 */

import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'

/** A splitter handle, in every dockview splitview and gridview. */
export const SASH_SELECTOR = '.dv-sash'

/** The one message every drag-freeze line carries; the reason tells them apart. */
export const DRAG_FREEZE_LOG_MESSAGE = 'Preview drag freeze'

/**
 * Why a drag-freeze line was written (part 1 §1.5). Fixed ids, so one log
 * search finds them all.
 */
export const DRAG_FREEZE_LOG_REASON = {
  /** The drag ended before main confirmed the hide. The layout never moved (moves were held). */
  hideUnconfirmed: 'drag-hide-unconfirmed',
  /** The panel lost its live view (crash, suspend, eviction, close) while moves were held. */
  holdAbandoned: 'drag-hold-abandoned',
  /** The hide was confirmed later than `PREVIEW_LIMITS.DRAG_HOLD_SLOW_LOG_MS` after the hold began. */
  hideSlow: 'drag-hide-slow'
} as const

/** One of {@link DRAG_FREEZE_LOG_REASON}. */
export type DragFreezeLogReason = (typeof DRAG_FREEZE_LOG_REASON)[keyof typeof DRAG_FREEZE_LOG_REASON]

/**
 * Where the controller is in a drag.
 *
 * - `idle` – no pointer down on a sash.
 * - `armed` – pointer down on a sash, not yet moved past the threshold.
 * - `passive` – moved, but no live preview was on screen: the drag runs untouched.
 * - `holding` – the page is being hidden; moves are held until main confirms.
 * - `frozen` – the page is hidden (or the hold was abandoned); moves flow.
 * - `releasing` – the drag ended; waiting two frames before the page returns.
 */
export type DragFreezePhase = 'idle' | 'armed' | 'passive' | 'holding' | 'frozen' | 'releasing'

/** The animation-frame pair the controller schedules with. */
export interface FrameScheduler {
  /** Runs `callback` before the next repaint; returns an id for {@link cancel}. */
  request: (callback: () => void) => number
  /** Drops a frame requested with {@link request}. */
  cancel: (id: number) => void
}

/**
 * The browser's own animation frames, read at call time so a test that stubs
 * the globals is honoured.
 */
export const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(() => callback()),
  cancel: (id) => cancelAnimationFrame(id)
}

/**
 * Runs `run` two animation frames from now.
 *
 * Two, not one: the first frame is the one dockview's last layout lands in, the
 * second is the first one measured after it – the same margin the design gives
 * both the splitter release and the window-edge settled push.
 *
 * @param frames - The frame scheduler
 * @param run - What to do on the second frame
 * @returns Cancels the pending run; safe to call after it ran
 *
 * @example
 * ```ts
 * const cancel = afterTwoFrames(browserFrames, () => pushBounds({ settled: true }))
 * // a newer event supersedes it:
 * cancel()
 * ```
 */
export function afterTwoFrames(frames: FrameScheduler, run: () => void): () => void {
  let pending: number | null = frames.request(() => {
    pending = frames.request(() => {
      pending = null
      run()
    })
  })
  return () => {
    if (pending !== null) frames.cancel(pending)
    pending = null
  }
}

/** Everything the controller needs from the outside world. */
export interface DragFreezeDeps {
  /** Hears the sash's `pointerdown` and the end signals, in the capture phase. */
  document: EventTarget
  /** Holds moves (capture phase, ahead of dockview's `document` listener) and hears `blur`. */
  window: EventTarget
  /** A monotonic clock in milliseconds, for the slow-hide line. */
  now: () => number
  /** Animation frames for the two-frame release. */
  frames: FrameScheduler
  /**
   * The panel whose live preview is on screen now, or `null` – an inactive tab,
   * an open host list, a dialog, or a collapsed panel (C2) all count as none.
   * Read once, when the drag passes the threshold.
   */
  visiblePreviewPanel: () => string | null
  /** Whether the panel still has a live view. `false` while holding abandons the hold. */
  isPanelLive: (panelId: string) => boolean
  /** Notified after anything {@link isPanelLive} reads may have changed. */
  subscribeLive: (listener: () => void) => () => void
  /** Main's report of what it did with a view (`preview:visibilityApplied`). */
  subscribeVisibilityApplied: (listener: (panelId: string, visible: boolean) => void) => () => void
  /**
   * Hide the panel's page for the drag, synchronously: latch the still picture
   * or backdrop, then register the `drag` occluder the overlay guard obeys.
   */
  beginHide: (panelId: string) => void
  /** Push the panel's current bounds, even when unchanged. */
  pushBounds: (panelId: string) => void
  /** Release the `drag` occluder; the guard shows the page again. */
  endHide: () => void
  /** Writes one drag-freeze line. */
  log: (level: 'info' | 'warn', message: string, fields: Record<string, unknown>) => void
  /** Pointer travel before the freeze engages (CSS px). Default: `PREVIEW_LIMITS.DRAG_FREEZE_MOVE_THRESHOLD_PX`. */
  thresholdPx?: number
  /** A hide confirmed later than this is logged (ms). Default: `PREVIEW_LIMITS.DRAG_HOLD_SLOW_LOG_MS`. */
  slowHoldMs?: number
}

/** The running controller. */
export interface DragFreezeController {
  /** @returns Where the controller is in a drag. */
  phase: () => DragFreezePhase
  /**
   * Detaches every listener and subscription and drops a pending release. A
   * registered occluder is released, so nothing stays hidden. Idempotent.
   */
  dispose: () => void
}

/** The pointer fields the controller reads; a `PointerEvent` satisfies it. */
interface PointerLike {
  readonly clientX: number
  readonly clientY: number
  readonly buttons: number
  readonly pointerId?: number
  readonly target: EventTarget | null
}

/**
 * Whether an event target sits on a splitter handle.
 *
 * @param target - The event's target
 * @returns `true` for the sash itself or anything inside it
 */
function isOnSash(target: EventTarget | null): boolean {
  const el = target as Partial<Element> | null
  return typeof el?.closest === 'function' && el.closest(SASH_SELECTOR) !== null
}

/** Capture phase: the controller must see each event before dockview does. */
const CAPTURE: AddEventListenerOptions = { capture: true }

/** End signals heard on `document`. `contextmenu` mirrors dockview's own end set. */
const DOCUMENT_END_EVENTS = ['pointerup', 'pointercancel', 'lostpointercapture', 'contextmenu'] as const

/**
 * Builds the splitter drag-freeze controller and starts listening for sash
 * presses.
 *
 * The drag ends on the FIRST of `pointerup`, `pointercancel`,
 * `lostpointercapture`, `contextmenu`, a window `blur`, or a `pointermove` with
 * no button pressed. The last three matter when the native view swallows the
 * pointer mid-drag and Erfana never hears the `pointerup` (spike S14).
 *
 * @param deps - Document, window, clock, frames, the store reads and the logger
 * @returns The controller; call {@link DragFreezeController.dispose} on unmount
 *
 * @example
 * ```ts
 * const controller = createDragFreezeController({
 *   document, window, now: () => performance.now(), frames: browserFrames,
 *   visiblePreviewPanel, isPanelLive, subscribeLive, subscribeVisibilityApplied,
 *   beginHide, pushBounds, endHide, log
 * })
 * // later
 * controller.dispose()
 * ```
 */
export function createDragFreezeController(deps: DragFreezeDeps): DragFreezeController {
  const threshold = deps.thresholdPx ?? PREVIEW_LIMITS.DRAG_FREEZE_MOVE_THRESHOLD_PX
  const slowHoldMs = deps.slowHoldMs ?? PREVIEW_LIMITS.DRAG_HOLD_SLOW_LOG_MS

  let phase: DragFreezePhase = 'idle'
  let startX = 0
  let startY = 0
  let pointerId: number | undefined
  /** The panel whose page this drag hid; set from `holding` to the release. */
  let panelId: string | null = null
  let holdStartedAt = 0
  let cancelRelease: (() => void) | null = null
  let listening = false
  let disposed = false

  const log = (level: 'info' | 'warn', reason: DragFreezeLogReason, extra: Record<string, unknown> = {}): void => {
    deps.log(level, DRAG_FREEZE_LOG_MESSAGE, { reason, panelId, ...extra })
  }

  // A second touch or pen contact must not end or drive this drag.
  const isDragPointer = (event: PointerLike): boolean =>
    pointerId === undefined || event.pointerId === undefined || event.pointerId === pointerId

  const reset = (): void => {
    phase = 'idle'
    panelId = null
    pointerId = undefined
    listen(false)
  }

  /** Brings the page back: the occluder goes, and the guard shows it. */
  const releaseNow = (): void => {
    deps.endHide()
    reset()
  }

  /** A release still waiting for its frames finishes at once. */
  const finishRelease = (): void => {
    if (cancelRelease === null) return
    cancelRelease()
    cancelRelease = null
    if (panelId !== null) deps.pushBounds(panelId)
    releaseNow()
  }

  const engage = (): void => {
    const target = deps.visiblePreviewPanel()
    if (target === null) {
      // Nothing on screen to cover: the drag runs exactly as it always did.
      phase = 'passive'
      return
    }
    panelId = target
    holdStartedAt = deps.now()
    phase = 'holding'
    deps.beginHide(target)
  }

  const end = (): void => {
    switch (phase) {
      case 'armed':
      case 'passive':
        // A click, or a drag with no preview on screen: nothing to undo.
        reset()
        return
      case 'holding':
        // Moves were held, so the layout never moved: release at once. The
        // strict rule (never overlap) wins over a smooth drag.
        log('warn', DRAG_FREEZE_LOG_REASON.hideUnconfirmed)
        releaseNow()
        return
      case 'frozen': {
        phase = 'releasing'
        listen(false)
        const target = panelId
        cancelRelease = afterTwoFrames(deps.frames, () => {
          cancelRelease = null
          // The rect goes out BEFORE the show, so main re-adds the view at the
          // settled layout rather than where it last was.
          if (target !== null) deps.pushBounds(target)
          releaseNow()
        })
        return
      }
      default:
        return
    }
  }

  const onPointerDown = (event: Event): void => {
    const pointer = event as unknown as PointerLike
    // A press means the last drag is over, whatever end signal was lost – so a
    // lost `pointerup` can never leave the occluder registered.
    if (phase !== 'idle' && phase !== 'releasing') end()
    if (!isOnSash(pointer.target)) return
    // A new drag within the previous one's two frames: that release finishes
    // now, so this drag starts from a page the guard shows again.
    finishRelease()
    phase = 'armed'
    startX = pointer.clientX
    startY = pointer.clientY
    pointerId = pointer.pointerId
    listen(true)
  }

  const onPointerMove = (event: Event): void => {
    const pointer = event as unknown as PointerLike
    if (!isDragPointer(pointer)) return
    if (
      phase === 'armed' &&
      pointer.buttons !== 0 &&
      Math.hypot(pointer.clientX - startX, pointer.clientY - startY) > threshold
    ) {
      engage()
    }
    // Held moves never reach dockview: the layout must not move while the page
    // may still be drawn. The move that engaged the hold is held too.
    if (phase === 'holding') event.stopImmediatePropagation()
    // No button pressed: the `pointerup` went somewhere else (S14).
    if (pointer.buttons === 0) end()
  }

  const onPointerEnd = (event: Event): void => {
    if (event.type !== 'contextmenu' && !isDragPointer(event as unknown as PointerLike)) return
    end()
  }

  function listen(on: boolean): void {
    if (on === listening) return
    listening = on
    const method = on ? 'addEventListener' : 'removeEventListener'
    deps.window[method]('pointermove', onPointerMove, CAPTURE)
    deps.window[method]('blur', end)
    for (const type of DOCUMENT_END_EVENTS) deps.document[method](type, onPointerEnd, CAPTURE)
  }

  const unsubscribeApplied = deps.subscribeVisibilityApplied((appliedPanelId, visible) => {
    // Only the hide this drag asked for ends the hold. A `true` here is a show
    // main applied before our hide reached it.
    if (phase !== 'holding' || appliedPanelId !== panelId || visible) return
    const elapsedMs = deps.now() - holdStartedAt
    // Measured on arrival, so no timer runs while a hold is fast.
    if (elapsedMs > slowHoldMs) log('info', DRAG_FREEZE_LOG_REASON.hideSlow, { elapsedMs: Math.round(elapsedMs) })
    phase = 'frozen'
  })

  const unsubscribeLive = deps.subscribeLive(() => {
    if (phase !== 'holding' || panelId === null || deps.isPanelLive(panelId)) return
    // Nothing is left to cover, and no confirmation will come: stop holding at
    // once. The occluder stays until the drag ends, like any frozen drag.
    log('info', DRAG_FREEZE_LOG_REASON.holdAbandoned)
    phase = 'frozen'
  })

  deps.document.addEventListener('pointerdown', onPointerDown, CAPTURE)

  return {
    phase: () => phase,
    dispose: () => {
      if (disposed) return
      disposed = true
      deps.document.removeEventListener('pointerdown', onPointerDown, CAPTURE)
      unsubscribeApplied()
      unsubscribeLive()
      cancelRelease?.()
      cancelRelease = null
      const hidden = phase === 'holding' || phase === 'frozen' || phase === 'releasing'
      reset()
      // MUST release, or every preview stays hidden with no drag left to end.
      if (hidden) deps.endHide()
    }
  }
}
