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
 * It takes its input slowly, READ_CHARS (~1 KiB) per read, one read every
 * READ_INTERVAL_MS – the way Windows ConPTY hands a long paste over. Without
 * this the test could not fail on macOS or Linux: there the whole paste comes
 * in one read well inside 200 ms, so even the old fixed 200 ms Enter arrived
 * on its own and counted as a submit. Taken slowly, a ~11 KB paste needs over
 * half a second; an Enter written 200 ms after the paste is then still queued
 * behind it, is taken in the same read as the paste's end, and the agent
 * prints AGENT-LINEBREAK – the #449 failure. An Enter sent only after the
 * output has gone quiet arrives once the queue is empty, on its own.
 *
 * A read never ends inside a paste marker, and a carriage return already
 * queued right behind the paste's end joins that read even across a READ_CHARS
 * boundary: otherwise a paste whose length happened to be a multiple of
 * READ_CHARS would leave an early Enter alone in the next read and pass by luck.
 *
 * Prints one line per outcome, short enough for a narrow terminal:
 *   AGENT-READY                  listening
 *   AGENT-SUBMIT <n> took=<ms>   Enter arrived on its own after a paste of n
 *                                characters that took <ms> from its first read
 *                                to the read with its end
 *   AGENT-LINEBREAK              Enter arrived in the same read as the end of the paste
 * and exits after a submit, or after AGENT_IDLE_EXIT_MS without one.
 */
/* global process, setTimeout, clearTimeout, setInterval, clearInterval -- CommonJS, run by plain Node */

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const CR = '\r'
const AGENT_IDLE_EXIT_MS = 60_000
/** Characters taken per read – ConPTY's ~1 KiB. */
const READ_CHARS = 1024
/** Time between reads: slow enough that a long paste outlasts the old 200 ms Enter. */
const READ_INTERVAL_MS = 50

let pasted = ''
let inPaste = false
let pasteDone = false
/** Input received but not yet read, as the input queue of a slow terminal. */
let queue = ''
let pasteFirstReadAt = 0
let pasteTook = 0

process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
// Bracketed paste on, then the ready line
process.stdout.write('\x1b[?2004h')
process.stdout.write('AGENT-READY\r\n')

const idleExit = setTimeout(finish, AGENT_IDLE_EXIT_MS)

function finish() {
  clearTimeout(idleExit)
  clearInterval(reader)
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

/** Where the next read ends: READ_CHARS on, moved past a marker it would split. */
function readEnd() {
  let end = Math.min(READ_CHARS, queue.length)
  for (const marker of [PASTE_START, PASTE_END]) {
    const at = queue.indexOf(marker, Math.max(0, end - marker.length + 1))
    if (at !== -1 && at < end && at + marker.length > end) end = at + marker.length
  }
  // A carriage return already queued behind the paste's end goes in its read
  if (queue.slice(0, end).endsWith(PASTE_END) && queue[end] === CR) end += 1
  return end
}

/** One read of the agent, applying the prompt-box Enter rule to it. */
function handleRead(chunk) {
  if (chunk === CR && pasteDone && !inPaste) {
    process.stdout.write(`\r\nAGENT-SUBMIT ${pasted.length} took=${pasteTook}\r\n`)
    finish()
    return
  }

  if (chunk.includes(PASTE_START) && pasteFirstReadAt === 0) pasteFirstReadAt = Date.now()
  // Enter that came in the same read as the end of the paste: a line break
  if (chunk.includes(PASTE_END + CR)) process.stdout.write('\r\nAGENT-LINEBREAK\r\n')
  if (chunk.includes(PASTE_END)) pasteTook = Date.now() - pasteFirstReadAt
  pasted += takePasteText(chunk)
  // Redraw the status line, as a prompt box redraws while text comes in
  process.stdout.write(`\r\x1b[Kreceived ${pasted.length}`)
}

const reader = setInterval(() => {
  if (queue.length === 0) return
  const end = readEnd()
  const chunk = queue.slice(0, end)
  queue = queue.slice(end)
  handleRead(chunk)
}, READ_INTERVAL_MS)

process.stdin.on('data', (chunk) => {
  // Ctrl+C ends the agent at once, as in a real one
  if (chunk === '\x03') finish()
  queue += chunk
})
