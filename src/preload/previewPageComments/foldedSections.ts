// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Folded sections – `<details>` – and the comments inside them
 * (docs/designs/html-preview-comments.md §7.5 step 6, §7.10, §19 Rev 4
 * "folded sections").
 *
 * A closed `<details>` renders only its summary, so a comment on anything else
 * inside it has no pin and is "Not visible now". Two things open it:
 *
 * - {@link openAround}: a reveal ("Show on page", or a drawer row's Open) of
 *   such an element opens every closed `<details>` around it, outermost first,
 *   before the scroll and the render – so the pin draws and main hears
 *   "visible".
 * - {@link SectionRestore}: after Erfana's own save reload, the top frame opens
 *   again the sections that were open before it (`commentState.openSections`,
 *   read by main in world 996 together with the scroll). A section is named by
 *   its place among the page's `<details>` in document order: a comment block
 *   is a comment node, so a save never moves one. A place the page does not
 *   have opens nothing.
 *
 * Both run only on main's state, the one receive channel: nothing the page
 * sends or dispatches starts either. Only `<details>`: an element hidden any
 * other way (`display: none`, `hidden`, an inactive slide) stays hidden and
 * keeps "Not visible now". Opening one section of an exclusive accordion
 * (`<details name>`) closes its open sibling, as a click on its summary would.
 */
import { RESTORE_BUDGET_MS } from './constants'

const HTML_NS = 'http://www.w3.org/1999/xhtml'

/** An element of the HTML namespace named `name`. */
function isHtml(element: Element, name: string): boolean {
  return element.localName === name && element.namespaceURI === HTML_NS
}

/** An HTML `<details>`. */
function isSection(element: Element): element is HTMLDetailsElement {
  return isHtml(element, 'details')
}

/**
 * Whether `child` is its parent section's summary – the first `<summary>`
 * child – which shows while the section is closed. Walks back from `child`
 * only, so an element that is no summary costs nothing however many siblings
 * it has.
 */
function isSummary(child: Element): boolean {
  if (!isHtml(child, 'summary')) return false
  for (let before = child.previousElementSibling; before !== null; before = before.previousElementSibling) {
    if (isHtml(before, 'summary')) return false
  }
  return true
}

/**
 * Open every closed `<details>` that hides `element`, outermost first, and say
 * how many were opened. A section whose summary holds the element stays
 * closed: its summary shows while it is folded. Walks the element's ancestors
 * only.
 */
export function openAround(element: Element): number {
  const closed: HTMLDetailsElement[] = []
  let child: Element = element
  for (let parent = element.parentElement; parent !== null; child = parent, parent = parent.parentElement) {
    if (isSection(parent) && !parent.open && !isSummary(child)) closed.push(parent)
  }
  for (const section of closed.reverse()) section.open = true
  return closed.length
}

/**
 * Opens again, in the top frame, the sections a save reload folded (§19 Rev
 * 4). The controller starts it before the state's render, so the load's first
 * anchors report already counts a pin inside a reopened section as visible.
 */
export class SectionRestore {
  private pending: number[] = []
  private startedAt = 0
  private frame = 0

  constructor(
    private readonly win: Window,
    private readonly doc: Document,
    private readonly now: () => number
  ) {}

  /**
   * Open the sections at `places` (ascending: an outer one before the ones in
   * it). A place the page has not built yet is tried again each animation
   * frame for up to {@link RESTORE_BUDGET_MS} – the scroll restore's budget –
   * and then dropped.
   */
  start(places: readonly number[]): void {
    this.cancel()
    this.pending = [...places]
    this.startedAt = this.now()
    this.step()
  }

  /** Stop trying: the user scrolled, typed or pressed, or the overlay is going. */
  cancel(): void {
    this.pending = []
    if (this.frame !== 0 && typeof this.win.cancelAnimationFrame === 'function') {
      this.win.cancelAnimationFrame(this.frame)
    }
    this.frame = 0
  }

  private step(): void {
    this.frame = 0
    const sections = this.doc.getElementsByTagName('details')
    this.pending = this.pending.filter(place => {
      const section = sections.item(place)
      if (section === null) return true
      if (isSection(section)) section.open = true
      return false
    })
    const { win } = this
    if (this.pending.length === 0 || this.now() - this.startedAt >= RESTORE_BUDGET_MS || typeof win.requestAnimationFrame !== 'function') {
      this.pending = []
      return
    }
    this.frame = win.requestAnimationFrame(() => this.step())
  }
}
