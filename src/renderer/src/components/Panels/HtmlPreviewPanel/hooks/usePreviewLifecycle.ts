// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewLifecycle hook (Issue #74, work item 71).
 *
 * Owns the `preview:open` on mount and the `preview:close` on unmount for one
 * preview panel, and surfaces the two refusal/failure signals the panel body
 * renders around:
 *
 * - **limit-reached** — this file is already previewed in ANOTHER WINDOW.
 *   Panel ids are path-derived, so both windows mint the same id; main refuses
 *   with `PREVIEW_VIEW_LIMIT_REACHED` rather than destroying the other window's
 *   running view, and the panel offers "Open as source" (sd-074b §4.2).
 *   Independent previews in the SAME window are no longer refused.
 * - **open-failed** — any other `open` failure (eligibility flip, session build
 *   error) collapses the panel to the failed banner, since no view was created.
 *
 * The successful path is silent here: once main accepts the open, load state,
 * failures and still frames flow through {@link usePreviewEvents} into the store.
 *
 * The hook also RESUMES a suspended preview. Beyond `PREVIEW.MAX_LIVE_VIEWS`,
 * main tears the least recently active view down to its still frame and emits
 * `suspended`; when such a panel becomes the visible tab again, this hook
 * re-opens it (sd-074b §4.3). That round trip is what makes the sleep policy
 * invisible to the user.
 *
 * @module usePreviewLifecycle
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorCode } from '../../../../../../shared/errors'
import { usePreviewStore } from '../../../../stores/usePreviewStore'
import { deriveBounds } from '../htmlPreview.logic'
import { logger } from '../../../../utils/logger'
import { getBasename } from '../../../../utils/fileUtils'

/** Options for {@link usePreviewLifecycle}. */
export interface UsePreviewLifecycleOptions {
  /** The preview panel id. */
  panelId: string
  /** Absolute path of the `.html` file to preview. */
  filePath: string
  /** Ref to the placeholder, read once to seed the initial `open` bounds. */
  placeholderRef: React.RefObject<HTMLElement>
  /**
   * Whether this panel is the visible tab. A suspended preview re-opens only
   * when it becomes visible, so a background tab never resurrects itself and
   * re-evicts the tab the user is actually looking at.
   */
  isVisible?: boolean
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
/**
 * How many times a superseded RESUME re-arms itself before giving up.
 *
 * Small on purpose. Each retry is a full `preview:open` round trip, and the
 * thing that superseded us may keep winning, so this bounds a loop rather than
 * guaranteeing success. Giving up leaves the still frame on screen, which is
 * what the panel already shows while suspended.
 */
const RESUME_RETRY_LIMIT = 3

export function usePreviewLifecycle(
  options: UsePreviewLifecycleOptions
): UsePreviewLifecycleResult {
  const { panelId, filePath, placeholderRef, isVisible = true } = options

  const [limitReached, setLimitReached] = useState(false)
  const [holderPanelId, setHolderPanelId] = useState<string | null>(null)
  const [openFailed, setOpenFailed] = useState(false)

  // `placeholderRef` is read once at open time only; excluding it from deps
  // keeps the open/close to exactly one run per (panelId, filePath).
  const placeholderRefStable = useRef(placeholderRef)
  placeholderRefStable.current = placeholderRef

  /**
   * Ask main to open this preview. Shared by the mount effect and the resume
   * effect, so an initial open and a wake-from-suspended take the identical
   * path — including the refusal handling.
   */
  const requestOpen = useCallback(
    async (isCancelled: () => boolean, onSuperseded?: () => void): Promise<void> => {
      // Clear whatever the LAST attempt concluded. Without this there is no
      // path back out of either banner: a panel that once failed keeps saying so
      // for the rest of its mount even after a later open succeeds (F27).
      setOpenFailed(false)
      setLimitReached(false)

      try {
        const result = await window.api.preview.open({
          panelId,
          filePath,
          bounds: initialBounds(placeholderRefStable.current.current)
        })
        if (isCancelled()) return

        if (result.ok) return

        if (result.errorCode === ErrorCode.PREVIEW_VIEW_LIMIT_REACHED) {
          setLimitReached(true)
          setHolderPanelId(result.holderPanelId ?? null)
          if (result.holderPanelId) {
            usePreviewStore.getState().setHolder(result.holderPanelId)
          }
          return
        }

        if (result.errorCode === ErrorCode.PREVIEW_OPEN_SUPERSEDED) {
          // Tell the caller, so a RESUME can re-arm. The initial open needs no
          // such thing — whoever superseded it owns the panel from then on —
          // but a resume has nowhere else to come from: `loadState` stays
          // 'suspended' and no dependency changes, so without this the tab sits
          // on a frozen still frame with no live view and no banner.
          onSuperseded?.()
          // Not a failure. Something newer overtook this open — a project
          // switch, a close, a suspend, or another open for the same panel — so
          // the staleness guard did exactly its job. Whoever superseded us owns
          // what happens next; showing a banner here would be wrong, and used to
          // be permanent because nothing ever cleared it.
          //
          // `isCancelled()` covers only supersession started by THIS effect, so
          // it does not catch the suspend/evict case, which is why the code
          // exists at all.
          //
          // But say so somewhere. Returning in total silence is what made an
          // invisible preview so slow to find: a genuinely failed open painted a
          // black rectangle and reported nothing anywhere. Basename only — the
          // absolute path carries the user's home directory.
          logger.debug('Preview open superseded', {
            panelId,
            file: getBasename(filePath)
          })
          return
        }

        // Any other refusal: no view exists, so show the failed banner.
        setOpenFailed(true)
        logger.warn('Preview open failed', { panelId, filePath, errorCode: result.errorCode })
      } catch (error) {
        if (isCancelled()) return
        setOpenFailed(true)
        logger.error('Preview open threw', error instanceof Error ? error : undefined, {
          panelId,
          filePath
        })
      }
    },
    [panelId, filePath]
  )

  useEffect(() => {
    let cancelled = false

    void requestOpen(() => cancelled)

    return () => {
      cancelled = true
      // Bounded destroy main-side; idempotent (design §5(f)).
      void window.api.preview.close(panelId).catch(() => {})
      const store = usePreviewStore.getState()
      store.removePanel(panelId)
      if (store.holderPanelId === panelId) store.clearHolder()
    }
  }, [panelId, filePath, requestOpen])

  // Resume a suspended preview when its tab becomes visible again. Main emits
  // `suspended` after evicting the least recently active view; the still frame
  // stays on screen until this re-open lands, so the tab is never blank.
  const loadState = usePreviewStore((state) => state.getLoadState(panelId))
  const [resumeAttempt, setResumeAttempt] = useState(0)

  // Reset the budget once the panel is live again, so a later suspend/resume
  // cycle does not inherit a spent one.
  useEffect(() => {
    if (loadState !== 'suspended') {
      setResumeAttempt((attempt) => (attempt === 0 ? attempt : 0))
    }
  }, [loadState])

  useEffect(() => {
    if (!isVisible || loadState !== 'suspended') return

    let cancelled = false
    void requestOpen(
      () => cancelled,
      () => {
        // Bounded: a supersession can repeat — another panel's open keeps
        // winning — and an unbounded re-arm would spin reopening for as long as
        // the tab is visible.
        if (cancelled) return
        setResumeAttempt((attempt) =>
          attempt < RESUME_RETRY_LIMIT ? attempt + 1 : attempt
        )
      }
    )
    return () => {
      cancelled = true
    }
  }, [isVisible, loadState, requestOpen, resumeAttempt])

  return { limitReached, holderPanelId, openFailed }
}
