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
 * Usage:
 *   node scripts/stop-orphan-mcp.mjs            stop the orphans
 *   node scripts/stop-orphan-mcp.mjs --dry-run  list what would be stopped
 *
 * macOS and Linux only (reads `ps`); on Windows it prints "not supported".
 */
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { setTimeout as waitFor } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export const MCP_PACKAGES = ['@snowfort/circuit-electron']
const GRACE_MS = 2000
const POLL_MS = 50
const COMMAND_WIDTH = 100

/** Every process as { pid, ppid, age, command }, from one `ps` call. */
export function listProcesses() {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,etime=,command='], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const processes = []
  for (const line of out.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (match) processes.push({ pid: Number(match[1]), ppid: Number(match[2]), age: match[3], command: match[4].trimEnd() })
  }
  return processes
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** True when `command` launches one of `packages` through `npm exec` or `npx`. */
export function isMcpLauncher(command, packages = MCP_PACKAGES) {
  if (!/^npm exec\s|(^|[\s/])npx(\s|$)/.test(command)) return false
  return packages.some((pkg) => new RegExp(`(^|\\s)${escapeRegExp(pkg)}(@\\S*)?(\\s|$)`).test(command))
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

const isAlive = (pid) => {
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
 * target is gone (or nothing was found), 1 when one survived SIGKILL.
 */
export async function stopOrphanMcp({
  dryRun = false,
  packages = MCP_PACKAGES,
  orphanParentPid = 1,
  graceMs = GRACE_MS,
  log = console.log,
} = {}) {
  const targets = findOrphans(listProcesses(), { packages, orphanParentPid })
  if (targets.length === 0) {
    log('No orphaned MCP launchers found.')
    return 0
  }
  if (dryRun) {
    for (const proc of targets) log(`would stop ${describe(proc)}`)
    log(`${targets.length} process(es) would be stopped (dry run, nothing stopped).`)
    return 0
  }

  for (const { pid } of targets) sendSignal(pid, 'SIGTERM')
  const deadline = Date.now() + graceMs
  while (targets.some(({ pid }) => isAlive(pid)) && Date.now() < deadline) await waitFor(POLL_MS)

  // Re-read before SIGKILL so a PID reused by an unrelated process in the
  // meantime is not hit: only a PID still running the same command is killed.
  const survivors = targets.filter(({ pid }) => isAlive(pid))
  if (survivors.length > 0) {
    const current = new Map(listProcesses().map((proc) => [proc.pid, proc.command]))
    for (const { pid, command } of survivors) if (current.get(pid) === command) sendSignal(pid, 'SIGKILL')
    const killDeadline = Date.now() + graceMs
    while (survivors.some(({ pid }) => isAlive(pid)) && Date.now() < killDeadline) await waitFor(POLL_MS)
  }

  let stopped = 0
  let failed = 0
  for (const proc of targets) {
    if (isAlive(proc.pid)) {
      failed++
      log(`FAILED to stop ${describe(proc)}`)
    } else {
      stopped++
      log(`stopped ${describe(proc)}`)
    }
  }
  log(`Stopped ${stopped} process(es).${failed > 0 ? ` ${failed} still running.` : ''}`)
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
