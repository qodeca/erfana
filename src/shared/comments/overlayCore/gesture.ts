// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Whether a press-and-release in comment mode selects words or picks a
 * target (spec 024 024-FR-004 "in comment mode a mouse drag selects text, and
 * a click picks"; design differences-table "drag of 4 px or more";
 * specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md § 2).
 *
 * Shared overlay core – pure, no imports, no globals, no DOM (see
 * `pinLayout.ts` and docs/adrs/0006-overlay-core-in-the-sealed-preload.md).
 *
 * Not wired yet: in v0.23.1 a drag in comment mode picks, and the preload
 * keeps that until spec 024's selection commit turns this rule on in both
 * previews at once.
 */

/** Pointer travel, in CSS pixels, from which a press-and-release is a drag that selects. */
export const SELECT_DRAG_MIN_PX = 4

/** `select`: comment on the selected words. `pick`: comment on the element or block. */
export type CommentGesture = 'select' | 'pick'

/** A pointer position in CSS pixels. */
export interface GesturePoint {
  readonly x: number
  readonly y: number
}

/** What the overlay saw between the press and the release. */
export interface GestureInput {
  /** Where the primary button went down. */
  readonly down: GesturePoint
  /** Where it came up. */
  readonly up: GesturePoint
  /** The document's selection is collapsed (empty) at release. */
  readonly selectionCollapsed: boolean
}

/**
 * `select` when the selection holds words, or when the pointer travelled at
 * least {@link SELECT_DRAG_MIN_PX} (straight-line distance from press to
 * release); otherwise `pick`. A coordinate that is not a number (`NaN`) makes
 * no distance, so it picks.
 */
export function classifyGesture(input: GestureInput): CommentGesture {
  if (!input.selectionCollapsed) return 'select'
  const travel = Math.hypot(input.up.x - input.down.x, input.up.y - input.down.y)
  return travel >= SELECT_DRAG_MIN_PX ? 'select' : 'pick'
}
