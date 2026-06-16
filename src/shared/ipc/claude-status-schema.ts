// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zod schemas for the per-terminal Claude Code context status bar (issue #216).
 *
 * Defines the display-only snapshot pushed to the renderer, the change-payload
 * envelope (snapshot or null), and the register request. Security remediation
 * §10: the renderer NEVER supplies a pid — `register` carries `terminalId`
 * only; the main process resolves the PTY pid from its own terminal record.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2, §4, §10
 */
import { z } from 'zod'

/**
 * Green/amber/red severity band derived from context-window usage.
 * Boundaries: green `<70%`, amber `70–<90%`, red `>=90%`.
 */
export const ClaudeStatusLevel = z.enum(['green', 'amber', 'red'])
export type ClaudeStatusLevel = z.infer<typeof ClaudeStatusLevel>

/**
 * Context window size in tokens — exactly the standard 200k or the
 * extended 1M variant. No other values are valid (§2 hybrid detection).
 */
export const ClaudeWindowSize = z.union([z.literal(200000), z.literal(1000000)])
export type ClaudeWindowSize = z.infer<typeof ClaudeWindowSize>

/**
 * Display-only snapshot for a single terminal panel's Claude session.
 *
 * - `percent` is the display percentage (0–100, clamped).
 * - `usedTokens` is the raw token count (tooltip shows exact figures).
 * - `tooltip` is the precomputed hover string (e.g. `"84k / 200k"`).
 */
export const ClaudeStatusSnapshotSchema = z.object({
  /** Terminal panel this snapshot belongs to */
  terminalId: z.string().min(1),
  /** Raw Claude model id (e.g. `claude-opus-4-8`) */
  modelId: z.string(),
  /** Friendly, sanitized display name (e.g. `Opus 4.8`) */
  friendlyName: z.string(),
  /** Context window size: 200k or 1M */
  windowSize: ClaudeWindowSize,
  /** Tokens consumed by the latest main-session turn */
  usedTokens: z.number().int().nonnegative(),
  /** Display percentage of the window used (0–100, clamped) */
  percent: z.number().min(0).max(100),
  /** Severity band for color coding */
  level: ClaudeStatusLevel,
  /** Precomputed exact-count tooltip string */
  tooltip: z.string()
})
export type ClaudeStatusSnapshot = z.infer<typeof ClaudeStatusSnapshotSchema>

/**
 * Envelope pushed over `claude-status:changed`. A `null` snapshot tells the
 * renderer to hide the bar for that terminal (fail-closed semantics).
 */
export const ClaudeStatusChangePayloadSchema = z.object({
  /** Terminal panel this change applies to */
  terminalId: z.string().min(1),
  /** New snapshot, or null to hide the bar */
  snapshot: ClaudeStatusSnapshotSchema.nullable()
})
export type ClaudeStatusChangePayload = z.infer<typeof ClaudeStatusChangePayloadSchema>

/**
 * Register request from the renderer. Carries `terminalId` ONLY — the pid is
 * never sent from the renderer (security remediation §10). The main process
 * resolves the PTY pid via the terminal record it created.
 */
export const ClaudeStatusRegisterRequestSchema = z.object({
  /** Terminal panel to begin tracking */
  terminalId: z.string().min(1)
})
export type ClaudeStatusRegisterRequest = z.infer<typeof ClaudeStatusRegisterRequestSchema>

/**
 * Nudge request from the renderer (activity-triggered light re-check). Carries
 * the same terminalId-only shape as register — the pid is never sent (§10).
 */
export const ClaudeStatusNudgeRequestSchema = ClaudeStatusRegisterRequestSchema
export type ClaudeStatusNudgeRequest = z.infer<typeof ClaudeStatusNudgeRequestSchema>

/**
 * Shared contract for the preload Claude-status bridge (`window.api.claudeStatus`).
 *
 * Single source of truth consumed by both the preload implementation and the
 * renderer typing, mirroring {@link ClipboardBridge}. All control methods carry
 * a `terminalId` only — the pid is never sent over IPC (§10).
 */
export interface ClaudeStatusBridge {
  /** Begin tracking Claude status for a terminal panel. */
  register(terminalId: string): Promise<void>
  /** Stop tracking a terminal panel (idempotent). */
  unregister(terminalId: string): Promise<void>
  /** Activity-triggered light re-check for a terminal panel. */
  nudge(terminalId: string): Promise<void>
  /** Subscribe to per-terminal snapshot changes; returns an unsubscribe. */
  onChanged(callback: (payload: ClaudeStatusChangePayload) => void): () => void
}
