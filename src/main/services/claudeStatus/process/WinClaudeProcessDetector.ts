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
 * @see docs/designs/216-claude-status-bar.md §10
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
// This detector builds Windows paths (powershell.exe under %SystemRoot%) and only
// runs on Windows in production. Use the win32 path namespace explicitly so the
// path logic is correct and unit-testable on any host (e.g. Linux CI), not just
// when process.platform === 'win32'.
import { win32 as winPath } from 'node:path'
import type { ExecLike } from './exec'
import type { ClaudeDetection } from './types'
import { AbstractClaudeProcessDetector } from './AbstractClaudeProcessDetector'

const execFileAsync = promisify(execFile)

/** Default exec: real `execFile`, promisified (forwards `cwd` for DLL-plant defence). */
const defaultExecFile: ExecLike = (file, args, opts) =>
  execFileAsync(file, args, opts).then((r) => ({ stdout: r.stdout.toString() }))

/**
 * Per-command timeout (ms). Higher than the macOS detector's 5s because
 * PowerShell has a non-trivial cold-start cost on first invocation.
 */
const EXEC_TIMEOUT_MS = 8000

/**
 * Explicit stdout cap (16 MiB). The whole `Win32_Process` JSON table is large on
 * busy hosts; Node's default 1 MiB cap would ENOBUFS-reject the call, which our
 * catch turns into a fail-closed `{ running: false }` that silently hides the
 * bar. A higher cap lets normal tables through while still bounding memory.
 */
const EXEC_MAX_BUFFER = 16 * 1024 * 1024

/**
 * Short TTL (ms) for the per-rootPid liveness cache. Higher than macOS (4s) to
 * absorb PowerShell cold-start. Worst case: the bar can linger as a "ghost" for
 * up to {@link LIVENESS_TTL_MS} after `claude` exits — acceptable for a
 * display-only bar, and the PTY-exit `unregister` clears the tracking sooner in
 * practice.
 */
const LIVENESS_TTL_MS = 8000

/**
 * Static PowerShell query — NEVER interpolate any runtime value into this.
 *
 * `Win32_Process` is projected to `ProcessId,ParentProcessId,Name,CommandLine`
 * plus `StartMs`, a numeric epoch-ms computed from `CreationDate`. The per-row
 * `StartMs` projection (finding #13):
 *  - converts `CreationDate` to UTC first (`.ToUniversalTime()`) so the
 *    `[datetimeoffset]` cast cannot pick up an ambiguous local offset;
 *  - is wrapped in try/catch so ONE unparseable date yields a null `StartMs`
 *    (tolerated downstream) instead of a terminating error that blanks the WHOLE
 *    snapshot → empty stdout → fail-closed hide;
 *  - sidesteps Windows-PowerShell-5.1's `/Date(ms)/` JSON date form by emitting a
 *    plain number, and folds the start-time read into the same snapshot as the
 *    process table — no second per-pid probe, no TOCTOU race.
 *
 * Array shape: the `@(...)` wrapper does not reliably force an array in 5.1 (a
 * one-element result still unrolls to a bare object); `parseWin32Processes`
 * normalizes that, so the array shape is guaranteed by the parser, not here.
 */
export const PS_QUERY =
  "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{N='StartMs';E={try{if($_.CreationDate){[long]([datetimeoffset]$_.CreationDate.ToUniversalTime()).ToUnixTimeMilliseconds()}else{$null}}catch{$null}}})"

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

/** A normalized `Win32_Process` row. `startMs` omitted when unparseable. */
interface WinProcRow {
  pid: number
  ppid: number
  name: string
  commandLine: string
  startMs?: number
}

/**
 * Resolve the absolute `powershell.exe` path off `%SystemRoot%` (or `%windir%`),
 * never via PATH and never `pwsh`. Fail-closed: returns undefined when the env
 * var is absent (never guesses a drive) or the join is somehow non-absolute.
 */
function resolvePowershell(): string | undefined {
  const root = process.env.SystemRoot ?? process.env.windir
  if (!root) return undefined // fail-closed: never guess a drive
  const p = winPath.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return winPath.isAbsolute(p) ? p : undefined
}

export class WinClaudeProcessDetector extends AbstractClaudeProcessDetector {
  protected readonly livenessTtlMs = LIVENESS_TTL_MS
  /** Windows v1 never resolves the matched process's live cwd (design §10). */
  readonly resolvesLiveCwd = false

  /**
   * @param exec Injected exec (real `execFile` by default; mocked in tests).
   * @param now Injected clock (defaults to `Date.now`) so tests control TTL
   *   expiry deterministically.
   */
  constructor(exec: ExecLike = defaultExecFile, now: () => number = Date.now) {
    super(exec, now)
  }

  /**
   * Compute liveness from a single PowerShell `Win32_Process` snapshot. Throws on
   * a transient PowerShell failure (spawn error / timeout / ENOBUFS) so the base
   * does not cache it; resolves a definite detection otherwise.
   */
  protected async computeDetection(rootPid: number): Promise<ClaudeDetection> {
    const powershell = resolvePowershell()
    // A missing %SystemRoot% is a stable (non-transient) condition; a definite
    // fail-closed result is fine to cache for the short TTL.
    if (powershell === undefined) return { running: false }

    // A throw from the exec (spawn error / timeout / ENOBUFS) propagates to the
    // base, which treats it as transient and does not cache the fail-closed value.
    const { stdout } = await this.exec(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', PS_QUERY],
      {
        timeout: EXEC_TIMEOUT_MS,
        maxBuffer: EXEC_MAX_BUFFER,
        // Pin cwd to powershell's own (trusted) System32 dir so a malicious DLL
        // in the user's project folder cannot be side-loaded via the current
        // directory during interpreter startup.
        cwd: winPath.dirname(powershell),
      }
    )
    const rows = parseWin32Processes(stdout)

    const match = this.findClaudeDescendant(rows, rootPid, (r) =>
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
 * Parse the PowerShell `ConvertTo-Json` output of the `Win32_Process` projection
 * into normalized rows. Tolerant by construction: empty input, malformed JSON,
 * and individual rows with non-integer pids are all dropped rather than thrown.
 * A single object (not an array) is normalized to a one-element array even though
 * the query forces `@(...)`, as belt-and-braces. Exported for unit testing.
 */
export function parseWin32Processes(stdout: string): WinProcRow[] {
  const text = stdout.trim()
  if (text === '') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }

  const arr = Array.isArray(parsed) ? parsed : [parsed]
  const rows: WinProcRow[] = []
  for (const raw of arr) {
    if (raw === null || typeof raw !== 'object') continue
    const obj = raw as Record<string, unknown>

    const pid = Number(obj.ProcessId)
    const ppid = Number(obj.ParentProcessId)
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue

    const name = typeof obj.Name === 'string' ? obj.Name : ''
    const commandLine = typeof obj.CommandLine === 'string' ? obj.CommandLine : ''

    // The PS projection emits `StartMs` as a JSON number or null; null/undefined
    // must NOT coerce to 0 (Number(null) === 0), so guard before Number().
    // A `/Date(ms)/` or ISO string (a non-numeric PS date serialization) coerces
    // to NaN and is dropped; a negative epoch is implausible for a process start
    // and is dropped too (→ no transcript floor, graceful degrade).
    const startMs =
      obj.StartMs === null || obj.StartMs === undefined
        ? undefined
        : (() => {
            const n = Number(obj.StartMs)
            return Number.isFinite(n) && n >= 0 ? n : undefined
          })()

    const row: WinProcRow = { pid, ppid, name, commandLine }
    if (startMs !== undefined) row.startMs = startMs
    rows.push(row)
  }
  return rows
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
