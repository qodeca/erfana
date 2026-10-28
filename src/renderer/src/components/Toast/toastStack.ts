// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * How a new toast joins the stack, now that errors stay until closed
 * (finding [26]).
 *
 * A sticky toast that repeats – a save that keeps failing, a watcher retrying
 * – would otherwise pile up without limit and push everything else off the
 * screen. Two rules keep the stack readable:
 *
 * 1. **Repeats merge.** A toast with the same type, title and message as one
 *    already on screen bumps that toast's `count` (shown as "×3") instead of
 *    adding a second one. Nothing else about the existing toast changes: its
 *    position, its timer and its announcement stay as they were.
 * 2. **Sticky toasts are capped** at {@link MAX_STICKY_TOASTS}. When a new one
 *    would exceed the cap, the OLDEST sticky toast that does not hold keyboard
 *    focus is dropped. Timed toasts are not counted: they clear themselves.
 *
 * Dropping rather than collapsing into a "N more" line: it needs no new UI,
 * and the newest errors are the ones that describe the current state. The
 * Feedback card (docs/design-system/system/components/feedback, proposed) sets no rule for
 * stacking, so this is not a deviation from it.
 */
import type { Toast } from './ToastContext'

/** At most this many toasts that stay until closed are on screen at once. */
export const MAX_STICKY_TOASTS = 5

/** Whether two toasts say the same thing and can merge. */
function sameMessage(a: Toast, b: Omit<Toast, 'id'>): boolean {
  // A toast with an action carries its own callback (approve THIS host), so
  // two of them are never merged into one button.
  return (
    a.action === undefined &&
    b.action === undefined &&
    a.type === b.type &&
    a.title === b.title &&
    a.message === b.message
  )
}

/**
 * The stack after `incoming` arrives.
 *
 * @param stack - Toasts on screen, oldest first
 * @param incoming - The new toast, with its resolved `duration` and a fresh id
 * @param focusedId - Id of the toast holding keyboard focus, if any; never dropped
 * @returns The new stack (a new array; the input is not mutated)
 *
 * @example
 * ```ts
 * setToasts((prev) => addToStack(prev, newToast, focusedToastId()))
 * ```
 */
export function addToStack(stack: readonly Toast[], incoming: Toast, focusedId: string | null): Toast[] {
  const repeat = stack.find((toast) => sameMessage(toast, incoming))
  if (repeat !== undefined) {
    return stack.map((toast) =>
      toast === repeat ? { ...toast, count: (toast.count ?? 1) + 1 } : toast
    )
  }

  const next = [...stack, incoming]
  const isSticky = (toast: Toast): boolean => toast.duration === 0
  let sticky = next.filter(isSticky).length
  if (sticky <= MAX_STICKY_TOASTS) return next

  const kept: Toast[] = []
  for (const toast of next) {
    if (sticky > MAX_STICKY_TOASTS && isSticky(toast) && toast.id !== focusedId && toast !== incoming) {
      sticky -= 1
      continue
    }
    kept.push(toast)
  }
  return kept
}

/**
 * The id of the toast that holds keyboard focus, read from the DOM.
 *
 * @returns The id, or null when focus is not inside a toast
 */
export function focusedToastId(): string | null {
  const active = typeof document === 'undefined' ? null : document.activeElement
  return active?.closest('[data-toast-id]')?.getAttribute('data-toast-id') ?? null
}
