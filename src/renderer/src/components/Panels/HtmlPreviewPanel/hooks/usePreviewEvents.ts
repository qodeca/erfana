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
import { showGlobalToast } from '../../../Toast/toastService'

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
    const { setLoadState, pushFailures, setStillFrame, setBackdrop, recordBlockedHost } =
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

      // Record FIRST, and unconditionally. The permission band lists from this,
      // and it must list every host — the toast budget used to gate the event
      // itself, so past three hosts the renderer never heard about a block at
      // all and the reader had no way to approve it.
      recordBlockedHost(panelId, {
        host: payload.host,
        kinds: payload.kinds,
        approvable: payload.approvable
      })

      // `notify` is the budget's verdict, now a hint rather than a gate.
      if (!payload.notify) return

      if (payload.approvable) {
        // Approvable host: offer to load it. The action toast is manual-dismiss
        // (ToastProvider forces duration 0 when an action is present), giving
        // the user time to read the host before deciding.
        showGlobalToast({
          type: 'warning',
          title: 'Blocked a remote resource',
          message: `The preview blocked ${payload.host}. Approve to load resources from it – the preview will reload and may fetch remote content.`,
          action: {
            label: 'Approve',
            // Main rebuilds the CSP, purges storage and reloads on approve, so
            // the renderer just fires the request (design §5(c)).
            onClick: () => {
              void window.api.preview.approveHost(panelId, payload.host)
            }
          }
        })
      } else {
        // Not approvable (e.g. an insecure scheme): surface it without an action.
        showGlobalToast({
          type: 'warning',
          title: 'Blocked a remote resource',
          message: `The preview blocked ${payload.host}. It cannot be approved and was not loaded.`
        })
      }
    })

    return () => {
      unsubscribeLoadState()
      unsubscribeBackdrop()
      unsubscribeFailures()
      unsubscribeStillFrame()
      unsubscribeHostBlocked()
    }
  }, [panelId])
}
