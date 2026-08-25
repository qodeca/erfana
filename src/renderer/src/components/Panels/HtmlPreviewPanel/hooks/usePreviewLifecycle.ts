// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewLifecycle hook (Issue #74, work item 71).
 *
 * Owns the `preview:open` on mount and the `preview:close` on unmount for one
 * preview panel, and surfaces the two refusal/failure signals the panel body
 * renders around:
 *
 * - **limit-reached** — a second `open` with a different panel id is refused
 *   with `PREVIEW_VIEW_LIMIT_REACHED` and a `holderPanelId`, which the panel
 *   turns into "a preview is already open — Open as source" (design §1.4 X20).
 * - **open-failed** — any other `open` failure (eligibility flip, session build
 *   error) collapses the panel to the failed banner, since no view was created.
 *
 * The successful path is silent here: once main accepts the open, load state,
 * failures and still frames flow through {@link usePreviewEvents} into the store.
 *
 * @module usePreviewLifecycle
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import { useEffect, useRef, useState } from 'react'
import { ErrorCode } from '../../../../../../shared/errors'
import { usePreviewStore } from '../../../../stores/usePreviewStore'
import { deriveBounds } from '../htmlPreview.logic'
import { logger } from '../../../../utils/logger'

/** Options for {@link usePreviewLifecycle}. */
export interface UsePreviewLifecycleOptions {
  /** The preview panel id. */
  panelId: string
  /** Absolute path of the `.html` file to preview. */
  filePath: string
  /** Ref to the placeholder, read once to seed the initial `open` bounds. */
  placeholderRef: React.RefObject<HTMLElement>
}

/** Result of {@link usePreviewLifecycle}. */
export interface UsePreviewLifecycleResult {
  /** `true` when this panel was refused because a preview is already live. */
  limitReached: boolean
  /** The already-open preview's panel id, present only when `limitReached`. */
  holderPanelId: string | null
  /** `true` when `open` failed for a non-limit reason (collapse to failed view). */
  openFailed: boolean
}

/**
 * Seeds the initial `open` bounds from the placeholder, defaulting to a 1×1 rect
 * at the origin when the placeholder is not laid out yet — the `ResizeObserver`
 * in {@link usePreviewBounds} corrects it on the first frame.
 */
function initialBounds(el: HTMLElement | null): { x: number; y: number; width: number; height: number } {
  const rect = el?.getBoundingClientRect()
  const bounds = rect ? deriveBounds(rect) : null
  return bounds ?? { x: 0, y: 0, width: 1, height: 1 }
}

/**
 * Opens the preview on mount and closes it on unmount, reporting refusal state.
 *
 * @param options - Panel id, file path, and the placeholder ref.
 * @returns Limit-reached / holder / open-failed flags for the panel body.
 *
 * @example
 * ```tsx
 * const { limitReached, holderPanelId, openFailed } = usePreviewLifecycle({
 *   panelId, filePath, placeholderRef
 * })
 * ```
 */
export function usePreviewLifecycle(
  options: UsePreviewLifecycleOptions
): UsePreviewLifecycleResult {
  const { panelId, filePath, placeholderRef } = options

  const [limitReached, setLimitReached] = useState(false)
  const [holderPanelId, setHolderPanelId] = useState<string | null>(null)
  const [openFailed, setOpenFailed] = useState(false)

  // `placeholderRef` is read once at open time only; excluding it from deps
  // keeps the open/close to exactly one run per (panelId, filePath).
  const placeholderRefStable = useRef(placeholderRef)
  placeholderRefStable.current = placeholderRef

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const result = await window.api.preview.open({
          panelId,
          filePath,
          bounds: initialBounds(placeholderRefStable.current.current)
        })
        if (cancelled) return

        if (result.ok) return

        if (result.errorCode === ErrorCode.PREVIEW_VIEW_LIMIT_REACHED) {
          setLimitReached(true)
          setHolderPanelId(result.holderPanelId ?? null)
          if (result.holderPanelId) {
            usePreviewStore.getState().setHolder(result.holderPanelId)
          }
          return
        }

        // Any other refusal: no view exists, so show the failed banner.
        setOpenFailed(true)
        logger.warn('Preview open failed', { panelId, filePath, errorCode: result.errorCode })
      } catch (error) {
        if (cancelled) return
        setOpenFailed(true)
        logger.error(
          'Preview open threw',
          error instanceof Error ? error : undefined,
          { panelId, filePath }
        )
      }
    })()

    return () => {
      cancelled = true
      // Bounded destroy main-side; idempotent (design §5(f)).
      void window.api.preview.close(panelId).catch(() => {})
      const store = usePreviewStore.getState()
      store.removePanel(panelId)
      if (store.holderPanelId === panelId) store.clearHolder()
    }
  }, [panelId, filePath])

  return { limitReached, holderPanelId, openFailed }
}
