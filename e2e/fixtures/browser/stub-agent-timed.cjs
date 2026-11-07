// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The stub agent of the send tests (`stub-agent.cjs`) with arrival times, for
 * the send-latency bench (spec 025, 025-AC-050, 025-NFR-005).
 *
 * Run in Erfana's terminal as `node stub-agent-timed.cjs <record-file>`. Like
 * the plain stub it turns on bracketed paste, reads raw input, appends every
 * byte to `<record-file>`, echoes the printable part and exits on Ctrl+D. It
 * also appends one line per chunk to `<record-file>.times`:
 * `<process.hrtime in µs> <bytes in the chunk>`. On macOS `process.hrtime` is
 * `mach_absolute_time`, the clock of Chromium's trace timestamps, so the bench
 * can set "the terminal received the text" against an input event in a trace.
 *
 * It prints `STUB-AGENT-READY <record-file name>` once it reads input.
 */
/* global require, process -- CommonJS, run by node in the app's terminal */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- run directly by node, no bundler
const fs = require('node:fs')
// eslint-disable-next-line @typescript-eslint/no-require-imports -- run directly by node, no bundler
const path = require('node:path')

const record = process.argv[2]
if (!record) {
  process.stderr.write('usage: node stub-agent-timed.cjs <record-file>\n')
  process.exit(2)
}
const times = `${record}.times`
fs.writeFileSync(record, '')
fs.writeFileSync(times, '')
process.stdin.setRawMode(true)
process.stdin.resume()
process.stdout.write('\x1b[?2004h')
process.stdout.write(`STUB-AGENT-READY ${path.basename(record)}\r\n`)
process.stdin.on('data', (chunk) => {
  // Stamped first, before any file write, so the time is when the bytes arrived.
  const at = process.hrtime.bigint() / 1000n
  fs.appendFileSync(record, chunk)
  fs.appendFileSync(times, `${at} ${chunk.length}\n`)
  if (chunk.includes(0x04)) {
    process.stdout.write('\x1b[?2004l')
    process.exit(0)
  }
  // eslint-disable-next-line no-control-regex -- the echo drops the paste markers and other controls
  const shown = chunk.toString('utf8').replace(/\x1b\[20[01]~/g, '').replace(/\r/g, '\r\n').replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, '')
  process.stdout.write(shown)
})
