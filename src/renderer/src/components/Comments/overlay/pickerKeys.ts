// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard picker of a renderer-hosted preview (spec 024 024-NFR-006,
 * 024-AC-029; comments-v2 C-08; differences table D-31 – the keys are the
 * HTML preload's: Tab, Shift+Tab, Alt+Up, Alt+Down, Enter, Shift+F10 or the
 * Menu key, Esc).
 *
 * Pure apart from reading the adapter: the host maps a key to a step, and
 * the step to the next target or the sentence the picker says at a level end
 * (A-06).
 *
 * @module components/Comments/overlay/pickerKeys
 */
import type { PreviewCommentAdapter } from './previewAdapter'

/** What a picker key does. */
export type PickerStep = 'next' | 'previous' | 'parent' | 'child' | 'open' | 'menu' | 'exit'

/** The fields of a keydown the picker reads. */
export interface PickerKeyEvent {
  readonly key: string
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

/**
 * The picker step a key is, or `null` for a key the picker leaves alone.
 * A key held with Ctrl or Cmd is never the picker's (copy, Find, the mode
 * shortcut itself).
 */
export function pickerStepOf(event: PickerKeyEvent): PickerStep | null {
  if (event.ctrlKey || event.metaKey) return null
  switch (event.key) {
    case 'Tab':
      return event.altKey ? null : event.shiftKey ? 'previous' : 'next'
    case 'ArrowUp':
      return event.altKey && !event.shiftKey ? 'parent' : null
    case 'ArrowDown':
      return event.altKey && !event.shiftKey ? 'child' : null
    case 'Enter':
      return event.altKey || event.shiftKey ? null : 'open'
    case 'F10':
      return event.shiftKey && !event.altKey ? 'menu' : null
    case 'ContextMenu':
      return 'menu'
    case 'Escape':
      return 'exit'
    default:
      return null
  }
}

/** Where a move step lands: a target, or the sentence said at a level end. */
export type PickerMove = { readonly target: HTMLElement } | { readonly end: 'top' | 'no-child' | 'edge' }

/**
 * The target a move step goes to from `current`.
 *
 * Tab and Shift+Tab walk every target in document order – a nested item is
 * reached after its parent – and stay put at either end; Alt+Up and Alt+Down
 * climb out of and into the current target.
 *
 * @param adapter - The preview's adapter.
 * @param current - The picked target; `null` before the first.
 * @param step - A move step.
 * @param start - Where the walk starts with nothing picked (the first target in view).
 * @returns The next target, or which end was reached.
 */
export function movePicker(
  adapter: PreviewCommentAdapter,
  current: HTMLElement | null,
  step: 'next' | 'previous' | 'parent' | 'child',
  start: () => HTMLElement | null
): PickerMove {
  if (current === null || !current.isConnected) {
    const first = start()
    return first === null ? { end: 'edge' } : { target: first }
  }
  if (step === 'parent') {
    const parent = adapter.parentOf(current)
    return parent === null ? { end: 'top' } : { target: parent }
  }
  if (step === 'child') {
    const child = adapter.childOf(current)
    return child === null ? { end: 'no-child' } : { target: child }
  }
  const order = adapter.targetsInOrder()
  const at = order.indexOf(current)
  const next = order[at + (step === 'next' ? 1 : -1)]
  return next === undefined ? { end: 'edge' } : { target: next }
}

/**
 * The first target whose top is inside `viewport` (C-08.2, menu matrix § 4),
 * else the first target below it, else the first at all.
 */
export function firstTargetInView(adapter: PreviewCommentAdapter, viewport: DOMRect | null): HTMLElement | null {
  const order = adapter.targetsInOrder()
  if (viewport === null) return order[0] ?? null
  const inView = order.find(el => {
    const top = el.getBoundingClientRect().top
    return top >= viewport.top && top < viewport.bottom
  })
  return inView ?? order.find(el => el.getBoundingClientRect().top >= viewport.top) ?? order[0] ?? null
}
