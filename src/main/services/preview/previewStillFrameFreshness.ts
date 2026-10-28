// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One preview's input watch (issue #124). It has two outputs: whether the
 * cached still picture still shows the page (WI-10; RU3, part 1 §1.5), and the
 * gesture clock of the tab's history (QG-7 S1, QG-8 T1).
 *
 * **Still-picture staleness.** During a splitter or window-edge drag the
 * renderer shows the still picture in place of the hidden page – unless it is
 * stale, in which case the page's plain background is shown instead
 * (answer 6). "Stale" means REAL input reached the page after the capture: a
 * scroll, a key, a click, a touch. A pointer merely crossing the page on its
 * way to a splitter changes nothing the page shows, so it leaves the picture
 * fresh – otherwise every drag started across the preview would blank. A
 * stale-making type marks the cached frame stale and restarts an idle timer;
 * when the timer runs out the frame is refreshed through
 * `captureWhileVisible()`, which captures only while the view is drawn and
 * keeps its settle barrier and in-flight skip.
 *
 * **The history's gesture clock.** The same listener keeps the time of the
 * last USER GESTURE – a press, a key, the end of a touch – and owns the rule
 * that reads it: `takeRecentGesture()` is true when that gesture arrived within
 * `PREVIEW_LIMITS.HISTORY_GESTURE_WINDOW_MS`, and never on a clock that ran
 * backwards. The gesture is SPENT by the first read, whatever the answer – an
 * in-page step being recorded, or a same-tab move or history step landing – so
 * one real input buys at most one history entry: a page that waits for a click
 * and then loops `location.hash` replaces the entry it is on instead of filling
 * and evicting the list (T1). It lives here
 * because this listener already hears every input type on `input-event`;
 * `before-input-event` sees keys only.
 *
 * The handler checks the type, sets a flag and resets one timer, so the input
 * volume costs next to nothing.
 *
 * @see src/main/services/preview/previewPageNavigator.ts – the one reader of the gesture clock
 */

import { PREVIEW_LIMITS } from '../../../shared/preview-limits'

/**
 * The `input-event` types that change what the page shows (Electron's
 * `InputEvent.type`, `electron.d.ts`). Every other type – `mouseMove`,
 * `mouseEnter`, `mouseLeave`, `pointerMove`, `pointerRawUpdate`,
 * `contextMenu`, the tap gestures, `keyUp` – leaves the picture fresh.
 */
export const STILL_FRAME_STALE_INPUT_TYPES: ReadonlySet<string> = new Set([
  // Wheel and scroll gestures
  'mouseWheel',
  'gestureScrollBegin',
  'gestureScrollUpdate',
  'gestureScrollEnd',
  'gestureFlingStart',
  'gestureFlingCancel',
  'gesturePinchBegin',
  'gesturePinchUpdate',
  'gesturePinchEnd',
  // Keys
  'rawKeyDown',
  'keyDown',
  'char',
  // Clicks
  'mouseDown',
  'mouseUp',
  // Touch
  'touchStart',
  'touchMove',
  'touchEnd',
  'touchCancel'
])

/**
 * The `input-event` types that are a user gesture for tab history (QG-7 S1):
 * the ones HTML counts as activation-triggering input – a mouse press, a key
 * press, the end of a touch. A wheel, a scroll, a pinch or a pointer move is
 * none, so a scroll spy that sets `location.hash` while the reader scrolls
 * takes the current entry's place instead of pushing one.
 */
export const HISTORY_GESTURE_INPUT_TYPES: ReadonlySet<string> = new Set([
  'mouseDown',
  'rawKeyDown',
  'keyDown',
  'touchEnd'
])

/** Whether an `input-event` type makes the cached still picture stale. */
export function marksStillFrameStale(type: unknown): boolean {
  return typeof type === 'string' && STILL_FRAME_STALE_INPUT_TYPES.has(type)
}

/** The `input-event` listener shape this module attaches. */
type InputEventListener = (event: unknown, input: { type?: unknown }) => void

/** The slice of a preview `WebContents` this module listens to. */
export interface PreviewInputEventSource {
  on(event: 'input-event', listener: InputEventListener): void
  removeListener(event: 'input-event', listener: InputEventListener): void
}

/** What the input watch needs from the view it serves. */
export interface PreviewStillFrameFreshnessDeps {
  /** The previewed page. */
  readonly contents: PreviewInputEventSource
  /** Mark this view's cached frame stale. */
  readonly markStale: () => void
  /** Refresh the frame; captures only while the view is drawn. */
  readonly refresh: () => void
  /** The clock a gesture's time is read from (`Date.now` in production). */
  readonly now: () => number
}

/** A running input watch. */
export interface PreviewStillFrameFreshness {
  /**
   * Whether a user gesture reached the page within
   * `PREVIEW_LIMITS.HISTORY_GESTURE_WINDOW_MS` of `now()` – never when the
   * clock ran backwards. Spends the gesture: until new input arrives, every
   * later call is false.
   */
  takeRecentGesture(): boolean
  /** Stop listening and drop a pending refresh. */
  dispose(): void
}

/** Watch one preview's input: stale on real input, refreshed after a pause; the gesture clock. */
export function attachStillFrameFreshness(
  deps: PreviewStillFrameFreshnessDeps
): PreviewStillFrameFreshness {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastGesture: number | null = null

  const onInput: InputEventListener = (_event, input) => {
    const type = input?.type
    if (typeof type === 'string' && HISTORY_GESTURE_INPUT_TYPES.has(type)) {
      lastGesture = deps.now()
    }
    if (!marksStillFrameStale(type)) return
    deps.markStale()
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      deps.refresh()
    }, PREVIEW_LIMITS.STILL_FRAME_IDLE_REFRESH_MS)
  }

  deps.contents.on('input-event', onInput)
  return {
    takeRecentGesture(): boolean {
      const at = lastGesture
      // Spent on every read: a gesture that did not count now – too old, or
      // "ahead" of a clock that jumped back – must not count once the clock
      // catches up with it either.
      lastGesture = null
      if (at === null) {
        return false
      }
      const elapsed = deps.now() - at
      return elapsed >= 0 && elapsed <= PREVIEW_LIMITS.HISTORY_GESTURE_WINDOW_MS
    },
    dispose(): void {
      clearTimeout(timer)
      timer = undefined
      deps.contents.removeListener('input-event', onInput)
    }
  }
}
