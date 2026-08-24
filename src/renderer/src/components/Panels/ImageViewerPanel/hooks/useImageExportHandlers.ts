// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Export handlers for the image viewer's PNG / PDF / clipboard controls.
 *
 * Called ONCE by {@link ImageViewerPanel} and its result handed to both toolbar
 * instances, so the panel's toolbar and the full-screen overlay's toolbar share
 * one busy state and one in-flight request. That is requirement 14: clicking
 * the overlay's PNG button is literally the same handler as clicking the
 * panel's.
 *
 * The renderer never sees a byte of image data. It sends `{ filePath, target }`
 * and gets back a small structured result; main reads the file fresh from disk,
 * rasterizes it in a hidden sandboxed window and writes the output.
 *
 * Toasts go through `showGlobalToast`, NOT `useToast()`: the context throws
 * without a provider, and the panel's own test harness renders it bare.
 *
 * @module useImageExportHandlers
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  ImageExportResponse,
  ImageExportTarget
} from '../../../../../../shared/ipc/image-export-schema'
import { showGlobalToast, type GlobalToastPayload } from '../../../Toast/toastService'
import { logger } from '../../../../utils/logger'
import {
  EXPORT_TOAST_ERROR_MS,
  EXPORT_TOAST_SUCCESS_MS,
  formatExportToast,
  formatSettledAnnouncement,
  politeAnnouncement,
  SILENT_ANNOUNCEMENT,
  type ExportAnnouncement
} from '../imageExportToast.logic'
import { IMAGE_EXPORT_COPY, IMAGE_EXPORT_TOAST_COPY } from '../imageViewerStatus.logic'

// ============================================================================
// Types
// ============================================================================

/** Options for {@link useImageExportHandlers}. */
export interface UseImageExportHandlersOptions {
  /** Absolute path of the image on display; the export re-reads it from disk. */
  filePath: string
  /**
   * Whether the full-screen overlay is the top surface.
   *
   * Only affects what is ANNOUNCED. The overlay is `aria-modal="true"` and the
   * toast region lives outside it, so while full screen the settled sentence is
   * written into the panel's own live region instead of being cleared.
   */
  isFullScreen: boolean
}

/**
 * State and handlers {@link useImageExportHandlers} hands to both toolbars.
 *
 * The three flags are the whole busy state; the controls derive "any export is
 * running" from them rather than being handed a fourth flag that could disagree.
 * Marking all three busy together is what makes a click that is legal WITHIN
 * ONE PANEL unable to come back as an `IMAGE_EXPORT_BUSY` error toast. It is
 * not a promise across panels: the main-side lock is process-wide while this
 * state is per-panel, so a second image tab that takes the lock while this
 * panel sits in its save dialog (which deliberately runs outside the lock) can
 * still make this panel's next request fail as busy.
 */
export interface UseImageExportHandlersResult {
  /** Whether a PNG export is in flight. */
  isExportingPng: boolean
  /** Whether a PDF export is in flight. */
  isExportingPdf: boolean
  /** Whether a clipboard copy is in flight. */
  isCopying: boolean
  /**
   * Sentence for the panel-owned export live regions, and which one gets it.
   *
   * Empty text clears both regions. A failure is routed to the assertive one:
   * see {@link formatSettledAnnouncement}.
   */
  exportAnnouncement: ExportAnnouncement
  /**
   * Re-state the running export's busy sentence for a click the UI swallowed.
   *
   * The three controls stay live while an export runs - they are
   * `aria-disabled`, never `disabled` - so a click on one of them is legal and
   * then does nothing at all. Without this the only feedback is `cursor:
   * progress` on hover, and a user who clicks PDF 200 ms into a PNG export
   * cannot tell a refused click from a lost one.
   *
   * Deliberately NOT a toast: a click the UI itself swallowed must never come
   * back as an `IMAGE_EXPORT_BUSY` error.
   */
  onBusyClick: () => void
  /** Export the file on disk as a PNG, via a native save dialog. */
  onExportPng: () => void
  /** Export the file on disk as a single-page PDF, via a native save dialog. */
  onExportPdf: () => void
  /** Copy the image to the system clipboard as PNG bytes. No dialog. */
  onCopyImage: () => void
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Wires the three export controls to `window.api.imageExport.run`.
 *
 * @param options - The file to export and which surface is on top
 * @returns Busy flags, the live-region announcement and the three click handlers
 *
 * @example
 * ```tsx
 * const exports = useImageExportHandlers({ filePath, isFullScreen })
 *
 * <ImageViewerExportControls
 *   isExportingPng={exports.isExportingPng}
 *   isExportingPdf={exports.isExportingPdf}
 *   isCopying={exports.isCopying}
 *   onExportPng={exports.onExportPng}
 *   // …
 * />
 * ```
 */
export function useImageExportHandlers(
  options: UseImageExportHandlersOptions
): UseImageExportHandlersResult {
  const { filePath, isFullScreen } = options

  const [isExportingPng, setIsExportingPng] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [exportAnnouncement, setExportAnnouncement] =
    useState<ExportAnnouncement>(SILENT_ANNOUNCEMENT)

  // The guard is a REF, not the state above: two clicks landing in the same
  // tick would both read a `false` that React has not re-rendered yet, and the
  // second would reach the main-side lock and come back as an error toast.
  const busyRef = useRef(false)

  // A panel can be closed while the native save dialog is still open. Writing
  // state after that is a no-op React warns about; the toast still fires,
  // because it is dispatched on `window` and not owned by this component.
  const isMountedRef = useRef(true)

  // The settled sentence is transient, on the same budget as the toast that
  // carries the same news: left standing it is still in the accessibility tree
  // when the user leaves full screen and the region re-mounts in the panel,
  // where it reads as a fresh announcement about an export that finished long
  // ago. Same mechanism as `useReloadAction`'s indicator window.
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current)
        clearTimerRef.current = null
      }
    }
  }, [])

  // Read at settle time, never captured when the click was made: an export
  // started in the panel can finish while the user is in full screen, and it is
  // the surface on top AT THAT MOMENT that decides who gets to speak.
  const isFullScreenRef = useRef(isFullScreen)
  useEffect(() => {
    isFullScreenRef.current = isFullScreen
  }, [isFullScreen])

  const setBusy = useCallback((target: ImageExportTarget, value: boolean) => {
    if (target === 'png') setIsExportingPng(value)
    else if (target === 'pdf') setIsExportingPdf(value)
    else setIsCopying(value)
  }, [])

  /**
   * Empty both live regions once the matching toast would have gone.
   *
   * @param delayMs - How long the sentence stays, matching the toast's own life
   */
  const scheduleClear = useCallback((delayMs: number) => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    clearTimerRef.current = setTimeout(() => {
      clearTimerRef.current = null
      if (isMountedRef.current) setExportAnnouncement(SILENT_ANNOUNCEMENT)
    }, delayMs)
  }, [])

  /**
   * One export, start to finish.
   *
   * Stable identity (it closes over nothing that changes but `filePath`), so
   * both toolbar instances keep receiving the same three callbacks.
   */
  const run = useCallback(
    async (target: ImageExportTarget): Promise<void> => {
      // Requirement 13: a second click while busy is a no-op, never an error.
      if (busyRef.current || !filePath) return

      busyRef.current = true
      setBusy(target, true)
      // A new export supersedes the previous verdict, so the pending clear goes
      // with it rather than wiping the busy sentence part-way through this run.
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current)
        clearTimerRef.current = null
      }
      setExportAnnouncement(politeAnnouncement(IMAGE_EXPORT_COPY[target].announceBusy))

      let toast: GlobalToastPayload | null = null

      try {
        const result: ImageExportResponse = await window.api.imageExport.run({ filePath, target })
        toast = formatExportToast(result, { target })
      } catch {
        // The invoke itself rejected - the bridge or the handler failed before
        // producing a response. No `error` string exists to quote, so the
        // catch-all message is used. The raw error is deliberately NOT logged:
        // a rejected invoke carries the main-process error verbatim, absolute
        // path included, and this log line ends up on disk. The target plus a
        // static reason is what the log gets; the toast below is what the user
        // gets.
        logger.error('Image export bridge call failed', undefined, {
          target,
          reason: 'invoke-rejected'
        })
        toast = {
          title: IMAGE_EXPORT_COPY[target].toastErrorTitle,
          message: IMAGE_EXPORT_TOAST_COPY.bridgeFailure,
          type: 'error',
          duration: EXPORT_TOAST_ERROR_MS
        }
      } finally {
        busyRef.current = false
        if (isMountedRef.current) setBusy(target, false)
      }

      // A cancelled save dialog produces no toast and clears the announcement:
      // the user cancelled, so there is nothing to tell them.
      if (toast) showGlobalToast(toast)
      if (!isMountedRef.current) return

      const settled = formatSettledAnnouncement(toast, {
        isFullScreen: isFullScreenRef.current
      })
      setExportAnnouncement(settled)
      if (settled.text) scheduleClear(toast?.duration ?? EXPORT_TOAST_SUCCESS_MS)
    },
    [filePath, scheduleClear, setBusy]
  )

  // Which action is running is DERIVED from the three flags, never a fourth
  // ref: they are the busy state the buttons render, so this cannot name an
  // action the toolbar is not showing as busy.
  const onBusyClick = useCallback(() => {
    const running: ImageExportTarget | null = isExportingPng
      ? 'png'
      : isExportingPdf
        ? 'pdf'
        : isCopying
          ? 'clipboard'
          : null
    if (!running) return
    setExportAnnouncement(politeAnnouncement(IMAGE_EXPORT_COPY[running].announceBusy))
  }, [isCopying, isExportingPdf, isExportingPng])

  const onExportPng = useCallback(() => {
    void run('png')
  }, [run])

  const onExportPdf = useCallback(() => {
    void run('pdf')
  }, [run])

  const onCopyImage = useCallback(() => {
    void run('clipboard')
  }, [run])

  return {
    isExportingPng,
    isExportingPdf,
    isCopying,
    exportAnnouncement,
    onBusyClick,
    onExportPng,
    onExportPdf,
    onCopyImage
  }
}
