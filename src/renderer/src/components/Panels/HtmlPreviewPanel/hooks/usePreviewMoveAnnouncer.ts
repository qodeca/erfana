// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewMoveAnnouncer hook (issue #124, part 3 §3.8, RU3-1).
 *
 * Speaks a same-tab move once it has landed, in the polite region on the
 * PANEL ROOT – not the band's, which mounts only in the normal view, so a move
 * that starts from the failed banner would write into a region created in the
 * same render as its text, and a live region created with its content is not
 * announced.
 *
 * The move coordinator (`previewTabMove.ts`) writes what to say into the tab
 * store just before the commit and clears it on every ending but success. This
 * hook speaks it only on a `pageChanged` for this tab whose `filePath` and
 * `anchor` equal the announcement's target and whose `failed` is false, and
 * clears it on every `pageChanged` – so a refused move followed by a
 * `#section` jump says nothing.
 *
 * TIMING. The text is written one animation frame after the later of the
 * `pageChanged` for its target and any focus move the move caused. A focus
 * change can cut off a polite announcement, so text never lands in the same
 * frame as focus. Always at least one frame, which also clears the region
 * first: the same sentence twice ("Showing overview.html.") is spoken twice.
 *
 * @module usePreviewMoveAnnouncer
 * @see docs/design/design-issue-124-part3.md §3.8
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { PreviewPageChangedPayload } from '../../../../../../shared/ipc/preview-navigation-schema'
import {
  usePreviewTabStore,
  type PreviewMoveAnnouncement
} from '../../../../stores/usePreviewTabStore'
import { getBasename } from '../../../../utils/fileUtils'

/**
 * Runs a callback on a later animation frame; returns a cancel function.
 * Injectable so tests can step frames by hand.
 */
export type PreviewFrameScheduler = (callback: () => void) => () => void

/** The production scheduler: the next animation frame. */
export const scheduleNextFrame: PreviewFrameScheduler = (callback) => {
  const id = requestAnimationFrame(() => callback())
  return () => cancelAnimationFrame(id)
}

/**
 * What a landed move says (UX spec §6).
 *
 * - Started from Erfana's controls: "Showing pricing.html."
 * - Other tabs closed, whatever started it: "Closed the other tab that showed
 *   it." / "Closed 2 other tabs that showed it."
 * - A link or key inside the page that closed nothing: `''` – the page's own
 *   title announcement already covers the change.
 *
 * @param announcement - The coordinator's announcement
 * @returns The sentence(s), or `''` for nothing to say
 *
 * @example
 * ```ts
 * previewMoveAnnouncementText({ origin: 'chrome', closedCount: 1, focusMoved: false,
 *   target: { filePath: '/p/pricing.html', anchor: null } })
 * // 'Showing pricing.html. Closed the other tab that showed it.'
 * ```
 */
export function previewMoveAnnouncementText(announcement: PreviewMoveAnnouncement): string {
  const parts: string[] = []
  if (announcement.origin === 'chrome') {
    parts.push(`Showing ${getBasename(announcement.target.filePath) || 'the page'}.`)
  }
  if (announcement.closedCount === 1) {
    parts.push('Closed the other tab that showed it.')
  } else if (announcement.closedCount > 1) {
    parts.push(`Closed ${announcement.closedCount} other tabs that showed it.`)
  }
  return parts.join(' ')
}

/** Result of {@link usePreviewMoveAnnouncer}. */
export interface PreviewMoveAnnouncer {
  /** The panel-root polite region's text. */
  text: string
  /** Handles a `pageChanged` for this panel: speak the landed move, or clear it. */
  onPageChanged: (payload: PreviewPageChangedPayload) => void
  /** A focus move is coming (a banner-started move, a find bar closing): hold the text. */
  expectFocus: () => void
  /** The focus move landed, or will not happen: held text goes out one frame later. */
  focusSettled: () => void
}

/**
 * Owns the panel-root region's text for move announcements.
 *
 * @param panelId - The tab whose store entry holds the announcement
 * @param schedule - Frame scheduler; defaults to {@link scheduleNextFrame}
 * @returns The region text and the three inputs that drive it
 *
 * @example
 * ```tsx
 * const announcer = usePreviewMoveAnnouncer(panelId)
 * usePreviewEvents(panelId, { onPageChanged: announcer.onPageChanged })
 * <div className="erf-band__announce" role="status" aria-live="polite">{announcer.text}</div>
 * ```
 */
export function usePreviewMoveAnnouncer(
  panelId: string,
  schedule: PreviewFrameScheduler = scheduleNextFrame
): PreviewMoveAnnouncer {
  const [text, setText] = useState('')
  /** Words waiting for their frame (and for a focus move, if one is coming). */
  const pendingRef = useRef<string | null>(null)
  const awaitingFocusRef = useRef(false)
  const cancelFrameRef = useRef<(() => void) | null>(null)

  const flushNextFrame = useCallback(() => {
    cancelFrameRef.current?.()
    cancelFrameRef.current = schedule(() => {
      cancelFrameRef.current = null
      // Re-checked at run time: a focus move announced after this frame was
      // asked for still holds the text.
      if (awaitingFocusRef.current || pendingRef.current === null) return
      const words = pendingRef.current
      pendingRef.current = null
      setText(words)
    })
  }, [schedule])

  useEffect(() => () => cancelFrameRef.current?.(), [])

  const onPageChanged = useCallback(
    (payload: PreviewPageChangedPayload) => {
      const store = usePreviewTabStore.getState()
      const announcement = store.getTab(panelId).announcement
      if (announcement === null) return
      // Cleared whatever happens next: this change either is the move landing
      // or proves the move will not land as announced.
      store.setAnnouncement(panelId, null)
      const lands =
        !payload.failed &&
        payload.filePath === announcement.target.filePath &&
        payload.anchor === announcement.target.anchor
      if (!lands) return
      const words = previewMoveAnnouncementText(announcement)
      if (words === '') return
      // `focusMoved` (an answered prompt) needs nothing extra: the coordinator
      // asked for its focus frame before the commit, so it runs before ours.
      setText('')
      pendingRef.current = words
      flushNextFrame()
    },
    [panelId, flushNextFrame]
  )

  const expectFocus = useCallback(() => {
    awaitingFocusRef.current = true
  }, [])

  const focusSettled = useCallback(() => {
    awaitingFocusRef.current = false
    if (pendingRef.current !== null) flushNextFrame()
  }, [flushNextFrame])

  return { text, onPageChanged, expectFocus, focusSettled }
}
