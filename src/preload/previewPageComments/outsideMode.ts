// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments outside comment mode, read off the page's own input (differences
 * table D-09, D-10; comments-v2 C-16, C-17; docs/designs/comments/
 * spike-outside-mode.md).
 *
 * The page owns its mouse here, so everything in this file only reads: no
 * listener of its own (the guards hand trusted events in), nothing stopped,
 * nothing cancelled (ADR 0006, PIN-S). What it decides waits a task, so the
 * page has had its turn at the event.
 *
 * - **The Comment button** follows a real drag or double-click that left
 *   words selected. A click on a part that selects by script earns nothing,
 *   so a page cannot raise the button by bait; a press on a page control
 *   earns nothing either.
 * - **A click on an underline** opens its thread by the ordinary `icon` pick,
 *   only when it was a plain click on plain text, on the marked element itself
 *   (a page part drawn over the mark keeps its click), and the page let it pass:
 *   not cancelled, and nothing in the page changed during the click's own turn.
 *   Then it waits {@link UNDERLINE_CLICK_WAIT_MS} for a second press, which is
 *   a double-click selecting a word. A page handler that changes nothing at
 *   once cannot be told from no handler, so both act: a stated limit (D-09).
 *
 * This runs in the page's renderer, so none of it is a security check: main
 * decides what a pick may open (`commentPickHandler.ts`, `commentContextGate.ts`).
 */
import { selectsOutsideMode } from '../../shared/comments/overlayCore/gesture'
import { UNDERLINE_CLICK_WAIT_MS } from '../../shared/comments/overlayCore/selectionRules'
import type { Box, Point } from './geometry'
import type { MarkPlacement } from './marks'
import { coversPageControl, onPageControl } from './pageControls'
import type { SelectionButton } from './selectionButton'
import type { TokenRegistry } from './tokens'
import type { PageWords } from './words'

/** What the frame gives this reader. */
export interface OutsideModeDeps {
  readonly win: Window
  readonly doc: Document
  /** Comment mode is off, and the frame can hold comments. */
  readonly open: () => boolean
  /** Erfana's own overlay host. */
  readonly isOverlay: (element: Element) => boolean
  readonly button: SelectionButton
  readonly tokens: TokenRegistry
  /** The page's selected words, if any. */
  readonly words: () => PageWords | null
  /** The comment mark drawn at a point whose element is on an event's `path`. */
  readonly markAt: (point: Point, path: readonly EventTarget[]) => MarkPlacement | null
  /** Counts the page's changes. */
  readonly pageVersion: () => number
  /** The click is the reader's: open the mark's thread. */
  readonly openMark: (mark: MarkPlacement, event: MouseEvent) => void
  /** The button may have gone. */
  readonly redraw: () => void
}

const pointOf = (event: MouseEvent): Point => ({ x: event.clientX, y: event.clientY })

const hasModifier = (event: MouseEvent): boolean => event.altKey || event.ctrlKey || event.metaKey || event.shiftKey

/** One frame's reading of the page's mouse, outside comment mode. */
export class OutsideMode {
  /** Where the primary button went down on the page, in this frame. */
  private down: Point | null = null
  private onControl = false
  /** A click on a mark, waiting out its turn and the double-click wait. */
  private wait: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: OutsideModeDeps) {}

  /** A trusted click-family event, comment mode off. `onOverlay`: it hit Erfana's overlay, never the page. */
  seen(event: Event, onOverlay: boolean): void {
    if (event.type === 'mousedown') this.press(event as MouseEvent, onOverlay)
    else if (!onOverlay && event.type === 'mouseup') this.release(event as MouseEvent)
    else if (!onOverlay && event.type === 'click') this.click(event as MouseEvent)
  }

  /** Whether the page leaves `box` free of its controls, for the button. */
  leavesFree(box: Box): boolean {
    return !coversPageControl(this.deps.doc, this.deps.win, box, this.deps.isOverlay)
  }

  /** Stop the wait (tests, and the document's end). */
  dispose(): void {
    this.cancelWait()
  }

  private press(event: MouseEvent, onOverlay: boolean): void {
    // Any second press ends a click's wait: it is a double-click, or the reader moved on.
    this.cancelWait()
    if (onOverlay || event.button !== 0) return
    this.down = pointOf(event)
    this.onControl = onPageControl(event.composedPath(), this.deps.win)
    this.deps.button.press(this.down)
    this.deps.redraw()
  }

  private release(event: MouseEvent): void {
    const { deps, down } = this
    if (event.button !== 0 || down === null || this.onControl || !deps.open()) return
    if (selectsOutsideMode({ down, up: pointOf(event), clicks: event.detail })) deps.button.selected(() => this.keptWords())
  }

  private click(event: MouseEvent): void {
    const { deps, down } = this
    this.down = null
    if (event.button !== 0 || event.detail !== 1 || down === null || this.onControl || hasModifier(event) || !deps.open()) return
    const at = pointOf(event)
    if (selectsOutsideMode({ down, up: at, clicks: event.detail })) return
    // Empty once the dispatch ends, so the wait below keeps its own copy.
    const path = event.composedPath()
    const mark = deps.markAt(at, path)
    if (mark === null || onPageControl(path, deps.win)) return
    const version = deps.pageVersion()
    this.wait = setTimeout(() => {
      this.wait = null
      if (event.defaultPrevented || deps.pageVersion() !== version) return
      this.wait = setTimeout(() => {
        this.wait = null
        if (this.stillPlain(mark, at, path)) deps.openMark(mark, event)
      }, UNDERLINE_CLICK_WAIT_MS)
    }, 0)
  }

  /** The selected words a pick can carry to main, which keeps nothing else (a word alone in its element gives none). */
  private keptWords(): PageWords | null {
    const words = this.deps.open() ? this.deps.words() : null
    return words?.sel !== undefined && this.deps.tokens.nearestTokened(words.target) !== undefined ? words : null
  }

  /** After the wait: still outside the mode, no words selected, the same mark under the click. */
  private stillPlain(mark: MarkPlacement, at: Point, path: readonly EventTarget[]): boolean {
    const selection = this.deps.win.getSelection()
    const noWords = selection === null || selection.isCollapsed
    return noWords && this.deps.open() && this.deps.markAt(at, path)?.markKey === mark.markKey
  }

  private cancelWait(): void {
    if (this.wait !== null) clearTimeout(this.wait)
    this.wait = null
  }
}
