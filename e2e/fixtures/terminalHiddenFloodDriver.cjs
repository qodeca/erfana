// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Hidden-window run of e2e/terminal-output.bench.ts, driven from inside the
 * app's main process instead of by Playwright.
 *
 * Playwright cannot measure a hidden window: its Electron launcher turns
 * Chromium's background throttling off (`--disable-renderer-backgrounding`,
 * `--disable-background-timer-throttling`, ...) and its focus emulation keeps
 * the page "visible" even when the window is minimised. A user's app has
 * neither, so this script is preloaded into the main process (`-r`) and the
 * app runs exactly as shipped:
 *
 *   electron -r e2e/fixtures/terminalHiddenFloodDriver.cjs . --user-data-dir=<dir> --use-mock-keychain
 *
 * `--use-mock-keychain` (which Playwright also passes) keeps the project lock's
 * signing key out of the login keychain; without it macOS blocks the main
 * process on a keychain prompt.
 *
 * Environment: ERFANA_BENCH_PROJECT (folder to open), ERFANA_BENCH_BYTES,
 * ERFANA_BENCH_HIDE (`minimize` or `cover`), plus the usual
 * ERFANA_E2E_FAST_SHELL=1 and ERFANA_E2E_TEST_HOOKS=1. It opens the project and
 * the terminal, runs the flood, hides the window right after Enter, shows it
 * again once the end marker has arrived over IPC, and prints one line
 * `BENCH_RESULT <json>` before it exits.
 */
/* global require, process, setTimeout -- CommonJS, run inside Electron's main process */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- `-r` preloads CommonJS only
const { app, BrowserWindow } = require('electron')

const BYTES = Number(process.env.ERFANA_BENCH_BYTES || 50000000)
const HIDE = process.env.ERFANA_BENCH_HIDE || 'minimize'
const PROJECT = process.env.ERFANA_BENCH_PROJECT
const MARKER = 'DONE_2'
const COMMAND = `yes | head -c ${BYTES}; echo DONE_$((1+1))`

const js = (win, code) => win.webContents.executeJavaScript(code, true)
const t0 = Date.now()
const log = (step) => process.stdout.write(`BENCH_STEP ${step} +${Date.now() - t0} ms\n`)

async function until(check, timeoutMs, label, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** The in-page recorder, as in the Playwright benchmark. */
const RECORDER = `(() => {
  const rec = { messages: 0, chars: 0, markerAt: null, start: performance.now(), hiddenSamples: 0, samples: 0 }
  let tail = ''
  rec.off = window.api.terminal.onData(({ data }) => {
    rec.messages++
    rec.chars += data.length
    if (rec.markerAt === null) {
      const text = tail + data
      if (text.includes(${JSON.stringify(MARKER)})) rec.markerAt = performance.now() - rec.start
      tail = text.slice(-${MARKER.length})
    }
  })
  window.__terminalBench = rec
})()`

async function run(win) {
  log('window loaded')
  await until(() => js(win, `!!document.querySelector('[data-testid="activity-bar"]')`), 30000, 'the app')
  await js(win, `window.api.file.openProjectByPath({ projectPath: ${JSON.stringify(PROJECT)} })`)
  await until(() => js(win, `!!document.querySelector('[data-testid^="project-tree-node-file-"]')`), 30000, 'the project')
  log('project open')
  await js(win, `document.querySelector('[data-testid="activity-bar-btn-terminal"]').click()`)
  const terminalId = await until(
    () =>
      js(
        win,
        `window.api.terminal.list().then((r) => {
          const id = r.terminals && r.terminals.length ? r.terminals[r.terminals.length - 1].id : null
          const text = id && window.__erfanaTest ? window.__erfanaTest.terminalText(id) : ''
          return id && text && /[$#%>]\\s*$/.test(text) ? id : null
        })`
      ),
    30000,
    'the shell prompt'
  )

  log('prompt drawn')
  await js(win, RECORDER)
  await js(win, `window.__terminalBench.start = performance.now()`)
  const pressedAt = Date.now()
  await js(win, `window.api.terminal.write(${JSON.stringify(terminalId)}, ${JSON.stringify(COMMAND + '\r')})`)

  let cover = null
  if (HIDE === 'none') {
    // Baseline: the window stays in front
  } else if (HIDE === 'minimize') {
    win.minimize()
  } else {
    const { x, y, width, height } = win.getBounds()
    cover = new BrowserWindow({
      x: x - 40,
      y: y - 40,
      width: width + 80,
      height: height + 80,
      frame: false,
      alwaysOnTop: true,
      backgroundColor: '#000000'
    })
    await cover.loadURL('data:text/html,<body style="margin:0;background:#000"></body>')
  }
  // Give the hide up to 2 s to reach the page (it may never: the result says so)
  const hiddenState =
    HIDE === 'none'
      ? 'visible'
      : await until(
          () => js(win, `document.visibilityState === 'hidden' ? 'hidden' : null`),
          2000,
          'the page to be hidden'
        ).catch(() => 'visible')

  log(`hidden: page ${hiddenState}, window ${win.isMinimized() ? 'minimized' : 'normal'}`)
  // Sample the page's visibility while it is hidden, so a run that was not
  // really hidden shows in the result
  const markerAt = await until(
    async () => {
      await js(win, `(() => { const r = window.__terminalBench; r.samples++; if (document.visibilityState === 'hidden') r.hiddenSamples++ })()`)
      return js(win, `window.__terminalBench.markerAt`)
    },
    9 * 60000,
    'the end marker',
    250
  )
  const receivedMs = Date.now() - pressedAt
  log('marker received')

  if (cover) cover.destroy()
  win.restore()
  win.show()
  await until(
    () =>
      js(
        win,
        `(window.__erfanaTest.terminalText(${JSON.stringify(terminalId)}) || '').split('\\n').some((l) => l.trim() === ${JSON.stringify(MARKER)})`
      ),
    9 * 60000,
    'the marker in the buffer'
  )
  const parsedMs = Date.now() - pressedAt
  const rec = await js(win, `(() => { const r = window.__terminalBench; r.off(); return { messages: r.messages, chars: r.chars, samples: r.samples, hiddenSamples: r.hiddenSamples } })()`)
  await js(win, `window.api.terminal.kill(${JSON.stringify(terminalId)})`)
  return {
    hide: HIDE,
    hiddenState,
    hiddenShare: rec.samples ? Math.round((100 * rec.hiddenSamples) / rec.samples) : 0,
    bytes: BYTES,
    ipcMessages: rec.messages,
    ipcChars: rec.chars,
    meanCharsPerMessage: Math.round(rec.chars / Math.max(1, rec.messages)),
    markerReceivedMs: Math.round(markerAt),
    markerReceivedWallMs: receivedMs,
    markerParsedMs: parsedMs
  }
}

// A run that hangs still ends, and says so
setTimeout(() => {
  process.stdout.write('BENCH_ERROR overall timeout\n')
  app.exit(2)
}, 12 * 60000).unref()

let started = false
app.on('browser-window-created', (_event, win) => {
  if (started) return
  started = true
  win.webContents.once('did-finish-load', () => {
    run(win).then(
      (result) => {
        process.stdout.write(`BENCH_RESULT ${JSON.stringify(result)}\n`)
        setTimeout(() => app.exit(0), 1000)
      },
      (error) => {
        process.stdout.write(`BENCH_ERROR ${error && error.message}\n`)
        setTimeout(() => app.exit(1), 1000)
      }
    )
  })
})
