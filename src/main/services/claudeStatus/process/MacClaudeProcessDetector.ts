// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * macOS Claude Code process detector (#216).
 *
 * Walks the process tree below a terminal panel's PTY pid looking for the
 * `claude` CLI, and — on a hit — reads that process's *live* working directory
 * (which keys the transcript dir; design §2 "live cwd from process").
 *
 * Matching rule (design §10 "Match on args, not comm"): `ps -axo
 * pid,ppid,command` exposes the full argv, not the 16-char-truncated `comm`, so
 * a node-launched `claude` (`node …/cli.js`) is still detectable. A process
 * counts as Claude when ANY argv token's basename is exactly `claude` — i.e. a
 * bare `claude` arg or a path ending `/claude`. This deliberately rejects
 * substring look-alikes such as `claude-foo`, `/path/claudexyz`, or a data file
 * argument like `/tmp/claude-notes.txt`, whose basenames are not `claude`.
 *
 * All process inspection uses `execFile` (never `exec`, never `shell:true`)
 * against absolute binary paths, with a numeric-validated pid and a 5s timeout.
 * Every failure path is fail-closed (`{ running: false }` / `cwd` omitted).
 *
 * @see docs/designs/216-claude-status-bar.md §2, §4, §10
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute } from 'node:path'
import type { ClaudeDetection } from './types'
import type { ExecLike } from './exec'
import { AbstractClaudeProcessDetector, isValidPid } from './AbstractClaudeProcessDetector'

// Re-export so existing importers (e.g. MacClaudeProcessDetector.test.ts) that
// pull `ExecLike` from this module keep compiling after the type moved to
// `./exec`.
export type { ExecLike } from './exec'

const execFileAsync = promisify(execFile)

/** Default exec: real `execFile`, promisified. */
const defaultExecFile: ExecLike = (file, args, opts) =>
  execFileAsync(file, args, opts).then((r) => ({ stdout: r.stdout.toString() }))

/** Absolute `ps` binary path (avoids PATH lookup / shell). */
const PS_BIN = '/bin/ps'
/**
 * Absolute `lsof` binary path. On macOS `lsof` ships in `/usr/sbin`; the
 * `/usr/bin` variant does not exist on stock macOS (verified on the build
 * host), so `/usr/sbin/lsof` is the canonical choice.
 */
const LSOF_BIN = '/usr/sbin/lsof'

/** Per-command timeout (ms) — matches the screenshot/dependency detectors. */
const EXEC_TIMEOUT_MS = 5000

/**
 * Explicit stdout cap for `ps`/`lsof` (16 MiB). The whole-process-table `ps`
 * can be large on busy hosts; without a generous `maxBuffer` Node's default
 * 1 MiB cap would ENOBUFS-reject the call, which our catch turns into a
 * fail-closed `{ running: false }` and silently hides the bar. A higher cap
 * lets normal-sized tables through while still bounding memory.
 */
const EXEC_MAX_BUFFER = 16 * 1024 * 1024

/**
 * Short TTL (ms) for the per-rootPid liveness cache. The status service can
 * refresh a terminal ~once per 1.25s; caching the (expensive) ps+lsof result
 * for a few seconds collapses the steady-state cost to one process spawn every
 * {@link LIVENESS_TTL_MS} instead of one per refresh, without making the bar
 * feel stale.
 */
const LIVENESS_TTL_MS = 4000

/** A parsed `ps` row. `command` is the full argv tail of the line. */
interface PsRow {
  pid: number
  ppid: number
  command: string
}

export class MacClaudeProcessDetector extends AbstractClaudeProcessDetector {
  protected readonly livenessTtlMs = LIVENESS_TTL_MS
  readonly resolvesLiveCwd = true

  /**
   * @param exec Injected exec (real `execFile` by default; mocked in tests).
   * @param now Injected clock (defaults to `Date.now`) so tests control TTL
   *   expiry deterministically.
   */
  constructor(exec: ExecLike = defaultExecFile, now: () => number = Date.now) {
    super(exec, now)
  }

  /**
   * Compute liveness from the live process table (the ps+lsof path). Throws on a
   * transient `ps` failure so the base does not cache it; resolves a definite
   * detection otherwise.
   */
  protected async computeDetection(rootPid: number): Promise<ClaudeDetection> {
    // A throw here (spawn error / timeout / ENOBUFS) propagates to the base, which
    // treats it as transient and does not cache the resulting fail-closed value.
    const { stdout } = await this.exec(PS_BIN, ['-axo', 'pid,ppid,command'], {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER,
    })
    const rows = parsePsOutput(stdout)

    const match = this.findClaudeDescendant(rows, rootPid, (r) => commandIsClaude(r.command))
    if (match === undefined) return { running: false }

    // Resolve cwd and start time concurrently. Both are best-effort: a failure of
    // either leaves its field omitted but never demotes `running` (#216).
    const [cwd, startedAtMs] = await Promise.all([
      this.getProcessCwd(match.pid),
      this.getProcessStartTime(match.pid),
    ])

    const detection: ClaudeDetection = { running: true }
    if (cwd !== undefined) detection.cwd = cwd
    if (startedAtMs !== undefined) detection.startedAtMs = startedAtMs
    return detection
  }

  /**
   * Resolve the start time (epoch ms) of `pid` via `ps -p <pid> -o lstart=`.
   * A scoped single-pid call keeps the main `ps -axo pid,ppid,command` parser
   * untouched — BSD `lstart` is a space-bearing field that would break that
   * row regex. Returns undefined on any error / unparseable output; the caller
   * then applies no transcript floor (graceful degrade, #216).
   */
  private async getProcessStartTime(pid: number): Promise<number | undefined> {
    if (!isValidPid(pid)) return undefined
    let stdout: string
    try {
      const res = await this.exec(PS_BIN, ['-p', String(pid), '-o', 'lstart='], {
        timeout: EXEC_TIMEOUT_MS,
        maxBuffer: EXEC_MAX_BUFFER,
        // Force the C locale so `lstart` is emitted in English ctime form. Under a
        // non-English LC_TIME the month name is localized and Date.parse would
        // return NaN → undefined → the floor would silently disable itself (#216).
        env: { ...process.env, LC_ALL: 'C', LC_TIME: 'C' },
      })
      stdout = res.stdout
    } catch {
      return undefined
    }
    return parsePsLstart(stdout)
  }

  /**
   * Resolve the live working directory of `pid` via
   * `lsof -a -p <pid> -d cwd -Fn`. Returns the absolute cwd path, or undefined
   * on any error / malformed / non-absolute output.
   */
  private async getProcessCwd(pid: number): Promise<string | undefined> {
    if (!isValidPid(pid)) return undefined
    let stdout: string
    try {
      const res = await this.exec(
        LSOF_BIN,
        ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
        { timeout: EXEC_TIMEOUT_MS, maxBuffer: EXEC_MAX_BUFFER }
      )
      stdout = res.stdout
    } catch {
      return undefined
    }

    const cwd = parseLsofCwd(stdout)
    if (cwd === undefined || !isAbsolute(cwd)) return undefined
    return cwd
  }
}

/**
 * Parse `ps -axo pid,ppid,command` output into rows. The first two
 * whitespace-separated columns are integer pid/ppid; the rest of the line
 * (preserving internal spaces) is the command. The header row and any line
 * whose first two columns are not integers are skipped.
 */
function parsePsOutput(stdout: string): PsRow[] {
  const rows: PsRow[] = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trimStart()
    if (line === '') continue
    // pid, ppid, then the command (which may contain spaces).
    const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/)
    if (!match) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
    rows.push({ pid, ppid, command: match[3] })
  }
  return rows
}

/**
 * True when any whitespace-separated argv token's basename is exactly `claude`
 * (bare `claude` arg, or a path ending `/claude`). Rejects `claude-foo`,
 * `/path/claudexyz`, and data-file arguments whose basename isn't `claude`.
 */
function commandIsClaude(command: string): boolean {
  for (const token of command.split(/\s+/)) {
    if (token === '') continue
    const basename = token.slice(token.lastIndexOf('/') + 1)
    if (basename === 'claude') return true
  }
  return false
}

/**
 * Parse BSD `ps -o lstart=` output into epoch ms. The field is ctime(3) format —
 * `"Sat Jun  6 11:16:39 2026"` — emitted in English because the probe forces the
 * C locale (see `getProcessStartTime`). It carries no timezone, so it is parsed
 * in LOCAL time, the same clock that stamps filesystem mtimes (the floor compares
 * the two). Note the local-time parse is approximate, not exact: during the
 * once-a-year DST fall-back hour a wall-clock string is ambiguous and may resolve
 * up to an hour off — acceptable because the floor only gates older transcripts
 * and self-corrects on the next turn.
 *
 * Internal runs of whitespace (e.g. `"Jun  6"`) are collapsed before parsing so
 * `Date.parse` tokenizes cleanly. The string must contain a 4-digit year and an
 * `HH:MM:SS` group; this shape guard fails a non-ctime string closed to
 * `undefined` rather than letting `Date.parse`'s leniency coerce it to a
 * wrong-but-valid epoch. Returns undefined for empty / non-conforming / otherwise
 * unparseable input (fail-soft → the caller applies no floor). Exported for unit
 * testing.
 */
export function parsePsLstart(stdout: string): number | undefined {
  const text = stdout.trim().replace(/\s+/g, ' ')
  if (text === '') return undefined
  // Shape guard: a real ctime string has a 4-digit year and a HH:MM:SS time.
  if (!/\d{4}/.test(text) || !/\d{2}:\d{2}:\d{2}/.test(text)) return undefined
  const ms = Date.parse(text)
  // Date.parse yields a finite number or NaN (never ±Infinity), so NaN is the
  // only failure to screen out.
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * Extract the cwd path from `lsof -Fn` output: the `n`-prefixed line following
 * the `cwd` fd record. With `-d cwd` only the cwd descriptor is reported, so the
 * first `n` line is the cwd path. Returns the path (minus the `n` prefix) or
 * undefined.
 */
function parseLsofCwd(stdout: string): string | undefined {
  for (const line of stdout.split('\n')) {
    if (line.startsWith('n')) {
      const path = line.slice(1)
      return path === '' ? undefined : path
    }
  }
  return undefined
}
