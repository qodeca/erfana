// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page's tree for the keyboard picker (docs/designs/comments/html-preview-comments.md
 * §10.2, §10.8; tests J-002, J-010). The keys and the moves are the overlay
 * core's (`overlayCore/pickerKeys`); this is what a level is on an HTML page.
 *
 * Only elements a reader can see count: not `<script>`, `<style>` and other
 * non-rendered tags, not Erfana's own overlay, not anything without a box.
 * `<body>` is the top: Alt+Up stops there.
 */
import type { PickerTree } from '../../shared/comments/overlayCore/pickerKeys'
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

/** The page below and including `body`, as the picker walks it. `body` is read at each call: a page can replace it. */
export function pageTree(body: () => Element, ok: PickablePredicate): PickerTree<Element> {
  return {
    parent(node) {
      const top = body()
      return node === top || !top.contains(node) ? null : node.parentElement
    },
    firstChild(node) {
      for (const child of node.children) if (ok(child)) return child
      return null
    },
    sibling(node, forward) {
      if (node === body()) return null
      let cur = forward ? node.nextElementSibling : node.previousElementSibling
      while (cur !== null && !ok(cur)) cur = forward ? cur.nextElementSibling : cur.previousElementSibling
      return cur
    }
  }
}

/** Where the picker starts from `hit`: the page's bare margin is no place to start, nothing can be said about it. */
export function pickerStart(hit: Element | null, doc: Document, tree: PickerTree<Element>): Element | null {
  const { body, documentElement } = doc
  if (hit !== null && hit !== body && hit !== documentElement) return hit
  return body !== null ? (tree.firstChild(body) ?? body) : hit
}

/** The element holding focus in `doc`, or `null` when nothing a reader can see does. */
export function focusedElement(doc: Document, ok: PickablePredicate): Element | null {
  const { activeElement, body, documentElement } = doc
  return activeElement === null || activeElement === body || activeElement === documentElement || !ok(activeElement) ? null : activeElement
}
