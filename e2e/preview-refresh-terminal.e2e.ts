// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E test for terminal → image viewer routing (issue #70, AC5).
 *
 * Before the shared panel router, every terminal file link built an
 * `editor-…` panel id, so clicking `logo.png` in agent output opened Monaco on
 * binary bytes. This spec drives a real xterm link click and asserts the image
 * viewer opened instead.
 *
 * Split out of `preview-refresh.e2e.ts` for two reasons: it needs a launch
 * environment the composed fixtures do not provide (`ERFANA_E2E_FAST_SHELL`,
 * so the PTY does not race a multi-second shell rc), and it keeps both specs
 * comfortably under the file-size policy.
 *
 * Clicking an xterm link is a geometry problem: the WebGL renderer paints text
 * to a canvas, so there is no DOM node to click. The cell grid is reconstructed
 * from xterm's own IME helper textarea, which is parked on the cursor cell and
 * sized to exactly one cell, and the click is retried across the printed rows –
 * the link provider validates the path over IPC, so the very first click can
 * land before the link exists. Every wait is a bounded condition wait, never a
 * sleep.
 *
 * @see src/renderer/src/hooks/useTerminalFileLinks.ts
 * @see temp/design-70.md § 7.4 T4
 */

import { test, expect, _electron as electron } from '@playwright/test'
import * as path from 'path'
import type { ElectronApplication, Page } from '@playwright/test'

import {
  TEST_IDS,
  waitForAppReady,
  openProject,
  terminal,
  closeApp,
  createTestProject,
  createTempUserDataDir
} from './utils/helpers'
import { ImageViewerPage } from './pages/image-viewer.page'

// =============================================================================
// Constants and helpers
// =============================================================================

const IMAGE_NAME = 'icon.svg'

const SEED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" data-marker="v1" width="200" height="200" ' +
  'viewBox="0 0 200 200"><rect width="200" height="200" fill="#1f1f1f"/></svg>\n'

/** How long to keep retrying the link click before failing. */
const LINK_CLICK_BUDGET_MS = process.platform === 'win32' ? 30_000 : 20_000

/** How many lines the probe command prints, and therefore how many rows carry a link. */
const PRINTED_LINES = 3

/**
 * xterm's cell grid, reconstructed from the DOM.
 *
 * `left`/`top` are the origin of buffer cell (0, 0) in page coordinates.
 * `cursorRow` is where the shell's prompt currently sits, which is what makes
 * the printed rows addressable without counting prompt lines by hand.
 */
type TerminalGrid = {
  left: number
  top: number
  cellWidth: number
  cellHeight: number
  cursorRow: number
}

/**
 * Measure the cell grid from xterm's own helper textarea.
 *
 * xterm keeps `.xterm-helper-textarea` parked on the cursor cell for IME, sized
 * to exactly one cell and positioned relative to the `.xterm` element. Its
 * inline styles are therefore a first-party readout of cell width, cell height
 * AND the cursor's row – no private renderer internals, no font maths, and no
 * dependence on `.xterm-char-measure-element`, which this xterm build does not
 * leave in the DOM.
 */
async function readTerminalGrid(page: Page): Promise<TerminalGrid> {
  const grid = await page.evaluate(() => {
    const root = document.querySelector('.xterm') as HTMLElement | null
    const helper = document.querySelector('.xterm-helper-textarea') as HTMLElement | null
    if (!root || !helper) return null

    const cellWidth = parseFloat(helper.style.width)
    const cellHeight = parseFloat(helper.style.height)
    if (!cellWidth || !cellHeight) return null

    const box = root.getBoundingClientRect()
    return {
      left: box.left,
      top: box.top,
      cellWidth,
      cellHeight,
      cursorRow: Math.round(parseFloat(helper.style.top) / cellHeight)
    }
  })

  expect(grid, 'xterm cell grid could not be measured').not.toBeNull()
  return grid!
}

/** Click the centre of one terminal cell. */
async function clickCell(page: Page, grid: TerminalGrid, row: number, col: number): Promise<void> {
  const x = grid.left + (col + 0.5) * grid.cellWidth
  const y = grid.top + (row + 0.5) * grid.cellHeight

  // Hover first: xterm asks the link provider for links at the hovered cell,
  // and the provider validates the path over IPC before a link exists at all.
  await page.mouse.move(x, y)
  await page.mouse.click(x, y)
}

// =============================================================================
// Tests
// =============================================================================

test.describe('Terminal file links route images to the image viewer', () => {
  test('should open the image viewer, not the editor, for an image path', async () => {
    const { projectPath, cleanup: cleanupProject } = await createTestProject({
      [IMAGE_NAME]: SEED_SVG,
      'notes.md': '# Notes\n'
    })
    const { userDataDir, cleanup: cleanupUserData } =
      await createTempUserDataDir('preview-refresh-terminal')

    let electronApp: ElectronApplication | undefined
    let window: Page | undefined

    try {
      electronApp = await electron.launch({
        args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
        env: {
          ...process.env,
          NODE_ENV: 'development',
          // Skip the user's login shell rc files – see docs/known-issues.md
          // § "E2E terminal-driven tests sensitive to user's shell init speed".
          ERFANA_E2E_FAST_SHELL: '1'
        }
      })

      window = await electronApp.firstWindow()
      await waitForAppReady(window)
      await openProject(window, projectPath)
      await terminal.open(window)

      // Print the path on its own short line, three times, so a click that
      // misses by a row still lands on a link. `clear` puts the prompt on row 0
      // and keeps the command line from wrapping the output down the screen.
      await terminal.sendCommand(window, `cd "${projectPath}"`)
      await terminal.sendCommand(window, 'clear')
      await terminal.sendCommand(
        window,
        `printf '%s\\n' ${Array(PRINTED_LINES).fill(IMAGE_NAME).join(' ')}`
      )

      const viewer = new ImageViewerPage(window, LINK_CLICK_BUDGET_MS)
      const panel = viewer.panel()

      const deadline = Date.now() + LINK_CLICK_BUDGET_MS
      while (Date.now() < deadline && !(await panel.isVisible())) {
        // Re-measured every round: the prompt moves as the shell echoes, and
        // the printed rows are addressed relative to the current cursor row.
        const grid = await readTerminalGrid(window)
        for (let offset = 1; offset <= PRINTED_LINES; offset++) {
          // Column 4 sits inside `icon.svg` (8 characters wide).
          await clickCell(window, grid, grid.cursorRow - offset, 4)
        }
        // Bounded condition wait, not a sleep: resolves the moment the panel
        // mounts, and otherwise gives the link provider's IPC round trip time
        // to complete before the next scan.
        await panel.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {})
      }

      await expect(panel).toBeVisible({ timeout: 5000 })
      await viewer.waitForReady()
      expect(await viewer.marker()).toBe('v1')

      // The routing decision is exclusive: no Monaco editor was opened for the
      // SVG. `editor-content` only exists when an editor panel is mounted.
      await expect(window.locator(`[data-testid="${TEST_IDS.EDITOR_CONTENT}"]`)).toHaveCount(0)
    } finally {
      if (electronApp && window) {
        await closeApp(electronApp, window)
      } else if (electronApp) {
        await electronApp.close().catch(() => {})
      }
      await cleanupProject()
      await cleanupUserData()
    }
  })
})
