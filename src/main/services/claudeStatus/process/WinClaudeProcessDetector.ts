// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Windows Claude Code process detector (#217).
 *
 * Walks the process tree below a terminal panel's PTY pid looking for the
 * `claude` CLI and — on a hit — reports liveness plus the matched process's
 * start time (used as a transcript-selection floor). Live cwd is NOT resolved on
 * Windows v1: the caller falls back to the panel's recorded spawn cwd (design
 * §10), so `cwd` is always omitted here.
 *
 * Process inspection uses a SINGLE PowerShell bulk query of `Win32_Process`
 * (pid, ppid, name, command line, and a numeric start-time in the same row).
 * Projecting `StartMs` as epoch milliseconds inside the query avoids
 * Windows-PowerShell-5.1's `/Date(ms)/` JSON serialization plus DateTimeKind/
 * offset ambiguity, and collapses what would otherwise be a second per-pid probe
 * (removing its TOCTOU race) into one snapshot. A single matching row would
 * serialize as a bare object (5.1 unrolls a one-element array and lacks
 * `-AsArray`); the array shape is GUARANTEED by `parseWin32Processes` normalizing
 * a bare object to a one-element array, not by the `@(...)` wrapper alone.
 * The query runs through the process-wide snapshot it shares with the browser
 * send guard (`../../process/processSnapshot.ts`, spec 025 § 9.4): one query in
 * flight for both.
 *
 * Matching rule (design §10 "Match on args, not comm"): a process counts as
 * Claude when its image name is a `claude` shim (`claude.exe`/`.cmd`/`.bat`)
 * OR any command-line token's basename is exactly `claude`/that shim set,
 * OR a token ends with the anchored suffix `\@anthropic-ai\claude-code\cli.js`
 * (catches a node-launched `claude`). This deliberately REJECTS substring
 * look-alikes such as `C:\Users\claude\notes.txt` or `claude-foo.exe`.
 *
 * Security: `powershell.exe` is resolved by ABSOLUTE path off `%SystemRoot%`
 * (never via PATH, never `pwsh`); the query is a STATIC constant string with NO
 * runtime interpolation (no pid ever reaches the argv); the child's cwd is pinned
 * to the trusted System32 powershell dir to defeat current-directory DLL-planting.
 * Every failure path is fail-closed (`{ running: false }`).
 *
 * @see docs/designs/context-meter/216-claude-status-bar.md §10
 */
import type { ExecLike } from './exec'
import type { ClaudeDetection } from './types'
import { AbstractClaudeProcessDetector } from './AbstractClaudeProcessDetector'
import {
  defaultExecFile,
  ProcessSnapshot,
  ProcessSnapshotUnavailable,
  sharedProcessSnapshot,
  type WinProcRow
} from '../../process/processSnapshot'

// The query and its parser live in the shared snapshot module (spec 025 § 9.4);
// re-exported so this detector's callers and tests keep their import path.
export { PS_QUERY, parseWin32Processes } from '../../process/processSnapshot'

/**
 * Short TTL (ms) for the per-rootPid liveness cache. Higher than macOS (4s) to
 * absorb PowerShell cold-start. Worst case: the bar can linger as a "ghost" for
 * up to {@link LIVENESS_TTL_MS} after `claude` exits — acceptable for a
 * display-only bar, and the PTY-exit `unregister` clears the tracking sooner in
 * practice.
 */
const LIVENESS_TTL_MS = 8000

/**
 * Snapshot age this detector accepts: none. It always asks the shared snapshot
 * for a new query (joining one already in flight), so its freshness is set by
 * its own per-pid cache exactly as before the snapshot was shared; the browser
 * send guard is the reader that reuses these snapshots.
 */
const SNAPSHOT_MAX_AGE_MS = 0

/** Image names that denote the Claude CLI directly (lowercased basenames). */
const CLAUDE_IMAGE_NAMES = new Set(['claude.exe', 'claude.cmd', 'claude.bat'])

/** Command-line token basenames that denote the Claude CLI (lowercased). */
const CLAUDE_TOKEN_BASENAMES = new Set([
  'claude',
  'claude.exe',
  'claude.cmd',
  'claude.bat',
  'claude.ps1',
])

/** Anchored suffix of a node-launched Claude CLI entrypoint (back-slashed, lowercased). */
const CLI_JS_SUFFIX = '\\@anthropic-ai\\claude-code\\cli.js'

export class WinClaudeProcessDetector extends AbstractClaudeProcessDetector {
  protected readonly livenessTtlMs = LIVENESS_TTL_MS
  /** Windows v1 never resolves the matched process's live cwd (design §10). */
  readonly resolvesLiveCwd = false

  /** The process snapshot: the process-wide shared one, or a private one over an injected exec. */
  private readonly snapshot: ProcessSnapshot

  /**
   * @param exec Injected exec (mocked in tests). Without it the detector reads
   *   the process-wide {@link sharedProcessSnapshot}; with it, a private
   *   snapshot over that exec, so a test never shares state with another.
   * @param now Injected clock (defaults to `Date.now`) so tests control TTL
   *   expiry deterministically.
   */
  constructor(exec?: ExecLike, now: () => number = Date.now) {
    super(exec ?? defaultExecFile, now)
    this.snapshot = exec === undefined ? sharedProcessSnapshot() : new ProcessSnapshot(exec, now)
  }

  /**
   * Compute liveness from a `Win32_Process` snapshot. Throws on a transient
   * PowerShell failure (spawn error / timeout / ENOBUFS) so the base does not
   * cache it; resolves a definite detection otherwise.
   */
  protected async computeDetection(rootPid: number): Promise<ClaudeDetection> {
    let rows: readonly WinProcRow[]
    try {
      rows = (await this.snapshot.read(SNAPSHOT_MAX_AGE_MS)).rows
    } catch (error) {
      // A missing %SystemRoot% is a stable (non-transient) condition; a definite
      // fail-closed result is fine to cache for the short TTL. Any other throw
      // propagates to the base, which treats it as transient.
      if (error instanceof ProcessSnapshotUnavailable) return { running: false }
      throw error
    }

    const match = this.findClaudeDescendant([...rows], rootPid, (r) =>
      commandIsClaude(r.name, r.commandLine)
    )
    if (match === undefined) return { running: false }

    const detection: ClaudeDetection = { running: true }
    // startMs comes from the SAME snapshot row (no second probe). Omitted when
    // unparseable → the caller applies no transcript floor (graceful degrade).
    if (match.startMs !== undefined) detection.startedAtMs = match.startMs
    return detection
  }
}

/**
 * Precise Claude-CLI matcher (no over-match). True when:
 *  - the image `name` (lowercased) is a `claude` shim, OR
 *  - any command-line token's basename (after stripping quotes; last `\` or `/`)
 *    is exactly `claude` / a `claude` shim, OR
 *  - a token (slashes normalized to `\`, lowercased) ends with the anchored
 *    suffix `\@anthropic-ai\claude-code\cli.js` (a node-launched `claude`).
 *
 * Linear, no backtracking regex. Rejects paths that merely CONTAIN "claude"
 * (e.g. `C:\Users\claude\notes.txt`, `claude-foo.exe`).
 */
function commandIsClaude(name: string, commandLine: string): boolean {
  if (CLAUDE_IMAGE_NAMES.has(name.toLowerCase())) return true

  for (const rawToken of commandLine.split(/\s+/)) {
    if (rawToken === '') continue
    const token = stripQuotes(rawToken)
    if (token === '') continue

    const cut = Math.max(token.lastIndexOf('\\'), token.lastIndexOf('/'))
    const basename = token.slice(cut + 1).toLowerCase()
    if (CLAUDE_TOKEN_BASENAMES.has(basename)) return true

    const normalized = token.replace(/\//g, '\\').toLowerCase()
    if (normalized.endsWith(CLI_JS_SUFFIX)) return true
  }

  // Spaces-in-path fallback: a node-launched cli.js whose path contains spaces
  // (e.g. under "C:\Program Files\") is split mid-token above. Test the whole
  // command line (trailing quote stripped, slashes normalized, lowercased) against
  // the anchored cli.js suffix — still anchored on the `\` boundary, so it cannot
  // match a path that merely contains "claude".
  const whole = commandLine.replace(/["']+$/, '').replace(/\//g, '\\').toLowerCase()
  if (whole.endsWith(CLI_JS_SUFFIX)) return true

  return false
}

/** Strip a single pair of surrounding single/double quotes from a token. */
function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0]
    const last = token[token.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1)
    }
  }
  return token
}
