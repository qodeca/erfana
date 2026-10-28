// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Teardown when the app hangs on quit (#63).
 *
 * `closeAppAndWait` must not wait forever on a `close()` that never settles,
 * and on Windows its kill must also end the app's child processes – a hung
 * Electron main process leaves GPU, utility and renderer children behind,
 * and they keep the test folders locked.
 *
 * No Electron here: a fake app whose `close()` never settles wraps a real
 * Node process that starts a child of its own, standing in for Electron's
 * main process and one of its helpers.
 */

import { test, expect, type ElectronApplication } from '@playwright/test'
import { spawn } from 'child_process'
import { APP_EXIT_TIMEOUT_MS, closeAppAndWait, describeTaskkill } from './fixtures/isolation'

/** `true` while a process with this PID exists. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Starts a "main process" that spawns a "helper" child, prints the child's PID and idles. */
const PARENT_SCRIPT = [
  "const { spawn } = require('child_process')",
  "const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
  'console.log(helper.pid)',
  'setInterval(() => {}, 1000)'
].join('\n')

test.describe('fixture teardown: the taskkill log line', () => {
  // Real taskkill output from a teardown on Windows 11 (2026-10-21)
  const PARTIAL =
    'SUCCESS: The process with PID 8512 (child process of PID 7412) has been terminated. ' +
    'SUCCESS: The process with PID 7412 (child process of PID 16948) has been terminated. ' +
    'ERROR: The process with PID 16152 (child process of PID 8512) could not be terminated. ' +
    'Reason: There is no running instance of the task.'

  test('a helper that had already exited does not make the kill a failure', () => {
    const line = describeTaskkill(7412, true, PARTIAL)
    expect(line).toMatch(/^process tree of PID 7412; some child processes had already exited \(/)
    expect(line).not.toContain('failed')
  })

  test('a kill that did not end the main process is a failure', () => {
    expect(describeTaskkill(9999, true, PARTIAL)).toMatch(/^taskkill \/PID 9999 \/T \/F failed: /)
    expect(describeTaskkill(9999, true, 'ERROR: The process "9999" not found.')).toMatch(/failed/)
  })

  test('a clean kill names the tree', () => {
    const ok = 'SUCCESS: The process with PID 7412 (child process of PID 16948) has been terminated.'
    expect(describeTaskkill(7412, false, ok)).toBe(`process tree of PID 7412 (${ok})`)
  })

  test('a PID that is a prefix of another is not mistaken for it', () => {
    expect(describeTaskkill(741, true, PARTIAL)).toMatch(/failed/)
  })
})

test.describe('fixture teardown: an app that hangs on quit', () => {
  test('is killed after the deadline, child processes included on Windows', async () => {
    test.setTimeout(APP_EXIT_TIMEOUT_MS + 30_000)

    const main = spawn(process.execPath, ['-e', PARENT_SCRIPT], { stdio: ['ignore', 'pipe', 'ignore'] })
    const helperPid = await new Promise<number>((resolve, reject) => {
      main.stdout.once('data', (chunk: Buffer) => resolve(Number(String(chunk).trim())))
      main.once('exit', () => reject(new Error('fake app exited before it reported its helper')))
    })
    const fakeApp = {
      process: () => main,
      close: () => new Promise<void>(() => {}) // never settles, like an app hung on quit
    } as unknown as ElectronApplication

    try {
      const started = Date.now()
      await closeAppAndWait(fakeApp)
      const elapsed = Date.now() - started

      // It gave up at the deadline instead of waiting on close() forever
      expect(elapsed).toBeGreaterThanOrEqual(APP_EXIT_TIMEOUT_MS)
      expect(elapsed).toBeLessThan(APP_EXIT_TIMEOUT_MS + 10_000)
      // The main process is gone
      expect(main.exitCode !== null || main.signalCode !== null).toBe(true)
      if (process.platform === 'win32') {
        // taskkill /T ended the helper too
        await expect.poll(() => isRunning(helperPid), { timeout: 5_000 }).toBe(false)
      }
    } finally {
      if (isRunning(helperPid)) process.kill(helperPid)
      if (main.exitCode === null && main.signalCode === null) main.kill()
    }
  })
})
