// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Hover-only elements, the freeze and the capture moment end to end (spec
 * 025): 025-AC-028 (a hover menu picked by the second Ctrl/Cmd+E and held
 * open, the freeze state and audio while the menu or dialog is open; the
 * click route) and 025-AC-067 (the capture is taken at the pick). Whether
 * the engine really pauses the page is `browser-pick-freeze-pause.e2e.ts`.
 *
 * Sends go to the app's terminal running `cat`. Capture files are read from
 * disk; PNGs are decoded by `nativeImage` in main. The double-click window
 * and the click guard are passed on main's test clock. Condition-based
 * waits only.
 */
import { test, expect } from './fixtures/browserHarness'
import {
  AgentTerminal,
  captureBox,
  captureFiles,
  contextFiles,
  near,
  newCapture,
  PickFlow,
  PICK_WAIT_MS as WAIT_MS,
  readPng
} from './pages/browser-pick-flow.page'

const MENU_DARK: [number, number, number] = [38, 50, 56] // #263238, the fixture's hover-menu background
const STATE_2: [number, number, number] = [21, 101, 192] // #1565c0
const ACCENT: [number, number, number] = [160, 168, 255] // --color-accent-primary (#A0A8FF)

/** Open the fixture's script hover menu with the pointer and rest on Reports. */
async function openHoverMenu(flow: PickFlow): Promise<void> {
  const trigger = await flow.rect('#menu-trigger')
  await flow.move(trigger.x + trigger.width / 2, trigger.y + trigger.height / 2)
  await (await flow.panel.page()).waitFor(`window.__fixture.menuOpen()`, 'the hover menu opened')
  const item = await flow.rect('#item-reports')
  await flow.move(item.x + item.width / 2, item.y + item.height / 2)
}

// Titled without the ID: whether the page really stops is in browser-pick-freeze-pause.e2e.ts (an open finding);
// "no focus emulation remains" cannot be read in this lane (see the last test of this block); the same-site popup
// is recorded only. So 025-AC-028 is not proven whole here.
test.describe('hover-only element and the freeze (025-AC-028)', () => {
  test('the second Ctrl/Cmd+E picks a hover-menu item: the menu stays open and the still shows it, the page is held and muted while the menu or dialog is open, and a click while held is never delivered', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/hover-menu.html'))
    expect(await flow.audioMuted()).toBe(false)
    // Every click the page receives is logged (test-owned listener).
    await flow.eval(`window.__fixture.clear(); document.addEventListener('click', (e) => window.__fixture.record('page-click', e.target.tagName), true); 0`)
    const heading = await flow.rect('h1')

    await openHoverMenu(flow)
    await flow.pickKey()
    await flow.waitForActive(true)
    expect(await flow.eval<boolean>('window.__fixture.menuOpen()'), 'pick mode starting keeps the menu open').toBe(true)
    await expect.poll(() => flow.highlightLabel(), { timeout: WAIT_MS }).toMatch(/^a#item-reports /)
    // The item's neighbour, read while the page runs: the click below lands on it.
    const billing = await flow.rect('#item-billing')
    await flow.pickKey()
    await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
    await expect(flow.chip).toHaveText(/^a#item-reports · /)
    await flow.waitForFrozen(true)
    await expect(flow.statusChip).toHaveText('Page paused')
    expect(await flow.audioMuted()).toBe(true)

    // The still image shows the open hover menu.
    const area = (await flow.panel.placeholder.boundingBox())!
    await expect(flow.still).toBeVisible()
    const paint = await flow.windowPaint()
    expect(near(paint(area.x + billing.x + 4, area.y + billing.y + billing.height / 2), MENU_DARK, 12), 'the open menu on the still').toBe(true)

    // A click on the page outside the panel while held – it lands on the still image over the page – closes the
    // menu (025-FR-049) and is never delivered to the page.
    const panel = (await flow.actions.boundingBox())!
    const at = { x: area.x + heading.x + 8, y: area.y + heading.y + heading.height / 2 }
    expect(at.x >= panel.x && at.x <= panel.x + panel.width && at.y >= panel.y && at.y <= panel.y + panel.height, 'the heading is outside the panel').toBe(false)
    await windowWithTestProject.mouse.click(at.x, at.y)
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    await flow.waitForFrozen(false)
    expect(await flow.audioMuted()).toBe(false)
    // Sentinel: the page runs again and answers; nothing was clicked in it.
    expect(await flow.eval<boolean>('window.__fixture.menuOpen()')).toBe(true)
    expect((await flow.pageLog()).filter((e) => e.type === 'page-click' || e.type === 'item-click')).toEqual([])
    expect((await flow.state()).active).toBe(true)

    // The dialog keeps the page held; Esc lets it go.
    await flow.waitForPageFocus()
    await openHoverMenu(flow)
    await expect.poll(() => flow.highlightLabel(), { timeout: WAIT_MS }).toMatch(/^a#item-reports /)
    await flow.pickKey()
    await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
    await flow.waitForFrozen(true)
    await flow.action('Ask').click()
    await expect(flow.dialog).toBeVisible()
    await expect(flow.dialog).toContainText('Page paused')
    expect((await flow.state()).frozen).toBe(true)
    expect(await flow.audioMuted()).toBe(true)
    await windowWithTestProject.keyboard.press('Escape')
    await expect(flow.dialog).toHaveCount(0, { timeout: WAIT_MS })
    await flow.waitForFrozen(false)
    expect(await flow.audioMuted()).toBe(false)
  })


  test('by the click route the hover menu stays open, the item is picked and the menu opens over the still with nothing frozen; the page logs no blur or visibilitychange', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/hover-menu.html'))
    await flow.eval('window.__fixture.clear(); 0')
    // The click on Pick element takes focus to the toolbar before the page gets it back.
    await flow.focusErfana()
    await flow.pickButton.click()
    await flow.waitForActive(true)
    await openHoverMenu(flow)
    await expect.poll(() => flow.highlightLabel(), { timeout: WAIT_MS }).toMatch(/^a#item-reports /)
    expect(await flow.eval<boolean>('window.__fixture.menuOpen()')).toBe(true)
    await flow.pickByClick('#item-reports', 'a#item-reports ')
    await expect(flow.chip).toHaveText(/^a#item-reports · /)
    await expect(flow.still).toBeVisible()
    expect((await flow.state()).frozen).toBe(false)
    expect(await flow.eval<boolean>('window.__fixture.menuOpen()')).toBe(true)
    const log = (await flow.pageLog()).map((e) => e.type)
    expect(log.filter((t) => t === 'blur' || t === 'visibilitychange' || t === 'menu-close' || t === 'item-click')).toEqual([])
  })

  test('the lane cannot read leftover focus emulation: document.hasFocus() is already true with the terminal focused before any pick', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    // A control that documents why the focus-emulation clause of 025-AC-028 is not asserted here (manual lane).
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    const terminal = new AgentTerminal(windowWithTestProject, flow)
    await terminal.open()
    await flow.load(browserServers.sites.static.url('/hover-menu.html'))
    await terminal.terminal.focus()
    expect(await flow.eval<boolean>('window.__fixture.hasFocus()')).toBe(true)
  })
})


// Titled without the ID: "two browser tabs send at the same time" is not proven here – showing one tab hides
// (and releases) the other, and the suite has no split-view helper to show both at once.
test.describe('the capture is taken at the pick (025-AC-067)', () => {
  test('picked by click in state 2, then advanced and removed under the Change dialog: the screenshot and HTML show state 2 and the console has only entries from before the pick', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    await flow.load(browserServers.sites.static.url('/changing.html'))
    expect(await flow.eval<number>('window.__fixture.setState(2)')).toBe(2)
    // The capture keeps warnings and errors (025-FR-038): one before the pick, one after.
    await flow.eval(`console.warn('logged before the pick'); 0`)
    await flow.pickButton.click()
    await flow.pickByClick('#changing', 'div#changing ')
    await flow.action('Change').click()
    await expect(flow.dialog).toBeVisible()
    await flow.eval(`console.warn('logged after the pick'); 0`)
    expect(await flow.eval<number>('window.__fixture.advance()')).toBe(3)
    expect(await flow.eval<boolean>('window.__fixture.remove()')).toBe(true)
    const before = await contextFiles(testProject.path)
    await flow.dialogField.fill('make it state two forever')
    await flow.dialogSend.click()
    await expect(flow.status).toContainText('Sent Change to Terminal', { timeout: WAIT_MS })

    const capture = await newCapture(testProject.path, before)
    expect(capture.text).toContain('data-state="2"')
    expect(capture.text).toContain('State 2')
    expect(capture.text).not.toContain('State 3')
    expect(capture.text).toMatch(/^- .* warning: logged before the pick$/m)
    expect(capture.text).not.toContain('logged after the pick')
    const { box, dpr } = captureBox(capture.text)
    const png = await readPng(appWithTestProject, capture.screenshot)
    expect(near(png.at((box.x + box.width / 2) * dpr, (box.y + box.height / 2) * dpr), STATE_2, 6), 'state 2 colour in the screenshot').toBe(true)
  })

  test('Up in the menu moves the capture to the parent with its outline; quick Up and Down presses: the last wins', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    await flow.load(browserServers.sites.static.url('/changing.html'))

    await flow.pickButton.click()
    await flow.pickByClick('#changing', 'div#changing ')
    await windowWithTestProject.keyboard.press('ArrowUp')
    await expect(flow.chip).toHaveText(/^section#changing-parent · /)
    let before = await contextFiles(testProject.path)
    await flow.action('Explain').click()
    let capture = await newCapture(testProject.path, before)
    expect(capture.text).toMatch(/^- .*section#changing-parent$/m)
    const parent = await flow.rect('#changing-parent')
    const { box, dpr } = captureBox(capture.text)
    expect(Math.abs(box.width - parent.width)).toBeLessThanOrEqual(1)
    const png = await readPng(appWithTestProject, capture.screenshot)
    // The 2-device-px outline just outside the parent's box, on its left edge.
    const left = [1, 2].map((d) => png.at((box.x * dpr) - d, (box.y + box.height / 2) * dpr))
    expect(left.some((c) => near(c, ACCENT, 30)), `outline on the parent: ${JSON.stringify(left)}`).toBe(true)

    // Up, Up, Down, Up as fast as they can be pressed: body is where the last press leaves the pick.
    await flow.waitForActive(false)
    await flow.pickButton.click()
    await flow.pickByClick('#changing', 'div#changing ')
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowUp']) await windowWithTestProject.keyboard.press(key)
    await expect(flow.chip).toHaveText(/^body · /)
    before = await contextFiles(testProject.path)
    await flow.action('Explain').click()
    capture = await newCapture(testProject.path, before)
    expect(capture.text).toMatch(/^- body$/m)
  })

  test('a parent that moves after the pick: Up draws its outline from the snapshot box, and the panel and the context file say the page changed after the pick', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    await flow.load(browserServers.sites.static.url('/changing.html'))
    await flow.pickButton.click()
    const snapshot = await flow.rect('#changing-parent')
    await flow.pickByClick('#changing', 'div#changing ')
    await flow.eval(`document.getElementById('changing-parent').style.marginTop = '80px'; 0`)
    await windowWithTestProject.keyboard.press('ArrowUp')
    await expect(flow.chip).toHaveText(/^section#changing-parent · /)
    await expect(flow.actions).toContainText('The page changed after the pick', { timeout: WAIT_MS })
    const before = await contextFiles(testProject.path)
    await flow.action('Explain').click()
    const capture = await newCapture(testProject.path, before)
    expect(capture.text).toMatch(/^- the page changed after the pick$/m)
    // The outline in the screenshot sits on the parent's box as it was at the pick, not where it moved.
    const { dpr } = captureBox(capture.text)
    const png = await readPng(appWithTestProject, capture.screenshot)
    const atSnapshot = [1, 2].map((d) => png.at(snapshot.x * dpr - d, (snapshot.y + snapshot.height / 2) * dpr))
    expect(atSnapshot.some((c) => near(c, ACCENT, 30)), `outline at the snapshot box: ${JSON.stringify(atSnapshot)}`).toBe(true)
  })

  test('a strip prompt shifts the page under a resting pointer: a click after the click guard confirms the element under the pointer at the click', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.trustTestCa(browserServers.tls.caPem)
    await flow.load(browserServers.sites.static.url('/permissions.html', { host: 'geo.test', secure: true }))
    await flow.pickButton.click()
    const button = await flow.hover('#request-notifications', 'button#request-notifications ')
    const point = { x: button.x + button.width / 2, y: button.y + button.height / 2 }
    // A site request puts a row in the strip above the page; the page moves down under the pointer.
    await flow.eval(`window.__fixture.clear(); navigator.geolocation.getCurrentPosition(() => {}, () => {}); 0`)
    await expect(flow.panel.stripRow('permission')).toBeVisible({ timeout: WAIT_MS })
    // Main armed the click guard for the shift (025-FR-047) before the test moves its clock past it.
    await expect.poll(async () => (await flow.routing()).clickGuardUntil, { timeout: WAIT_MS }).toBeGreaterThan(0)
    const now = await flow.eval<string>(
      `(() => { const area = document.elementFromPoint(${point.x}, ${point.y}); return area ? area.tagName.toLowerCase() + (area.id ? '#' + area.id : '') : '' })()`
    )
    await flow.passClickWindows()
    await flow.click(point.x, point.y)
    await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
    await expect(flow.chip).toHaveText(new RegExp(`^${now.replace(/[.#]/g, '\\$&')} · `))
  })

  test('the page reloads under the Change dialog: the dialog keeps its text and says so, Send sends the held capture and the pick banner is gone; Cancel instead leaves pick mode off', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    const url = browserServers.sites.static.url('/changing.html')
    await flow.load(url)
    for (const finish of ['Send', 'Cancel'] as const) {
      await flow.pickButton.click()
      await flow.pickByClick('#changing', 'div#changing ')
      await flow.action('Change').click()
      await flow.dialogField.fill(`kept across the reload (${finish})`)
      await flow.eval('setTimeout(() => window.__fixture.reload(), 0); 0')
      await expect(flow.dialog).toContainText('The page reloaded – the capture shows the page as you picked it', { timeout: WAIT_MS })
      await expect(flow.dialogField).toHaveValue(`kept across the reload (${finish})`)
      await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'false')
      await expect(flow.status).not.toContainText('Picking – click an element')
      const before = await contextFiles(testProject.path)
      if (finish === 'Send') {
        await flow.dialogSend.click()
        await expect(flow.status).toContainText('Sent Change to Terminal', { timeout: WAIT_MS })
        const capture = await newCapture(testProject.path, before)
        expect(capture.text).toContain('div#changing')
      } else {
        await flow.dialogCancel.click()
        await expect(flow.dialog).toHaveCount(0)
        expect(await contextFiles(testProject.path)).toEqual(before)
      }
      await flow.waitForActive(false)
      await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'false')
      await (await flow.panel.page()).waitForLoaded(url)
    }
  })

  test('the page navigates under the open menu: the menu closes, "The page changed – pick the element again" shows, nothing is sent and no capture file is written', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/changing.html'))
    await flow.pickButton.click()
    await flow.pickByClick('#changing', 'div#changing ')
    const next = browserServers.sites.static.url('/plain.html')
    await flow.eval(`setTimeout(() => window.__fixture.navigate(${JSON.stringify(next)}), 0); 0`)
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    await expect(flow.status).toContainText('The page changed – pick the element again', { timeout: WAIT_MS })
    expect((await flow.state()).capture).toBeNull()
    expect(await captureFiles(testProject.path)).toEqual([])
  })
})
