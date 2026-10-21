// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Open-overlay stack – the single answer to "which overlay owns the keyboard".
 *
 * Every modal surface in the renderer (each `BaseDialog`, `SettingsOverlay`,
 * the shared `ContextMenu`) registers here while it is open. Two questions are
 * answered from the stack:
 *
 * 1. **Which modal is on top?** ({@link isTopmostOverlay}) – read by
 *    BaseDialog's Tab trap and focusout rescue, which must stand down while
 *    another MODAL surface is stacked on top of their dialog. Non-modal
 *    entries (context menus) are ignored here: a menu opened over a trapping
 *    dialog must not switch that dialog's trap off.
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

import { logger } from './logger'

/** What an overlay does when it owns an Escape keystroke. */
export type OverlayEscapeHandler = () => void

/**
 * A z-index layering token from `design-tokens.css` (e.g. `'--z-modal'`).
 *
 * Overlays whose z-index comes from a stylesheet pass the TOKEN, never its
 * number: the layering card (design/system/foundations/layering.html) forbids
 * mirroring a token into TypeScript, because changing the CSS would then
 * silently desynchronise the runtime. The value is read from `:root` when the
 * stack is queried, so it always matches what is painted.
 */
export type ZIndexToken = `--z-${string}`

/**
 * Resolve a z-index token to the number it currently holds on `:root`.
 *
 * @param token - Custom property name, e.g. `'--z-context-menu'`
 * @returns The token's integer value, or `0` when it is not defined (no
 *   stylesheet loaded – unit tests under jsdom set the property themselves)
 */
export function readZIndexToken(token: ZIndexToken): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  if (raw === '') return 0
  // Plain integers only: `parseInt` would read `calc(…)` or a `var(…)` chain
  // as NaN and `10000px` as 10000, and either way the stack would silently
  // rank against a number the stylesheet does not paint.
  if (!/^-?\d+$/.test(raw)) {
    warnUnparsableToken(token, raw)
    return 0
  }
  return Number.parseInt(raw, 10)
}

const warnedTokens = new Set<string>()

/**
 * Dev-only, once per token: a DEFINED token that is not a plain integer means
 * the stack ranks that overlay at 0 – below every dialog – which is a layering
 * bug in the stylesheet, not something to fail on at runtime.
 */
function warnUnparsableToken(token: ZIndexToken, raw: string): void {
  if (!import.meta.env.DEV || warnedTokens.has(token)) return
  warnedTokens.add(token)
  logger.warn('overlayStack: z-index token is not a plain integer; ranking it at 0', {
    token,
    value: raw
  })
}

function resolveZIndex(zIndex: number | ZIndexToken): number {
  return typeof zIndex === 'number' ? zIndex : readZIndexToken(zIndex)
}

/**
 * One open overlay on the stack.
 */
export interface OverlayStackEntry {
  /**
   * Container element of the overlay. Identity of the entry: registering the
   * same ref again moves it rather than duplicating it.
   */
  ref: React.RefObject<HTMLElement | null>
  /**
   * The z-index the overlay paints at – the primary ordering key. A number
   * when the caller already holds one at runtime (BaseDialog's `zIndex`
   * prop), otherwise the stylesheet token it paints with.
   */
  zIndex: number | ZIndexToken
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
  /**
   * Whether the overlay is modal, i.e. owns Tab focus while it is on top.
   * Non-modal entries (the context menu) still take Escape first when they
   * are topmost, but are invisible to {@link isTopmostOverlay}, so a menu
   * opened over a trapping dialog leaves that dialog's Tab trap working.
   *
   * @default true
   */
  modal?: boolean
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
  // A held Escape auto-repeats: without this guard one long press would walk
  // down the stack and close every overlay in turn – the very cascade this
  // module exists to prevent, just spread over a few hundred milliseconds.
  if (event.repeat) return

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
 * registerOverlay({ ref: menuRef, zIndex: '--z-context-menu', getEscapeHandler: () => close })
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
 * @param options - `modalOnly` skips non-modal entries (context menus)
 * @returns The topmost entry, or `null`
 */
export function getTopmostOverlay(
  options: { modalOnly?: boolean } = {}
): OverlayStackEntry | null {
  let top: OverlayStackEntry | null = null
  let topRank = Number.NEGATIVE_INFINITY
  for (const entry of stack) {
    if (options.modalOnly && entry.modal === false) continue
    const element = entry.ref.current
    if (element === null || !element.isConnected) continue
    const zIndex = resolveZIndex(entry.zIndex)
    // `>=`, not `>`: within one z-index the LAST registration is frontmost.
    if (top === null || zIndex >= topRank) {
      top = entry
      topRank = zIndex
    }
  }
  return top
}

/**
 * Whether `ref` is the frontmost open MODAL overlay – the question focus
 * management asks. Non-modal entries are ignored (see
 * {@link OverlayStackEntry.modal}). An overlay registered while nothing else
 * is connected is topmost by definition, so this is also `true` when the
 * stack holds no connected modal entry at all.
 *
 * @param ref - The container ref the overlay registered with
 * @returns `true` when no connected modal overlay is stacked above `ref`
 */
export function isTopmostOverlay(ref: React.RefObject<HTMLElement | null>): boolean {
  const top = getTopmostOverlay({ modalOnly: true })
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
