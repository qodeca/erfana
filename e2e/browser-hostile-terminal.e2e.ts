// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's hostile pages that aim at the terminal and at pick
 * mode (spec 025, 025-NFR-001, 025-AC-046): a page that tries to open or type
 * into a terminal, one that forges pick events, and one whose drag payloads
 * are dropped on the terminal.
 *
 * Erfana's terminal panel runs the stub agent (`fixtures/browser/stub-agent.cjs`),
 * which records every byte the terminal sends it: "nothing reached the
 * terminal" is read from that record after a sentinel key the user types
 * there has arrived. Pick mode is read from main (`pick` hook) and from the
 * pick row, with a real Ctrl/Cmd+E as the positive control.
 *
 * **Drag (`drag-file.html`).** A real drag out of the page runs the OS drag
 * session, which no test input can drive. The drop on the terminal is
 * dispatched by the browser process (CDP `Input.dispatchDragEvent` on
 * Erfana's window – trusted events, Chromium's own drop path) carrying the
 * page's payloads exactly as the page sets them, so the worst case – nothing
 * filtered on the way out of the page – is what the terminal meets. The drag
 * start inside the page is not driven, so that test does not carry 025-AC-046.
 *
 * Condition-based waits only.
 */
import { test, expect } from './fixtures/browserHarness'
import { BrowserSendUi, PASTE_END, PASTE_START, SEND_WAIT_MS, type StubAgent } from './pages/browser-send.page'
import { HostileSuite, leaks } from './pages/browser-hostile.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'

const MOD = process.platform === 'darwin' ? 'meta' : 'control'

/**
 * The user types `mark` into the terminal; once the agent has it, everything
 * the agent received since the record was empty is returned.
 */
async function typeSentinel(send: BrowserSendUi, agent: StubAgent, mark: string): Promise<string> {
  await send.terminal.focus()
  await send.window.keyboard.type(mark)
  await expect.poll(() => agent.received(), { timeout: SEND_WAIT_MS, message: 'the sentinel reached the agent' }).toContain(mark)
  return agent.received()
}

// Pick, key routing and focus moving into the page all follow the page's
// native focus, which ends when the window stops being the OS key window: run
// with the OS-focus lock held exclusive (e2e/fixtures/osFocusLock.ts).
test.use({ needsOsFocus: true })

test.describe('built-in browser hostile pages: the terminal and pick mode', () => {
  test('025-AC-046 hostile page: no route opens a terminal or types into one', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    const hostile = new HostileSuite(send.ui.tabs, browserServers)
    await hostile.recordShellOpens()
    const terminals = await send.terminalInstance.count()
    const windows = await hostile.windowCount()

    const url = hostile.url('/terminal.html')
    await send.load(url)
    const page = await send.panel.page()
    expect(leaks(await hostile.report(page))).toEqual([])

    // The scheme links, clicked by the user: the page stays.
    for (const link of ['#scheme-link', '#preview-link']) {
      const token = await hostile.mark(page)
      await page.clickSelector(link)
      await hostile.expectStayed(page, url, token, link)
    }
    // window.open of erfana:// on a user click: nothing opens.
    await page.clickSelector('#open-scheme')
    await page.waitFor(`window.__canary.results.some((r) => r.name === 'window.open erfana://')`, 'window.open tried')
    const report = await hostile.report(page)
    expect(leaks(report)).toEqual([])
    expect(report.attempts.map((a) => a.name)).toEqual(
      expect.arrayContaining(['bridge terminal.create', 'bridge terminal.write', 'iframe erfana://', 'window.open erfana://'])
    )
    await hostile.sentinel(page)

    expect(await typeSentinel(send, agent, 'Q')).toBe('Q')
    expect(await send.terminalInstance.count()).toBe(terminals)
    expect((await send.terminal.readScreen()).lines.join('\n')).not.toContain('ERFANA-HOSTILE-TERMINAL-7f3a')
    expect(await hostile.windowCount()).toBe(windows)
    expect(await hostile.shellOpens()).toEqual({ external: [], paths: [], shown: [] })
    await hostile.expectOnlyTabsInBrowserSession()
  })

  test('025-AC-046 hostile page: forged pick keys, clicks and messages neither start, confirm nor end pick mode, and send nothing', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    const hostile = new HostileSuite(send.ui.tabs, browserServers)
    await send.load(hostile.url('/forge-pick.html'))
    const page = await send.panel.page()
    const driver = await send.driver()

    // On load and once more: pick mode stays off.
    expect(leaks(await hostile.report(page))).toEqual([])
    await page.eval('window.__forge.run(); 0')
    await hostile.sentinel(page)
    await expect(send.pick.pickButton).toHaveAttribute('aria-pressed', 'false')
    expect(await send.pickState()).toMatchObject({ active: false, capture: null })

    // Positive control: the real Ctrl/Cmd+E from the page starts pick mode.
    await page.waitForInputReady()
    await driver.key('e', [MOD])
    await expect(send.pick.pickButton).toHaveAttribute('aria-pressed', 'true', { timeout: SEND_WAIT_MS })

    // Forged Enter, Up, Esc and clicks while pick mode is on: nothing is confirmed, and pick mode stays on.
    await page.eval('window.__forge.run(); 0')
    // Sentinel: a real pointer move is still highlighted, so pick mode is live and unconfirmed.
    await driver.hoverSelector('#victim span', 'span')
    await expect(send.pick.actions).toHaveCount(0)
    await expect(send.pick.pickButton).toHaveAttribute('aria-pressed', 'true')
    expect(await send.pickState()).toMatchObject({ active: true, capture: null })

    // Positive control: the real Esc ends it.
    await driver.key('Escape')
    await expect(send.pick.pickButton).toHaveAttribute('aria-pressed', 'false', { timeout: SEND_WAIT_MS })
    expect(await send.captureFiles()).toEqual([])
    const received = await typeSentinel(send, agent, 'Q')
    expect(received).toBe('Q')
    expect(received).not.toContain('ERFANA-HOSTILE-FORGE-7f3a')
  })

  test('hostile page: its drag payloads dropped on the terminal type no command and no file path unasked', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    const hostile = new HostileSuite(send.ui.tabs, browserServers)
    await send.load(hostile.url('/drag-file.html'))
    const page = await send.panel.page()
    const payloads = await page.eval<Record<string, Array<[string, string]>>>('PAYLOADS')
    expect(Object.keys(payloads).sort()).toEqual(['drag-download', 'drag-text', 'drag-uri'])

    const cdp = await send.window.context().newCDPSession(send.window)
    const box = await send.terminalInstance.boundingBox()
    if (box === null) throw new Error('The terminal is not drawn')
    const at = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
    const drop = async (id: string): Promise<void> => {
      const data = { items: payloads[id]!.map(([mimeType, value]) => ({ mimeType, data: value })), dragOperationsMask: 1 }
      for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
        await cdp.send('Input.dispatchDragEvent', { type, ...at, data })
      }
    }
    const confirm = byTestId(send.window, TEST_IDS.DIALOG_CONFIRM)

    // A DownloadURL (a file the page serves): no file, no path, nothing typed.
    await drop('drag-download')
    expect(await typeSentinel(send, agent, 'A')).toBe('A')
    await agent.reset()

    // Shell text with a line break: Erfana asks first; Cancel types nothing.
    await drop('drag-text')
    await expect(confirm).toBeVisible({ timeout: SEND_WAIT_MS })
    await expect(byTestId(send.window, TEST_IDS.DIALOG_TITLE)).toHaveText('Drop text from outside Erfana?')
    await byTestId(send.window, TEST_IDS.DIALOG_BTN_CANCEL).click()
    await expect(confirm).toHaveCount(0)
    expect(await typeSentinel(send, agent, 'B')).toBe('B')
    await agent.reset()

    // A file:// URI list: no file is dropped. Its plain-text part, a path with no line break, is typed as
    // a bracketed paste and never run (025-FR-009 asks only about a line break or a control character).
    await drop('drag-uri')
    await expect.poll(() => agent.received(), { timeout: SEND_WAIT_MS }).toBe(`${PASTE_START}/etc/passwd${PASTE_END}`)
    await expect(confirm).toHaveCount(0)
    const received = await typeSentinel(send, agent, 'C')
    expect(received).toBe(`${PASTE_START}/etc/passwd${PASTE_END}C`)
    expect(received).not.toMatch(/[\r\n]/)
    expect((await send.terminal.readScreen()).lines.join('\n')).not.toContain('ERFANA-HOSTILE-DRAG-7f3a')
  })
})
