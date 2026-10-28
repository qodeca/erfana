// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Test-only stand-in for `npx <mcp-server>` (#145), shared by
 * run-mcp.test.mjs and stop-orphan-mcp.test.mjs.
 *
 * Like the real `npm exec`, the stand-in launcher starts the server as a
 * grandchild. The server always ignores SIGTERM, as the orphans seen on
 * 25 Sep 2026 did; passing `stubborn` makes the launcher ignore it too. The
 * launcher writes { launcher, server } PIDs to $MCP_STAND_IN_PIDS and appends
 * whatever it reads on stdin to `$MCP_STAND_IN_PIDS.stdin`.
 */
import { writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

const FAKE_NPX = `#!/usr/bin/env node
const { spawn } = require('child_process')
const { writeFileSync, appendFileSync } = require('fs')
if (process.argv.includes('stubborn')) process.on('SIGTERM', () => {})
const server = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' })
writeFileSync(process.env.MCP_STAND_IN_PIDS, JSON.stringify({ launcher: process.pid, server: server.pid }))
process.stdin.on('data', (chunk) => appendFileSync(process.env.MCP_STAND_IN_PIDS + '.stdin', chunk))
setInterval(() => {}, 1000)
`

/** Write an executable `npx` stand-in into `dir` and return its path. */
export function writeFakeNpx(dir) {
  const npx = join(dir, 'npx')
  writeFileSync(npx, FAKE_NPX)
  chmodSync(npx, 0o755)
  return npx
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}
