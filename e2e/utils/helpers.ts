// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E test helper utilities – backward-compatible adapter layer.
 *
 * This module preserves the original namespace API (keyboard.selectAll(page), etc.)
 * while delegating to POM classes under the hood. Existing test files continue
 * to work without modification.
 *
 * New tests should use POM classes directly via Playwright fixtures instead.
 *
 * @see e2e/pages/ - POM class implementations
 * @see e2e/fixtures/ - Playwright fixture definitions
 */

import * as fs from 'fs'
import * as path from 'path'
import { Page, expect, Locator, ElectronApplication } from '@playwright/test'
import { stubDialog } from 'electron-playwright-helpers'
import { TEST_IDS, getPathHash } from '../../src/renderer/src/constants/testids'
import {
  byTestId as _byTestId,
  byDynamicTestId as _byDynamicTestId,
  waitForTestId as _waitForTestId,
  waitForTestIdHidden as _waitForTestIdHidden
} from './locators'
import { KeyboardHelper } from '../pages/keyboard.helper'
import { TerminalPage } from '../pages/terminal.page'
import { MonacoPage } from '../pages/monaco.page'
import { MermaidPage } from '../pages/mermaid.page'
import { ProjectTreePage } from '../pages/project-tree.page'

// Re-export TEST_IDS for convenience
export { TEST_IDS, getPathHash }

// Re-export POM classes for direct use
export { KeyboardHelper, TerminalPage, MonacoPage, MermaidPage, ProjectTreePage }

// =============================================================================
// WeakMap caches – POM instances reused per Page, GC'd when Page closes
// =============================================================================

const keyboardCache = new WeakMap<Page, KeyboardHelper>()
const terminalCache = new WeakMap<Page, TerminalPage>()
const monacoCache = new WeakMap<Page, MonacoPage>()
const mermaidCache = new WeakMap<Page, MermaidPage>()
const projectTreeCache = new WeakMap<Page, ProjectTreePage>()

function getKeyboard(page: Page): KeyboardHelper {
  let kh = keyboardCache.get(page)
  if (!kh) {
    kh = new KeyboardHelper(page)
    keyboardCache.set(page, kh)
  }
  return kh
}

function getTerminal(page: Page): TerminalPage {
  let tp = terminalCache.get(page)
  if (!tp) {
    tp = new TerminalPage(page)
    terminalCache.set(page, tp)
  }
  return tp
}

function getMonaco(page: Page): MonacoPage {
  let mp = monacoCache.get(page)
  if (!mp) {
    mp = new MonacoPage(page, getKeyboard(page))
    monacoCache.set(page, mp)
  }
  return mp
}

function getMermaid(page: Page): MermaidPage {
  let mp = mermaidCache.get(page)
  if (!mp) {
    mp = new MermaidPage(page)
    mermaidCache.set(page, mp)
  }
  return mp
}

function getProjectTree(page: Page): ProjectTreePage {
  let pt = projectTreeCache.get(page)
  if (!pt) {
    pt = new ProjectTreePage(page)
    projectTreeCache.set(page, pt)
  }
  return pt
}

// =============================================================================
// Core element location helpers (delegated to shared locators module)
// =============================================================================

export const byTestId = _byTestId
export const byDynamicTestId = _byDynamicTestId
export const waitForTestId = _waitForTestId
export const waitForTestIdHidden = _waitForTestIdHidden

export async function getAllTestIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const elements = document.querySelectorAll('[data-testid]')
    return Array.from(elements)
      .map((el) => el.getAttribute('data-testid'))
      .filter((id): id is string => id !== null)
  })
}

export async function verifyUniqueTestIds(page: Page): Promise<void> {
  const allIds = await getAllTestIds(page)
  const staticIds = allIds.filter((id) => !id.match(/-[a-f0-9]{8}$/))
  const unique = new Set(staticIds)
  expect(staticIds.length).toBe(unique.size)
}

// =============================================================================
// Platform-aware keyboard helpers (adapter to KeyboardHelper POM)
// =============================================================================

export const keyboard = {
  async getModifier(page: Page): Promise<string> {
    return getKeyboard(page).getModifier()
  },
  async shortcut(page: Page, key: string): Promise<void> {
    return getKeyboard(page).shortcut(key)
  },
  async selectAll(page: Page): Promise<void> {
    return getKeyboard(page).selectAll()
  },
  async copy(page: Page): Promise<void> {
    return getKeyboard(page).copy()
  },
  async paste(page: Page): Promise<void> {
    return getKeyboard(page).paste()
  },
  async cut(page: Page): Promise<void> {
    return getKeyboard(page).cut()
  },
  async undo(page: Page): Promise<void> {
    return getKeyboard(page).undo()
  },
  async redo(page: Page): Promise<void> {
    return getKeyboard(page).redo()
  },
  async save(page: Page): Promise<void> {
    return getKeyboard(page).save()
  },
  async find(page: Page): Promise<void> {
    return getKeyboard(page).find()
  },
  async newWindow(page: Page): Promise<void> {
    return getKeyboard(page).newWindow()
  }
}

// =============================================================================
// Monaco editor helpers (adapter to MonacoPage POM)
// =============================================================================

export const monaco = {
  getEditor(page: Page): Locator {
    return getMonaco(page).getEditor()
  },
  async focus(page: Page): Promise<void> {
    return getMonaco(page).focus()
  },
  async setContent(page: Page, content: string): Promise<void> {
    return getMonaco(page).setContent(content)
  },
  async appendContent(page: Page, content: string): Promise<void> {
    return getMonaco(page).appendContent(content)
  },
  async getContent(page: Page): Promise<string> {
    return getMonaco(page).getContent()
  },
  async selectAll(page: Page): Promise<void> {
    return getMonaco(page).selectAll()
  },
  async openCommandPalette(page: Page): Promise<void> {
    return getMonaco(page).openCommandPalette()
  },
  async executeCommand(page: Page, command: string): Promise<void> {
    return getMonaco(page).executeCommand(command)
  },
  async openSearch(page: Page): Promise<void> {
    return getMonaco(page).openSearch()
  },
  async closeSearch(page: Page): Promise<void> {
    return getMonaco(page).closeSearch()
  },
  async search(page: Page, query: string): Promise<void> {
    return getMonaco(page).search(query)
  },
  async nextMatch(page: Page): Promise<void> {
    return getMonaco(page).nextMatch()
  },
  async prevMatch(page: Page): Promise<void> {
    return getMonaco(page).prevMatch()
  },
  async waitForReady(page: Page): Promise<void> {
    return getMonaco(page).waitForReady()
  },
  getTextArea(page: Page): Locator {
    return getMonaco(page).getTextArea()
  },
  async waitForCursor(page: Page): Promise<void> {
    return getMonaco(page).waitForCursor()
  }
}

// =============================================================================
// Terminal helpers (adapter to TerminalPage POM)
// =============================================================================

export const terminal = {
  getTerminal(page: Page): Locator {
    return getTerminal(page).getTerminal()
  },
  async open(page: Page): Promise<void> {
    return getTerminal(page).open()
  },
  async close(page: Page): Promise<void> {
    return getTerminal(page).close()
  },
  async focus(page: Page): Promise<void> {
    return getTerminal(page).focus()
  },
  async sendCommand(page: Page, command: string, pressEnter = true): Promise<void> {
    return getTerminal(page).sendCommand(command, pressEnter)
  },
  async waitForOutput(
    page: Page,
    text: string,
    options: { timeout?: number } = {}
  ): Promise<void> {
    return getTerminal(page).waitForOutput(text, options)
  },
  async interrupt(page: Page): Promise<void> {
    return getTerminal(page).interrupt()
  },
  async clear(page: Page): Promise<void> {
    return getTerminal(page).clear()
  },
  async scrollToBottom(page: Page): Promise<void> {
    return getTerminal(page).scrollToBottom()
  },
  async restart(page: Page): Promise<void> {
    return getTerminal(page).restart()
  },
  async toggleScrollLock(page: Page): Promise<void> {
    return getTerminal(page).toggleScrollLock()
  },
  async waitForReady(page: Page): Promise<void> {
    return getTerminal(page).waitForReady()
  },
  async waitForPrompt(page: Page, options?: { timeout?: number }): Promise<void> {
    return getTerminal(page).waitForPrompt(options)
  }
}

// =============================================================================
// Mermaid diagram helpers (adapter to MermaidPage POM)
// =============================================================================

export const mermaid = {
  getToolbar(page: Page): Locator {
    return getMermaid(page).getToolbar()
  },
  getViewer(page: Page): Locator {
    return getMermaid(page).getViewer()
  },
  async hoverDiagram(page: Page, index = 0): Promise<void> {
    return getMermaid(page).hoverDiagram(index)
  },
  async setDirection(page: Page, direction: 'TB' | 'BT' | 'LR' | 'RL'): Promise<void> {
    return getMermaid(page).setDirection(direction)
  },
  async openViewer(page: Page): Promise<void> {
    return getMermaid(page).openViewer()
  },
  async closeViewer(page: Page): Promise<void> {
    return getMermaid(page).closeViewer()
  },
  async zoomIn(page: Page): Promise<void> {
    return getMermaid(page).zoomIn()
  },
  async zoomOut(page: Page): Promise<void> {
    return getMermaid(page).zoomOut()
  },
  async fitToView(page: Page): Promise<void> {
    return getMermaid(page).fitToView()
  },
  async resetZoom(page: Page): Promise<void> {
    return getMermaid(page).resetZoom()
  },
  async openChat(page: Page): Promise<void> {
    return getMermaid(page).openChat()
  },
  async sendChatMessage(page: Page, message: string): Promise<void> {
    return getMermaid(page).sendChatMessage(message)
  }
}

// =============================================================================
// App-level helpers (standalone – not part of any POM)
// =============================================================================

export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await waitForTestId(page, TEST_IDS.ACTIVITY_BAR, { timeout: 10000 })
}

export async function openProjectTree(page: Page): Promise<void> {
  return getProjectTree(page).openProjectTree()
}

export async function openSettings(page: Page): Promise<void> {
  return getProjectTree(page).openSettings()
}

export async function closeSettings(page: Page): Promise<void> {
  return getProjectTree(page).closeSettings()
}

export async function clickFileInTree(page: Page, filePath: string): Promise<void> {
  return getProjectTree(page).clickFileInTree(filePath)
}

export async function toggleFolder(page: Page, folderPath: string): Promise<void> {
  return getProjectTree(page).toggleFolder(folderPath)
}

// =============================================================================
// Project management helpers (standalone – require ElectronApplication)
// =============================================================================

export async function dismissDialogIfPresent(
  page: Page,
  options: { timeout?: number; maxAttempts?: number } = {}
): Promise<void> {
  const { timeout = 500, maxAttempts = 3 } = options
  let attempts = 0

  while (attempts < maxAttempts) {
    const confirmBtn = byTestId(page, TEST_IDS.DIALOG_BTN_CONFIRM)

    try {
      await expect(confirmBtn).toBeVisible({ timeout })
      await confirmBtn.click()
      await expect(byTestId(page, TEST_IDS.DIALOG_OVERLAY)).not.toBeVisible({ timeout: 500 })
      attempts++
    } catch {
      break
    }
  }
}

export async function openProject(page: Page, projectPath: string): Promise<void> {
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await dismissDialogIfPresent(page)

  await waitForTestId(page, TEST_IDS.ACTIVITY_BAR, { timeout: 10000 })

  const projectTree = byTestId(page, TEST_IDS.PROJECT_TREE)
  await expect(projectTree).toBeVisible({ timeout: 10000 })

  await page.evaluate(async (p: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).api.file.openProjectByPath(p)
  }, projectPath)

  const fileNodes = page.locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
  await expect(fileNodes.first()).toBeVisible({ timeout: 15000 })

  const terminalBtn = byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)
  await expect(terminalBtn).toBeVisible({ timeout: 10000 })
}

export async function openProjectViaUI(
  electronApp: ElectronApplication,
  page: Page,
  projectPath: string
): Promise<void> {
  await stubDialog(electronApp, 'showOpenDialog', {
    filePaths: [projectPath],
    canceled: false
  })

  await waitForTestId(page, TEST_IDS.ACTIVITY_BAR, { timeout: 10000 })

  const openBtn = byTestId(page, TEST_IDS.PROJECT_TREE_BTN_OPEN)
  await expect(openBtn).toBeVisible({ timeout: 5000 })
  await openBtn.click()

  await dismissDialogIfPresent(page)

  const fileNodes = page.locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
  await expect(fileNodes.first()).toBeVisible({ timeout: 15000 })

  const terminalBtn = byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)
  await expect(terminalBtn).toBeVisible({ timeout: 10000 })
}

export async function clickFileByName(page: Page, fileName: string): Promise<void> {
  return getProjectTree(page).clickFileByName(fileName)
}

export async function closeApp(
  electronApp: ElectronApplication,
  page?: Page
): Promise<void> {
  if (!page) {
    // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await electronApp.close()
    return
  }

  try {
    await page.evaluate(() => window.close())
  } catch {
    // Page might already be closing
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const confirmBtn = byTestId(page, TEST_IDS.DIALOG_BTN_CONFIRM)
      await expect(confirmBtn).toBeVisible({ timeout: 1500 })
      await confirmBtn.click()

      try {
        // KNOWN_WAIT: Inter-dialog pause during quit – page may be destroyed
        await page.waitForTimeout(300)
      } catch {
        break
      }
      continue
    } catch {
      break
    }
  }

  try {
    // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await electronApp.close()
  } catch {
    // App already closed
  }
}

// =============================================================================
// Project and user data directory helpers
// =============================================================================

export async function createTestProject(
  seedFiles?: Record<string, string>
): Promise<{ projectPath: string; cleanup: () => Promise<void> }> {
  const e2eTestDir = path.join(__dirname, '..', '..', '.e2e-temp')
  await fs.promises.mkdir(e2eTestDir, { recursive: true })
  const projectPath = await fs.promises.mkdtemp(path.join(e2eTestDir, 'test-'))

  const files = seedFiles ?? { 'test.md': '# Test Document\n\nTest content.\n' }
  for (const [name, content] of Object.entries(files)) {
    await fs.promises.writeFile(path.join(projectPath, name), content, 'utf-8')
  }

  return {
    projectPath,
    cleanup: async () => {
      try {
        await fs.promises.rm(projectPath, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors – must not mask test failures
      }
    }
  }
}

export async function createTempUserDataDir(
  prefix: string
): Promise<{ userDataDir: string; cleanup: () => Promise<void> }> {
  const e2eTempDir = path.join(__dirname, '..', '..', '.e2e-temp')
  await fs.promises.mkdir(e2eTempDir, { recursive: true })

  const userDataDir = await fs.promises.mkdtemp(path.join(e2eTempDir, `${prefix}-`))

  return {
    userDataDir,
    cleanup: async () => {
      try {
        await fs.promises.rm(userDataDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors – must not mask test failures
      }
    }
  }
}
