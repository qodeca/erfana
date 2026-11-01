// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Esc from the panel's chrome (plan step 4; I-1, K-19). The mode tab says "Esc
 * to leave", and that has to hold from wherever focus is: the toggle after a
 * click, the drawer, Find, or dockview's group element after a tab switch. The
 * page's own Esc (preload) and the Markdown scroller's are not reached from
 * there. One rule for both previews, on the overlay core's mode machine.
 *
 * The keys arrive on the panel root, after the surfaces inside it: whatever has
 * an Esc of its own (a full-width drawer, the permission band) acts first and
 * this one does nothing, so one press does one thing. Find is the exception: it
 * stops every key at its bar, and it comes after the mode in the Esc order
 * (menu → window → comment mode → Find), so its Esc is taken on the way down.
 *
 * @module components/Comments/commentModeEscape
 */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { reduceCommentMode } from '../../../../shared/comments/overlayCore/modeState'

/** The slice of a key event the rule reads: a React event and a native one both fit. */
export type ModeEscapeKey = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'defaultPrevented' | 'preventDefault'>

/**
 * Leave comment mode on a plain Esc nothing else took.
 *
 * @param event - The key press.
 * @param mode - Whether comment mode is on, with nothing above it in the Esc order.
 * @param leave - Leaves the mode.
 * @returns Whether the key was taken.
 */
export function takeModeEscape(event: ModeEscapeKey, mode: boolean, leave: () => void): boolean {
  if (event.key !== 'Escape' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return false
  if (!reduceCommentMode({ on: mode }, { type: 'escape' }).consumed) return false
  event.preventDefault()
  leave()
  return true
}

/**
 * The capture-phase half: Esc in the Find bar leaves the mode first, and Find
 * stays open. An IME composition keeps its Esc.
 *
 * @param event - The key press, on its way down through the panel root.
 * @param mode - As for {@link takeModeEscape}.
 * @param leave - Leaves the mode.
 */
export function takeFindEscape(event: ReactKeyboardEvent, mode: boolean, leave: () => void): void {
  const inFind = event.target instanceof Element && event.target.closest('[role="search"]') !== null
  if (!inFind || event.nativeEvent.isComposing) return
  if (takeModeEscape(event, mode, leave)) event.stopPropagation()
}
