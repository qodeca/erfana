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

/** The page element an overlay hit stands for. */
export function elementOfHit(hit: OverlayHit): Element {
  if (hit.kind === 'pin') return hit.pin.element
  if (hit.kind === 'mark') return hit.mark.element
  return hit.kind === 'button' ? hit.words.target : hit.iframe
}
