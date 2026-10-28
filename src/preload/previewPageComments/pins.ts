// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Speech-bubble pins (docs/designs/comments/html-preview-comments.md §10.5,
 * decisions 20 and 33; tests J-005, J-014).
 *
 * One pin per element, its tail tip on the element's top-right corner, 4 px
 * outward, clamped to the visible part of the element and to the viewport –
 * the frame's visible viewport, scrollbars excluded (`viewportOf`), with the
 * pin's box kept {@link PIN_EDGE_INSET_PX} inside each edge, so a full-width
 * element's pin is never drawn under the page's scrollbar (§19 Rev 4 "pins at
 * the right edge"). Vertically that is the design's clamp as before: an
 * element scrolled partly off keeps its pin at the viewport edge, one fully
 * off has none.
 *
 * A pin whose box would overlap one already placed moves left along the top
 * edge in 22 px steps, never past the left inset; elements are placed in
 * document order, so an ancestor keeps the corner and its descendant moves.
 * The search is bounded: a pin is
 * compared with the pins of its own row only, and takes at most
 * {@link PIN_MAX_STEPS} steps – past that it stays put, overlapping – so a
 * page with hundreds of pins in one row costs little per render. Only
 * elements that are rendered and on screen get a pin (the caller filters);
 * resolved threads never reach here – main counts open threads only, so a
 * count of 0 draws nothing.
 */
import {
  PIN_BODY,
  PIN_BOX_PX,
  PIN_EDGE_INSET_PX,
  PIN_MAX_STEPS,
  PIN_PATH,
  PIN_STEP_PX,
  PIN_TIP,
  PIN_TIP_OFFSET_PX
} from './constants'
import { clipToViewport, overlaps, type Box, type Viewport } from './geometry'

const SVG_NS = 'http://www.w3.org/2000/svg'
const HTML_NS = 'http://www.w3.org/1999/xhtml'

/** The attribute the overlay's words are drawn from (`.erf-hpc-text::before`). */
export const TEXT_ATTRIBUTE = 'data-text'

/**
 * Show `text` in `el` as CSS generated content, never as a text node: Find in
 * page counts text in a shadow root, closed or not, and generated content it
 * does not search (E-022). Unchanged text is not written again.
 */
export function showText(el: Element, text: string): void {
  el.classList.add('erf-hpc-text')
  if (el.getAttribute(TEXT_ATTRIBUTE) !== text) el.setAttribute(TEXT_ATTRIBUTE, text)
}

/** What a pin shows: two "text lines" for one thread, a number, `9+`, or `!` (damaged). */
export type PinContent = 'lines' | '!' | '9+' | `${number}`

/** One element that has a pin, before placement. */
export interface PinInput {
  readonly key: string
  readonly count: number
  readonly status: 'open' | 'damaged'
  readonly element: Element
  /** The element's border box. */
  readonly box: Box
}

/** One placed pin. */
export interface PinPlacement {
  readonly key: string
  readonly count: number
  readonly status: 'open' | 'damaged'
  readonly element: Element
  readonly content: PinContent
  /** The pin's hit box, `size` × `size`. */
  readonly box: Box
}

/** What a pin with `count` open threads shows, or `null` when it is not drawn. */
export function pinContent(count: number, status: 'open' | 'damaged'): PinContent | null {
  if (status === 'damaged') return '!'
  if (count <= 0) return null
  if (count === 1) return 'lines'
  return count > 9 ? '9+' : (`${count}` as PinContent)
}

function documentOrder(a: PinInput, b: PinInput): number {
  if (a.element === b.element) return 0
  // DOCUMENT_POSITION_FOLLOWING (4): b comes after a.
  return (a.element.compareDocumentPosition(b.element) & 4) !== 0 ? -1 : 1
}

/** The drawn bubble inside a pin's hit box: the view box's 2–22 units. */
function bodyOf(box: Box, scale: number): Box {
  const inset = PIN_TIP.x * scale
  return { left: box.left + inset, top: box.top + inset, width: box.width - 2 * inset, height: box.height - 2 * inset }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Place the pins of `inputs` in `viewport` (the frame's visible viewport,
 * `viewportOf`); a pin's box is `size` CSS pixels square.
 */
export function placePins(
  inputs: readonly PinInput[],
  viewport: Viewport,
  size: number = PIN_BOX_PX
): PinPlacement[] {
  const scale = size / PIN_BOX_PX
  const inset = PIN_EDGE_INSET_PX
  const placed: PinPlacement[] = []
  for (const input of [...inputs].sort(documentOrder)) {
    const content = pinContent(input.count, input.status)
    const visible = clipToViewport(input.box, viewport)
    if (content === null || visible === null) continue
    const tipX = visible.left + visible.width + PIN_TIP_OFFSET_PX
    const tipY = visible.top - PIN_TIP_OFFSET_PX
    let left = clamp(tipX - PIN_TIP.x * scale, inset, viewport.width - size - inset)
    const top = clamp(tipY - PIN_TIP.y * scale, inset, viewport.height - size - inset)
    const at = (x: number): Box => ({ left: x, top, width: size, height: size })
    // Collisions are judged on the drawn bubble (20 px inside the 24 px hit
    // box), so pins 22 px apart sit side by side with a 2 px gap. They run
    // after the clamp: every full-width element's pin lands on the same
    // clamped spot, so one in the same row steps left like any other.
    const row = placed.filter(pin => Math.abs(pin.box.top - top) < size).map(pin => bodyOf(pin.box, scale))
    const step = PIN_STEP_PX * scale
    for (let moves = 0; moves < PIN_MAX_STEPS && left - step >= inset; moves += 1) {
      const body = bodyOf(at(left), scale)
      if (!row.some(other => overlaps(other, body))) break
      left -= step
    }
    placed.push({ ...input, content, box: at(left) })
  }
  return placed
}

/** The pin's accessible name (§10.10 "Pin"). */
export function pinName(pin: PinPlacement, label: string): string {
  if (pin.status === 'damaged') return `Damaged comment on ${label}. Open.`
  return `${pin.count} ${pin.count === 1 ? 'comment' : 'comments'} on ${label}. Open.`
}

/** The pin's tooltip (§10.5 "Hover"). */
export function pinTooltip(pin: PinPlacement): string {
  if (pin.status === 'damaged') return 'Damaged comment – click to open'
  return `${pin.count} ${pin.count === 1 ? 'comment' : 'comments'} – click to open`
}

function svgChild(doc: Document, tag: string, attributes: Record<string, string>): Element {
  const node = doc.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
  return node
}

/**
 * The pin's glyph: the bubble plus its content, in a 24-unit view box. A
 * number or `!` is not SVG text (Find in page would count it): it is a box
 * over the bubble's body (`PIN_BODY`, so its middle is `PIN_BODY_MIDDLE_Y`)
 * showing generated content.
 */
function glyph(doc: Document, content: PinContent): Element {
  const svg = svgChild(doc, 'svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' })
  svg.append(svgChild(doc, 'path', { d: PIN_PATH, class: 'erf-hpc-pin__body' }))
  if (content === 'lines') {
    svg.append(svgChild(doc, 'rect', { x: '6', y: '6', width: '12', height: '2', class: 'erf-hpc-pin__line' }))
    svg.append(svgChild(doc, 'rect', { x: '6', y: '10', width: '8', height: '2', class: 'erf-hpc-pin__line' }))
    return svg
  }
  const { x, y, width, height } = PIN_BODY
  const box = svgChild(doc, 'foreignObject', { x: String(x), y: String(y), width: String(width), height: String(height) })
  const count = doc.createElementNS(HTML_NS, 'span')
  count.setAttribute('class', 'erf-hpc-pin__count')
  showText(count, content)
  box.append(count)
  svg.append(box)
  return svg
}

/**
 * Create or update the element of one pin. Content is rebuilt only when it
 * changed; position and state are set every time, through `el.style` only.
 */
export function drawPin(
  doc: Document,
  existing: HTMLElement | undefined,
  pin: PinPlacement,
  options: { readonly label: string; readonly selected: boolean }
): HTMLElement {
  const el = existing ?? doc.createElement('div')
  if (el.dataset.content !== pin.content) {
    el.replaceChildren(glyph(doc, pin.content))
    el.dataset.content = pin.content
  }
  el.className = [
    'erf-hpc-pin',
    pin.status === 'damaged' ? 'erf-hpc-pin--damaged' : '',
    options.selected ? 'erf-hpc-pin--selected' : ''
  ]
    .filter(Boolean)
    .join(' ')
  el.setAttribute('role', 'button')
  el.tabIndex = -1
  el.setAttribute('aria-label', pinName(pin, options.label))
  el.title = pinTooltip(pin)
  el.style.left = `${pin.box.left}px`
  el.style.top = `${pin.box.top}px`
  el.style.width = `${pin.box.width}px`
  el.style.height = `${pin.box.height}px`
  return el
}
