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

/** What the overlay saw of a press-and-release outside comment mode. */
export interface OutsideGestureInput {
  readonly down: GesturePoint
  readonly up: GesturePoint
  /** The release's click count (`MouseEvent.detail`). */
  readonly clicks: number
}

/**
 * Whether a press-and-release outside comment mode is the reader's own
 * selecting: a drag of at least {@link SELECT_DRAG_MIN_PX}, or a double- or
 * triple-click. Stricter than {@link classifyGesture}: a page can select by
 * script on a plain click, and that must earn nothing (differences table D-10).
 * A coordinate that is not a number makes no distance.
 */
export function selectsOutsideMode(input: OutsideGestureInput): boolean {
  return input.clicks >= 2 || Math.hypot(input.up.x - input.down.x, input.up.y - input.down.y) >= SELECT_DRAG_MIN_PX
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
