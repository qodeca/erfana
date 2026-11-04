// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A stand-in CLI agent for e2e/prompt-submit.e2e.ts (#449), run inside the
 * app's real terminal: `node e2e/fixtures/pasteSubmitAgent.cjs`.
 *
 * It reads the terminal in raw mode with bracketed paste on, the way an
 * interactive agent's prompt box does, and keeps the rule such prompt boxes
 * use to tell a pressed Enter from a line break inside pasted text: a carriage
 * return counts as Enter only when it arrives on its own, after the paste has
 * ended. A carriage return that arrives in the same read as other input is
 * part of that input – a line break, not a submit.
 *
 * Like a real prompt box it redraws as text comes in (one status line per
 * read), so the terminal shows output while a paste is still arriving.
 *
 * Prints one line per outcome, short enough for a narrow terminal:
 *   AGENT-READY          listening
 *   AGENT-SUBMIT <n>     Enter arrived on its own after a paste of n characters
 *   AGENT-LINEBREAK      Enter arrived in the same read as the end of the paste
 * and exits after a submit, or after AGENT_IDLE_EXIT_MS without one.
 */
/* global process, setTimeout, clearTimeout -- CommonJS, run by plain Node */

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const CR = '\r'
const AGENT_IDLE_EXIT_MS = 60_000

let pasted = ''
let inPaste = false
let pasteDone = false

process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
// Bracketed paste on, then the ready line
process.stdout.write('\x1b[?2004h')
process.stdout.write('AGENT-READY\r\n')

const idleExit = setTimeout(finish, AGENT_IDLE_EXIT_MS)

function finish() {
  clearTimeout(idleExit)
  process.stdout.write('\x1b[?2004l')
  process.stdin.setRawMode(false)
  process.exit(0)
}

/** Strip the paste markers from one read, tracking whether a paste is open. */
function takePasteText(chunk) {
  let text = ''
  let rest = chunk
  while (rest.length > 0) {
    if (inPaste) {
      const end = rest.indexOf(PASTE_END)
      if (end === -1) {
        text += rest
        return text
      }
      text += rest.slice(0, end)
      rest = rest.slice(end + PASTE_END.length)
      inPaste = false
      pasteDone = true
    } else {
      const start = rest.indexOf(PASTE_START)
      if (start === -1) {
        text += rest
        return text
      }
      text += rest.slice(0, start)
      rest = rest.slice(start + PASTE_START.length)
      inPaste = true
    }
  }
  return text
}

process.stdin.on('data', (chunk) => {
  // Ctrl+C ends the agent, as in a real one
  if (chunk === '\x03') finish()

  if (chunk === CR && pasteDone && !inPaste) {
    process.stdout.write(`\r\nAGENT-SUBMIT ${pasted.length}\r\n`)
    finish()
    return
  }

  // Enter that came in the same read as the end of the paste: a line break
  if (chunk.includes(PASTE_END + CR)) process.stdout.write('\r\nAGENT-LINEBREAK\r\n')
  pasted += takePasteText(chunk)
  // Redraw the status line, as a prompt box redraws while text comes in
  process.stdout.write(`\r\x1b[Kreceived ${pasted.length}`)
})
