// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A stand-in CLI agent for the built-in browser's send tests (spec 025,
 * 025-AC-032, 025-AC-060, 025-AC-070, 025-AC-077).
 *
 * Run in Erfana's terminal as `node stub-agent.cjs <record-file>`: `node` in
 * front is not a shell, so the shell guard lets a send through, as it does for
 * a real agent. The stub turns on bracketed paste as agents do, reads its
 * input raw (no line editing, no echo by the terminal driver), appends every
 * byte it receives to `<record-file>` unchanged, and echoes the printable part
 * so the terminal shows what arrived. The test reads the record file: that is
 * exactly what Erfana typed, paste markers and Enter included.
 *
 * It prints `STUB-AGENT-READY <record-file name>` once it reads input, and
 * exits on Ctrl+D.
 */
/* global require, process -- CommonJS, run by node in the app's terminal */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- run directly by node, no bundler
const fs = require('node:fs')
// eslint-disable-next-line @typescript-eslint/no-require-imports -- run directly by node, no bundler
const path = require('node:path')

const record = process.argv[2]
if (!record) {
  process.stderr.write('usage: node stub-agent.cjs <record-file>\n')
  process.exit(2)
}
fs.writeFileSync(record, '')
process.stdin.setRawMode(true)
process.stdin.resume()
// Bracketed paste on, as an agent's line editor does.
process.stdout.write('\x1b[?2004h')
process.stdout.write(`STUB-AGENT-READY ${path.basename(record)}\r\n`)
process.stdin.on('data', (chunk) => {
  fs.appendFileSync(record, chunk)
  if (chunk.includes(0x04)) {
    process.stdout.write('\x1b[?2004l')
    process.exit(0)
  }
  // eslint-disable-next-line no-control-regex -- the echo drops the paste markers and other controls
  const shown = chunk.toString('utf8').replace(/\x1b\[20[01]~/g, '').replace(/\r/g, '\r\n').replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, '')
  process.stdout.write(shown)
})
