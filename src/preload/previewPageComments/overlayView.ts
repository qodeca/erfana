// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the overlay draws inside its closed shadow root
 * (docs/designs/comments/html-preview-comments.md §10.1, §10.2, §10.5, §10.8).
 *
 * - the hover / picker outline and its label, above the element's top-left,
 *   flipped below at the viewport top, clamped sideways;
 * - one speech-bubble pin per commented element (`pins.ts`);
 * - transparent click-shields over iframes that are not commentable inside;
 * - in the top frame in comment mode, the 2 px mode frame and the
 *   "Comment mode – Esc to leave" tab, which moves to the bottom edge while
 *   the pointer is near the top;
 * - the reveal flash (a static highlight, so reduced motion needs nothing);
 * - comment marks over the words comments are about (spec 024 C-12), which
 *   take clicks only in comment mode (C-17);
 * - in comment mode, after a drag that selected words, the Comment button
 *   at the end of the selection (C-16) – a button in the shadow root, its
 *   label generated content like every other word here.
 *
 * Pins and marks are visual only (C-11, differences table D-07): their layer
 * is `aria-hidden`, and a pin has no role, name or tab stop. Assistive tech
 * reaches comments through the picker's announcements, the drawer and the
 * comment stepper.
 *
 * No text node in it (E-022, §10.2): Find in page counts text in a shadow
 * root, closed or not, so every word the overlay shows – the label, the mode
 * tab, a pin's number – is CSS generated content read from a `data-text`
 * attribute (`TEXT_ATTRIBUTE`), which Find does not search. Nor does it hold
 * a live region: what the keyboard picker reaches is said by the comment
 * window's live region, through main (`StepSender`).
 *
 * DOM is built with `createElement` and attributes only – nothing the page
 * wrote is ever parsed as markup here – and positioned through `el.style`.
 */
import { drawPin, showText, type PinPlacement } from './pins'
import type { MarkPlacement } from './marks'
import { boxOf, outlineBox, type Box, type Viewport } from './geometry'
import { labelOf, type LabelParts, type LabelSuffix } from './label'

/** The outlined element, already clipped and snapped. */
export interface OutlineModel {
  readonly box: Box
  readonly selected: boolean
  readonly label: LabelParts
}

/**
 * The outline of `element` in `viewport` with its label (§10.2); `null` when
 * it is off screen.
 *
 * @param comments - Open comments on the element's pin, for the label.
 */
export function outlineModelOf(
  element: Element,
  selected: boolean,
  viewport: Viewport,
  dpr: number,
  suffix: LabelSuffix,
  comments: number
): OutlineModel | null {
  const box = boxOf(element)
  const outlined = outlineBox(box, viewport, dpr)
  return outlined === null ? null : { box: outlined, selected, label: labelOf(element, box, suffix, comments) }
}

/** Everything one render shows. */
export interface ViewModel {
  readonly outline: OutlineModel | null
  readonly pins: readonly PinPlacement[]
  /** The label text a pin's accessible name uses. */
  readonly pinLabel: (pin: PinPlacement) => string
  /** The element whose pin is drawn selected (the one a pick just opened). */
  readonly selected: Element | null
  readonly shields: readonly Box[]
  readonly indicator: { readonly visible: boolean; readonly bottom: boolean }
  readonly flash: Box | null
  /** Comment marks over commented words (C-12); none when absent. */
  readonly marks?: readonly MarkPlacement[]
  /** Marks take clicks (comment mode, C-17). */
  readonly marksClickable?: boolean
  /** The Comment button over a selection (C-16), while it shows. */
  readonly button?: Box | null
}

/** The Comment button's label (comments-v2 C-16; `SELECTION_COPY.button`). */
export const COMMENT_BUTTON_TEXT = 'Comment'

/** The text of the mode tab (§10.10). */
export const MODE_TAB_TEXT = 'Comment mode – Esc to leave'

/** Gap between an element and its label. */
const LABEL_GAP_PX = 2

function part(doc: Document, className: string): HTMLDivElement {
  const el = doc.createElement('div')
  el.className = className
  return el
}

function place(el: HTMLElement, box: Box): void {
  el.style.left = `${box.left}px`
  el.style.top = `${box.top}px`
  el.style.width = `${box.width}px`
  el.style.height = `${box.height}px`
}

function shown(el: HTMLElement, visible: boolean): void {
  el.classList.toggle('erf-hpc-hidden', !visible)
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Lucide `message-square-plus`, 24-unit view box (C-16). */
const BUTTON_ICON_PATHS = [
  'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z',
  'M12 7v6',
  'M9 10h6'
] as const

/**
 * The Comment button: the icon and its label. It takes no focus
 * (`tabindex=-1`) and never moves the selection – its press is kept from
 * the page by the guards and its click is a pick.
 */
function commentButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'erf-hpc-button erf-hpc-hidden'
  button.tabIndex = -1
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of BUTTON_ICON_PATHS) {
    const path = doc.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  const label = doc.createElement('span')
  showText(label, COMMENT_BUTTON_TEXT)
  button.append(svg, label)
  return button
}

/** The overlay's content. */
export class OverlayView {
  private readonly frame: HTMLDivElement
  private readonly tab: HTMLDivElement
  private readonly shields: HTMLDivElement
  private readonly flash: HTMLDivElement
  private readonly outline: HTMLDivElement
  private readonly label: HTMLDivElement
  private readonly labelTag: HTMLSpanElement
  private readonly labelRest: HTMLSpanElement
  private readonly labelSize: HTMLSpanElement
  private readonly pinLayer: HTMLDivElement
  private readonly markLayer: HTMLDivElement
  private readonly button: HTMLButtonElement
  private readonly pinElements = new Map<string, HTMLElement>()

  constructor(
    private readonly doc: Document,
    root: ShadowRoot,
    private readonly labelHeight: number
  ) {
    const container = part(doc, 'erf-hpc-root')
    this.frame = part(doc, 'erf-hpc-frame erf-hpc-hidden')
    this.tab = part(doc, 'erf-hpc-tab erf-hpc-hidden')
    showText(this.tab, MODE_TAB_TEXT)
    this.tab.setAttribute('aria-hidden', 'true')
    this.shields = part(doc, 'erf-hpc-shields')
    this.flash = part(doc, 'erf-hpc-flash erf-hpc-hidden')
    this.outline = part(doc, 'erf-hpc-outline erf-hpc-hidden')
    this.label = part(doc, 'erf-hpc-label erf-hpc-hidden')
    this.label.setAttribute('aria-hidden', 'true')
    this.labelTag = doc.createElement('span')
    this.labelTag.className = 'erf-hpc-label__tag'
    this.labelRest = doc.createElement('span')
    this.labelSize = doc.createElement('span')
    this.labelSize.className = 'erf-hpc-label__size'
    this.label.append(this.labelTag, this.labelRest, this.labelSize)
    this.pinLayer = part(doc, 'erf-hpc-pins')
    this.pinLayer.setAttribute('aria-hidden', 'true')
    this.markLayer = part(doc, 'erf-hpc-marks')
    this.markLayer.setAttribute('aria-hidden', 'true')
    this.button = commentButton(doc)
    container.append(this.frame, this.tab, this.shields, this.markLayer, this.flash, this.outline, this.label, this.pinLayer, this.button)
    root.replaceChildren(container)
  }

  /** Draw `model` in `viewport`. */
  render(model: ViewModel, viewport: Viewport): void {
    shown(this.frame, model.indicator.visible)
    shown(this.tab, model.indicator.visible)
    this.tab.classList.toggle('erf-hpc-tab--bottom', model.indicator.bottom)
    this.renderShields(model.shields)
    shown(this.flash, model.flash !== null)
    if (model.flash !== null) place(this.flash, model.flash)
    this.renderOutline(model.outline, viewport)
    this.renderMarks(model.marks ?? [], model.marksClickable === true)
    this.renderPins(model)
    const button = model.button ?? null
    shown(this.button, button !== null)
    if (button !== null) place(this.button, button)
  }

  private renderMarks(marks: readonly MarkPlacement[], clickable: boolean): void {
    this.markLayer.classList.toggle('erf-hpc-marks--clickable', clickable)
    while (this.markLayer.children.length > marks.length) this.markLayer.lastElementChild?.remove()
    while (this.markLayer.children.length < marks.length) this.markLayer.append(part(this.doc, 'erf-hpc-mark'))
    marks.forEach((mark, i) => place(this.markLayer.children[i] as HTMLElement, mark.box))
  }

  private renderShields(boxes: readonly Box[]): void {
    while (this.shields.children.length > boxes.length) this.shields.lastElementChild?.remove()
    while (this.shields.children.length < boxes.length) {
      this.shields.append(part(this.doc, 'erf-hpc-shield'))
    }
    boxes.forEach((box, i) => place(this.shields.children[i] as HTMLElement, box))
  }

  private renderOutline(outline: OutlineModel | null, viewport: Viewport): void {
    shown(this.outline, outline !== null)
    shown(this.label, outline !== null)
    if (outline === null) return
    place(this.outline, outline.box)
    this.outline.classList.toggle('erf-hpc-outline--selected', outline.selected)
    showText(this.labelTag, outline.label.tag)
    showText(this.labelRest, outline.label.rest)
    showText(this.labelSize, outline.label.size)
    this.placeLabel(outline.box, viewport)
  }

  /** Above the element's top-left; below it at the viewport top; inside a huge one. */
  private placeLabel(box: Box, viewport: Viewport): void {
    const height = this.label.offsetHeight || this.labelHeight
    const width = this.label.offsetWidth
    let top = box.top - height - LABEL_GAP_PX
    if (top < 0) top = box.top + box.height + LABEL_GAP_PX
    if (top + height > viewport.height) top = Math.max(box.top, 0) + LABEL_GAP_PX
    const left = Math.max(0, Math.min(box.left, viewport.width - width))
    this.label.style.left = `${left}px`
    this.label.style.top = `${top}px`
  }

  private renderPins(model: ViewModel): void {
    const keep = new Set<string>()
    for (const pin of model.pins) {
      keep.add(pin.key)
      const existing = this.pinElements.get(pin.key)
      const el = drawPin(this.doc, existing, pin, {
        label: model.pinLabel(pin),
        selected: pin.element === model.selected
      })
      if (existing === undefined) {
        this.pinElements.set(pin.key, el)
        this.pinLayer.append(el)
      }
    }
    for (const [key, el] of this.pinElements) {
      if (keep.has(key)) continue
      el.remove()
      this.pinElements.delete(key)
    }
  }
}
