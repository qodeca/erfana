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
 * `cwd` — the *live* working directory of the matched process (absolute path),
 * omitted when it cannot be resolved (the caller then falls back to the panel's
 * recorded spawn cwd). `cwd` is meaningless when `running` is false.
 */
export interface ClaudeDetection {
  running: boolean
  cwd?: string
}

/**
 * Strategy interface implemented once per supported OS.
 */
export interface IClaudeProcessDetector {
  /**
   * Determine whether the Claude Code CLI is running as a descendant of
   * `rootPid` (the panel's PTY pid). Fail-closed: any error/timeout resolves
   * `{ running: false }` rather than throwing.
   */
  isClaudeRunning(rootPid: number): Promise<ClaudeDetection>
}
