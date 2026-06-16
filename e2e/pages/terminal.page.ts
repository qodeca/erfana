// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal panel Page Object Model.
 *
 * Encapsulates xterm.js terminal interactions with condition-based waits.
 *
 * NOTE: xterm.js v6 with WebGL renderer does not expose terminal text content
 * to the DOM (.xterm-rows only exists with the DOM renderer, and
 * .xterm-accessibility-tree requires screenReaderMode: true). Therefore
 * prompt detection uses xterm textarea presence (condition-based) plus a
 * KNOWN_WAIT for PTY shell initialization.
 *
 * @see e2e/utils/helpers.ts - Backward-compatible adapter
 */

import { Page, Locator, expect } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'

/** Selector for the xterm.js terminal container */
const TERMINAL_SELECTOR = `[data-testid="${TEST_IDS.TERMINAL_INSTANCE}"]`

/**
 * KNOWN_WAIT: PTY shell initialization delay.
 * xterm.js WebGL renderer does not expose text to the DOM, so we cannot
 * poll for prompt characters. After confirming xterm is initialized
 * (textarea present), this delay allows the PTY shell to start and
 * render the prompt via the GPU renderer.
 */
const PTY_INIT_DELAY_MS = 1500

export class TerminalPage {
  constructor(private readonly page: Page) {}

  getTerminal(): Locator {
    return byTestId(this.page, TEST_IDS.TERMINAL_INSTANCE)
  }

  /**
   * Waits for the terminal to be ready for input.
   *
   * Two-stage approach:
   * 1. Condition-based: polls for xterm textarea (proves xterm.open() completed)
   * 2. KNOWN_WAIT: brief delay for PTY shell startup (unavoidable with WebGL renderer)
   *
   * @param options.timeout - Maximum wait time for xterm init (default: 10000ms)
   */
  async waitForPrompt(options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 10_000

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

    // Stage 2: KNOWN_WAIT for PTY shell initialization
    // WebGL renderer doesn't expose text to DOM, so prompt detection via
    // DOM polling is not possible without app-level changes (e.g. screenReaderMode)
    await this.page.waitForTimeout(PTY_INIT_DELAY_MS)
  }

  async open(): Promise<void> {
    const terminalInstance = byTestId(this.page, TEST_IDS.TERMINAL_INSTANCE)
    const isAlreadyOpen = await terminalInstance.isVisible()

    if (isAlreadyOpen) {
      // Terminal is already open, wait for PTY initialization
      await this.waitForPrompt()
      return
    }

    // Click the terminal button in the right activity bar
    const terminalBtn = byTestId(this.page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)
    await expect(terminalBtn).toBeVisible({ timeout: 10000 })
    await terminalBtn.click()

    // Wait for terminal to become visible (handles splitview animation via auto-retry)
    await expect(terminalInstance).toBeVisible({ timeout: 15000 })

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

  /**
   * NOTE: Uses toContainText() which may not work with xterm.js WebGL renderer
   * (text is rendered to canvas, not DOM). Works when xterm falls back to DOM renderer.
   * For WebGL-only scenarios, use a KNOWN_WAIT pattern instead.
   */
  async waitForOutput(text: string, options: { timeout?: number } = {}): Promise<void> {
    const { timeout = 10000 } = options
    await expect(this.getTerminal()).toContainText(text, { timeout })
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

  async restart(): Promise<void> {
    await byTestId(this.page, TEST_IDS.TERMINAL_BTN_RESTART).click()
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
