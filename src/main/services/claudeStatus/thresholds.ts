// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Severity-band thresholds and percentage clamping for the Claude status bar.
 *
 * Two distinct percentages are in play and MUST NOT be conflated:
 *  - `levelFor` takes the RAW percentage (e.g. `used / windowSize * 100`) so
 *    the color band never flips because of display rounding (29.9 → green,
 *    not amber). UX comparisons are `pct >= 30` (amber) and `pct >= 60` (red).
 *    On the 1M window these map to 300k tokens (amber) and 600k (red); on the
 *    200k window to 60k and 120k.
 *  - `clampPercent` returns the FLOORED integer (0–100) used for the headline
 *    `%` text and the progress-fill width. Flooring (not rounding) guarantees
 *    the displayed number never reaches a severity band the colour hasn't:
 *    raw 69.6 displays "69" (green), where rounding to "70" would read amber
 *    while the bar is still green.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §5 (UX), §10
 */
import { type ClaudeStatusLevel } from '../../../shared/ipc/claude-status-schema'

export type { ClaudeStatusLevel }

/** Raw-percentage boundary at/above which the band is amber (1M: 300k tokens). */
const AMBER_THRESHOLD = 30
/** Raw-percentage boundary at/above which the band is red (1M: 600k tokens). */
const RED_THRESHOLD = 60

/**
 * Map a RAW context-usage percentage to a severity band.
 *
 * green `<30`, amber `>=30 && <60`, red `>=60`. Boundaries: `30 → amber`,
 * `60 → red`. Pass the unrounded percentage so the band is rounding-stable.
 */
export function levelFor(percent: number): ClaudeStatusLevel {
  if (percent >= RED_THRESHOLD) return 'red'
  if (percent >= AMBER_THRESHOLD) return 'amber'
  return 'green'
}

/**
 * Compute the clamped, floored display percentage (0–100) for `used` tokens
 * against `windowSize`.
 *
 * Uses `Math.floor` (not round) so the displayed integer can never enter a
 * severity band before {@link levelFor} (which reads the raw percentage) does —
 * keeping the number and the colour consistent at band boundaries.
 *
 * Guards `windowSize > 0` (returns 0 otherwise — fail-closed, never NaN/∞).
 * Over-budget usage (>100%) clamps to 100 for display; the raw token count is
 * preserved separately for the tooltip.
 */
export function clampPercent(used: number, windowSize: number): number {
  if (!(windowSize > 0)) return 0
  const raw = (used / windowSize) * 100
  return Math.floor(Math.min(100, Math.max(0, raw)))
}
