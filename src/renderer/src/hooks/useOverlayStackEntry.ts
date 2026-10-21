// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useOverlayStackEntry hook (#229).
 *
 * Puts a modal surface on the shared open-overlay stack while it is open, so
 * Escape reaches only the topmost overlay and BaseDialog's focus trap knows
 * when something is stacked above it. See `utils/overlayStack.ts`.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  registerOverlay,
  unregisterOverlay,
  type OverlayEscapeHandler,
  type ZIndexToken
} from '../utils/overlayStack'

/**
 * Options for {@link useOverlayStackEntry}.
 */
export interface UseOverlayStackEntryOptions {
  /** Whether the overlay is currently open. Closed overlays are not on the stack. */
  active: boolean
  /**
   * The z-index the overlay paints at – the stack's primary ordering key. Pass
   * the stylesheet token (e.g. `'--z-context-menu'`) when the overlay's
   * z-index comes from CSS; never copy the token's number into TypeScript.
   */
  zIndex: number | ZIndexToken
  /**
   * What Escape does while this overlay is on top, or `null`/`undefined` to
   * make Escape do nothing (it then does NOT fall through to the overlay
   * beneath). May change on every render; the latest value is used.
   */
  onEscape?: OverlayEscapeHandler | null
}

/**
 * Registers an overlay on the shared stack while `active` is `true`.
 *
 * Registration depends only on `active`, `zIndex` and `ref`, never on
 * `onEscape`: re-registering moves the entry to the end of its z-index tie
 * group, so a handler that changes identity every render would otherwise
 * reorder equal-z-index overlays on each keystroke. The handler is read
 * through a ref at the moment Escape is pressed instead.
 *
 * @param ref - Ref to the overlay's container element (used to detect a
 *   detached overlay and as the entry's identity). Must be stable.
 * @param options - Open state, z-index and Escape action
 *
 * @example
 * ```tsx
 * function Menu({ onClose }: { onClose: () => void }) {
 *   const menuRef = useRef<HTMLDivElement>(null)
 *   useOverlayStackEntry(menuRef, { active: true, zIndex: '--z-context-menu', onEscape: onClose })
 *   return <div ref={menuRef} role="menu" />
 * }
 * ```
 */
export function useOverlayStackEntry(
  ref: React.RefObject<HTMLElement | null>,
  { active, zIndex, onEscape }: UseOverlayStackEntryOptions
): void {
  const onEscapeRef = useRef<OverlayEscapeHandler | null>(onEscape ?? null)

  // Layout effect so the handler is current before any keystroke the browser
  // can deliver after this commit.
  useLayoutEffect(() => {
    onEscapeRef.current = onEscape ?? null
  })

  useEffect(() => {
    if (!active) return undefined

    registerOverlay({ ref, zIndex, getEscapeHandler: () => onEscapeRef.current })
    return () => unregisterOverlay(ref)
  }, [active, zIndex, ref])
}
