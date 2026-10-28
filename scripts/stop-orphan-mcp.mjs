// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Stop orphaned npx MCP server launchers (#145).
 *
 * Before scripts/run-mcp.js owned its server's lifetime, an ended Claude Code
 * session could leave `npm exec @snowfort/circuit-electron…` behind, re-parented
 * to PID 1 and spinning a CPU core. This finds such launchers – an `npm exec` /
 * `npx` command line naming a known MCP package, whose parent PID is 1 – plus
 * every process below them, and stops them: SIGTERM, a short bounded wait,
 * then SIGKILL for anything still alive. A launcher whose parent is not PID 1
 * belongs to a live session and is never touched.
 *
 * Recognition is by argument position, never by substring: the executable is
 * `npx` (or `node <path>/npx`) or `npm exec`, and the listed package is the
 * package argument itself. A command line that does not parse that way is not
 * a launcher.
 *
 * Each target's identity is its PID, start time, parent and command. `ps`
 * reports the start time only to the second, so a PID reused within the same
 * second by the same command would look identical; therefore a process is a
 * target only if it started at least MIN_AGE_MS before the first snapshot was
 * taken. It was alive in that snapshot, so any process that later reuses its
 * PID starts after the snapshot – in a later second – and no longer matches.
 * A younger process is refused and reported NOT stopped. One fresh snapshot
 * per signal batch re-confirms the identity of every target before the SIGTERM
 * batch and again before the SIGKILL batch; a process that no longer matches is
 * skipped. Limits that remain: the gap between each snapshot and the signals it
 * gates (Node offers no pidfd to close it), and a wall-clock step backwards of
 * more than a second during the run, which would weaken the age rule.
 *
 * Usage:
 *   node scripts/stop-orphan-mcp.mjs            stop the orphans
 *   node scripts/stop-orphan-mcp.mjs --dry-run  list what would be stopped
 *
 * macOS and Linux only (reads `ps`); on Windows it prints "not supported".
 *
 * The leader-only scripts/xezar-leader-settings.json allows these two commands as exact-command
 * rules (no wildcard, matched under Claude Code's permission rules, which check each part of a
 * compound command on its own), so the Xezar project leader can clear orphans at each tick without
 * a permission prompt – leaked launchers each spin a CPU core and hold the machine over its load
 * ceiling (#145). Not in .claude/settings.json: a rule there would reach every read-only agent too.
 */
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { setTimeout as waitFor } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export const MCP_PACKAGES = ['@snowfort/circuit-electron']
const GRACE_MS = 2000
// Two whole seconds, not one: one second is the lstart resolution, the second is margin.
const MIN_AGE_MS = 2000
const POLL_MS = 50
const COMMAND_WIDTH = 100

/**
 * Every process as { pid, ppid, start, age, command }, from one `ps` call.
 * `start` (lstart, five words, 1-second resolution, in UTC so no clock change
 * repeats a local hour) is the start-time half of a process's identity; a line
 * without one is dropped, so it can never be a target.
 */
export function listProcesses() {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,lstart=,etime=,command='], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
    maxBuffer: 16 * 1024 * 1024,
  })
  const processes = []
  for (const line of out.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(\S+)\s+(.*)$/.exec(line)
    if (match) {
      processes.push({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        start: match[3].replace(/\s+/g, ' '),
        age: match[4],
        command: match[5].trimEnd(),
      })
    }
  }
  return processes
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A UTC lstart value (`Fri Sep 25 16:00:00 2026`) as epoch ms, or NaN when it does not parse. */
export function parseStart(start) {
  const match = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(start ?? '')
  const month = match ? MONTHS.indexOf(match[1]) : -1
  if (month < 0) return NaN
  const [day, hours, minutes, seconds, year] = match.slice(2).map(Number)
  return Date.UTC(year, month, day, hours, minutes, seconds)
}

// Options that may stand between the launcher and its package argument. Any
// other option makes the command line ambiguous (e.g. `--package=<x> <bin>`),
// so it is not treated as a launcher.
const LAUNCHER_OPTIONS = new Set(['-y', '--yes'])
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/

const isProgram = (token, name) => token === name || token.endsWith(`/${name}`)

/**
 * True when `command` launches one of `packages` through `npm exec` or `npx`,
 * judged by argument position: the executable is `npx` (optionally run by
 * `node`) or `npm` followed by `exec`, and the first non-option argument after
 * it is exactly a listed package, optionally `@<version>`. An argument that
 * merely mentions `npx` or a package, or an unknown option, is rejected.
 */
export function isMcpLauncher(command, packages = MCP_PACKAGES) {
  const tokens = command.trim().split(/\s+/)
  let i
  if (isProgram(tokens[0], 'npx')) i = 1
  else if (isProgram(tokens[0], 'node') && isProgram(tokens[1] ?? '', 'npx')) i = 2
  else if (isProgram(tokens[0], 'npm') && tokens[1] === 'exec') i = 2
  else return false
  while (LAUNCHER_OPTIONS.has(tokens[i])) i++
  const arg = tokens[i]
  if (!arg) return false
  return packages.some((pkg) => arg === pkg || (arg.startsWith(`${pkg}@`) && VERSION.test(arg.slice(pkg.length + 1))))
}

/** True when `now` is the same process as `target`: same PID, start time and command. */
const sameStart = (target, now) =>
  Boolean(now) &&
  typeof target.start === 'string' &&
  target.start.length > 0 &&
  now.pid === target.pid &&
  now.start === target.start &&
  now.command === target.command

/**
 * True when `now` (a fresh snapshot entry) may be signalled as `target`: the
 * same process (PID, start time, command) with a parent that is unchanged or
 * the orphan parent (a descendant is re-parented when its launcher exits).
 * Anything unconfirmable – missing, no start time – is refused.
 */
export function isSameProcess(target, now, orphanParentPid = 1) {
  return sameStart(target, now) && (now.ppid === target.ppid || now.ppid === orphanParentPid)
}

/**
 * The orphaned launchers (parent is `orphanParentPid`) and all their
 * descendants, launchers first.
 */
export function findOrphans(processes, { packages = MCP_PACKAGES, orphanParentPid = 1 } = {}) {
  const childrenOf = new Map()
  for (const proc of processes) {
    if (!childrenOf.has(proc.ppid)) childrenOf.set(proc.ppid, [])
    childrenOf.get(proc.ppid).push(proc)
  }
  const found = new Map()
  for (const launcher of processes) {
    if (launcher.ppid !== orphanParentPid || !isMcpLauncher(launcher.command, packages)) continue
    const queue = [launcher]
    while (queue.length > 0) {
      const proc = queue.shift()
      if (found.has(proc.pid)) continue // guards against a cycle in a racy ps snapshot
      found.set(proc.pid, proc)
      queue.push(...(childrenOf.get(proc.pid) ?? []))
    }
  }
  return [...found.values()]
}

const pidIsAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

const sendSignal = (pid, signal) => {
  try {
    process.kill(pid, signal)
  } catch {
    // already gone
  }
}

const describe = ({ pid, ppid, age, command }) => {
  const shown = command.length > COMMAND_WIDTH ? `${command.slice(0, COMMAND_WIDTH - 1)}…` : command
  return `pid=${pid} ppid=${ppid} age=${age} ${shown}`
}

/**
 * Find and stop the orphans. Returns the process exit code: 0 when every
 * target is gone (or nothing was found), 1 when one survived SIGKILL or was
 * refused (too young, or no start time) and is still there.
 * `list`, `signal`, `isAlive`, `clock` and `minAgeMs` are seams for tests.
 */
export async function stopOrphanMcp({
  dryRun = false,
  packages = MCP_PACKAGES,
  orphanParentPid = 1,
  graceMs = GRACE_MS,
  log = console.log,
  list = listProcesses,
  signal = sendSignal,
  isAlive = pidIsAlive,
  clock = Date.now,
  minAgeMs = MIN_AGE_MS,
} = {}) {
  // Taken before `ps` runs: every process it lists was alive at or after this instant.
  const scannedAt = clock()
  const targets = findOrphans(list(), { packages, orphanParentPid })
  if (targets.length === 0) {
    log('No orphaned MCP launchers found.')
    return 0
  }
  const refusal = (proc) => {
    const startMs = parseStart(proc.start)
    if (!Number.isFinite(startMs)) return 'identity not confirmed'
    return startMs <= scannedAt - minAgeMs ? null : 'too young to confirm identity'
  }
  const eligible = targets.filter((proc) => refusal(proc) === null)
  if (dryRun) {
    for (const proc of targets) {
      const reason = refusal(proc)
      log(reason ? `would NOT stop (${reason}) ${describe(proc)}` : `would stop ${describe(proc)}`)
    }
    const refused = targets.length - eligible.length
    log(`${eligible.length} process(es) would be stopped${refused > 0 ? `, ${refused} refused` : ''} (dry run, nothing stopped).`)
    return 0
  }

  // One fresh snapshot per signal batch re-confirms every target's identity,
  // so a PID reused since the last look is skipped, never signalled.
  const confirmedNow = () => {
    const byPid = new Map(list().map((proc) => [proc.pid, proc]))
    return (target) => isSameProcess(target, byPid.get(target.pid), orphanParentPid)
  }
  const waitForExit = async (procs) => {
    const deadline = Date.now() + graceMs
    while (procs.some(({ pid }) => isAlive(pid)) && Date.now() < deadline) await waitFor(POLL_MS)
  }

  const termed = eligible.filter(confirmedNow())
  for (const { pid } of termed) signal(pid, 'SIGTERM')
  await waitForExit(termed)

  const survivors = termed.filter(confirmedNow())
  for (const { pid } of survivors) signal(pid, 'SIGKILL')
  if (survivors.length > 0) await waitForExit(survivors)

  const now = new Map(list().map((proc) => [proc.pid, proc]))
  let stopped = 0
  let gone = 0
  let failed = 0
  for (const proc of targets) {
    // no parsable start time means no identity: while its PID is present, it may still be running
    const running =
      sameStart(proc, now.get(proc.pid)) || (!Number.isFinite(parseStart(proc.start)) && now.has(proc.pid))
    if (termed.includes(proc)) {
      if (running) {
        failed++
        log(`FAILED to stop ${describe(proc)}`)
      } else {
        stopped++
        log(`stopped ${describe(proc)}`)
      }
    } else if (running) {
      failed++
      log(`NOT stopped (${refusal(proc) ?? 'identity not confirmed'}) ${describe(proc)}`)
    } else {
      gone++
      log(`gone before stop, not signalled ${describe(proc)}`)
    }
  }
  const extra = [gone > 0 ? ` ${gone} gone before stop.` : '', failed > 0 ? ` ${failed} still running.` : ''].join('')
  log(`Stopped ${stopped} process(es).${extra}`)
  return failed > 0 ? 1 : 0
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  const flags = process.argv.slice(2)
  const unknown = flags.filter((flag) => flag !== '--dry-run')
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown.join(' ')}\nUsage: node scripts/stop-orphan-mcp.mjs [--dry-run]`)
    process.exit(2)
  }
  if (process.platform === 'win32') {
    console.log('stop-orphan-mcp: not supported on Windows.')
    process.exit(0)
  }
  process.exitCode = await stopOrphanMcp({ dryRun: flags.includes('--dry-run') })
}
