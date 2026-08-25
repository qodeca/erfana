// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Full-screen overlay lifecycle for the image viewer.
 *
 * Owns the four things that belong together and nothing else: whether the
 * overlay is open, the `portal-root` precondition, the focus trap while it is
 * open, and restoring focus when it closes.
 *
 * @module useFullScreenOverlay
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { logger } from '../../../../utils/logger'
import { useOccluder } from '../../../../hooks/useOccluder'

/**
 * Elements the focus trap cycles through.
 *
 * Deliberately the same list the rest of the app uses for modal traps.
 */
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** State and actions returned by {@link useFullScreenOverlay}. */
export interface UseFullScreenOverlayResult {
  /** Whether the overlay is currently open. */
  isFullScreen: boolean
  /** Attach to the overlay element; the focus trap reads its focusable children. */
  overlayRef: React.RefObject<HTMLDivElement>
  /** The `#portal-root` element, or `null` when the app shell has not rendered it. */
  portalRoot: HTMLElement | null
  /** Open the overlay. No-op (with a log line) when `portal-root` is missing. */
  open: () => void
  /** Close the overlay and restore focus. No-op when already closed. */
  close: () => void
}

/**
 * Manages the image viewer's full-screen overlay.
 *
 * @returns Overlay state, the ref to attach, and open/close actions
 *
 * @example
 * ```tsx
 * const { isFullScreen, overlayRef, portalRoot, open, close } = useFullScreenOverlay()
 *
 * {isFullScreen && portalRoot && createPortal(
 *   <div ref={overlayRef} role="dialog" aria-modal="true">…</div>,
 *   portalRoot
 * )}
 * ```
 */
export function useFullScreenOverlay(): UseFullScreenOverlayResult {
  const [isFullScreen, setIsFullScreen] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<Element | null>(null)

  // Occlude the live preview view while the image viewer is full-screen (item
  // 67): the overlay covers the whole content area, so the preview's
  // WebContentsView must hide behind its still frame until it closes.
  useOccluder('overlay', isFullScreen)

  const open = useCallback(() => {
    // Without a portal root the overlay would mount nowhere and trap focus in a
    // detached tree, so refuse rather than half-open.
    if (!document.getElementById('portal-root')) {
      logger.error('Cannot enter fullscreen: portal-root element not found')
      return
    }
    previousActiveElement.current = document.activeElement
    setIsFullScreen(true)
  }, [])

  // Mirrors `isFullScreen` for `close`, which must stay a pure callback: a
  // state updater with a focus side effect fires twice under StrictMode.
  const isFullScreenRef = useRef(false)
  useEffect(() => {
    isFullScreenRef.current = isFullScreen
  }, [isFullScreen])

  const close = useCallback(() => {
    // Guarded so an Escape press outside full screen cannot steal focus.
    if (!isFullScreenRef.current) return

    setIsFullScreen(false)
    if (previousActiveElement.current instanceof HTMLElement) {
      previousActiveElement.current.focus()
    }
  }, [])

  // Focus trap: only active while the overlay is mounted.
  useEffect(() => {
    if (!isFullScreen) return

    const overlay = overlayRef.current
    if (!overlay) return

    const initial = overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (initial.length > 0) initial[0].focus()

    const handleTabKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return

      // Re-queried per keypress: the toolbar's buttons enable and disable as the
      // zoom level changes, so a snapshot would wrap to a disabled element.
      const focusable = overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleTabKey)
    return () => document.removeEventListener('keydown', handleTabKey)
  }, [isFullScreen])

  return {
    isFullScreen,
    overlayRef,
    // Read during render so a late-mounted portal root is picked up on the next
    // render rather than being cached as `null` forever.
    portalRoot: typeof document === 'undefined' ? null : document.getElementById('portal-root'),
    open,
    close
  }
}
