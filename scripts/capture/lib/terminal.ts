// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The terminal's PTY stream, kept in the page, and the condition waits built
 * on it (design § Capture script, Waits).
 *
 * The WebGL terminal puts no text in the DOM, so every wait reads the PTY
 * stream that `window.api.terminal.onData` delivers. Predicates are functions
 * with an argument, never strings: Erfana's CSP forbids `unsafe-eval`, and a
 * string predicate fails there (spike Q2).
 */

import { expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'

type CaptureWindow = Window & {
  __capturePty?: string
  api: { terminal: { onData: (cb: (d: { terminalId: string; data: string }) => void) => () => void } }
}

/** The neutral prompt the sandbox `.zshrc` sets, as it reads in the project. */
export const SHELL_PROMPT = '~/Projects/harbour-garden %'

/** Start keeping the PTY stream. Call before the project opens. */
export async function installPtyRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as CaptureWindow
    if (w.__capturePty !== undefined) return
    w.__capturePty = ''
    w.api.terminal.onData(({ data }) => {
      w.__capturePty += data
    })
  })
}

/** The PTY stream so far, raw (escape codes included). */
export async function readPty(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as CaptureWindow).__capturePty ?? '')
}

/** How long the stream is now; pass it as `from` to wait only on new output. */
export async function ptyLength(page: Page): Promise<number> {
  return (await readPty(page)).length
}

/**
 * Wait until the stream after `from` contains `needle`. Escape codes and all
 * whitespace are removed from both before comparing: a TUI such as Claude
 * Code moves the cursor instead of printing spaces and wraps long lines, so
 * only the visible characters are stable. The needle should be text only the
 * program's output contains, not the typed command echoing back (spike Q2).
 */
export async function waitForPty(page: Page, needle: string, { from = 0, timeout = 30_000 } = {}): Promise<void> {
  await page.waitForFunction(
    ({ needle, from }) => {
      const raw = ((window as unknown as { __capturePty?: string }).__capturePty ?? '').slice(from)
      // eslint-disable-next-line no-control-regex
      const text = raw.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      return text.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''))
    },
    { needle, from },
    { timeout, polling: 100 }
  )
}

/** Whether the stream after `from` contains `needle` (same comparison as `waitForPty`). */
export async function ptyContains(page: Page, needle: string, from = 0): Promise<boolean> {
  return page.evaluate(
    ({ needle, from }) => {
      const raw = ((window as unknown as { __capturePty?: string }).__capturePty ?? '').slice(from)
      // eslint-disable-next-line no-control-regex
      const text = raw.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      return text.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''))
    },
    { needle, from }
  )
}

/** Wait until the stream's last line is the sandbox's neutral shell prompt. */
export async function waitForShellPrompt(page: Page, { from = 0, timeout = 30_000 } = {}): Promise<void> {
  await page.waitForFunction(
    ({ prompt, from }) => {
      const raw = ((window as unknown as { __capturePty?: string }).__capturePty ?? '').slice(from)
      // eslint-disable-next-line no-control-regex
      const text = raw.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean)
      return lines.length > 0 && lines[lines.length - 1] === prompt
    },
    { prompt: SHELL_PROMPT, from },
    { timeout, polling: 100 }
  )
}

/** Open the terminal panel if it is closed, and wait for its xterm to exist. */
export async function ensureTerminalOpen(page: Page): Promise<void> {
  const instance = page.getByTestId(TEST_IDS.TERMINAL_INSTANCE)
  const toggle = page.getByTestId(TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  await expect(async () => {
    const cls = (await toggle.getAttribute('class')) ?? ''
    if (!cls.split(/\s+/).includes('active')) await toggle.click()
    await expect(instance).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 45_000, intervals: [250, 500, 1000, 2000] })
  await expect(instance.locator('textarea')).toHaveCount(1, { timeout: 10_000 })
}

/** Focus the terminal: its hidden xterm textarea becomes the active element. */
export async function focusTerminal(page: Page): Promise<void> {
  await page.getByTestId(TEST_IDS.TERMINAL_INSTANCE).click()
  await page.waitForFunction(
    (id) => {
      const t = document.querySelector(`[data-testid="${id}"] textarea`)
      return t !== null && document.activeElement === t
    },
    TEST_IDS.TERMINAL_INSTANCE,
    { timeout: 5_000 }
  )
}

/** Type a line into the terminal as a user would, and press Enter. */
export async function typeLine(page: Page, line: string): Promise<void> {
  await focusTerminal(page)
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
}

/** Lines in the Stop hook's log: one per finished agent turn. */
export function stopHookCount(stopLog: string): number {
  try {
    return fs.readFileSync(stopLog, 'utf8').split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

/**
 * Start Claude Code in the project's terminal and wait until it is idle at
 * its prompt: its edit-mode footer is in the stream. (Erfana's status bar
 * appears only after the session's first finished turn.)
 */
export async function startClaude(page: Page): Promise<void> {
  const from = await ptyLength(page)
  await typeLine(page, 'claude')
  await waitForPty(page, 'accept edits on', { from, timeout: 60_000 })
}

/**
 * Send one prompt to Claude Code and wait for the end of its turn: the Stop
 * hook fired (a new line in its log) and, when given, `done()` holds.
 */
export async function runAgentTurn(
  page: Page,
  stopLog: string,
  prompt: string,
  done: () => Promise<boolean> | boolean = () => true,
  timeout = 5 * 60_000
): Promise<void> {
  const before = stopHookCount(stopLog)
  const from = await ptyLength(page)
  await typeLine(page, prompt)
  await expect.poll(() => stopHookCount(stopLog), { timeout, intervals: [250, 500, 1000] }).toBeGreaterThan(before)
  await expect.poll(done, { timeout: 30_000, intervals: [250, 500, 1000] }).toBe(true)
  // acceptEdits in the sandbox project (R138-8): no approval prompt appeared.
  expect(await ptyContains(page, 'Do you want to', from)).toBe(false)
}

/** Write the PTY stream (escape codes removed later) next to a raw shot. */
export async function savePty(page: Page, file: string): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, await readPty(page))
}
