// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Visual regression of the built-in browser's Erfana surfaces (spec 025,
 * issue #448): the toolbar (navigation row + pick row), the pick panel over
 * the page's still image, the prompt-actions panel, the instruction dialog
 * and the three warning pages (certificate, load error, crashed).
 *
 * Same rules as `visual-regression.e2e.ts`: the `visualTest` fixtures (pinned
 * window content size, 1× DPR), no retries, the baseline-exists guard, and
 * `toHaveScreenshot`'s two-pass stability check as the only wait for paint.
 *
 * What is in these pictures, and what is made deterministic:
 * - The page itself is a native view drawn outside Erfana's DOM, so it is
 *   never in a window screenshot. The pick surfaces draw over the page's
 *   still image – a canvas in Erfana's DOM painted from a capture of the
 *   committed `elements.html` fixture – so that picture *is* captured, as the
 *   user sees it under the panel.
 * - The target terminal runs `cat` (the browser tests' stub agent,
 *   {@link AgentTerminal}). With the bare shell the pick row, the panel and
 *   the dialog name the host's login shell (`zsh`, `bash`) and the panel adds
 *   a shell-guard banner that wraps by that name – a picture of the machine,
 *   not of Erfana.
 * - The fixture servers listen on OS-assigned ports. Every port number the
 *   panel draws (the address bar, the warning pages' host and address lines)
 *   is replaced by {@link PINNED_PORT} just before the capture
 *   ({@link pinPortText}), so those lines stay under assertion instead of
 *   behind a mask. Nothing else in the DOM is touched.
 *
 * Needs the test hooks (`electron-vite build --mode e2e`, which
 * `npm run test:e2e:visual` runs): the pick is driven through main-side input
 * and the crash through the tab's `webContents` id.
 */
import * as net from 'node:net'
import type { Page } from '@playwright/test'
import { visualTest, expect } from './fixtures/index'
import { BROWSER_CHROMIUM_ARGS, startBrowserFixtureServers, type BrowserFixtureServers } from './fixtures/browser/serve'
import { AgentTerminal, PickFlow, PICK_WAIT_MS } from './pages/browser-pick-flow.page'
import { ECHO_AGENT } from './fixtures/browser/echoAgent'
import { assertBaselineExists } from './utils/visual-baseline'

/**
 * `visualTest` launched on the sealed network of the browser tests (every
 * `*.test` host reaches the fixture servers, any other host fails at once),
 * with the persisted renderer storage wiped before each launch, plus one set
 * of fixture servers per worker.
 */
const browserVisualTest = visualTest.extend<object, { browserServers: BrowserFixtureServers }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take their dependencies by destructuring
  visualExtraLaunchArgs: async ({}, use) => {
    await use([...BROWSER_CHROMIUM_ARGS])
  },
  // Each test starts from the default layout, whatever an earlier test in this worker persisted.
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take their dependencies by destructuring
  visualResetRendererStorage: async ({}, use) => {
    await use(true)
  },
  browserServers: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take their dependencies by destructuring
    async ({}, use) => {
      const servers = await startBrowserFixtureServers()
      try {
        await use(servers)
      } finally {
        await servers.close()
      }
    },
    { scope: 'worker' }
  ]
})

/** The element the pick panel and the dialog are opened on (`elements.html`). */
const PICK_SELECTOR = '#save-label'
const PICK_LABEL = 'span#save-label '

/**
 * The port drawn in every baseline. Five digits, as every OS-assigned port is
 * on the supported hosts (ephemeral ranges start at 32768 or 49152).
 */
const PINNED_PORT = '54321'

/** A loopback port nothing listens on, for the load-error page. */
async function closedPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/**
 * Replace the port number `port` with {@link PINNED_PORT} in the browser
 * panel's drawn text – a determinism helper, run right before the capture.
 * Matched as a whole number, not as `:<port>`: the address bar draws the port
 * in its own text node, apart from the colon. It edits drawn text only: no
 * event is fired, so React's state and main's tab are unchanged.
 *
 * Text nodes only, never a field's value: React writes a controlled field's
 * value back on its next render, so a pinned value does not hold. Every
 * capture is therefore taken with the address bar at rest, where the field's
 * own text is not drawn and the at-rest address line (text nodes) is. Fails
 * when the panel still shows the port afterwards, so a text the walk missed
 * is caught here, not as a pixel diff.
 */
async function pinPortText(flow: PickFlow, port: number): Promise<void> {
  await expect(flow.panel.addressBar).not.toBeFocused()
  await flow.panel.root.evaluate(
    (root, [from, to]) => {
      const number = new RegExp(`(?<!\\d)${from}(?!\\d)`, 'g')
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.nodeValue ?? ''
        const pinned = text.replace(number, to)
        if (pinned !== text) node.nodeValue = pinned
      }
    },
    [String(port), PINNED_PORT] as const
  )
  await expect(flow.panel.root).not.toContainText(String(port))
}

/**
 * The toolbar's two rows as one clip in window CSS px: they are siblings in
 * the panel with no shared container, and a whole-panel shot would pull the
 * page area in.
 */
async function toolbarClip(flow: PickFlow): Promise<{ x: number; y: number; width: number; height: number }> {
  const nav = await flow.panel.navigation.boundingBox()
  const row = await flow.ui.row.boundingBox()
  if (nav === null || row === null) throw new Error('toolbarClip: the navigation row or the pick row is not drawn')
  const x = Math.min(nav.x, row.x)
  const y = Math.min(nav.y, row.y)
  const right = Math.max(nav.x + nav.width, row.x + row.width)
  const bottom = Math.max(nav.y + nav.height, row.y + row.height)
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * A new browser tab whose target terminal runs the stub agent (`cat`), so the
 * target reads the same on every host and no shell-guard banner shows.
 *
 * A tab reads its target as it opens (and again when its panel opens), so the
 * agent is started from a first tab and the tab under test is opened after
 * it – as for a user who starts the agent first. The first tab stays open,
 * hidden behind the second.
 */
async function openTabWithAgent(app: Parameters<typeof PickFlow.open>[0], window: Page): Promise<PickFlow> {
  const setup = await PickFlow.open(app, window)
  await new AgentTerminal(window, setup).start()
  const flow = await PickFlow.open(app, window)
  await expect(flow.target).toHaveAccessibleName(`Terminal · ${ECHO_AGENT.name}, target terminal`, { timeout: PICK_WAIT_MS })
  return flow
}

/** {@link openTabWithAgent} with `elements.html` loaded and taking pointer input. */
async function openElementsPage(
  app: Parameters<typeof PickFlow.open>[0],
  window: Page,
  servers: BrowserFixtureServers
): Promise<PickFlow> {
  const flow = await openTabWithAgent(app, window)
  await flow.load(servers.sites.static.url('/elements.html'))
  await expect(flow.pickButton).not.toHaveAttribute('aria-disabled', 'true')
  return flow
}

/** Turn pick mode on and pick {@link PICK_SELECTOR} with Ctrl/Cmd+E: the panel opens over the frozen page's still image. */
async function pickSaveLabel(flow: PickFlow): Promise<void> {
  await flow.pickButton.click()
  await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'true')
  await flow.pickByShortcut(PICK_SELECTOR, PICK_LABEL)
  await expect(flow.still).toBeVisible()
  await expect(flow.chip).toContainText('span#save-label')
  await expect(flow.action('Explain')).toBeFocused()
}

// ---------------------------------------------------------------------------
// Toolbar and pick surfaces
// ---------------------------------------------------------------------------

browserVisualTest.describe('Visual regression – built-in browser, toolbar and pick', () => {
  browserVisualTest.slow()

  browserVisualTest('should draw the navigation row and the pick row when a page has loaded', async (
    { visualAppWithProject, visualWindowWithProject, browserServers },
    testInfo
  ) => {
    assertBaselineExists('browser-toolbar', testInfo)
    const flow = await openElementsPage(visualAppWithProject, visualWindowWithProject, browserServers)
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'false')
    // The address bar keeps focus after Enter; at rest it draws the address line the user reads while working.
    await flow.panel.addressBar.blur()
    await pinPortText(flow, browserServers.sites.static.httpPort)

    await expect(visualWindowWithProject).toHaveScreenshot('browser-toolbar.png', { clip: await toolbarClip(flow) })
  })

  browserVisualTest('should draw the pick panel and the outline over the still image when an element is picked', async (
    { visualAppWithProject, visualWindowWithProject, browserServers },
    testInfo
  ) => {
    assertBaselineExists('browser-pick-over-still', testInfo)
    const flow = await openElementsPage(visualAppWithProject, visualWindowWithProject, browserServers)
    await pickSaveLabel(flow)
    await pinPortText(flow, browserServers.sites.static.httpPort)

    // The whole panel: toolbar, pick row in its picked state, and the page area with the still, the outline and the panel.
    await expect(flow.panel.root).toHaveScreenshot('browser-pick-over-still.png')
  })

  browserVisualTest('should draw the prompt-actions panel when an element is picked', async (
    { visualAppWithProject, visualWindowWithProject, browserServers },
    testInfo
  ) => {
    assertBaselineExists('browser-prompt-actions', testInfo)
    const flow = await openElementsPage(visualAppWithProject, visualWindowWithProject, browserServers)
    await pickSaveLabel(flow)

    await expect(flow.actions).toHaveScreenshot('browser-prompt-actions.png')
  })

  browserVisualTest('should draw the instruction dialog when Ask is chosen from the prompt-actions panel', async (
    { visualAppWithProject, visualWindowWithProject, browserServers },
    testInfo
  ) => {
    assertBaselineExists('browser-instruction-dialog', testInfo)
    const flow = await openElementsPage(visualAppWithProject, visualWindowWithProject, browserServers)
    await pickSaveLabel(flow)
    await flow.action('Ask').click()
    await expect(flow.dialog).toBeVisible({ timeout: PICK_WAIT_MS })
    await expect(flow.actions).toHaveCount(0)
    await expect(flow.dialog.getByRole('textbox', { name: 'Your question' })).toBeFocused()

    await expect(flow.dialog).toHaveScreenshot('browser-instruction-dialog.png')
  })
})

// ---------------------------------------------------------------------------
// Warning pages
// ---------------------------------------------------------------------------

browserVisualTest.describe('Visual regression – built-in browser, warning pages', () => {
  browserVisualTest.slow()

  browserVisualTest('should draw the certificate page when a site presents an untrusted certificate', async (
    { visualAppWithProject, visualWindowWithProject, browserServers },
    testInfo
  ) => {
    assertBaselineExists('browser-page-certificate', testInfo)
    const flow = await openTabWithAgent(visualAppWithProject, visualWindowWithProject)
    const panel = flow.panel
    const server = browserServers.certServers.selfSigned
    await panel.load(server.url('/'))
    await expect(panel.pageHeading).toHaveText(/^selfsigned\.test(:\d+)? has a certificate Erfana can't trust$/, {
      timeout: PICK_WAIT_MS
    })
    await expect(panel.root.getByRole('button', { name: 'Back to safety' })).toBeFocused()
    // Proceed anyway is drawn disabled during its input guard; capture the settled state, not the guard.
    await expect(panel.root.getByRole('button', { name: /^Proceed anyway to selfsigned\.test/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
      { timeout: PICK_WAIT_MS }
    )
    await pinPortText(flow, server.port)

    await expect(panel.root).toHaveScreenshot('browser-page-certificate.png')
  })

  browserVisualTest('should draw the load-error page when the server refuses the connection', async (
    { visualAppWithProject, visualWindowWithProject },
    testInfo
  ) => {
    assertBaselineExists('browser-page-load-error', testInfo)
    const flow = await openTabWithAgent(visualAppWithProject, visualWindowWithProject)
    const panel = flow.panel
    const port = await closedPort()
    await panel.load(`localhost:${port}`)
    await expect(panel.pageHeading).toHaveText('localhost refused to connect', { timeout: PICK_WAIT_MS })
    await expect(panel.root.getByText('ERR_CONNECTION_REFUSED (-102)')).toBeVisible()
    await expect(panel.root.getByRole('button', { name: 'Reload', exact: true }).last()).toBeFocused()
    await pinPortText(flow, port)

    await expect(panel.root).toHaveScreenshot('browser-page-load-error.png')
  })

  browserVisualTest('should draw the crashed page when the page process stops', async (
    { visualAppWithProject, visualWindowWithProject, browserServers },
    testInfo
  ) => {
    assertBaselineExists('browser-page-crashed', testInfo)
    const flow = await openTabWithAgent(visualAppWithProject, visualWindowWithProject)
    const panel = flow.panel
    await flow.load(browserServers.sites.static.url('/index.html'), { pointer: false })
    const { webContentsId } = await panel.hookTab()
    await visualAppWithProject.evaluate(({ webContents }, id) => {
      webContents.fromId(id)?.forcefullyCrashRenderer()
    }, webContentsId)
    await expect(panel.pageHeading).toHaveText('This page crashed', { timeout: PICK_WAIT_MS })
    await pinPortText(flow, browserServers.sites.static.httpPort)

    await expect(panel.root).toHaveScreenshot('browser-page-crashed.png')
  })
})
