// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One shared Windows process snapshot (spec 025 solution design § 9.4, Q8).
 *
 * The Claude-status detector (`WinClaudeProcessDetector`) and the browser's
 * send guard (`terminalForegroundRead.ts`) both need the Windows process tree,
 * and each read costs a PowerShell start. This module runs that query for
 * both: at most one query is in flight, and a reader says how old a snapshot
 * it accepts – the guard takes one up to 10 s old for display, the detector
 * always asks for a new one (its own per-pid cache sets its pace).
 *
 * - {@link ProcessSnapshot.latest}: the last snapshot when it is young enough,
 *   never starts a query.
 * - {@link ProcessSnapshot.read}: the last snapshot when young enough, else
 *   the query already in flight, else a new one. A failed query is not kept,
 *   so the next read retries.
 * - Age is counted from the moment the query started, so a slow PowerShell
 *   never makes a snapshot look newer than it is; a snapshot is young enough
 *   while its age is strictly below the limit (a limit of 0 always queries).
 *
 * The query (moved here from `WinClaudeProcessDetector.ts`) projects pid,
 * parent pid, image name, command line and start time: the detector needs the
 * last two, the guard only the first three. Security: `powershell.exe` is
 * resolved by absolute path off `%SystemRoot%` (never PATH, never `pwsh`), the
 * query is a static string with no runtime value in it, and the child's cwd is
 * pinned to the trusted System32 PowerShell folder (no current-directory DLL
 * planting).
 *
 * @see docs/designs/context-meter/216-claude-status-bar.md §10
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
// Windows paths on any host, so the path logic is unit-testable off Windows.
import { win32 as winPath } from 'node:path'
import type { ExecLike } from '../claudeStatus/process/exec'

const execFileAsync = promisify(execFile)

/** Default exec: real `execFile`, promisified (forwards `cwd` for the DLL-plant defence). */
export const defaultExecFile: ExecLike = (file, args, opts) =>
  execFileAsync(file, args, opts).then((r) => ({ stdout: r.stdout.toString() }))

/** Per-query timeout (ms); PowerShell has a real cold-start cost. */
const EXEC_TIMEOUT_MS = 8000

/**
 * Stdout cap (16 MiB). The `Win32_Process` table is large on busy hosts and
 * Node's default 1 MiB cap would reject it with ENOBUFS.
 */
const EXEC_MAX_BUFFER = 16 * 1024 * 1024

/**
 * Static PowerShell query – NEVER interpolate any runtime value into this.
 *
 * `StartMs` is a numeric epoch-ms computed from `CreationDate`, converted to
 * UTC first and wrapped in try/catch so one unparseable date yields a null
 * instead of blanking the whole snapshot; a plain number also sidesteps
 * Windows PowerShell 5.1's `/Date(ms)/` JSON form. A one-row result still
 * unrolls to a bare object in 5.1; {@link parseWin32Processes} normalises it.
 */
export const PS_QUERY =
  "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{N='StartMs';E={try{if($_.CreationDate){[long]([datetimeoffset]$_.CreationDate.ToUniversalTime()).ToUnixTimeMilliseconds()}else{$null}}catch{$null}}})"

/** A normalised `Win32_Process` row. `startMs` is omitted when unparseable. */
export interface WinProcRow {
  pid: number
  ppid: number
  name: string
  commandLine: string
  startMs?: number
}

/** One completed snapshot and the moment its query started. */
export interface ProcessSnapshotReading {
  readonly rows: readonly WinProcRow[]
  readonly takenAtMs: number
}

/** PowerShell cannot be located on this host (no `%SystemRoot%` / `%windir%`): a stable condition, not a transient failure. */
export class ProcessSnapshotUnavailable extends Error {
  constructor() {
    super('PowerShell is not available: %SystemRoot% and %windir% are unset')
    this.name = 'ProcessSnapshotUnavailable'
  }
}

/**
 * The absolute `powershell.exe` path off `%SystemRoot%` (or `%windir%`), or
 * undefined when neither is set – never guesses a drive.
 */
export function resolvePowershell(): string | undefined {
  const root = process.env.SystemRoot ?? process.env.windir
  if (!root) return undefined
  const p = winPath.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return winPath.isAbsolute(p) ? p : undefined
}

export class ProcessSnapshot {
  private last: ProcessSnapshotReading | null = null
  private inFlight: Promise<ProcessSnapshotReading> | null = null

  /**
   * @param exec Injected exec (real `execFile` by default; mocked in tests).
   * @param now Injected clock, so tests control snapshot age.
   */
  constructor(
    private readonly exec: ExecLike = defaultExecFile,
    private readonly now: () => number = Date.now
  ) {}

  /** The last snapshot when its age is below `maxAgeMs`, else null. Never starts a query. */
  latest(maxAgeMs: number): ProcessSnapshotReading | null {
    const last = this.last
    return last !== null && this.now() - last.takenAtMs < maxAgeMs ? last : null
  }

  /**
   * A snapshot younger than `maxAgeMs`: the last one, the one in flight, or a
   * new one. Rejects with {@link ProcessSnapshotUnavailable} when PowerShell
   * cannot be located, and with the exec's error on a spawn failure, timeout
   * or ENOBUFS (none of which is kept).
   */
  read(maxAgeMs: number): Promise<ProcessSnapshotReading> {
    const young = this.latest(maxAgeMs)
    if (young !== null) return Promise.resolve(young)
    if (this.inFlight !== null) return this.inFlight
    const query = this.query().finally(() => {
      if (this.inFlight === query) this.inFlight = null
    })
    this.inFlight = query
    return query
  }

  private async query(): Promise<ProcessSnapshotReading> {
    const powershell = resolvePowershell()
    if (powershell === undefined) throw new ProcessSnapshotUnavailable()
    const takenAtMs = this.now()
    const { stdout } = await this.exec(powershell, ['-NoProfile', '-NonInteractive', '-Command', PS_QUERY], {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER,
      cwd: winPath.dirname(powershell)
    })
    // Queries never overlap (one in flight), so this one is always the newest.
    this.last = { rows: parseWin32Processes(stdout), takenAtMs }
    return this.last
  }
}

let shared: ProcessSnapshot | null = null

/** The process-wide snapshot both Windows readers share (created on first use). */
export function sharedProcessSnapshot(): ProcessSnapshot {
  shared ??= new ProcessSnapshot()
  return shared
}

/**
 * Parse the `ConvertTo-Json` output of {@link PS_QUERY} into rows. Tolerant by
 * construction: empty input, malformed JSON and rows with non-integer pids are
 * dropped rather than thrown; a bare object reads as a one-row array.
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
    const row = toRow(raw)
    if (row !== null) rows.push(row)
  }
  return rows
}

function toRow(raw: unknown): WinProcRow | null {
  if (raw === null || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  const pid = Number(obj.ProcessId)
  const ppid = Number(obj.ParentProcessId)
  if (!Number.isInteger(pid) || !Number.isInteger(ppid)) return null

  const name = typeof obj.Name === 'string' ? obj.Name : ''
  const commandLine = typeof obj.CommandLine === 'string' ? obj.CommandLine : ''
  const row: WinProcRow = { pid, ppid, name, commandLine }
  const startMs = startMsOf(obj.StartMs)
  if (startMs !== undefined) row.startMs = startMs
  return row
}

/**
 * `StartMs` as a number, or undefined. null/undefined must not coerce to 0
 * (`Number(null) === 0`); a `/Date(ms)/` or ISO string reads as NaN and a
 * negative epoch is implausible – both are dropped (no transcript floor).
 */
function startMsOf(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
