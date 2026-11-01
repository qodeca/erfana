// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Comment button over a selection, in comment mode (spec 024 024-FR-004;
 * comments-v2 C-16; differences table D-10: in the HTML Preview only in
 * comment mode, because outside it the page owns its mouse).
 *
 * It holds the words a drag selected (or that were selected when the mode
 * came on) and says where the button goes, by the overlay core's one rule
 * (`overlayCore/selectionRules`): about 150 ms after a mouse selection,
 * `gap` pixels above the end of the selection's last line in view, below it
 * near the viewport top, kept inside the viewport. The selection is read live
 * on every render, so the button follows a scroll, leaves with the selection
 * and comes back with it. It never changes the selection.
 *
 * A page script can clear the selection with no input and no page change, and
 * `selectionchange` is a listener this sealed preload does not add (ADR 0006,
 * PIN-S): while the words are held, a timer asks for a redraw.
 */
import { classifyGesture } from '../../shared/comments/overlayCore/gesture'
import { SELECTION_BUTTON_DELAY_MS, buttonGoesBelow, lastLineInView, pointerOnLines, type LineBox } from '../../shared/comments/overlayCore/selectionRules'
import { clipToViewport, type Box, type Point, type Viewport } from './geometry'
import { rectsOf, type PageWords } from './words'

/** The button's width, CSS pixels: the icon, "Comment" at the overlay's size, and its padding. */
export const COMMENT_BUTTON_WIDTH_PX = 88

/** Where a keyboard menu on selected words opens: at the selection's last line (menu matrix § 4), or `null` with no box. */
export function selectionEnd(win: Window): Point | null {
  const last = linesOf(win).at(-1)
  return last === undefined ? null : { x: Math.round(last.left), y: Math.round(last.bottom) }
}

/** The selection's line boxes now. */
function linesOf(win: Window): DOMRect[] {
  const selection = win.getSelection()
  return selection === null || selection.isCollapsed || selection.rangeCount === 0 ? [] : rectsOf(selection.getRangeAt(0))
}

/** The viewport as a line box. */
function viewOf({ width, height }: Viewport): LineBox {
  return { left: 0, top: 0, right: width, bottom: height }
}

/** Whether the pointer at `point` is on the selection: only then is a menu about the words (I-22). */
export function onSelection(win: Window, point: Point): boolean {
  return pointerOnLines(linesOf(win), point)
}

/** Whether the selection shows in `viewport`: words out of view are ignored (C-16, I-12). */
export function selectionInView(win: Window, viewport: Viewport): boolean {
  return lastLineInView(linesOf(win), viewOf(viewport)) !== null
}

/** The selection's Comment button. */
export class SelectionButton {
  private words: PageWords | null = null
  /** Where the primary button went down: a drag from there selects (overlayCore `gesture`). */
  private downAt: Point | null = null
  /** When the wait after a mouse selection ends. */
  private dueAt = Number.NEGATIVE_INFINITY
  private timer: ReturnType<typeof setTimeout> | null = null

  /**
   * @param win - The frame's window.
   * @param now - The clock the wait is read on.
   * @param redraw - Ask for a render: the wait ended, or the selection may have gone.
   */
  constructor(
    private readonly win: Window,
    private readonly now: () => number,
    private readonly redraw: () => void
  ) {}

  /** The words the button comments on, while it holds them. */
  get current(): PageWords | null {
    return this.words
  }

  /** Show the button for `words` at once (nothing: hide it). */
  show(words: PageWords | null): void {
    this.words = words
    this.dueAt = Number.NEGATIVE_INFINITY
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
   * true – a drag that selects, and the button shows for the words after its
   * wait – or false, a click that picks (024-FR-004).
   */
  release(at: Point, words: PageWords | null): boolean {
    const gesture = classifyGesture({ down: this.downAt ?? at, up: at, selectionCollapsed: words === null })
    this.downAt = null
    if (gesture === 'select') {
      this.words = words
      this.dueAt = this.now() + SELECTION_BUTTON_DELAY_MS
      this.watch()
    }
    return gesture === 'select'
  }

  /** Where a keyboard menu on the words opens: at the selection's last line (menu matrix § 4), or `null` with no box. */
  menuPoint(): Point | null {
    return this.words === null ? null : selectionEnd(this.win)
  }

  /** The words, while the selection shows in `viewport`: Enter and the menu act on nothing out of view. */
  wordsInView(viewport: Viewport): PageWords | null {
    return selectionInView(this.win, viewport) ? this.words : null
  }

  /**
   * The button's box now, `height` tall, `gap` from the selection; `null` –
   * and the words dropped – once the selection is gone or its target left the
   * page. Also `null`, with the words kept, while the wait runs or the
   * selection is out of view.
   */
  box(viewport: Viewport, height: number, gap: number): Box | null {
    if (this.words === null) return null
    const selection = this.win.getSelection()
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0 || !this.words.target.isConnected) {
      this.words = null
      return null
    }
    this.watch()
    const last = lastLineInView(rectsOf(selection.getRangeAt(0)), viewOf(viewport))
    if (last === null || this.now() < this.dueAt) return null
    const width = COMMENT_BUTTON_WIDTH_PX
    const left = Math.max(0, Math.min(last.right - width, viewport.width - width))
    const top = buttonGoesBelow(last.top, 0) ? last.bottom + gap : last.top - gap - height
    return clipToViewport({ left, top, width, height }, viewport)
  }

  /** Stop the timer (tests, and the document's end). */
  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  /** One redraw after the wait; `box` asks again for as long as the words are held. */
  private watch(): void {
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.words !== null) this.redraw()
    }, SELECTION_BUTTON_DELAY_MS)
  }
}
