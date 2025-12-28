/**
 * E2E test helper utilities for Playwright with Electron.
 *
 * Provides reusable helpers for common E2E testing patterns:
 * - Element location by data-testid
 * - Platform-aware keyboard shortcuts
 * - Monaco editor interactions
 * - Terminal interactions
 * - Mermaid diagram interactions
 *
 * @see docs/testing/e2e-testing.md - E2E testing documentation
 * @see constants/testids.ts - Test ID constants
 * @see BRS-011 - Automated UI testing compatibility
 *
 * @example
 * ```typescript
 * import { byTestId, waitForTestId, keyboard, monaco, terminal } from './utils/helpers';
 *
 * // Locate element by testid
 * const button = byTestId(page, 'activity-bar-btn-files');
 *
 * // Wait for element
 * await waitForTestId(page, 'project-tree');
 *
 * // Platform-aware keyboard shortcut
 * await keyboard.selectAll(page);
 *
 * // Monaco editor interaction
 * await monaco.setContent(page, '# Hello World');
 * ```
 */

import { Page, expect, Locator, ElectronApplication } from '@playwright/test'
import { stubDialog } from 'electron-playwright-helpers'
import { TEST_IDS, getPathHash } from '../../src/renderer/src/constants/testids'

// Re-export TEST_IDS for convenience
export { TEST_IDS, getPathHash }

// =============================================================================
// Core element location helpers
// =============================================================================

/**
 * Creates a Playwright locator for an element with the specified data-testid.
 *
 * @param page - Playwright Page instance
 * @param testId - The data-testid value to locate
 * @returns Playwright Locator for the element
 *
 * @example
 * ```typescript
 * const activityBar = byTestId(page, TEST_IDS.ACTIVITY_BAR);
 * await activityBar.click();
 * ```
 */
export function byTestId(page: Page, testId: string): Locator {
  return page.locator(`[data-testid="${testId}"]`)
}

/**
 * Creates a Playwright locator for a dynamic testid element (with path hash suffix).
 *
 * @param page - Playwright Page instance
 * @param prefix - Base test ID prefix (e.g., TEST_IDS.PROJECT_TREE_NODE)
 * @param path - File path used to generate the hash suffix
 * @returns Playwright Locator for the element
 *
 * @example
 * ```typescript
 * const fileNode = byDynamicTestId(page, TEST_IDS.PROJECT_TREE_NODE, 'src/main/index.ts');
 * await fileNode.click();
 * ```
 */
export function byDynamicTestId(page: Page, prefix: string, path: string): Locator {
  const hash = getPathHash(path)
  return page.locator(`[data-testid="${prefix}-${hash}"]`)
}

/**
 * Waits for an element with the specified data-testid to be visible.
 *
 * @param page - Playwright Page instance
 * @param testId - The data-testid value to wait for
 * @param options - Optional configuration
 * @param options.timeout - Maximum time to wait in milliseconds (default: 5000)
 * @returns Promise that resolves when element is visible
 *
 * @example
 * ```typescript
 * await waitForTestId(page, TEST_IDS.ACTIVITY_BAR);
 * await waitForTestId(page, TEST_IDS.DIALOG_OVERLAY, { timeout: 10000 });
 * ```
 */
export async function waitForTestId(
  page: Page,
  testId: string,
  options: { timeout?: number } = {}
): Promise<void> {
  const { timeout = 5000 } = options
  await expect(byTestId(page, testId)).toBeVisible({ timeout })
}

/**
 * Waits for an element with the specified data-testid to be hidden or removed.
 *
 * @param page - Playwright Page instance
 * @param testId - The data-testid value to wait for removal
 * @param options - Optional configuration
 * @param options.timeout - Maximum time to wait in milliseconds (default: 5000)
 * @returns Promise that resolves when element is not visible
 *
 * @example
 * ```typescript
 * // Close dialog and wait for it to disappear
 * await byTestId(page, TEST_IDS.DIALOG_BTN_CANCEL).click();
 * await waitForTestIdHidden(page, TEST_IDS.DIALOG_OVERLAY);
 * ```
 */
export async function waitForTestIdHidden(
  page: Page,
  testId: string,
  options: { timeout?: number } = {}
): Promise<void> {
  const { timeout = 5000 } = options
  await expect(byTestId(page, testId)).not.toBeVisible({ timeout })
}

/**
 * Gets all data-testid values currently in the page.
 *
 * Useful for debugging which testids are available.
 *
 * @param page - Playwright Page instance
 * @returns Array of all testid values found in the page
 *
 * @example
 * ```typescript
 * const allIds = await getAllTestIds(page);
 * console.log('Available testids:', allIds);
 * ```
 */
export async function getAllTestIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const elements = document.querySelectorAll('[data-testid]')
    return Array.from(elements)
      .map((el) => el.getAttribute('data-testid'))
      .filter((id): id is string => id !== null)
  })
}

/**
 * Verifies that no duplicate static testids exist in the page.
 *
 * Dynamic testids (ending with 8-char hex hash) are excluded from this check.
 *
 * @param page - Playwright Page instance
 * @throws Assertion error if duplicates are found
 *
 * @example
 * ```typescript
 * await verifyUniqueTestIds(page);
 * ```
 */
export async function verifyUniqueTestIds(page: Page): Promise<void> {
  const allIds = await getAllTestIds(page)
  // Filter out dynamic testids (end with 8-char hex hash)
  const staticIds = allIds.filter((id) => !id.match(/-[a-f0-9]{8}$/))
  const unique = new Set(staticIds)
  expect(staticIds.length).toBe(unique.size)
}

// =============================================================================
// Platform-aware keyboard helpers
// =============================================================================

/**
 * Detects the platform from the Playwright page context.
 *
 * @param page - Playwright Page instance
 * @returns 'darwin' for macOS, 'win32' for Windows, 'linux' for Linux
 */
async function detectPlatform(page: Page): Promise<'darwin' | 'win32' | 'linux'> {
  const platform = await page.evaluate(() => navigator.platform.toLowerCase())
  if (platform.includes('mac')) return 'darwin'
  if (platform.includes('win')) return 'win32'
  return 'linux'
}

/**
 * Platform-aware keyboard shortcut helpers.
 *
 * Automatically uses Meta (Cmd) on macOS and Control (Ctrl) on Windows/Linux.
 *
 * @example
 * ```typescript
 * // Select all text (Cmd+A on macOS, Ctrl+A on Windows/Linux)
 * await keyboard.selectAll(page);
 *
 * // Copy (Cmd+C on macOS, Ctrl+C on Windows/Linux)
 * await keyboard.copy(page);
 *
 * // Custom shortcut
 * await keyboard.shortcut(page, 'S'); // Cmd+S or Ctrl+S
 * ```
 */
export const keyboard = {
  /**
   * Gets the platform modifier key (Meta for macOS, Control for others).
   */
  async getModifier(page: Page): Promise<string> {
    const platform = await detectPlatform(page)
    return platform === 'darwin' ? 'Meta' : 'Control'
  },

  /**
   * Presses a keyboard shortcut with the platform modifier.
   *
   * @param page - Playwright Page instance
   * @param key - The key to combine with modifier (e.g., 'A', 'S', 'F')
   */
  async shortcut(page: Page, key: string): Promise<void> {
    const modifier = await this.getModifier(page)
    await page.keyboard.press(`${modifier}+${key}`)
  },

  /**
   * Selects all text (Cmd/Ctrl+A).
   */
  async selectAll(page: Page): Promise<void> {
    await this.shortcut(page, 'A')
  },

  /**
   * Copies selected content (Cmd/Ctrl+C).
   */
  async copy(page: Page): Promise<void> {
    await this.shortcut(page, 'C')
  },

  /**
   * Pastes from clipboard (Cmd/Ctrl+V).
   */
  async paste(page: Page): Promise<void> {
    await this.shortcut(page, 'V')
  },

  /**
   * Cuts selected content (Cmd/Ctrl+X).
   */
  async cut(page: Page): Promise<void> {
    await this.shortcut(page, 'X')
  },

  /**
   * Undoes last action (Cmd/Ctrl+Z).
   */
  async undo(page: Page): Promise<void> {
    await this.shortcut(page, 'Z')
  },

  /**
   * Redoes last undone action (Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y).
   */
  async redo(page: Page): Promise<void> {
    const platform = await detectPlatform(page)
    if (platform === 'darwin') {
      await page.keyboard.press('Meta+Shift+Z')
    } else {
      await page.keyboard.press('Control+Y')
    }
  },

  /**
   * Saves current document (Cmd/Ctrl+S).
   */
  async save(page: Page): Promise<void> {
    await this.shortcut(page, 'S')
  },

  /**
   * Opens search (Cmd/Ctrl+F).
   */
  async find(page: Page): Promise<void> {
    await this.shortcut(page, 'F')
  },

  /**
   * Opens new window (Cmd/Ctrl+Shift+N).
   */
  async newWindow(page: Page): Promise<void> {
    const modifier = await this.getModifier(page)
    await page.keyboard.press(`${modifier}+Shift+N`)
  }
}

// =============================================================================
// Monaco editor helpers
// =============================================================================

/**
 * Monaco editor interaction helpers.
 *
 * @example
 * ```typescript
 * // Set editor content
 * await monaco.setContent(page, '# Hello World\n\nThis is a test.');
 *
 * // Get editor content
 * const content = await monaco.getContent(page);
 *
 * // Select all and delete
 * await monaco.selectAll(page);
 * await page.keyboard.press('Backspace');
 * ```
 */
export const monaco = {
  /**
   * Gets the Monaco editor locator.
   */
  getEditor(page: Page): Locator {
    return byTestId(page, TEST_IDS.EDITOR_MONACO)
  },

  /**
   * Focuses the Monaco editor by clicking on it.
   */
  async focus(page: Page): Promise<void> {
    await this.getEditor(page).click()
    // Small delay for focus to take effect
    await page.waitForTimeout(100)
  },

  /**
   * Sets content in the Monaco editor by clearing existing content and typing new content.
   *
   * @param page - Playwright Page instance
   * @param content - The content to set in the editor
   */
  async setContent(page: Page, content: string): Promise<void> {
    await this.focus(page)
    await keyboard.selectAll(page)
    await page.keyboard.type(content)
  },

  /**
   * Appends content to the end of the Monaco editor.
   *
   * @param page - Playwright Page instance
   * @param content - The content to append
   */
  async appendContent(page: Page, content: string): Promise<void> {
    await this.focus(page)
    // Go to end of document
    const modifier = await keyboard.getModifier(page)
    await page.keyboard.press(`${modifier}+End`)
    await page.keyboard.type(content)
  },

  /**
   * Gets the current content from the Monaco editor via clipboard.
   *
   * @param page - Playwright Page instance
   * @returns The editor content
   */
  async getContent(page: Page): Promise<string> {
    await this.focus(page)
    await keyboard.selectAll(page)
    await keyboard.copy(page)
    return page.evaluate(() => navigator.clipboard.readText())
  },

  /**
   * Selects all text in the Monaco editor.
   */
  async selectAll(page: Page): Promise<void> {
    await this.focus(page)
    await keyboard.selectAll(page)
  },

  /**
   * Opens the command palette (F1).
   */
  async openCommandPalette(page: Page): Promise<void> {
    await this.focus(page)
    await page.keyboard.press('F1')
  },

  /**
   * Executes a command from the command palette.
   *
   * @param page - Playwright Page instance
   * @param command - The command name to execute
   */
  async executeCommand(page: Page, command: string): Promise<void> {
    await this.openCommandPalette(page)
    await page.keyboard.type(command)
    await page.keyboard.press('Enter')
  },

  /**
   * Opens the search bar (Erfana's custom search, not Monaco's native find).
   */
  async openSearch(page: Page): Promise<void> {
    await this.focus(page)
    await keyboard.find(page)
    await waitForTestId(page, TEST_IDS.SEARCH_BAR)
  },

  /**
   * Closes the search bar by pressing Escape.
   */
  async closeSearch(page: Page): Promise<void> {
    await page.keyboard.press('Escape')
    await waitForTestIdHidden(page, TEST_IDS.SEARCH_BAR)
  },

  /**
   * Searches for text in the editor using the search bar.
   *
   * @param page - Playwright Page instance
   * @param query - The search query
   */
  async search(page: Page, query: string): Promise<void> {
    await this.openSearch(page)
    const searchInput = byTestId(page, TEST_IDS.SEARCH_BAR_INPUT)
    await searchInput.fill(query)
  },

  /**
   * Navigates to the next search match.
   */
  async nextMatch(page: Page): Promise<void> {
    await byTestId(page, TEST_IDS.SEARCH_BAR_BTN_NEXT).click()
  },

  /**
   * Navigates to the previous search match.
   */
  async prevMatch(page: Page): Promise<void> {
    await byTestId(page, TEST_IDS.SEARCH_BAR_BTN_PREV).click()
  },

  /**
   * Waits for the editor to be visible and ready.
   */
  async waitForReady(page: Page): Promise<void> {
    await waitForTestId(page, TEST_IDS.EDITOR_MONACO)
    // Additional wait for Monaco to initialize
    await page.waitForTimeout(500)
  }
}

// =============================================================================
// Terminal helpers
// =============================================================================

/**
 * Terminal panel interaction helpers.
 *
 * @example
 * ```typescript
 * // Open terminal panel
 * await terminal.open(page);
 *
 * // Send a command
 * await terminal.sendCommand(page, 'echo "Hello"');
 *
 * // Wait for specific output
 * await terminal.waitForOutput(page, 'Hello');
 * ```
 */
export const terminal = {
  /**
   * Gets the terminal instance locator.
   */
  getTerminal(page: Page): Locator {
    return byTestId(page, TEST_IDS.TERMINAL_INSTANCE)
  },

  /**
   * Opens the terminal panel by clicking the terminal button in the activity bar.
   * The terminal button is on the RIGHT activity bar and requires a project to be loaded.
   *
   * Note: Terminal auto-opens when a project loads (useAutoOpenTerminal hook).
   * This function checks if terminal is already visible to avoid toggling it closed.
   */
  async open(page: Page): Promise<void> {
    const terminalInstance = byTestId(page, TEST_IDS.TERMINAL_INSTANCE)

    // Check if terminal is already visible (auto-opened on project load)
    try {
      await expect(terminalInstance).toBeVisible({ timeout: 2000 })
      // Terminal is already open, just wait for PTY initialization
      await page.waitForTimeout(1500)
      return
    } catch {
      // Terminal not visible, need to open it
    }

    // Click the terminal button in the right activity bar
    // Note: This button is only visible when a project is loaded (requiresProject: true)
    const terminalBtn = byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)
    await expect(terminalBtn).toBeVisible({ timeout: 10000 })
    await terminalBtn.click()

    // Wait for splitview panel creation and animation
    // The terminal panel is dynamically added via React useEffect when projectPath changes
    await page.waitForTimeout(500)

    // Use Playwright's built-in auto-retry for visibility check
    // This handles the race condition where element is attached but has zero dimensions
    // during splitview animation. 15s timeout provides margin for slow CI environments.
    await expect(terminalInstance).toBeVisible({ timeout: 15000 })

    // Wait for PTY initialization
    await page.waitForTimeout(1500)
  },

  /**
   * Closes the terminal panel by clicking the activity bar button again.
   */
  async close(page: Page): Promise<void> {
    await byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL).click()
    await waitForTestIdHidden(page, TEST_IDS.TERMINAL_INSTANCE)
  },

  /**
   * Focuses the terminal for input.
   */
  async focus(page: Page): Promise<void> {
    await this.getTerminal(page).click()
    await page.waitForTimeout(100)
  },

  /**
   * Sends a command to the terminal.
   *
   * @param page - Playwright Page instance
   * @param command - The command to send
   * @param pressEnter - Whether to press Enter after typing (default: true)
   */
  async sendCommand(page: Page, command: string, pressEnter = true): Promise<void> {
    await this.focus(page)
    await page.keyboard.type(command)
    if (pressEnter) {
      await page.keyboard.press('Enter')
    }
  },

  /**
   * Waits for specific output to appear in the terminal.
   *
   * @param page - Playwright Page instance
   * @param text - The text to wait for
   * @param options - Optional configuration
   * @param options.timeout - Maximum time to wait in milliseconds (default: 10000)
   */
  async waitForOutput(
    page: Page,
    text: string,
    options: { timeout?: number } = {}
  ): Promise<void> {
    const { timeout = 10000 } = options
    await expect(this.getTerminal(page)).toContainText(text, { timeout })
  },

  /**
   * Sends SIGINT (Ctrl+C) to interrupt the current process.
   */
  async interrupt(page: Page): Promise<void> {
    await this.focus(page)
    await page.keyboard.press('Control+C')
  },

  /**
   * Clears the terminal by sending the clear command.
   */
  async clear(page: Page): Promise<void> {
    await this.sendCommand(page, 'clear')
  },

  /**
   * Scrolls to the bottom of the terminal.
   */
  async scrollToBottom(page: Page): Promise<void> {
    await byTestId(page, TEST_IDS.TERMINAL_BTN_SCROLL).click()
  },

  /**
   * Restarts the terminal.
   */
  async restart(page: Page): Promise<void> {
    await byTestId(page, TEST_IDS.TERMINAL_BTN_RESTART).click()
    // Wait for terminal to reinitialize
    await page.waitForTimeout(1000)
  },

  /**
   * Toggles scroll lock.
   */
  async toggleScrollLock(page: Page): Promise<void> {
    await byTestId(page, TEST_IDS.TERMINAL_BTN_LOCK).click()
  },

  /**
   * Waits for the terminal to be ready (visible and initialized).
   */
  async waitForReady(page: Page): Promise<void> {
    await waitForTestId(page, TEST_IDS.TERMINAL_INSTANCE)
    // Wait for PTY initialization
    await page.waitForTimeout(1000)
  }
}

// =============================================================================
// Mermaid diagram helpers
// =============================================================================

/**
 * Mermaid diagram interaction helpers.
 *
 * @example
 * ```typescript
 * // Hover over a diagram to show toolbar
 * await mermaid.hoverDiagram(page, 0);
 *
 * // Change diagram direction
 * await mermaid.setDirection(page, 'LR');
 *
 * // Open fullscreen viewer
 * await mermaid.openViewer(page);
 * ```
 */
export const mermaid = {
  /**
   * Gets the Mermaid toolbar locator.
   */
  getToolbar(page: Page): Locator {
    return byTestId(page, TEST_IDS.MERMAID_TOOLBAR)
  },

  /**
   * Gets the diagram viewer locator.
   */
  getViewer(page: Page): Locator {
    return byTestId(page, TEST_IDS.DIAGRAM_VIEWER)
  },

  /**
   * Hovers over a Mermaid diagram to show the toolbar.
   *
   * @param page - Playwright Page instance
   * @param index - The index of the diagram to hover (0-based, default: 0)
   */
  async hoverDiagram(page: Page, index = 0): Promise<void> {
    const preview = byTestId(page, TEST_IDS.EDITOR_PREVIEW)
    const diagram = preview.locator('.mermaid').nth(index)
    await diagram.hover()
    await waitForTestId(page, TEST_IDS.MERMAID_TOOLBAR)
  },

  /**
   * Changes the diagram direction.
   *
   * @param page - Playwright Page instance
   * @param direction - The direction to set: 'TB', 'BT', 'LR', or 'RL'
   */
  async setDirection(page: Page, direction: 'TB' | 'BT' | 'LR' | 'RL'): Promise<void> {
    await byTestId(page, TEST_IDS.MERMAID_DIRECTION_BTN).click()
    // The direction button in the toolbar uses dynamic testid with direction suffix
    await byTestId(page, `${TEST_IDS.MERMAID_DIRECTION_BTN}-${direction}`).click()
  },

  /**
   * Opens the fullscreen diagram viewer.
   */
  async openViewer(page: Page): Promise<void> {
    await byTestId(page, TEST_IDS.MERMAID_BTN_EXPAND).click()
    await waitForTestId(page, TEST_IDS.DIAGRAM_VIEWER)
  },

  /**
   * Closes the diagram viewer by pressing Escape.
   */
  async closeViewer(page: Page): Promise<void> {
    await page.keyboard.press('Escape')
    await waitForTestIdHidden(page, TEST_IDS.DIAGRAM_VIEWER)
  },

  /**
   * Zooms in on the diagram in the viewer.
   */
  async zoomIn(page: Page): Promise<void> {
    await byTestId(page, TEST_IDS.CHAT_BTN_ZOOM_IN).click()
  },

  /**
   * Zooms out on the diagram in the viewer.
   */
  async zoomOut(page: Page): Promise<void> {
    await byTestId(page, TEST_IDS.CHAT_BTN_ZOOM_OUT).click()
  },

  /**
   * Fits the diagram to the viewer viewport.
   */
  async fitToView(page: Page): Promise<void> {
    await byTestId(page, TEST_IDS.CHAT_BTN_FIT).click()
  },

  /**
   * Resets the zoom level to 100%.
   */
  async resetZoom(page: Page): Promise<void> {
    await byTestId(page, TEST_IDS.CHAT_BTN_RESET).click()
  },

  /**
   * Opens the chat panel in the diagram viewer.
   */
  async openChat(page: Page): Promise<void> {
    await byTestId(page, TEST_IDS.DIAGRAM_VIEWER_BTN_CHAT).click()
    await waitForTestId(page, TEST_IDS.CHAT_PANEL)
  },

  /**
   * Sends a message in the diagram chat.
   *
   * @param page - Playwright Page instance
   * @param message - The message to send
   */
  async sendChatMessage(page: Page, message: string): Promise<void> {
    const textarea = byTestId(page, TEST_IDS.CHAT_TEXTAREA)
    await textarea.fill(message)
    await byTestId(page, TEST_IDS.CHAT_BTN_SEND).click()
  }
}

// =============================================================================
// App-level helpers
// =============================================================================

/**
 * Waits for the Erfana app to be fully ready.
 *
 * @param page - Playwright Page instance
 */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await waitForTestId(page, TEST_IDS.ACTIVITY_BAR, { timeout: 10000 })
}

/**
 * Opens the project tree panel by clicking the files button.
 */
export async function openProjectTree(page: Page): Promise<void> {
  await byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_FILES).click()
  await waitForTestId(page, TEST_IDS.PROJECT_TREE)
}

/**
 * Opens the settings overlay.
 */
export async function openSettings(page: Page): Promise<void> {
  await byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_SETTINGS).click()
  await waitForTestId(page, TEST_IDS.SETTINGS_OVERLAY)
}

/**
 * Closes the settings overlay by pressing Escape.
 */
export async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await waitForTestIdHidden(page, TEST_IDS.SETTINGS_OVERLAY)
}

/**
 * Clicks a file in the project tree by its path.
 *
 * @param page - Playwright Page instance
 * @param filePath - The file path (relative or absolute)
 */
export async function clickFileInTree(page: Page, filePath: string): Promise<void> {
  const node = byDynamicTestId(page, TEST_IDS.PROJECT_TREE_NODE, filePath)
  await node.click()
}

/**
 * Toggles a folder's expanded state in the project tree.
 *
 * @param page - Playwright Page instance
 * @param folderPath - The folder path
 */
export async function toggleFolder(page: Page, folderPath: string): Promise<void> {
  const toggle = byDynamicTestId(page, TEST_IDS.PROJECT_TREE_TOGGLE, folderPath)
  await toggle.click()
}

// =============================================================================
// Project management helpers
// =============================================================================

/**
 * Dismisses application dialogs if present.
 *
 * Uses Playwright's auto-retrying assertions instead of arbitrary timeouts.
 * Handles multiple dialogs appearing in sequence (e.g., unsaved changes
 * followed by project switch confirmation).
 *
 * Note: This handles Erfana's custom React dialogs, not native OS dialogs.
 * For native dialogs, use stubDialog from electron-playwright-helpers.
 *
 * @param page - Playwright Page instance
 * @param options - Optional configuration
 * @param options.timeout - Time to wait for each dialog check (default: 500ms)
 * @param options.maxAttempts - Maximum number of dialogs to dismiss (default: 3)
 *
 * @example
 * ```typescript
 * // Dismiss any dialogs after page reload
 * await page.reload();
 * await dismissDialogIfPresent(page);
 *
 * // With custom timeout for slower environments
 * await dismissDialogIfPresent(page, { timeout: 1000 });
 * ```
 */
export async function dismissDialogIfPresent(
  page: Page,
  options: { timeout?: number; maxAttempts?: number } = {}
): Promise<void> {
  const { timeout = 500, maxAttempts = 3 } = options
  let attempts = 0

  while (attempts < maxAttempts) {
    const confirmBtn = byTestId(page, TEST_IDS.DIALOG_BTN_CONFIRM)

    try {
      // Quick check if dialog is visible using short timeout
      await expect(confirmBtn).toBeVisible({ timeout })

      // Dialog found - click to dismiss
      await confirmBtn.click()

      // Wait for dialog to be dismissed before checking for next one
      await expect(byTestId(page, TEST_IDS.DIALOG_OVERLAY)).not.toBeVisible({ timeout: 500 })

      attempts++
      // Continue loop to check for additional dialogs
    } catch {
      // No dialog visible within timeout - we're done
      break
    }
  }
}

/**
 * Opens a project using the IPC API directly.
 *
 * This bypasses the native file dialog and uses the `openProjectByPath` API
 * which is more reliable for E2E testing as it doesn't require dialog stubbing.
 *
 * The flow is:
 * 1. Clear localStorage for clean state
 * 2. Reload page
 * 3. Call the openProjectByPath API via page.evaluate
 * 4. Wait for project tree and terminal button to appear
 *
 * @param electronApp - Playwright ElectronApplication instance (unused but kept for API compatibility)
 * @param page - Playwright Page instance
 * @param projectPath - The path to the project folder
 *
 * @example
 * ```typescript
 * await openProject(electronApp, window, '/path/to/test/project');
 * await waitForTestId(window, TEST_IDS.PROJECT_TREE);
 * ```
 */
export async function openProject(
  _electronApp: ElectronApplication,
  page: Page,
  projectPath: string
): Promise<void> {
  // Clear persisted activity bar state to ensure clean slate
  await page.evaluate(() => {
    localStorage.removeItem('erfana-activity-bar-state')
  })

  // Reload the page to apply clean state
  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  // Handle potential dialogs that may appear on reload (unsaved changes, project switch, etc.)
  await dismissDialogIfPresent(page)

  await waitForTestId(page, TEST_IDS.ACTIVITY_BAR, { timeout: 10000 })

  // Now project tree should be visible by default (leftActivePanel: 'project')
  const projectTree = byTestId(page, TEST_IDS.PROJECT_TREE)
  await expect(projectTree).toBeVisible({ timeout: 10000 })

  // Open the project using the API directly (bypasses dialog)
  // This is more reliable than stubbing the dialog as it uses the same code path
  // that Recent Projects uses to open projects
  await page.evaluate(async (path: string) => {
    await (window as any).api.file.openProjectByPath(path)
  }, projectPath)

  // Wait for project to load - file nodes should appear in the tree
  // Using longer timeout as project loading involves IPC, file system, and React rendering
  const fileNodes = page.locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
  await expect(fileNodes.first()).toBeVisible({ timeout: 15000 })

  // Wait for terminal button to appear - this confirms projectPath has propagated to ActivityBar
  // The terminal button has requiresProject: true, so it only renders when projectPath is set
  const terminalBtn = byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)
  await expect(terminalBtn).toBeVisible({ timeout: 10000 })
}

/**
 * Opens a project using the UI flow with native dialog stubbed.
 *
 * Uses stubDialog to intercept the native file dialog and return the
 * specified project path, allowing E2E tests to test the actual UI flow
 * without manual interaction.
 *
 * Unlike openProject() which uses the API directly, this function tests
 * the full user-facing flow: clicking the "Open Folder" button and
 * handling the native file picker.
 *
 * @param electronApp - Playwright ElectronApplication instance
 * @param page - Playwright Page instance
 * @param projectPath - The path to return from the stubbed dialog
 *
 * @example
 * ```typescript
 * // Test the Open Folder button flow
 * await openProjectViaUI(electronApp, window, '/path/to/test/project');
 * await expect(byTestId(window, TEST_IDS.PROJECT_TREE)).toBeVisible();
 * ```
 */
export async function openProjectViaUI(
  electronApp: ElectronApplication,
  page: Page,
  projectPath: string
): Promise<void> {
  // Stub the native file dialog to return the test project path
  await stubDialog(electronApp, 'showOpenDialog', {
    filePaths: [projectPath],
    canceled: false
  })

  // Wait for app to be ready
  await waitForTestId(page, TEST_IDS.ACTIVITY_BAR, { timeout: 10000 })

  // Click the Open Folder button in the project tree
  const openBtn = byTestId(page, TEST_IDS.PROJECT_TREE_BTN_OPEN)
  await expect(openBtn).toBeVisible({ timeout: 5000 })
  await openBtn.click()

  // Dismiss any app dialogs that may appear (unsaved changes, etc.)
  await dismissDialogIfPresent(page)

  // Wait for project to load - file nodes should appear in the tree
  const fileNodes = page.locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
  await expect(fileNodes.first()).toBeVisible({ timeout: 15000 })

  // Wait for terminal button to appear (confirms project is fully loaded)
  const terminalBtn = byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)
  await expect(terminalBtn).toBeVisible({ timeout: 10000 })
}

/**
 * Clicks a file in the project tree by its filename (for simpler tests).
 * Uses the file-specific testid to avoid matching folder nodes.
 *
 * @param page - Playwright Page instance
 * @param fileName - The file name to click (e.g., 'test.md')
 */
export async function clickFileByName(page: Page, fileName: string): Promise<void> {
  // Use the file-specific testid (PROJECT_TREE_NODE_FILE) to match only files
  const fileNode = page
    .locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
    .filter({ hasText: fileName })

  // Wait for the file node to be visible and stable before clicking
  await expect(fileNode).toBeVisible({ timeout: 5000 })

  // Click the file node to open it in the editor
  await fileNode.click()

  // Wait for the editor to open (file click triggers tab creation and editor mount)
  await page.waitForTimeout(1000)
}

/**
 * Closes the Electron app gracefully, handling quit confirmation dialogs naturally.
 *
 * The app may show a quit confirmation dialog when:
 * - There are unsaved changes in the editor
 * - There is terminal activity
 *
 * This helper triggers quit via keyboard shortcut (Cmd+Q / Ctrl+Q) which goes
 * through the app's natural quit flow. If a dialog appears, it clicks the
 * confirm button to proceed with quit.
 *
 * **Why keyboard shortcut instead of electronApp.close()?**
 * Calling electronApp.close() triggers the quit flow which may show a dialog,
 * but by then we've already passed the point where we can interact with the page.
 * The keyboard shortcut triggers quit from within the page context, allowing us
 * to wait for and click any dialogs that appear.
 *
 * @param electronApp - Playwright ElectronApplication instance
 * @param page - Playwright Page instance (may be undefined if test failed early)
 *
 * @example
 * ```typescript
 * // In test finally block
 * } finally {
 *   await closeApp(electronApp, window);
 *   await cleanupTestProject(projectPath);
 * }
 * ```
 */
export async function closeApp(
  electronApp: ElectronApplication,
  page?: Page
): Promise<void> {
  if (!page) {
    // No page available - just close directly
    await electronApp.close()
    return
  }

  // Trigger quit from within the page by calling window.close()
  // This triggers the window's 'close' event which sends 'quit:requested' IPC to renderer
  // The renderer then checks for blockers and may show a confirmation dialog
  try {
    await page.evaluate(() => window.close())
  } catch {
    // Page might already be closing - continue
  }

  // Wait for and handle quit confirmation dialog
  // The dialog appears if there are unsaved changes or terminal activity
  // Use multiple attempts with short waits to handle race conditions
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Check if quit dialog appeared
      const confirmBtn = byTestId(page, TEST_IDS.DIALOG_BTN_CONFIRM)
      await expect(confirmBtn).toBeVisible({ timeout: 1500 })

      // Dialog appeared - click confirm ("Quit" button) to proceed
      await confirmBtn.click()

      // Wait for dialog to close (may fail if app closed)
      try {
        await page.waitForTimeout(300)
      } catch {
        // Page closed after clicking confirm - this is expected
        break
      }

      // Check if another dialog appeared (e.g., terminal activity after unsaved changes)
      continue
    } catch {
      // No dialog visible - either app is quitting or no blockers
      break
    }
  }

  // Fallback: ensure app is closed (may already be closed)
  try {
    await electronApp.close()
  } catch {
    // App already closed - this is fine
  }
}
