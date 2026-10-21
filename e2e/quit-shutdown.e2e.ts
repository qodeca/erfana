// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The quit sequence runs to its end (#305).
 *
 * Electron emits a second `before-quit` when the quit-confirm handler destroys the
 * window (`window-all-closed` -> `app.quit()`). If that one is not prevented, the
 * app quits a millisecond after the shutdown started and the disposers never
 * finish. Both ways of quitting must therefore reach the last log line the
 * shutdown writes before `app.exit(0)`, with the terminal service disposed first.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { ElectronApplication } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { TerminalPage } from './pages/terminal.page'
import { appMainLogPath, LogTail } from './fixtures/logTail'
import { APP_EXIT_TIMEOUT_MS } from './fixtures/isolation'

const TERMINAL_DISPOSED = /TerminalService disposed/
const DISPOSERS_DONE = /App quit: disposers done, exiting/

/** Resolves once the app's process has exited. */
function whenExited(app: ElectronApplication): Promise<void> {
  const child = app.process()
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise<void>((resolve) => child.once('exit', () => resolve()))
}

const BEFORE_QUIT_MARK = 'prevented='

/**
 * Records, in a file, whether each `before-quit` was prevented by the time every
 * listener ran. The listener is registered after the app's own, so it sees the
 * verdict. A file (written synchronously) survives the exit that follows.
 */
async function watchBeforeQuit(app: ElectronApplication, homeDir: string): Promise<() => string[]> {
  const file = path.join(homeDir, 'before-quit-events.log')
  await app.evaluate(
    ({ app: electronApp }, { target, mark }) => {
      const fs = process.getBuiltinModule('fs')
      electronApp.on('before-quit', (event) => {
        fs.appendFileSync(target, `${mark}${String(event.defaultPrevented)}\n`)
      })
    },
    { target: file, mark: BEFORE_QUIT_MARK }
  )
  return () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean) : [])
}

async function expectShutdownRanToTheEnd(log: LogTail, exited: Promise<void>): Promise<void> {
  await log.waitFor(TERMINAL_DISPOSED, { timeout: APP_EXIT_TIMEOUT_MS })
  await log.waitFor(DISPOSERS_DONE, { timeout: APP_EXIT_TIMEOUT_MS })
  let done = false
  void exited.then(() => {
    done = true
  })
  await expect.poll(() => done, { timeout: APP_EXIT_TIMEOUT_MS }).toBe(true)
}

/** Every before-quit that reached the listeners must have been prevented. */
function expectEveryBeforeQuitPrevented(seen: string[]): void {
  expect(seen.length).toBeGreaterThan(0)
  expect(seen.filter((line) => line !== 'prevented=true')).toEqual([])
}

test.describe('quit shutdown', () => {
  test('closing the window runs every disposer before the app exits', async ({
    appWithTestProject: app,
    windowWithTestProject: window,
    homeDir
  }) => {
    const terminalPage = new TerminalPage(window)
    await terminalPage.open()
    await terminalPage.waitForPrompt()

    const exited = whenExited(app)
    const beforeQuits = await watchBeforeQuit(app, homeDir)
    const log = new LogTail(appMainLogPath(homeDir))
    await log.mark()

    // Close from the main process: the window's close handler asks the renderer to
    // confirm, and on "proceed" destroys the window and calls app.quit() – which
    // makes window-all-closed call app.quit() again (two before-quit events).
    // Playwright's window.close() goes through Target.closeTarget and skips all of it.
    await app
      .evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })
      .catch(() => undefined)

    await expectShutdownRanToTheEnd(log, exited)
    expectEveryBeforeQuitPrevented(beforeQuits())
  })

  test('app.quit() runs every disposer before the app exits', async ({
    appWithTestProject: app,
    windowWithTestProject: window,
    homeDir
  }) => {
    const terminalPage = new TerminalPage(window)
    await terminalPage.open()
    await terminalPage.waitForPrompt()

    const exited = whenExited(app)
    const beforeQuits = await watchBeforeQuit(app, homeDir)
    const log = new LogTail(appMainLogPath(homeDir))
    await log.mark()

    void app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)

    await expectShutdownRanToTheEnd(log, exited)
    expectEveryBeforeQuitPrevented(beforeQuits())
  })
})
