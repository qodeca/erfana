// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment mode for a renderer-hosted preview: the shared `overlayCore/modeState`
 * rules over `usePreviewCommentStore`, where the mode is kept per panel.
 *
 * The mode belongs to the tab: hiding the tab keeps it, and it comes back with
 * the tab (I-8, differences D-43). It goes when the panel leaves the
 * preview-only view (024-FR-005), when comments go, or when no new comment can
 * be written (menu matrix § 2).
 *
 * @module components/Comments/overlay/useHostCommentMode
 */
import { useCallback, useEffect } from 'react'
import { reduceCommentMode } from '../../../../../shared/comments/overlayCore/modeState'
import { usePanelCommentState, usePreviewCommentStore } from '../../../stores/usePreviewCommentStore'
import { MD_SURFACE_COPY } from '../commentCopyWords'

/** Options for {@link useHostCommentMode}. */
export interface HostCommentModeOptions {
  readonly panelId: string
  /** The panel is in its preview view with comments on, tab shown or not. */
  readonly inPreview: boolean
  /** The preview is on screen: only then is a turned-off mode said aloud. */
  readonly live: boolean
  /** Why no new comment can be written, or `null`. */
  readonly blocked: string | null
  readonly announce: (text: string) => void
}

/**
 * Keeps one panel's comment mode to its rules.
 *
 * @param options - {@link HostCommentModeOptions}
 * @returns `setMode`, which answers whether the mode changed.
 */
export function useHostCommentMode({ panelId, inPreview, live, blocked, announce }: HostCommentModeOptions): (on: boolean) => boolean {
  const stored = usePanelCommentState(panelId).mode
  const store = usePreviewCommentStore
  const setMode = useCallback(
    (on: boolean) => {
      const step = reduceCommentMode({ on: store.getState().panels.get(panelId)?.mode ?? false }, { type: 'set', on })
      if (step.changed) store.getState().patch(panelId, { mode: step.on })
      return step.changed
    },
    [panelId, store]
  )
  useEffect(() => {
    if (stored && (!inPreview || blocked !== null)) {
      store.getState().patch(panelId, { mode: false })
      if (blocked !== null && live) announce(MD_SURFACE_COPY.modeUnavailable(blocked))
    }
  }, [stored, inPreview, live, blocked, panelId, store, announce])
  return setMode
}
