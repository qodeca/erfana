#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Cross-platform wrapper for running MCP servers via npx.
 *
 * On Windows, npx requires a `cmd /c` wrapper to execute properly.
 * This script detects the platform and spawns npx appropriately.
 *
 * The wrapper also owns the server's lifetime (#145). When the MCP client goes
 * away – our stdin ends, or we get SIGTERM, SIGINT or SIGHUP – or when npx
 * exits on its own, the whole server tree is stopped, never left re-parented
 * to launchd/init. Servers have been seen ignoring SIGTERM, so on POSIX the
 * child runs in its own process group, which gets SIGTERM, a short grace
 * period, then SIGKILL. On Windows the tree is stopped with `taskkill /T /F`.
 *
 * Usage in .mcp.json:
 *   "command": "node",
 *   "args": ["scripts/run-mcp.js", "-y", "@some/mcp-server", "--flag", "value"]
 */
const { spawn, spawnSync } = require('child_process')
const { setInterval, clearInterval } = require('timers')

const GRACE_MS = 2000
const POLL_MS = 50
const SIGNAL_EXIT_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }
const isWindows = process.platform === 'win32'

const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('Usage: node run-mcp.js <npx-args...>')
  process.exit(1)
}

// stdin is piped rather than inherited so the wrapper sees the client close it.
// `detached` on POSIX makes the child a process-group leader, so the group –
// npx and the server it starts – can be signalled as one.
const child = isWindows
  ? spawn('cmd', ['/c', 'npx', ...args], { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true })
  : spawn('npx', args, { stdio: ['pipe', 'inherit', 'inherit'], detached: true })

let stopping = false

/** Signal the child's whole tree; returns false once nothing is left to signal. */
function signalTree(signal) {
  if (child.pid === undefined) return false
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return false
  }
  try {
    process.kill(-child.pid, signal)
    return true
  } catch {
    return false // ESRCH: the group is empty
  }
}

function stop(exitCode) {
  if (stopping) return
  stopping = true
  if (!signalTree('SIGTERM')) process.exit(exitCode)
  const deadline = Date.now() + GRACE_MS
  const timer = setInterval(() => {
    if (!signalTree(0)) {
      clearInterval(timer)
      process.exit(exitCode)
    } else if (Date.now() >= deadline) {
      clearInterval(timer)
      signalTree('SIGKILL')
      process.exit(exitCode)
    }
  }, POLL_MS)
}

// Last resort for an exit path that skipped stop(), such as an uncaught error:
// never leave the tree behind. On Windows stop() has already run taskkill.
process.on('exit', () => {
  if (isWindows && stopping) return
  signalTree('SIGKILL')
})

for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
  process.on(signal, () => stop(SIGNAL_EXIT_CODES[signal]))
}

child.stdin.on('error', () => {}) // EPIPE once the child is gone; handled via 'exit'
process.stdin.pipe(child.stdin)
process.stdin.on('end', () => stop(0))
process.stdin.on('close', () => stop(0))
process.stdin.on('error', () => stop(0))

child.on('error', (err) => {
  console.error('Failed to start MCP server:', err.message)
  stop(1)
})

// npx may exit while the server it started is still running: clean up the rest.
child.on('exit', (code, signal) => {
  stop(code ?? (signal ? 1 : 0))
})
