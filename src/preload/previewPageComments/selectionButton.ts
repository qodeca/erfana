// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Comment button over a selection, in comment mode (spec 024 024-FR-004;
 * comments-v2 C-16; differences table D-10: in the HTML Preview only in
 * comment mode, because outside it the page owns its mouse).
 *
 * It holds the words a drag selected (or that were selected when the mode
 * came on) and says where the button goes: `gap` pixels above the end
 * of the selection's last line, below it near the viewport top, kept inside
 * the viewport. The selection is read live on every render, so the button
 * follows a scroll and goes once the selection collapses. It never changes
 * the selection.
 */
import { classifyGesture } from '../../shared/comments/overlayCore/gesture'
import { clipToViewport, type Box, type Point, type Viewport } from './geometry'
import { rectsOf, type PageWords } from './words'

/** The button's width, CSS pixels: the icon, "Comment" at the overlay's size, and its padding. */
export const COMMENT_BUTTON_WIDTH_PX = 88

/** The selection's Comment button. */
export class SelectionButton {
  private words: PageWords | null = null
  /** Where the primary button went down: a drag from there selects (overlayCore `gesture`). */
  private downAt: Point | null = null

  constructor(private readonly win: Window) {}

  /** The words the button comments on, while it shows. */
  get current(): PageWords | null {
    return this.words
  }

  /** Show the button for `words` (nothing: hide it). */
  show(words: PageWords | null): void {
    this.words = words
  }

  hide(): void {
    this.words = null
  }

  /** The primary button went down on the page at `at`: a new gesture starts, and the button goes. */
  press(at: Point): void {
    this.downAt = at
    this.words = null
  }

  /**
   * The click that ends the gesture, at `at`, with `words` selected now:
   * true – a drag that selects, and the button shows for the words – or
   * false, a click that picks (024-FR-004).
   */
  release(at: Point, words: PageWords | null): boolean {
    const gesture = classifyGesture({ down: this.downAt ?? at, up: at, selectionCollapsed: words === null })
    this.downAt = null
    if (gesture === 'select') this.words = words
    return gesture === 'select'
  }

  /**
   * The button's box now, `height` tall, `gap` from the selection; `null` –
   * and the words dropped – once the selection is gone or its target left the
   * page.
   */
  box(viewport: Viewport, height: number, gap: number): Box | null {
    if (this.words === null) return null
    const selection = this.win.getSelection()
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0 || !this.words.target.isConnected) {
      this.words = null
      return null
    }
    const last = rectsOf(selection.getRangeAt(0)).at(-1)
    if (last === undefined) return null
    const width = COMMENT_BUTTON_WIDTH_PX
    const left = Math.max(0, Math.min(last.right - width, viewport.width - width))
    const above = last.top - gap - height
    const top = above < 0 ? last.bottom + gap : above
    return clipToViewport({ left, top, width, height }, viewport)
  }
}
