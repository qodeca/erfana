// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Per-OS Claude Code process-detector contract (#216).
 *
 * The status bar must know whether the `claude` CLI is *actively running* in a
 * specific terminal panel, and where its live working directory is (used to key
 * the transcript directory — see design §2 "live cwd from process"). Detection
 * is per-OS because process inspection differs sharply across platforms; the
 * factory in `createProcessDetector.ts` picks the right strategy at runtime.
 *
 * v1 ships `MacClaudeProcessDetector` only; every other platform gets a no-op
 * detector that reports "not running", so the bar simply never appears
 * (graceful) — Windows is deferred to a follow-up issue (design §10).
 *
 * @see docs/designs/216-claude-status-bar.md §4, §10
 */

/**
 * Result of a single liveness probe.
 *
 * `running` — whether a `claude` CLI descendant of the queried PTY pid exists.
 * `cwd` — the *live* working directory of the matched process (absolute path).
 * Per-platform postcondition: macOS resolves it (via lsof) and omits it only on
 * failure; Windows v1 NEVER resolves it (always omitted, design §10). Either way,
 * an absent `cwd` means the caller falls back to the panel's recorded spawn cwd.
 * Check {@link IClaudeProcessDetector.resolvesLiveCwd} to know whether a detector
 * resolves it at all. `cwd` is meaningless when `running` is false.
 * `startedAtMs` — epoch ms of the matched process's start time (from `ps
 * lstart`), used as a transcript-selection floor so a freshly-launched session
 * never picks up a *prior* session's transcript (#216). Omitted when it cannot
 * be resolved (the caller then applies no floor — graceful degrade). Meaningless
 * when `running` is false.
 */
export interface ClaudeDetection {
  running: boolean
  cwd?: string
  startedAtMs?: number
}

/**
 * Strategy interface implemented once per supported OS.
 */
export interface IClaudeProcessDetector {
  /**
   * Whether this detector resolves the matched process's *live* working directory
   * ({@link ClaudeDetection.cwd}). `true` on macOS; `false` on Windows v1 and the
   * no-op detector — callers that need a cwd must use the spawn-cwd fallback. This
   * makes the per-platform postcondition type-expressed rather than implicit.
   */
  readonly resolvesLiveCwd: boolean

  /**
   * Determine whether the Claude Code CLI is running as a descendant of
   * `rootPid` (the panel's PTY pid). Fail-closed: any error/timeout resolves
   * `{ running: false }` rather than throwing.
   */
  isClaudeRunning(rootPid: number): Promise<ClaudeDetection>

  /**
   * Drop any cached liveness entry for a retired pid, bounding cache growth over
   * a long session (finding #2). Optional: the no-op detector caches nothing.
   */
  forget?(rootPid: number): void
}
