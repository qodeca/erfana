// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The only attributes the renderer's comment host writes INTO a preview's
 * rendered content, and their removal from what leaves the preview (spec 024
 * 024-FR-024, 024-AC-032; comments-v2 C-11 "export strips `aria-details` and
 * `tabindex`", E-M10).
 *
 * - `aria-details` on a commented block, pointing at its icon (C-11), so a
 *   screen reader says "has details" while reading;
 * - `tabindex="-1"` on the target the keyboard picker focused (C-08.3).
 *
 * Each is written with a `data-erf-comment-*` marker beside it, so the strip
 * removes exactly what the host added – an author's own `tabindex` or
 * `aria-details` in raw HTML stays – and then every marker. Exports (PDF,
 * DOCX) and a copy of a selection run {@link stripCommentAttributes} on a
 * detached copy; the live content is never touched by the strip.
 *
 * @module components/Comments/overlay/commentContentAttrs
 */

/** Marks an `aria-details` the host wrote (C-11). */
export const DETAILS_MARKER = 'data-erf-comment-details'
/** Marks a `tabindex` the host wrote (C-08.3). */
export const TABINDEX_MARKER = 'data-erf-comment-tabindex'
const MARKER_PREFIX = 'data-erf-comment'

/**
 * Point `block` at its icon (C-11).
 *
 * @param block - A commented block in the rendered content.
 * @param iconId - The id of its icon button.
 */
export function setCommentDetails(block: HTMLElement, iconId: string): void {
  if (block.hasAttribute('aria-details') && !block.hasAttribute(DETAILS_MARKER)) return
  block.setAttribute('aria-details', iconId)
  block.setAttribute(DETAILS_MARKER, '')
}

/**
 * Take back what {@link setCommentDetails} wrote.
 *
 * @param block - A block it was written on.
 */
export function clearCommentDetails(block: HTMLElement): void {
  if (!block.hasAttribute(DETAILS_MARKER)) return
  block.removeAttribute('aria-details')
  block.removeAttribute(DETAILS_MARKER)
}

/**
 * Give `target` the picker's `tabindex="-1"`, unless it has its own.
 *
 * @param target - The picked target.
 * @returns Whether the host wrote it (only then is it the host's to take back).
 */
export function setPickTabIndex(target: HTMLElement): boolean {
  if (target.hasAttribute('tabindex')) return false
  target.setAttribute('tabindex', '-1')
  target.setAttribute(TABINDEX_MARKER, '')
  return true
}

/**
 * Take back what {@link setPickTabIndex} wrote.
 *
 * @param target - The target it was written on.
 */
export function clearPickTabIndex(target: HTMLElement): void {
  if (!target.hasAttribute(TABINDEX_MARKER)) return
  target.removeAttribute('tabindex')
  target.removeAttribute(TABINDEX_MARKER)
}

/**
 * Remove every comment attribute below `root` (inclusive): the host's
 * `aria-details` and `tabindex`, then every `data-erf-comment*` marker.
 *
 * @param root - A detached copy of rendered content (an element or a fragment).
 */
export function stripCommentAttributes(root: Element | DocumentFragment): void {
  const elements = root instanceof Element ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')]
  for (const el of elements) {
    if (el.hasAttribute(DETAILS_MARKER)) el.removeAttribute('aria-details')
    if (el.hasAttribute(TABINDEX_MARKER)) el.removeAttribute('tabindex')
    for (const name of el.getAttributeNames()) if (name.startsWith(MARKER_PREFIX)) el.removeAttribute(name)
  }
}

/**
 * The inner HTML of `content` without comment attributes (exports): read
 * from a detached copy, so the live content keeps them and no HTML is ever
 * parsed from a string.
 *
 * @param content - The rendered content.
 * @returns Its inner HTML, stripped.
 */
export function htmlWithoutCommentAttributes(content: Element): string {
  if (content.querySelector(`[${DETAILS_MARKER}], [${TABINDEX_MARKER}]`) === null) return content.innerHTML
  const copy = content.cloneNode(true) as Element
  stripCommentAttributes(copy)
  return copy.innerHTML
}

/**
 * A copy of a selection inside `content` without comment attributes
 * (024-AC-032 "its text is copied"). While the host has written nothing
 * into `content`, the browser's own copy runs. Otherwise the copy is taken
 * over – the browser's HTML would carry the selection's ancestor blocks with
 * their attributes – as the selection's stripped HTML and its plain text.
 *
 * @param event - The document's `copy` event.
 * @param content - The rendered content the host writes into.
 * @returns Whether the copy was taken over.
 */
export function copyWithoutCommentAttributes(event: ClipboardEvent, content: HTMLElement): boolean {
  const selection = content.ownerDocument.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed || event.clipboardData === null) return false
  const range = selection.getRangeAt(0)
  if (!content.contains(range.commonAncestorContainer)) return false
  if (content.querySelector(`[${DETAILS_MARKER}], [${TABINDEX_MARKER}]`) === null) return false
  const holder = content.ownerDocument.createElement('div')
  holder.append(range.cloneContents())
  stripCommentAttributes(holder)
  event.clipboardData.setData('text/html', holder.innerHTML)
  event.clipboardData.setData('text/plain', selection.toString())
  event.preventDefault()
  return true
}
