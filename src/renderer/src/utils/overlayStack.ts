// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Open-overlay stack – the single answer to "which overlay owns the keyboard".
 *
 * Every modal surface in the renderer (each `BaseDialog`, `SettingsOverlay`,
 * the shared `ContextMenu`) registers here while it is open. Two questions are
 * answered from the stack:
 *
 * 1. **Who is on top?** ({@link isTopmostOverlay}) – read by BaseDialog's Tab
 *    trap and focusout rescue, which must stand down while anything is stacked
 *    on top of their dialog.
 * 2. **Who gets Escape?** – ONE shared capture-phase `keydown` listener on
 *    `document` hands Escape to the topmost overlay only (#229).
 *
 * Why one shared listener instead of a `isTopmost` guard in each overlay's own
 * listener: every overlay used to add its own capture listener on `document`,
 * and `stopPropagation()` does not stop other listeners on the SAME node, so
 * one Escape on the Cmd+Q quit prompt also ran TranscriptionDialog's listener
 * and cancelled a running transcription. A per-listener guard would fix that
 * only as long as no handler flushes React synchronously – the top dialog
 * closing mid-dispatch would make the one beneath it "topmost" for the next
 * listener in the same dispatch, and Escape would cascade again. Choosing the
 * owner once per keystroke removes that ordering hazard instead of
 * documenting it.
 *
 * ORDERING CONTRACT (unchanged from the BaseDialog-only stack this replaces):
 * the frontmost entry is the one with the HIGHEST `zIndex`; registration order
 * breaks a tie (the later registration wins). Painted order is what the user
 * sees, so it is compared directly rather than inferred from open order – see
 * the module comment in `components/Dialog/BaseDialog.tsx` for the shipping
 * case registration order alone gets wrong.
 *
 * Entries whose element is not connected are skipped, never trusted: React
 * removes a portal subtree in the mutation phase but runs the passive cleanup
 * that unregisters it later, and a registration leaked by a component that
 * never ran its cleanup must not wedge every later overlay.
 */

/** What an overlay does when it owns an Escape keystroke. */
export type OverlayEscapeHandler = () => void

/**
 * One open overlay on the stack.
 */
export interface OverlayStackEntry {
  /**
   * Container element of the overlay. Identity of the entry: registering the
   * same ref again moves it rather than duplicating it.
   */
  ref: React.RefObject<HTMLElement | null>
  /** The z-index the overlay paints at – the primary ordering key. */
  zIndex: number
  /**
   * Returns the overlay's CURRENT Escape action, or `null` when Escape must do
   * nothing while this overlay is on top (e.g. `closeOnEscape={false}`).
   *
   * A getter rather than a stored function so the action can change on every
   * render (TranscriptionDialog switches between cancel and close) without
   * re-registering – re-registering would move the entry to the end of its
   * z-index tie group and silently reorder equal-z-index overlays.
   */
  getEscapeHandler: () => OverlayEscapeHandler | null
}

const stack: OverlayStackEntry[] = []
let listenerInstalled = false

/**
 * Shared Escape listener. Capture phase on `document`, so it runs before any
 * target-phase handler inside the overlay (an input's own Escape handling, the
 * terminal's xterm textarea) – the same position each overlay's private
 * listener used to occupy.
 */
function handleDocumentKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  // An IME composition uses Escape to cancel the candidate window; that
  // keystroke belongs to the input, not to the overlay around it.
  if (event.isComposing) return

  const top = getTopmostOverlay()
  if (top === null) return

  const handler = top.getEscapeHandler()
  // The topmost overlay opted out of Escape. Deliberately NOT falling through
  // to the overlay beneath: a modal on top owns the keyboard even when it does
  // not react to this key.
  if (handler === null) return

  event.preventDefault()
  event.stopPropagation()
  handler()
}

function syncListener(): void {
  if (stack.length > 0 && !listenerInstalled) {
    document.addEventListener('keydown', handleDocumentKeyDown, true)
    listenerInstalled = true
  } else if (stack.length === 0 && listenerInstalled) {
    document.removeEventListener('keydown', handleDocumentKeyDown, true)
    listenerInstalled = false
  }
}

/**
 * Put an overlay on top of its z-index tie group, never duplicating it.
 *
 * @param entry - The overlay to register. An existing entry with the same
 *   `ref` is replaced.
 *
 * @example
 * ```ts
 * registerOverlay({ ref: menuRef, zIndex: 100000, getEscapeHandler: () => close })
 * // …on close
 * unregisterOverlay(menuRef)
 * ```
 */
export function registerOverlay(entry: OverlayStackEntry): void {
  removeEntry(entry.ref)
  stack.push(entry)
  syncListener()
}

/**
 * Remove an overlay from the stack. No-op when it is not registered.
 *
 * @param ref - The container ref the overlay registered with.
 */
export function unregisterOverlay(ref: React.RefObject<HTMLElement | null>): void {
  removeEntry(ref)
  syncListener()
}

function removeEntry(ref: React.RefObject<HTMLElement | null>): void {
  const index = stack.findIndex((entry) => entry.ref === ref)
  if (index !== -1) stack.splice(index, 1)
}

/**
 * The frontmost connected overlay – highest `zIndex`, latest registration on
 * a tie – or `null` when no registered overlay is on screen.
 *
 * @returns The topmost entry, or `null`
 */
export function getTopmostOverlay(): OverlayStackEntry | null {
  let top: OverlayStackEntry | null = null
  for (const entry of stack) {
    const element = entry.ref.current
    if (element === null || !element.isConnected) continue
    // `>=`, not `>`: within one z-index the LAST registration is frontmost.
    if (top === null || entry.zIndex >= top.zIndex) top = entry
  }
  return top
}

/**
 * Whether `ref` is the frontmost open overlay. An overlay registered while
 * nothing else is connected is topmost by definition, so this is also `true`
 * when the stack holds no connected entry at all.
 *
 * @param ref - The container ref the overlay registered with
 * @returns `true` when nothing connected is stacked above `ref`
 */
export function isTopmostOverlay(ref: React.RefObject<HTMLElement | null>): boolean {
  const top = getTopmostOverlay()
  return top === null || top.ref === ref
}

/**
 * Empty the stack and detach the shared listener. Test-only: production code
 * unregisters through {@link unregisterOverlay}.
 */
export function resetOverlayStackForTests(): void {
  stack.length = 0
  syncListener()
}
