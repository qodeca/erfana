// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewBounds hook (Issue #74, work item 71).
 *
 * Keeps the native `WebContentsView` aligned with the panel's DOM placeholder.
 * A `ResizeObserver` on the placeholder, a window-resize listener, a per-frame
 * measure loop that runs while the tab is visible and live, and an imperative
 * {@link UsePreviewBoundsResult.pushBounds} feed the placeholder's
 * `getBoundingClientRect()` through `deriveBounds` and send it with
 * `window.api.preview.setBounds`.
 *
 * The loop, the observer and the resize listener share one compare-and-send
 * (issue #124, part 1 §1.4): a rect goes out only when it differs from the last
 * one measured, so a still panel sends nothing and a moving one at most one
 * message per frame. It catches the moves the observer cannot see (C1): a panel
 * that slides without resizing, and dockview's layout landing a frame after the
 * window `resize` event measured the old one.
 *
 * The same measurement clips the rect by every clipping ancestor (C2). An empty
 * visible area is never sent; once a rect has gone out, it raises the panel's
 * collapsed flag, which the overlay guard reads to hide the page.
 *
 * Throttling and the zoom→DIP conversion happen downstream (the preload bridge
 * and main coalesce per animation frame — design §4.3), so this hook just emits
 * a monotonically-increasing `seq` on every geometry change; main drops any
 * `seq` at or below the last it applied.
 *
 * Every place this hook throws an update away reports it through one rate-capped
 * drop reporter per mount (issue #124, P1-AC1), so a page left over Erfana's own
 * chrome leaves a trail naming the step that dropped the update.
 *
 * @module usePreviewBounds
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { deriveBounds, needsBoundsAck, type RectLike } from '../htmlPreview.logic'
import { visibleArea } from '../previewClip'
import { usePreviewViewportStore } from '../../../../stores/usePreviewViewportStore'
import { usePreviewCollapsedStore } from '../../../../stores/usePreviewCollapsedStore'
import { logger } from '../../../../utils/logger'
import {
  createDropReporter,
  type DropLevel,
  type DropLogEntry,
  type DropRect
} from '../../../../../../shared/dropReporter'
import type { PreviewBounds } from '../../../../../../shared/ipc/preview-types'

/**
 * CSS pixels reserved at the top of the native view while the find bar is open
 * (UX-002). Covers the floating search bar's top offset (`--space-4`, 8px) plus
 * its box (`--space-2` padding × 2 + `--input-height-sm`, ≈ 36px) with a small
 * margin, so the bar sits in a DOM strip the `WebContentsView` never paints over
 * while native `findInPage` highlights stay visible in the shorter view.
 */
export const SEARCH_BAR_INSET_PX = 48

/**
 * The drop points of this hook (issue #124, part 1 §1.2; R-numbers are the
 * design's). Fixed ids, never page-derived, so one log search finds them all.
 */
export const PREVIEW_BOUNDS_DROP_REASON = {
  /** R1 – `enabled` is false: the panel is refused or has no view to size. */
  disabled: 'disabled',
  /** R2 – no placeholder element is mounted. */
  noPlaceholder: 'no-placeholder',
  /**
   * R3 – the placeholder measured an empty rect: an inactive tab, a panel not
   * yet laid out, or a find inset taller than the box. Also covers what R6 (the
   * retired first-rect pump's spent budget) used to report.
   */
  degenerateRect: 'degenerate-rect',
  /**
   * R7 – the placeholder has a valid rect, but a clipping ancestor leaves none of
   * it visible (C2: the terminal expanded over the editor). Logged once per
   * change of the measured rect, never per frame.
   */
  clippedAway: 'clipped-away'
} as const

/** One of {@link PREVIEW_BOUNDS_DROP_REASON}. */
export type PreviewBoundsDropReason =
  (typeof PREVIEW_BOUNDS_DROP_REASON)[keyof typeof PREVIEW_BOUNDS_DROP_REASON]

/**
 * Hands a reporter line to the renderer logger, which forwards it over
 * `logging:log`; the reporter's rate cap therefore also bounds that IPC.
 *
 * @param entry - The line the drop reporter decided to emit
 */
function writeDropLine({ level, message, context }: DropLogEntry): void {
  // Spread: the logger takes a plain record, and the context stays structured.
  const fields = { ...context }
  if (level === 'error') logger.error(message, undefined, fields)
  else logger[level](message, fields)
}

/**
 * What one look at the placeholder found.
 *
 * `key` identifies the measurement, so the loop can tell "nothing changed" with
 * one comparison and do no work at all while the panel is still.
 */
type Measurement =
  | { readonly kind: 'no-placeholder'; readonly key: string }
  | { readonly kind: 'degenerate' | 'clipped'; readonly key: string; readonly rect: RectLike }
  | { readonly kind: 'visible'; readonly key: string; readonly rect: RectLike; readonly bounds: PreviewBounds }

/**
 * Measures the placeholder: its rect, the bounds that rect gives after the find
 * inset, and whether any of those bounds survive the clipping ancestors.
 *
 * @param el - The placeholder, or `null` when none is mounted
 * @param topInset - CSS pixels reserved at the top for the find bar
 * @returns The measurement; only `visible` carries bounds worth sending
 */
function measurePlaceholder(el: HTMLElement | null, topInset: number): Measurement {
  if (!el) return { kind: 'no-placeholder', key: 'no-placeholder' }
  const { left, top, width, height } = el.getBoundingClientRect()
  const rect = { left, top, width, height }
  const where = `${left},${top},${width},${height}/${topInset}`
  const bounds = deriveBounds(rect, topInset)
  if (!bounds) return { kind: 'degenerate', key: `degenerate:${where}`, rect }
  // The bounds, not the raw rect: the find-bar strip is DOM, never the page, so
  // only the part the view would cover decides whether anything is visible.
  const area = { left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }
  if (visibleArea(el, area) === null) return { kind: 'clipped', key: `clipped:${where}`, rect }
  return { kind: 'visible', key: `visible:${where}`, rect, bounds }
}

/**
 * The measured rect in the drop reporter's shape.
 *
 * @param rect - The placeholder's rect
 * @returns The same rect as `{x, y, width, height}`
 */
function toDropRect({ left, top, width, height }: RectLike): DropRect {
  return { x: left, y: top, width, height }
}

/** Options for {@link usePreviewBounds}. */
export interface UsePreviewBoundsOptions {
  /** Ref to the sized placeholder element the native view tracks. */
  placeholderRef: React.RefObject<HTMLElement>
  /** The preview panel id (identifies the native view main-side). */
  panelId: string
  /**
   * Whether bounds should be pushed. `false` while the panel is refused
   * (limit-reached) or otherwise has no live view, so no stray rect is sent.
   */
  enabled: boolean
  /**
   * Whether this panel is the visible tab. Only a visible tab has a laid-out
   * box, so this is one of the two things that arm the measure loop.
   */
  isVisible: boolean
  /**
   * Whether main has a live `WebContentsView` for this panel (the store's load
   * state has left `'idle'`). Main DROPS a `setBounds` for a panel it has no
   * view for, so the loop starts again – with a push – once the view exists.
   */
  isLive: boolean
  /**
   * Whether the find bar is open. When `true` the native view is inset from the
   * top by {@link SEARCH_BAR_INSET_PX} so the bar is not occluded (UX-002).
   */
  searchOpen: boolean
  /**
   * The panel root, used to measure how far down the page area starts.
   *
   * Optional so existing callers and tests need no change: without it the
   * effective inset falls back to the placeholder's own top, which makes every
   * push look like it needs no proof — the pre-fail-safe behaviour.
   */
  panelRef?: React.RefObject<HTMLElement>
  /**
   * Records what was pushed so the fail-safe can decide whether Erfana may draw
   * controls in the space just claimed. Absent ⇒ no proof is ever requested.
   */
  ackController?: {
    provenInset: () => number
    recordPush: (seq: number, topInset: number, ackRequested: boolean) => void
  }
}

/** Result of {@link usePreviewBounds}. */
export interface UsePreviewBoundsResult {
  /**
   * Recomputes and sends the placeholder rect immediately – a forced push, sent
   * even when the rect is unchanged.
   *
   * @param options - `settled: true` marks the push answering main's
   *   `resizeHold {held: false}`; main ends the hold on it (issue #124, §1.5).
   * @returns `true` when a rect was sent, `false` when the placeholder is
   * missing, disabled, degenerate or clipped away.
   */
  pushBounds: (options?: { settled?: boolean }) => boolean
}

/**
 * Wires geometry updates from the placeholder to the native preview view.
 *
 * The collapsed flag it may raise is cleared again on the way back (after a
 * forced push), when the view stops being live, and on unmount; a tab switch
 * keeps it, so a panel re-activated while still collapsed never flashes a
 * stale strip before its first measurement.
 *
 * @param options - Placeholder ref, panel id, enablement, visibility, liveness and find-bar state.
 * @returns An imperative {@link UsePreviewBoundsResult.pushBounds}.
 *
 * @example
 * ```tsx
 * const placeholderRef = useRef<HTMLDivElement>(null)
 * const { pushBounds } = usePreviewBounds({
 *   placeholderRef, panelId, enabled: true, isVisible, isLive, searchOpen
 * })
 * ```
 */
export function usePreviewBounds(options: UsePreviewBoundsOptions): UsePreviewBoundsResult {
  const { placeholderRef, panelId, enabled, isVisible, isLive, searchOpen, panelRef, ackController } =
    options

  // Monotonic sequence so main can drop out-of-order sends (design §4.3). A ref,
  // not state — bumping it must never trigger a render.
  const seqRef = useRef(0)

  // Keep the props readable from the stable callbacks without re-creating them.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const searchOpenRef = useRef(searchOpen)
  searchOpenRef.current = searchOpen
  const isVisibleRef = useRef(isVisible)
  isVisibleRef.current = isVisible
  const isLiveRef = useRef(isLive)
  isLiveRef.current = isLive
  const ackControllerRef = useRef(ackController)
  ackControllerRef.current = ackController
  const panelTopRef = useRef(panelRef?.current ?? null)
  panelTopRef.current = panelRef?.current ?? null

  // The key of the last measurement acted on; see `sync`.
  const lastKeyRef = useRef<string | null>(null)
  // Whether a rect has gone out since the view became live. Before that, an
  // empty area is simply not sent: an opening preview must never flap
  // hide/show while dockview is still placing it.
  const sentSinceLiveRef = useRef(false)

  // One reporter per mount is one scope (part 1 §1.2): its first drop of each
  // reason is always logged, so a remount starts a fresh trail.
  const [drops] = useState(() =>
    createDropReporter({ source: 'renderer', now: () => performance.now(), emit: writeDropLine })
  )

  const reportDrop = useCallback(
    (reason: PreviewBoundsDropReason, level: DropLevel, rect?: DropRect): void => {
      // A dropped update never spends a `seq` (only a send does), so the line
      // carries the last one sent – the number main's own drop lines compare to.
      const lastSeq = seqRef.current > 0 ? seqRef.current - 1 : undefined
      drops.report({ reason, level, panelId, lastSeq, rect })
    },
    [drops, panelId]
  )

  const send = useCallback(
    (bounds: PreviewBounds, rect: RectLike, settled: boolean): void => {
      /*
       * The inset that matters for the fail-safe is the distance from the PANEL's
       * top edge to the view's top edge — not the find-bar inset, the only one
       * applied here now that the chrome band is subtracted by layout. When the
       * band grows, that inset does not change at all; the placeholder moves down.
       */
      const panelTop = panelTopRef.current?.getBoundingClientRect().top ?? rect.top
      const effectiveInset = bounds.y - panelTop

      const ack = ackControllerRef.current
      const needsAck = ack !== undefined && needsBoundsAck(effectiveInset, ack.provenInset())
      // Three arguments, not four-with-undefined, when no option is wanted: the
      // steady-state push stays byte-identical to what it always was; `ack` rides
      // only on pushes that reveal chrome, `settled` only on a hold's answer.
      if (needsAck || settled) {
        const options = { ...(needsAck ? { ack: true } : {}), ...(settled ? { settled: true } : {}) }
        window.api.preview.setBounds(panelId, bounds, seqRef.current, options)
      } else {
        window.api.preview.setBounds(panelId, bounds, seqRef.current)
      }
      ack?.recordPush(seqRef.current, effectiveInset, needsAck)
      seqRef.current += 1
      // A send before the view exists is dropped main-side, so it does not arm
      // the collapsed flag.
      if (isLiveRef.current) sentSinceLiveRef.current = true
      // Publish where the native view sits so Erfana's own chrome can place itself
      // beside it instead of hiding it (the toast stack does this). Deliberately
      // NOT keyed on whether the view is currently visible: occlusion is the
      // overlay guard's OUTPUT and the toast's placement is one of its inputs, so
      // keying on visibility would oscillate every frame.
      usePreviewViewportStore.getState().setRect(panelId, {
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height
      })
    },
    [panelId]
  )

  /**
   * An empty area – nothing of the page would be visible. Never sent: the rect is
   * withdrawn (keyed on geometry, not on the guard's output, so it cannot loop
   * with the toast occluder) and, once a rect has gone out to this live view,
   * the collapsed flag hides the page through the overlay guard.
   *
   * Only while the tab is visible: an inactive tab is already hidden by the
   * guard, and its 0×0 box says nothing about where the page would be.
   */
  const collapse = useCallback((): void => {
    usePreviewViewportStore.getState().clearRect(panelId)
    if (!isVisibleRef.current || !isLiveRef.current || !sentSinceLiveRef.current) return
    usePreviewCollapsedStore.getState().setCollapsed(panelId)
  }, [panelId])

  /**
   * Measures the placeholder and acts on the result.
   *
   * @param force - Act even when the measurement equals the last one: the first
   *   measurement of a loop run, the find-bar toggle and {@link pushBounds}.
   *   Otherwise (the loop, the observer, the window `resize`) an unchanged
   *   measurement does nothing at all – no send, no log – which is what keeps a
   *   still panel silent and a moving one at one message per frame.
   * @param settled - Mark the send as the answer to a resize hold's end.
   * @returns `true` when a rect was sent
   */
  const sync = useCallback(
    (force: boolean, settled = false): boolean => {
      if (!enabledRef.current) {
        reportDrop(PREVIEW_BOUNDS_DROP_REASON.disabled, 'info')
        return false
      }
      // ONLY the find bar. The chrome strip above the page area used to be added
      // here as a second constant, PREVIEW_CHROME_INSET_PX, duplicating the
      // `height` in HtmlPreviewPanel.css with nothing but comments keeping the two
      // in step. The strip is now a flow sibling ABOVE `.html-preview-page-area`,
      // so the placeholder's own box already excludes it — at whatever height it
      // happens to be, which is what lets the permission band grow when its list
      // opens without a single number changing here.
      //
      // The find bar keeps its inset because it is still an overlay INSIDE the page
      // area, not a sibling above it.
      const topInset = searchOpenRef.current ? SEARCH_BAR_INSET_PX : 0
      const measured = measurePlaceholder(placeholderRef.current, topInset)
      const collapsedStore = usePreviewCollapsedStore.getState()
      // A flag still set with an unchanged visible measurement would otherwise
      // never be cleared; the check keeps the way back open whatever set it.
      const returning = measured.kind === 'visible' && collapsedStore.isCollapsed(panelId)
      if (!force && !returning && measured.key === lastKeyRef.current) return false
      lastKeyRef.current = measured.key

      switch (measured.kind) {
        case 'no-placeholder':
          // No placeholder means no box on screen for this panel. Returning without
          // clearing left a rect published for a view that is not there — Erfana's
          // own chrome then placed itself around a rectangle nothing occupies.
          usePreviewViewportStore.getState().clearRect(panelId)
          reportDrop(PREVIEW_BOUNDS_DROP_REASON.noPlaceholder, 'info')
          return false
        case 'degenerate':
          // The measured rect, not the inset one: it shows which of the causes
          // (no box, not laid out, inset taller than the box) this was.
          reportDrop(PREVIEW_BOUNDS_DROP_REASON.degenerateRect, 'info', toDropRect(measured.rect))
          collapse()
          return false
        case 'clipped':
          reportDrop(PREVIEW_BOUNDS_DROP_REASON.clippedAway, 'info', toDropRect(measured.rect))
          collapse()
          return false
        case 'visible':
          // The way back: the push goes out FIRST, then the flag clears and the
          // guard shows the page – already at its new rect. Both are plain
          // `ipcRenderer.send` calls and main applies bounds synchronously, so
          // the order holds main-side. A partly clipped placeholder lands here
          // too and is sent whole (never reproduced; the centre's minimum width
          // keeps the group from overflowing it).
          send(measured.bounds, measured.rect, settled)
          if (returning) collapsedStore.clearCollapsed(panelId)
          return true
      }
    },
    [panelId, placeholderRef, reportDrop, send, collapse]
  )

  const pushBounds = useCallback(
    (options?: { settled?: boolean }): boolean => sync(true, options?.settled === true),
    [sync]
  )
  const syncIfChanged = useCallback((): void => {
    sync(false)
  }, [sync])

  // Track size changes on the placeholder and the viewport for the whole mount,
  // visible or not — a background tab must already be the right size when it is
  // activated.
  useEffect(() => {
    if (!enabled) return
    const el = placeholderRef.current
    if (!el) return

    const observer = new ResizeObserver(syncIfChanged)
    observer.observe(el)
    window.addEventListener('resize', syncIfChanged)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncIfChanged)
    }
  }, [enabled, placeholderRef, syncIfChanged])

  // A panel that is not the visible tab, has no view, or is unmounting has no
  // rectangle on screen. Leaving a stale one behind would push the toast around
  // a view that is not there.
  useEffect(() => {
    if (enabled && isVisible && isLive) return
    usePreviewViewportStore.getState().clearRect(panelId)
  }, [enabled, isVisible, isLive, panelId])

  // A view that is no longer live is gone main-side; the next one starts with no
  // rect sent and nothing collapsed. Declared BEFORE the loop, so on the way
  // back to live the reset runs first and the loop's opening push counts.
  useEffect(() => {
    if (isLive) return
    sentSinceLiveRef.current = false
    usePreviewCollapsedStore.getState().clearCollapsed(panelId)
  }, [isLive, panelId])

  useEffect(
    () => () => {
      usePreviewViewportStore.getState().clearRect(panelId)
      // MUST clear, or the page stays hidden with no hook left to bring it back.
      usePreviewCollapsedStore.getState().clearCollapsed(panelId)
    },
    [panelId]
  )

  // The measure loop (C1): while the tab is visible and the view live, measure
  // every animation frame and send only on a change.
  //
  // It also makes a freshly opened preview appear at once (#74 follow-up).
  // `openFileInPanel` calls `addPanel` and only then `setActive`, so the hook's
  // first run is while the panel is still an inactive tab with a 0×0 box, and
  // dockview re-parents an `always`-rendered panel rather than resizing it in
  // place, so the 0×0 → laid-out transition need not produce an observer
  // callback at all. The loop simply sees the first real rect on the frame it
  // lands. It never gives up, but a still panel costs one measurement per frame
  // and sends nothing.
  //
  // The first measurement of every run is forced: main may have a brand-new view
  // with no rect at all (`isLive` just turned true), or the tab was just
  // activated and its view last placed elsewhere.
  useEffect(() => {
    if (!enabled || !isVisible || !isLive) return

    // A flag, not only `cancelAnimationFrame`: a frame already dequeued by the
    // browser still runs after cleanup and would otherwise re-arm the loop.
    let running = true
    let frame: number | null = null
    const tick = (): void => {
      if (!running) return
      sync(false)
      frame = requestAnimationFrame(tick)
    }
    sync(true)
    frame = requestAnimationFrame(tick)

    return () => {
      running = false
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [enabled, isVisible, isLive, sync])

  // Re-push when the find bar opens or closes so the top inset is applied or
  // released immediately, without waiting for the loop's next frame.
  //
  // Only on a real TOGGLE. The mount run is already covered by the loop's forced
  // first measurement, and firing here as well sent the same rect twice for
  // every preview opened.
  const sawFirstSearchState = useRef(false)
  useEffect(() => {
    if (!sawFirstSearchState.current) {
      sawFirstSearchState.current = true
      return
    }
    pushBounds()
  }, [searchOpen, pushBounds])

  return { pushBounds }
}
