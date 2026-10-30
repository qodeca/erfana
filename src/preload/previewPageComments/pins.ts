// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Speech-bubble pins (docs/designs/comments/html-preview-comments.md §10.5,
 * decisions 20 and 33; tests J-005, J-014).
 *
 * One pin per element, its tail tip on the element's top-right corner, 4 px
 * outward, clamped to the visible part of the element and to the viewport –
 * the frame's visible viewport, scrollbars excluded (`viewportOf`), with the
 * pin's box kept `PIN_EDGE_INSET_PX` inside each edge, so a full-width
 * element's pin is never drawn under the page's scrollbar (§19 Rev 4 "pins at
 * the right edge"). Vertically that is the design's clamp as before: an
 * element scrolled partly off keeps its pin at the viewport edge, one fully
 * off has none.
 *
 * A pin whose hit box would overlap one already placed moves left along the
 * top edge in 26 px steps (24 + 2, C-17), never past the left inset; elements
 * are placed in document order, so an ancestor keeps the corner and its
 * descendant moves. At most `PIN_ROW_CAP` pins share a crowded spot: the
 * rest of the row merges into one stack pin, "+3", whose click opens all
 * their threads (C-17). A pin is compared with the slots of its own row only,
 * so a page with hundreds of pins in one row costs little per render. Only
 * elements that are rendered and on screen get a pin (the caller filters);
 * resolved threads never reach here – main counts open threads only, so a
 * count of 0 draws nothing.
 *
 * The placement rule itself is the shared overlay core's `layoutPins` (spec
 * 024), so every preview's pins land alike; this module orders the elements
 * and draws the pins.
 */
import { layoutPins } from '../../shared/comments/overlayCore/pinLayout'
import { PIN_BODY, PIN_BOX_PX, PIN_PATH } from './constants'
import type { Box, Viewport } from './geometry'

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

/** What a pin shows: two "text lines" for one thread, a number, `9+`, `!` (damaged), or `+3` (a stack, C-17). */
export type PinContent = 'lines' | '!' | '9+' | `${number}` | `+${number}`

/** One element that has a pin, before placement. */
export interface PinInput {
  readonly key: string
  readonly count: number
  readonly status: 'open' | 'damaged'
  /** C-06: a thread's target changed – a notched pin (a shape, not a colour). */
  readonly changed?: true
  readonly element: Element
  /** The element's border box. */
  readonly box: Box
}

/** One placed pin. */
export interface PinPlacement {
  readonly key: string
  readonly count: number
  readonly status: 'open' | 'damaged'
  readonly changed?: true
  readonly element: Element
  readonly content: PinContent
  /** The pin's hit box, `size` × `size`. */
  readonly box: Box
  /** A stack pin (C-17): every pin merged into it, in document order; the first gives its key and element. */
  readonly members?: readonly PinInput[]
}

/** Stack pins show at most this many more (C-17 "+3"). */
const STACK_SHOWN_MAX = 99

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

/**
 * Place the pins of `inputs` in `viewport` (the frame's visible viewport,
 * `viewportOf`); a pin's box is `size` CSS pixels square.
 */
export function placePins(
  inputs: readonly PinInput[],
  viewport: Viewport,
  size: number = PIN_BOX_PX
): PinPlacement[] {
  const drawn = [...inputs].sort(documentOrder).flatMap(input => {
    const content = pinContent(input.count, input.status)
    return content === null ? [] : [{ input, content }]
  })
  return layoutPins(
    drawn.map(({ input }) => input.box),
    viewport,
    size
  ).map(({ box, members, stack }): PinPlacement => {
    const { input, content } = drawn[members[0]]
    if (!stack) return { ...input, content, box }
    const merged = members.map(index => drawn[index].input)
    return {
      ...input,
      status: merged.some(member => member.status === 'damaged') ? 'damaged' : 'open',
      content: `+${Math.min(merged.length, STACK_SHOWN_MAX)}`,
      box,
      members: merged
    }
  })
}

/** The pin's name (§10.10 "Pin"): kept as `data-name` since pins are visual only (C-11). */
export function pinName(pin: PinPlacement, label: string): string {
  if (pin.members !== undefined) return `${pin.members.length} more commented elements here. Open.`
  if (pin.status === 'damaged') return `Damaged comment on ${label}. Open.`
  return `${pin.count} ${pin.count === 1 ? 'comment' : 'comments'} on ${label}${pin.changed === true ? ', changed' : ''}. Open.`
}

/** The pin's tooltip (§10.5 "Hover"). */
export function pinTooltip(pin: PinPlacement): string {
  if (pin.members !== undefined) return `${pin.members.length} more commented elements – click to open`
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
    pin.members === undefined ? '' : 'erf-hpc-pin--stack',
    pin.members === undefined && pin.changed === true ? 'erf-hpc-pin--changed' : '',
    pin.status === 'damaged' ? 'erf-hpc-pin--damaged' : '',
    options.selected ? 'erf-hpc-pin--selected' : ''
  ]
    .filter(Boolean)
    .join(' ')
  // Visual only (C-11, D-07): no role, no tab stop; the layer is aria-hidden. The
  // name stays as data for the overlay's own tests and tools, never for assistive tech.
  el.dataset.name = pinName(pin, options.label)
  el.title = pinTooltip(pin)
  el.style.left = `${pin.box.left}px`
  el.style.top = `${pin.box.top}px`
  el.style.width = `${pin.box.width}px`
  el.style.height = `${pin.box.height}px`
  return el
}
