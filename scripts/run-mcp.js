#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Cross-platform wrapper for running MCP servers via npx.
 *
 * On Windows, npx requires a `cmd /c` wrapper to execute properly.
 * This script detects the platform and spawns npx appropriately.
 *
 * Usage in .mcp.json:
 *   "command": "node",
 *   "args": ["scripts/run-mcp.js", "-y", "@some/mcp-server", "--flag", "value"]
 */
const { spawn } = require('child_process')

const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('Usage: node run-mcp.js <npx-args...>')
  process.exit(1)
}

let child
if (process.platform === 'win32') {
  child = spawn('cmd', ['/c', 'npx', ...args], { stdio: 'inherit' })
} else {
  child = spawn('npx', args, { stdio: 'inherit' })
}

child.on('error', (err) => {
  console.error('Failed to start MCP server:', err.message)
  process.exit(1)
})

child.on('close', (code) => {
  process.exit(code ?? 0)
})
