// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What of Erfana's overlay is under a point (docs/designs/comments/
 * html-preview-comments.md §7.1, §10.5; spec 024 C-16, C-17).
 *
 * The overlay's boxes are hit-tested here, not through the DOM: its host sits
 * in the page's top layer, and a trusted event's target is the host, never
 * the shadow root's node. Topmost first: the Comment button, then pins (the
 * last drawn on top), then – in comment mode only – comment marks, then the
 * click-shields over frames.
 */
import type { FrameElement, Shield } from './frames'
import { contains, type Box, type Point } from './geometry'
import type { MarkPlacement } from './marks'
import type { PinPlacement } from './pins'
import type { PageWords } from './words'

/** What one overlay click or context menu does (`routeOverlayEvent`). */
export interface OverlayActions {
  /** A pin or mark: open its threads. A stack pin names every pin merged into it (C-17); a mark's key names its words (I-13). */
  icon(key: string, element: Element, event: MouseEvent, members?: PinPlacement['members']): void
  /** Pick `element`, with the Comment button's words if any. */
  element(kind: 'open' | 'menu', element: Element, event: MouseEvent, words?: PageWords): void
}

/** What the pointer lights up across pins and marks (C-17 linked hover, I-13). */
export interface LinkedHover {
  /** The pin in its hover look: the one a hovered mark belongs to. */
  readonly pin: string | null
  /** The marks raised to the active look. */
  readonly marks: ReadonlySet<MarkPlacement>
}

/** Nothing lit. */
export const NO_HOVER: LinkedHover = Object.freeze({ pin: null, marks: new Set<MarkPlacement>() })

/** A pin, a comment mark, the Comment button or a shield under the pointer. */
export type OverlayHit =
  | { readonly kind: 'pin'; readonly pin: PinPlacement }
  | { readonly kind: 'mark'; readonly mark: MarkPlacement }
  | { readonly kind: 'button'; readonly words: PageWords }
  | { readonly kind: 'shield'; readonly iframe: FrameElement }

/** The overlay's boxes as last drawn. */
export interface OverlayBoxes {
  /** The Comment button's words and box, while it shows. */
  readonly button: { readonly words: PageWords; readonly box: Box } | null
  readonly pins: readonly PinPlacement[]
  /** Marks that take clicks: none outside comment mode. */
  readonly marks: readonly MarkPlacement[]
  readonly shields: readonly Shield[]
}

/** The topmost overlay part at `point`. */
export function hitAt(boxes: OverlayBoxes, point: Point): OverlayHit | null {
  if (boxes.button !== null && contains(boxes.button.box, point)) return { kind: 'button', words: boxes.button.words }
  for (let i = boxes.pins.length - 1; i >= 0; i -= 1) {
    if (contains(boxes.pins[i].box, point)) return { kind: 'pin', pin: boxes.pins[i] }
  }
  const mark = boxes.marks.find(m => contains(m.box, point))
  if (mark !== undefined) return { kind: 'mark', mark }
  const shield = boxes.shields.find(s => contains(s.box, point))
  return shield === undefined ? null : { kind: 'shield', iframe: shield.frame }
}

/** A hovered mark lights its pin and every box of its words; a hovered pin lights all its marks, a stack pin's too. */
export function linkedHover(hit: OverlayHit | null, marks: readonly MarkPlacement[]): LinkedHover {
  if (hit?.kind === 'mark') {
    const { key, markKey } = hit.mark
    return { pin: key, marks: new Set(marks.filter(mark => mark.markKey === markKey)) }
  }
  if (hit?.kind !== 'pin') return NO_HOVER
  const keys = new Set([hit.pin.key, ...(hit.pin.members ?? []).map(member => member.key)])
  return { pin: null, marks: new Set(marks.filter(mark => keys.has(mark.key))) }
}

/** One trusted primary click, or context menu, on what `hit` is. */
export function routeOverlayEvent(hit: OverlayHit, event: MouseEvent, act: OverlayActions): void {
  const primaryClick = event.type === 'click' && event.button === 0 && event.detail > 0
  if (hit.kind === 'pin' && primaryClick) act.icon(hit.pin.key, hit.pin.element, event, hit.pin.members)
  if (hit.kind === 'mark' && primaryClick) act.icon(hit.mark.markKey, hit.mark.element, event)
  // The Comment button opens the window on its words (C-16).
  if (hit.kind === 'button' && primaryClick) act.element('open', hit.words.target, event, hit.words)
  if (hit.kind !== 'shield') return
  // A shield exists only in comment mode (`shieldsOf`).
  if (primaryClick) act.element('open', hit.iframe, event)
  if (event.type === 'contextmenu') act.element('menu', hit.iframe, event)
}

/** The page element an overlay hit stands for. */
export function elementOfHit(hit: OverlayHit): Element {
  if (hit.kind === 'pin') return hit.pin.element
  if (hit.kind === 'mark') return hit.mark.element
  return hit.kind === 'button' ? hit.words.target : hit.iframe
}
