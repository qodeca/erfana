// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Claude Code context status bar (issue #216).
 *
 * A thin (~26px) display-only row pinned to the bottom of a terminal panel,
 * shown only while Claude Code is running in that panel. Renders the friendly
 * model name, a context-window-size badge ("200k" / "1M"), the used percentage,
 * and a green/amber/red meter. Hidden by fully unmounting when there is no
 * snapshot for the terminal (fail-closed).
 *
 * Accessibility (design §10): the meter exposes `role="meter"` with
 * `aria-valuemin/max/now` plus an `aria-valuetext` carrying the exact counts,
 * so the data is available without a keyboard-reachable tooltip. Color is never
 * the sole signal — the percentage text is always shown. Exact counts also
 * appear on hover via the native `title` attribute.
 *
 * @module TerminalPanel/components/ClaudeStatusBar
 * @see docs/designs/216-claude-status-bar.md §5, §10
 */

import { useClaudeStatus } from '../../../../stores/useClaudeStatusStore'
import { TEST_IDS } from '../../../../constants/testids'
import './ClaudeStatusBar.css'

/**
 * Props for {@link ClaudeStatusBar}.
 */
export interface ClaudeStatusBarProps {
  /** Terminal panel this status bar belongs to. */
  terminalId: string
}

/** Human-readable badge text for each supported context window size. */
const WINDOW_BADGE: Record<number, string> = {
  200000: '200k',
  1000000: '1M'
}

/** Accessible name for the meter (WCAG 4.1.2). Kept out of `aria-valuetext`
 * so the word "context" is not doubled by assistive tech. */
const METER_LABEL = 'Claude Code context usage'

/**
 * The marker main appends to the tooltip when the window is inferred. Stripped
 * before the counts are reformatted for `aria-valuetext`, where it is re-placed
 * after the noun rather than left inside the figure.
 */
const INFERRED_MARKER = ' (inferred)'

/**
 * Compose the `aria-valuetext` exact-count phrasing for the meter.
 *
 * Reuses the precomputed `tooltip` (e.g. `"84k / 200k"`) for the rounded
 * token figures and prepends the model + percentage, matching the design's
 * example `"Opus 4.8, 48% used, 84k of 200k tokens"`. The "Claude Code context"
 * naming lives in the meter's `aria-label` instead, so it is not repeated here.
 *
 * Since #41 the window may be INFERRED from the capability registry rather than
 * observed or explicitly configured. The visual tooltip carries that as a
 * trailing `"(inferred)"`, but reusing that string here put the marker
 * mid-sentence — `"84k of 1M (inferred) tokens"`. So the marker is taken from
 * the snapshot's structured `inferred` flag and appended after the noun instead.
 *
 * @param friendlyName - Display model name (already sanitized in main).
 * @param percent - Display percentage (0–100).
 * @param tooltip - Precomputed `used / window` string from the snapshot.
 * @param inferred - Whether the window size was inferred rather than observed.
 * @returns The full accessible value text.
 */
function buildValueText(
  friendlyName: string,
  percent: number,
  tooltip: string,
  inferred: boolean
): string {
  // The tooltip is "84k / 200k", or "84k / 1M (inferred)" since #41. Strip any
  // marker before reformatting the separator, then re-append it after "tokens"
  // so the sentence reads correctly when spoken.
  const counts = tooltip.replace(INFERRED_MARKER, '').trim().replace(' / ', ' of ')
  const suffix = inferred ? INFERRED_MARKER : ''
  return `${friendlyName}, ${percent}% used, ${counts} tokens${suffix}`
}

/**
 * Per-terminal Claude Code context status bar.
 *
 * Returns `null` (fully unmounts) when no snapshot is available for the
 * terminal, so the xterm area reclaims the height.
 *
 * @param props - Component props.
 * @returns The status bar element, or `null` when hidden.
 *
 * @example
 * ```tsx
 * <ClaudeStatusBar terminalId={terminalId} />
 * ```
 */
export function ClaudeStatusBar({ terminalId }: ClaudeStatusBarProps): JSX.Element | null {
  const snapshot = useClaudeStatus(terminalId)

  // No data → hide the bar entirely (fail-closed; xterm reclaims the height).
  if (!snapshot) return null

  const { friendlyName, windowSize, percent, level, tooltip, inferred } = snapshot

  // Clamp the visual fill width to the 0–100 band even if a snapshot ever
  // arrives with an out-of-range percent (defensive; main already clamps).
  const fillPercent = Math.max(0, Math.min(100, percent))
  const badgeText = WINDOW_BADGE[windowSize] ?? `${Math.round(windowSize / 1000)}k`
  const valueText = buildValueText(friendlyName, percent, tooltip, inferred)

  return (
    <div
      className="terminal-claude-statusbar"
      data-testid={TEST_IDS.CLAUDE_STATUS_BAR}
      data-level={level}
      title={tooltip}
    >
      <span className="terminal-claude-statusbar__name">{friendlyName}</span>
      <span
        className="terminal-claude-statusbar__badge"
        data-testid={TEST_IDS.CLAUDE_STATUS_BADGE}
      >
        {badgeText}
      </span>
      <div
        className="terminal-claude-statusbar__meter"
        role="meter"
        aria-label={METER_LABEL}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={valueText}
      >
        <div
          className="terminal-claude-statusbar__fill"
          data-testid={TEST_IDS.CLAUDE_STATUS_FILL}
          style={{ width: `${fillPercent}%` }}
        />
      </div>
      <span className="terminal-claude-statusbar__percent">{percent}%</span>
    </div>
  )
}
