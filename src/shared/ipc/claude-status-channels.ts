// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Claude Code Status IPC Channel Names
 *
 * Type-safe channel name constants for the per-terminal Claude Code context
 * status bar (issue #216). Using constants eliminates typos and enables
 * refactoring across the main/preload/renderer boundary.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §4 - File plan
 */

/**
 * Claude status control channels (invoke/handle pattern).
 *
 * `register` carries only a `terminalId` — the PTY pid is looked up
 * main-side from the terminal record and is NEVER sent over IPC
 * (security remediation §10). `unregister` is idempotent.
 */
export const ClaudeStatusChannels = {
  /** Register a terminal panel for Claude status tracking */
  REGISTER: 'claude-status:register',
  /** Unregister a terminal panel (idempotent; safe to double-call) */
  UNREGISTER: 'claude-status:unregister',
  /** Activity-triggered light re-check for a terminal panel */
  NUDGE: 'claude-status:nudge'
} as const

/**
 * Claude status event channels (send/on pattern, main → renderer push).
 */
export const ClaudeStatusEvents = {
  /** Per-terminal snapshot changed (snapshot or null when bar should hide) */
  CHANGED: 'claude-status:changed'
} as const

/**
 * Union types for channel-name validation.
 */
export type ClaudeStatusChannel = (typeof ClaudeStatusChannels)[keyof typeof ClaudeStatusChannels]
export type ClaudeStatusEvent = (typeof ClaudeStatusEvents)[keyof typeof ClaudeStatusEvents]
