// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Whether a leave may drop the picker's element
 * (docs/designs/comments/html-preview-comments.md §7.3, §10.2, §10.8).
 *
 * A pick main answers with its menu or comment window puts the page behind a
 * still frame: the view is hidden, and hiding it takes the pointer out of the
 * page – on macOS as a trusted `pointerout` with no `relatedTarget`. Treated
 * as the reader's pointer leaving, that dropped the picked element, and after
 * Esc the keyboard picker started again from the viewport centre instead of
 * the pick. So, after such a pick:
 *
 * - `picked` – the pick went out; a leave now is the view hiding (or the
 *   reader's hand), and keeps the element;
 * - `away` – the page has since lost the pointer or been hidden;
 * - the first pointer move on a shown page after that ends the hold, and a
 *   leave clears the hover outline again, as with no window open.
 *
 * A leave while the page is hidden is never the pointer leaving: the view
 * went (a dialog or another tab over the page), so it keeps the element too.
 */

type Phase = 'none' | 'picked' | 'away'

/** The hold of one frame's picker. */
export class PickHold {
  private phase: Phase = 'none'

  /** @param hidden - Whether the page is hidden now (`document.visibilityState`). */
  constructor(private readonly hidden: () => boolean) {}

  /** A pick went out that main answers with its menu or window over the page. */
  picked(): void {
    this.phase = 'picked'
  }

  /** The hover or the keyboard moved the picker, or the mode ended: nothing is held. */
  release(): void {
    this.phase = 'none'
  }

  /** A trusted `visibilitychange`. */
  visibilityChanged(): void {
    if (this.phase === 'picked' && this.hidden()) this.phase = 'away'
  }

  /** A trusted pointer move: back on a shown page after the menu or window, the hover leads again. */
  pointerMoved(): void {
    if (this.phase === 'away' && !this.hidden()) this.phase = 'none'
  }

  /** A trusted leave with no `relatedTarget`: true when the picker keeps its element. */
  pointerLeft(): boolean {
    if (this.phase === 'none') return this.hidden()
    this.phase = 'away'
    return true
  }
}
