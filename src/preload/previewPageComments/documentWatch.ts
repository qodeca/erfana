// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Notices when the page replaces its document element
 * (docs/designs/comments/html-preview-comments.md §9.1 S25; security review M1).
 *
 * `document.open()` erases every event listener of the window and the
 * document – the isolated world's included – and replaces `<html>`. A page
 * that calls it after load silently strips the comment-mode guards, the
 * overlay host's listener and the redraw listeners. Mutation observers
 * survive it, so a `childList` observer on the document sees the old root go
 * and the new one arrive; that is the signal to put the listeners back.
 *
 * The first root the parser creates is not a replacement: at document start
 * (when the preload runs) `document.documentElement` is still `null`.
 */

/**
 * Call `onReplaced` each time `<html>` is replaced by another element.
 *
 * @returns Stops watching.
 */
export function watchDocumentElement(doc: Document, onReplaced: () => void): () => void {
  let root: Element | null = doc.documentElement
  const observer = new MutationObserver(() => {
    const next = doc.documentElement
    // Removed and not yet replaced (an open() with the write still to come).
    if (next === null || next === root) return
    const replaced = root !== null
    root = next
    if (replaced) onReplaced()
  })
  observer.observe(doc, { childList: true })
  return () => observer.disconnect()
}
