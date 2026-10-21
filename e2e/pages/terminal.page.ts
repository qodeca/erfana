// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal panel Page Object Model.
 *
 * Encapsulates xterm.js terminal interactions with condition-based waits.
 *
 * NOTE: xterm.js v6 with WebGL renderer does not expose terminal text content
 * to the DOM (.xterm-rows only exists with the DOM renderer, and
 * .xterm-accessibility-tree requires screenReaderMode: true). The page object
 * therefore reads xterm's own buffer – the text the terminal draws – through
 * the React fiber of the terminal element (`readScreen`), without any
 * test-only code in the app.
 *
 * @see e2e/utils/helpers.ts - Backward-compatible adapter
 */

import { Page, Locator, expect } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'
import { IS_LINUX_CONTAINER } from '../utils/linux-container'

/** How long `waitForPrompt` waits for a settled prompt by default. */
export const PROMPT_TIMEOUT_MS = 30_000

/** Linux container only: how long a blank terminal is given before `waitForPrompt` presses Enter. */
const BLANK_SCREEN_NUDGE_MS = 3_000

/** A line that ends like a shell prompt: zsh `%`, bash/sh `$`, PowerShell `>`, root `#`. */
const PROMPT_END = /[%$>#]\s*$/

/**
 * Whether a screen shows a drawn prompt: the cursor sits after text on its row,
 * or the last line ends with a prompt sign. Stability (two equal reads) is
 * checked by the caller.
 */
export function isPromptDrawn(screen: Pick<TerminalScreen, 'lines' | 'cursorX'>): boolean {
  if (screen.lines.length === 0) return false
  return screen.cursorX > 0 || PROMPT_END.test(screen.lines[screen.lines.length - 1])
}

/** Selector for the xterm.js terminal container */
const TERMINAL_SELECTOR = `[data-testid="${TEST_IDS.TERMINAL_INSTANCE}"]`

/** What `readScreen` returns: the terminal's text and cursor, or why it could not be read. */
export interface TerminalScreen {
  /** Logical lines (wrapped rows joined), trailing blanks trimmed, empty lines dropped. */
  lines: string[]
  cursorX: number
  cursorY: number
  /** Set only inside the page when the screen cannot be read; `readScreen` throws on it. */
  error?: string
}

/**
 * Read the xterm buffer of the terminal element `selector`.
 *
 * Runs in the page. Walks up the React fibers from the element and through each
 * component's hooks to the first ref that holds an xterm `Terminal` (it has
 * `buffer.active.getLine`). Wrapped rows are joined into one logical line.
 */
function readScreenInPage(selector: string): TerminalScreen {
  const empty = (error: string): TerminalScreen => ({ lines: [], cursorX: 0, cursorY: 0, error })
  const el = document.querySelector(selector)
  if (!el) return empty('no terminal element')
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  if (!fiberKey) return empty('no React fiber on the terminal element')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = (el as any)[fiberKey]
  for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
    let hook = fiber.memoizedState
    for (let n = 0; hook && n < 200; n++, hook = hook.next) {
      const buffer = hook.memoizedState?.current?.buffer?.active
      if (!buffer?.getLine) continue
      const lines: string[] = []
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i)
        if (!line) continue
        const text = line.translateToString(true)
        if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text
        else lines.push(text)
      }
      return {
        lines: lines.map((l) => l.trimEnd()).filter((l) => l.length > 0),
        cursorX: buffer.cursorX,
        cursorY: buffer.cursorY
      }
    }
  }
  return empty('no xterm Terminal found in the React fibers')
}

export class TerminalPage {
  constructor(private readonly page: Page) {}

  getTerminal(): Locator {
    return byTestId(this.page, TEST_IDS.TERMINAL_INSTANCE)
  }

  /** The terminal's text and cursor, read from xterm's buffer. */
  async readScreen(): Promise<TerminalScreen> {
    const screen = await this.page.evaluate(readScreenInPage, TERMINAL_SELECTOR)
    // Fail loudly: an unreadable screen must never look like an empty one.
    if (screen.error) {
      throw new Error(
        `Terminal screen unreadable: ${screen.error}. ` +
          'xterm instance not found – React internals changed? See readScreenInPage in e2e/pages/terminal.page.ts.'
      )
    }
    return screen
  }

  /**
   * Waits for the terminal to be ready for input.
   *
   * 1. xterm is initialised (its textarea exists).
   * 2. The shell has drawn a prompt, and two reads in a row see the same
   *    screen, so a prompt that is still being drawn (or a banner before it)
   *    does not count. A prompt shows as either of:
   *    - the cursor sits after some text on its row; or
   *    - the last line ends with a prompt sign (`%`, `$`, `>`, `#`). zsh can
   *      leave the cursor at column 0 of the row below its prompt after a
   *      resize redraw (seen on macOS: `["%", "user@host dir %"]`, cursorX 0),
   *      and that shell is ready all the same.
   *
   * The default budget is generous on purpose: a first zsh prompt under
   * full-suite load on macOS took longer than the old 10 s, and the check only
   * waits as long as the shell needs. A timeout reports the last screen read,
   * so a slow shell can be told apart from a prompt this check does not see.
   *
   * @param options.timeout - Maximum wait time (default: PROMPT_TIMEOUT_MS)
   */
  async waitForPrompt(options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? PROMPT_TIMEOUT_MS

    // Stage 1: Condition-based wait for xterm initialization
    await this.page.waitForFunction(
      (selector) => {
        const terminal = document.querySelector(selector)
        if (!terminal) return false
        const textarea = terminal.querySelector('textarea')
        return textarea !== null
      },
      TERMINAL_SELECTOR,
      { timeout }
    )

    // Stage 2: the shell has drawn a settled prompt
    let previous = ''
    const startedAt = Date.now()
    let nudged = false
    try {
      await expect
        .poll(
          async () => {
            const screen = await this.readScreen()
            // Linux container only: a shell that is fast enough draws its first prompt
            // while the main process is still discarding output for the clear
            // handshake (TerminalService `isClearing`), so the screen stays blank until
            // the next keystroke. Press Enter once to make the shell draw it again.
            if (
              IS_LINUX_CONTAINER &&
              !nudged &&
              screen.lines.length === 0 &&
              Date.now() - startedAt > BLANK_SCREEN_NUDGE_MS
            ) {
              nudged = true
              console.warn('[e2e] blank terminal after the clear handshake; pressing Enter')
              await this.focus().catch(() => undefined)
              await this.page.keyboard.press('Enter')
            }
            const snapshot = JSON.stringify(screen)
            const settled = isPromptDrawn(screen) && snapshot === previous
            previous = snapshot
            return settled ? 'prompt' : 'starting'
          },
          { message: 'the shell should draw its prompt', intervals: [100], timeout }
        )
        .toBe('prompt')
    } catch (error) {
      throw new Error(`${(error as Error).message}\nLast terminal screen read: ${previous || '(none)'}`, {
        cause: error
      })
    }

    // Sanity: the screen the prompt check passed on really holds text
    expect((await this.readScreen()).lines.length, 'terminal screen after the prompt').toBeGreaterThan(0)
  }

  /**
   * Whether the activity-bar toggle reports the terminal panel as open.
   *
   * Reads the app's OWN state, not the panel's geometry: `ActivityBarItem`
   * renders the `active` class straight from `activePanel === panel.id`, so it
   * is correct from the first paint. The panel element itself is not — see
   * `open()` — which is exactly why the toggle is the authority here.
   */
  private async isPanelToggleActive(): Promise<boolean> {
    const className =
      (await byTestId(this.page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL).getAttribute('class')) ?? ''
    return className.split(/\s+/).includes('active')
  }

  /**
   * Open the terminal panel, tolerating the startup auto-open race.
   *
   * The panel restores itself a few hundred ms AFTER the window is ready: at
   * t=0 the activity-bar toggle already carries `active` (state says open) but
   * `[data-testid="terminal-instance"]` is not in the DOM yet, and once mounted
   * it needs another beat to lay out. A single `isVisible()` sample landing in
   * that gap read "closed", clicked the toggle, and thereby CLOSED the terminal
   * that was about to appear — after which the 15 s visibility wait could never
   * pass, because nothing was going to reopen it. The closed panel collapses to
   * width 0, which Playwright reports as `hidden`, so the failure looked like a
   * never-expanding splitview rather than a toggle the test itself flipped.
   * (docs/windows/known-flakes.md, entry of 2026-08-12: this confirms candidate
   * (b) and shows candidate (a)'s 0-width symptom is the same bug.)
   *
   * The retry wrapper decides from the toggle state and re-checks it every
   * attempt, so an accidental close self-heals instead of deadlocking.
   */
  async open(): Promise<void> {
    const terminalInstance = byTestId(this.page, TEST_IDS.TERMINAL_INSTANCE)
    const terminalBtn = byTestId(this.page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)
    await expect(terminalBtn).toBeVisible({ timeout: 10000 })

    await expect(async () => {
      if (!(await this.isPanelToggleActive())) {
        await terminalBtn.click()
      }
      // Short inner budget: one settle window per attempt, so a wrong decision
      // is retried rather than burning the whole timeout on a closed panel.
      await expect(terminalInstance).toBeVisible({ timeout: 5000 })
    }).toPass({ timeout: 45000, intervals: [250, 500, 1000, 2000] })

    // Wait for PTY initialization
    await this.waitForPrompt()
  }

  async close(): Promise<void> {
    await byTestId(this.page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL).click()
    await expect(byTestId(this.page, TEST_IDS.TERMINAL_INSTANCE)).not.toBeVisible()
  }

  async focus(): Promise<void> {
    await this.getTerminal().click()
    // Wait for xterm's textarea to receive focus instead of fixed delay
    await this.page.waitForFunction(
      (selector) => {
        const terminal = document.querySelector(selector)
        if (!terminal) return false
        const textarea = terminal.querySelector('textarea')
        return textarea !== null && document.activeElement === textarea
      },
      TERMINAL_SELECTOR,
      { timeout: 2000 }
    )
  }

  async sendCommand(command: string, pressEnter = true): Promise<void> {
    await this.focus()
    await this.page.keyboard.type(command)
    if (pressEnter) {
      await this.page.keyboard.press('Enter')
    }
  }

  /** Waits until the terminal shows `text` anywhere (the typed command line counts). */
  async waitForOutput(text: string, options: { timeout?: number } = {}): Promise<void> {
    const { timeout = 10000 } = options
    await expect
      .poll(async () => (await this.readScreen()).lines.join('\n'), {
        message: `the terminal should show ${JSON.stringify(text)}`,
        timeout
      })
      .toContain(text)
  }

  /**
   * Waits until a whole terminal line reads `line` (surrounding spaces ignored).
   * Use this to check a command's OUTPUT: the line that echoes the typed command
   * also contains the text, so `waitForOutput` would pass without any output.
   */
  async waitForOutputLine(line: string, options: { timeout?: number } = {}): Promise<void> {
    const { timeout = 10000 } = options
    await expect
      .poll(async () => (await this.readScreen()).lines.map((l) => l.trim()), {
        message: `the terminal should print the line ${JSON.stringify(line)}`,
        timeout
      })
      .toContain(line)
  }

  async interrupt(): Promise<void> {
    await this.focus()
    await this.page.keyboard.press('Control+C')
  }

  async clear(): Promise<void> {
    await this.sendCommand('clear')
  }

  async scrollToBottom(): Promise<void> {
    await byTestId(this.page, TEST_IDS.TERMINAL_BTN_SCROLL).click()
  }

  /**
   * Click "Restart terminal" and wait for the new session.
   *
   * Restart asks first while the terminal looks busy (typed in and still
   * producing output, or Claude Code running). A test that typed into the
   * terminal must pass `confirm: true` to accept that prompt; an idle terminal
   * restarts without one.
   */
  async restart(options: { confirm?: boolean } = {}): Promise<void> {
    await byTestId(this.page, TEST_IDS.TERMINAL_BTN_RESTART).click()
    if (options.confirm) {
      await expect(byTestId(this.page, TEST_IDS.DIALOG_CONFIRM)).toBeVisible({ timeout: 10_000 })
      await byTestId(this.page, TEST_IDS.DIALOG_BTN_CONFIRM).click()
      await expect(byTestId(this.page, TEST_IDS.DIALOG_CONFIRM)).toHaveCount(0, { timeout: 10_000 })
    }
    // Wait for terminal to reinitialize
    await this.waitForPrompt()
  }

  async toggleScrollLock(): Promise<void> {
    await byTestId(this.page, TEST_IDS.TERMINAL_BTN_LOCK).click()
  }

  /** The expand/restore (maximize-over-editor) toolbar button. */
  expandButton(): Locator {
    return byTestId(this.page, TEST_IDS.TERMINAL_BTN_EXPAND)
  }

  /** The camera-capture toolbar button (opens CameraDialog). */
  cameraButton(): Locator {
    return byTestId(this.page, TEST_IDS.TERMINAL_BTN_CAMERA)
  }

  /** Click the expand/restore button to toggle terminal maximize. */
  async toggleExpand(): Promise<void> {
    await this.expandButton().click()
  }

  async waitForReady(): Promise<void> {
    await expect(byTestId(this.page, TEST_IDS.TERMINAL_INSTANCE)).toBeVisible()
    // Wait for PTY initialization
    await this.waitForPrompt()
  }
}
