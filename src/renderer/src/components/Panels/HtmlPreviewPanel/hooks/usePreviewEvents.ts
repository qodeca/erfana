// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewEvents hook (Issue #74, work item 71).
 *
 * Bridges the main→renderer preview event stream into {@link usePreviewStore}
 * for the one live preview panel. The panel is the natural owner of these
 * subscriptions: only one preview is live at a time, the panel is mounted for
 * exactly that preview's lifetime, and unmount tears the subscriptions down.
 *
 * Each event carries its own `panelId`; the shared stream could in principle
 * carry another panel's event, so every handler guards on `payload.panelId`
 * before writing the store.
 *
 * @module usePreviewEvents
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import { useEffect } from 'react'
import { usePreviewStore } from '../../../../stores/usePreviewStore'

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
 * @param panelId - The preview panel these events belong to.
 *
 * @example
 * ```tsx
 * usePreviewEvents(panelId)
 * const loadState = usePreviewStore((s) => s.getLoadState(panelId))
 * ```
 */
export function usePreviewEvents(panelId: string): void {
  useEffect(() => {
    const {
      setLoadState,
      pushFailures,
      setStillFrame,
      setBackdrop,
      recordBlockedHost,
      markBlockedHostsTruncated,
      setAllowedHosts
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
        capturedAt: payload.capturedAt
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

    return () => {
      unsubscribeLoadState()
      unsubscribeBackdrop()
      unsubscribeFailures()
      unsubscribeStillFrame()
      unsubscribeHostBlocked()
      unsubscribeAllowlist()
    }
  }, [panelId])
}
