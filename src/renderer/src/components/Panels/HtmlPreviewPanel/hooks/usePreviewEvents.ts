// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewEvents hook (Issue #74, work item 71).
 *
 * Bridges the main→renderer preview event stream into {@link usePreviewStore}
 * for one preview panel. Several previews can be live at once, and each panel
 * mounts its own copy of this hook: the panel is the natural owner of its
 * subscriptions, because it is mounted for exactly its preview's lifetime and
 * unmount tears them down.
 *
 * The stream is shared and carries every live panel's events, each tagged with
 * its own `panelId`, so every handler guards on `payload.panelId` before
 * writing the store.
 *
 * `preview:pageChanged` (issue #124, part 3 §3.4) is the one event that writes
 * outside the stores: the page a tab shows lives in dockview's
 * `params.filePath`, so a move is written there with `updateParameters`, and
 * the title, tooltip, close label, lookup and crash recovery all follow it.
 *
 * `preview:resizeHold` and `preview:visibilityApplied` feed the drag freeze
 * (issue #124, part 1 §1.5): a window-edge hold sets `resizeHeld` and the drag
 * latch, main's release clears them, and every `held: false` is answered two
 * frames later with the panel's settled bounds.
 *
 * @module usePreviewEvents
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import { useEffect, useRef } from 'react'
import type { DockviewPanelApi } from 'dockview'

import type { PreviewPageChangedPayload } from '../../../../../../shared/ipc/preview-navigation-schema'
import { usePreviewStore } from '../../../../stores/usePreviewStore'
import { usePreviewTabStore } from '../../../../stores/usePreviewTabStore'
import { afterTwoFrames, browserFrames } from '../../../../services/preview/previewDragFreeze'

/** Options for {@link usePreviewEvents}: where a page change is written. */
export interface UsePreviewEventsOptions {
  /**
   * The panel's dockview api. A `pageChanged` naming another file writes
   * `params.filePath` through it. Without it a page change still updates the
   * stores, but the tab keeps naming the old page.
   */
  api?: Pick<DockviewPanelApi, 'updateParameters'>
  /** The page the tab shows now (`params.filePath`); compared, never re-sent. */
  filePath?: string
  /**
   * The tab moved to another DOCUMENT: the find bar's matches and the band's
   * host list belonged to the old page, so the panel closes the one and
   * collapses the other (UX spec §1.6). Not called for a `#section` step.
   */
  onLeavePage?: () => void
  /** Every `pageChanged` for this panel, after the stores and params are written. */
  onPageChanged?: (payload: PreviewPageChangedPayload) => void
  /**
   * Sends the panel's bounds as main's settled push – forced, even when the
   * rect is unchanged – answering a window-edge hold's `held: false`. Without
   * it, main shows the view only at its second settle timeout.
   */
  pushSettledBounds?: () => void
}

/**
 * Subscribes preview load-state, failure-log, still-frame and blocked-host
 * events into the store for `panelId`, unsubscribing on unmount or panel change.
 *
 * The blocked-host stream (Issue #74, UX-001) raises a toast that names the
 * exact host: an **approve** action toast when `approvable`, otherwise a plain
 * informational toast. Approving just calls `preview.approveHost` — main
 * rebuilds the CSP, purges storage and reloads the view (`applyApprovedHosts`),
 * so the renderer does nothing further (design §5(c)).
 *
 * A page change (issue #124) writes main's Back and Forward state to the tab
 * store, resets the per-page slice of the preview store when the tab moved to
 * another DOCUMENT (a `#section` step keeps it), and writes the new file into
 * `params.filePath`. A move to another document also closes the find bar and
 * collapses the host list (`onLeavePage`), and every page change is passed on
 * (`onPageChanged`) – the panel speaks a landed move from there.
 *
 * A window-edge resize hold (issue #124) sets `resizeHeld` and the drag latch
 * on `held: true`; each `held: false` is answered two frames later through
 * `pushSettledBounds`, and a `held: true` arriving meanwhile drops that answer.
 * `visibilityApplied` for this panel ends the hold (either value) and the latch
 * (`true` only).
 *
 * @param panelId - The preview panel these events belong to.
 * @param options - The panel's dockview api and current page, for page changes.
 *
 * @example
 * ```tsx
 * usePreviewEvents(panelId, { api: props.api, filePath: params.filePath })
 * const loadState = usePreviewStore((s) => s.getLoadState(panelId))
 * ```
 */
export function usePreviewEvents(panelId: string, options: UsePreviewEventsOptions = {}): void {
  // Read through a ref: the page changes on every move, and resubscribing the
  // whole event stream for it would buy nothing.
  const pageRef = useRef(options)
  pageRef.current = options

  // The `filePath` last written through `updateParameters`, until the props
  // show it. Between the write and dockview's re-render the panel can render
  // with the OLD params (the same event's store writes re-render it), so the
  // props alone would make a second event write the same page again.
  const pendingFilePathRef = useRef<string | null>(null)
  if (pendingFilePathRef.current === options.filePath) pendingFilePathRef.current = null

  useEffect(() => {
    const {
      setLoadState,
      pushFailures,
      setStillFrame,
      setBackdrop,
      recordBlockedHost,
      markBlockedHostsTruncated,
      setAllowedHosts,
      resetPage,
      beginResizeHold,
      applyVisibility,
      clearResizeHeld
    } =
      usePreviewStore.getState()

    const unsubscribeLoadState = window.api.preview.onLoadStateChanged((payload) => {
      if (payload.panelId !== panelId) return
      setLoadState(panelId, payload.state, payload.dropped)
    })

    // Main paints this colour behind the page; the placeholder paints the same
    // value so the two never disagree at a seam.
    const unsubscribeBackdrop = window.api.preview.onBackdropChanged((payload) => {
      if (payload.panelId !== panelId) return
      setBackdrop(panelId, payload.color)
    })

    const unsubscribeFailures = window.api.preview.onFailuresChanged((payload) => {
      if (payload.panelId !== panelId) return
      pushFailures(panelId, payload.failures, payload.truncated)
    })

    const unsubscribeStillFrame = window.api.preview.onStillFrameChanged((payload) => {
      if (payload.panelId !== panelId) return
      setStillFrame(panelId, {
        dataUrl: payload.dataUrl,
        width: payload.width,
        height: payload.height,
        capturedAt: payload.capturedAt,
        // The CSS size the still is drawn at and whether real input followed
        // the capture (issue #124). Absent on frames from before either existed.
        ...(payload.cssWidth !== undefined ? { cssWidth: payload.cssWidth } : {}),
        ...(payload.cssHeight !== undefined ? { cssHeight: payload.cssHeight } : {}),
        ...(payload.stale === true ? { stale: true } : {})
      })
    })

    const unsubscribeHostBlocked = window.api.preview.onHostBlocked((payload) => {
      if (payload.panelId !== panelId) return

      // The permission band renders this. NOTHING pops up.
      //
      // Each blocked host used to raise its own toast over the file tree, capped
      // at three — so a page reaching four hosts produced three stacked walls of
      // identical text and a fourth host that could not be approved at all,
      // because the app had run out of toasts. The band lists every host in the
      // preview's own chrome instead, and each decision is read once on the row
      // it belongs to.
      //
      // Deliberately silent: no announcement fires here either. A polite live
      // region on every block is a toast with extra steps, and the count on the
      // band's chip is what changes.
      recordBlockedHost(panelId, {
        host: payload.host,
        kinds: payload.kinds,
        approvable: payload.approvable
      })

      // Main has stopped listing new hosts for this view. The band says so
      // rather than presenting a short list as a complete one.
      if (payload.truncated) markBlockedHostsTruncated(panelId)
    })

    // What this project has ALREADY approved. Seeded on open and re-sent after
    // every approval, fanned out to every live view of the project — which is
    // how a second panel on the same project stays in step without polling.
    const unsubscribeAllowlist = window.api.preview.onAllowlistChanged((payload) => {
      if (payload.panelId !== panelId) return
      setAllowedHosts(panelId, payload.hosts)
    })

    // A load main started has committed (part 3 §3.4). Main's history is the
    // record; the tab store mirrors its Back and Forward state for the toolbar.
    const unsubscribePageChanged = window.api.preview.onPageChanged((payload) => {
      if (payload.panelId !== panelId) return

      usePreviewTabStore.getState().setHistory(panelId, payload)

      // Another document: drop what belonged to the old page. A `#section`
      // step is the same page, so it keeps its hosts, its badge and its find
      // matches. The find bar and the host list are UI state the stores do not
      // hold, so the panel closes and collapses them here (UX spec §1.6).
      if (!payload.sameDocument) {
        resetPage(panelId)
        pageRef.current.onLeavePage?.()
      }

      // `params.filePath` IS the page. Written even for a failed (404) commit:
      // the tab now shows B's error, and its title must say B.
      const shown = pendingFilePathRef.current ?? pageRef.current.filePath
      if (payload.filePath !== shown) {
        pendingFilePathRef.current = payload.filePath
        pageRef.current.api?.updateParameters({ filePath: payload.filePath })
      }

      pageRef.current.onPageChanged?.(payload)
    })

    // A window-edge resize hold (part 1 §1.5). Main re-sends `held: false`
    // every 500 ms until a settled push lands, and each one is answered; a new
    // `held: true` means the edge moved again, so a pending answer is stale.
    let cancelSettledPush: (() => void) | null = null
    const dropSettledPush = (): void => {
      cancelSettledPush?.()
      cancelSettledPush = null
    }
    const unsubscribeResizeHold = window.api.preview.onResizeHold((payload) => {
      if (payload.panelId !== panelId) return
      dropSettledPush()
      if (payload.held) {
        beginResizeHold(panelId)
        return
      }
      // Two frames: the resized layout lands, then it is measured.
      cancelSettledPush = afterTwoFrames(browserFrames, () => {
        cancelSettledPush = null
        pageRef.current.pushSettledBounds?.()
      })
    })

    // Main's report of what it did with the view: either value ends a resize
    // hold (its release emits exactly one); only a show ends the drag latch.
    const unsubscribeVisibility = window.api.preview.onVisibilityApplied((payload) => {
      if (payload.panelId !== panelId) return
      applyVisibility(panelId, payload.visible)
    })

    return () => {
      dropSettledPush()
      unsubscribeResizeHold()
      unsubscribeVisibility()
      // No release will reach this mount; the entry itself goes on close.
      clearResizeHeld(panelId)
      unsubscribeLoadState()
      unsubscribeBackdrop()
      unsubscribeFailures()
      unsubscribeStillFrame()
      unsubscribeHostBlocked()
      unsubscribeAllowlist()
      unsubscribePageChanged()
    }
  }, [panelId])
}
