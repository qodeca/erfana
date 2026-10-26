// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Keyboard picker moves (docs/designs/html-preview-comments.md §10.2, §10.8;
 * tests J-002, J-010).
 *
 * - Tab / Shift+Tab: the next / previous element at the same level, then the
 *   parent's next / previous sibling, climbing until one exists.
 * - Alt+↑: the parent, stopping at `<body>` ("Top of page").
 * - Alt+↓: back down the path Alt+↑ came up, else the first child.
 *
 * Only elements a reader can see count: not `<script>`, `<style>` and other
 * non-rendered tags, not Erfana's own overlay, not anything without a box.
 */
import { isRendered } from './geometry'

/** Tags that never draw a box of their own. */
const SKIPPED_TAGS: ReadonlySet<string> = new Set([
  'base',
  'br',
  'head',
  'link',
  'meta',
  'noscript',
  'script',
  'style',
  'template',
  'title',
  'wbr'
])

/** Whether an element can be shown by the picker. */
export type PickablePredicate = (element: Element) => boolean

/** The default predicate, given the overlay's own host to skip. */
export function pickableExcept(isOverlay: (element: Element) => boolean): PickablePredicate {
  return element => !SKIPPED_TAGS.has(element.localName) && !isOverlay(element) && isRendered(element)
}

function siblingOf(element: Element, forward: boolean, ok: PickablePredicate): Element | null {
  let cur = forward ? element.nextElementSibling : element.previousElementSibling
  while (cur !== null && !ok(cur)) cur = forward ? cur.nextElementSibling : cur.previousElementSibling
  return cur
}

/**
 * The next (or previous) element at the same level, then the parent's next
 * (or previous) sibling. `null` when there is none below `body`.
 */
export function stepOf(
  element: Element,
  forward: boolean,
  body: Element,
  ok: PickablePredicate
): Element | null {
  for (let cur: Element | null = element; cur !== null && cur !== body; cur = cur.parentElement) {
    const sibling = siblingOf(cur, forward, ok)
    if (sibling !== null) return sibling
  }
  return null
}

/** The parent of `element`, or `null` at `body` (or outside it). */
export function parentOf(element: Element, body: Element): Element | null {
  if (element === body || !body.contains(element)) return null
  return element.parentElement
}

/** The first pickable child of `element`, or `null`. */
export function firstChildOf(element: Element, ok: PickablePredicate): Element | null {
  for (const child of element.children) {
    if (ok(child)) return child
  }
  return null
}
