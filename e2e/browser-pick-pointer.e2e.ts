// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick and prompt with the pointer alone (spec 025, 025-AC-083, 025-NFR-011),
 * end to end.
 *
 * Every test arms {@link NoKeyTrap} once its setup is done (starting the stub
 * agent types `cat` into the terminal): from then on a Playwright keyboard
 * call or a keyboard `sendInputEvent` to the page fails the test at once, and
 * each test ends by checking that no key reached the page. The walk uses
 * `locator.click`, pointer moves and clicks to the page through main-side
 * `sendInputEvent` (S-27), Playwright's mouse on Erfana's own window, and
 * `fill` for the instruction. Main's test clock passes the click windows
 * (025-FR-047, 025-FR-049) – a hook, not a key. Condition-based waits only.
 *
 * The manual pointer-only pass per platform that 025-AC-083 also asks for is
 * outside this lane.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { AgentTerminal, captureFiles, contextFiles, newCapture, NoKeyTrap, PickFlow, PICK_WAIT_MS as WAIT_MS } from './pages/browser-pick-flow.page'
import { TabBarPage } from './pages/tab-bar.page'

/** The first item row's Save label: span.save-label › button.save-button › div.item-actions › li.item-row. */
const REACT_ITEM = '.save-label'
const REACT_ITEM_LABEL = 'span.save-label '

/** How often one prompt's text shows in the terminal: the tty's echo of the line `cat` reads, and `cat`'s copy. */
const PER_PROMPT = 2

/** A unique instruction per test run, so the terminal count reads this send alone. */
const instruction = (what: string): string => `Make the ${what} blue ${Date.now().toString(36)}`

/** Press on `control`, slide the pointer off it onto `off`, and release there: a press given up (025-NFR-011). */
async function pressAndSlideOff(window: Page, control: Locator, off: Locator): Promise<void> {
  const box = (await control.boundingBox())!
  const away = (await off.boundingBox())!
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await window.mouse.down()
  await window.mouse.move(away.x + 2, away.y + 2, { steps: 4 })
  await window.mouse.up()
}

/** At least 24 × 24 CSS px (025-NFR-011). */
async function expectTarget24(control: Locator, name: string): Promise<void> {
  await expect(control, name).toBeVisible()
  const box = (await control.boundingBox())!
  expect(box.width, `${name} width`).toBeGreaterThanOrEqual(24)
  expect(box.height, `${name} height`).toBeGreaterThanOrEqual(24)
}

/** A point on the still image (over the page) outside the menu: the page's heading. */
async function stillOutsideMenu(flow: PickFlow, selector: string): Promise<{ x: number; y: number }> {
  const area = (await flow.panel.placeholder.boundingBox())!
  const target = await flow.rect(selector)
  const at = { x: area.x + target.x + 6, y: area.y + target.y + target.height / 2 }
  const menu = (await flow.actions.boundingBox())!
  const inside = at.x >= menu.x && at.x <= menu.x + menu.width && at.y >= menu.y && at.y <= menu.y + menu.height
  expect(inside, `${selector} lies outside the menu`).toBe(false)
  return at
}

test.describe('025-AC-083 pick and prompt with the pointer alone', () => {
  test('the whole walk – Pick element, hover, click, Parent, Child, a path name, Change, the instruction, Send – sends one prompt; Show terminal and Open capture work', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    const agent = new AgentTerminal(windowWithTestProject, flow)
    await agent.start()
    await flow.load(browserServers.sites.react18.url('/'))
    // Hide the terminal panel, so Show terminal has something to show; the terminal and its `cat` keep running.
    await agent.terminal.close()
    const trap = await NoKeyTrap.arm(appWithTestProject, windowWithTestProject, flow)
    await trap.expectArmed()

    await flow.pickButton.click()
    await flow.waitForActive(true)
    await flow.pickByClick(REACT_ITEM, REACT_ITEM_LABEL)
    await expect(flow.chip).toHaveText(/^span\.save-label · /)
    await expect(flow.panelTarget).toHaveAttribute('aria-label', 'Terminal · cat, target terminal')
    await flow.parentButton.click()
    await expect(flow.chip).toHaveText(/^button\.save-button · /)
    await flow.childButton.click()
    await expect(flow.chip).toHaveText(/^span\.save-label · /)
    await flow.crumb('li.item-row').click()
    await expect(flow.chip).toHaveText(/^li\.item-row · /)

    await flow.action('Change').click()
    await expect(flow.dialog).toBeVisible()
    const text = instruction('row')
    await flow.dialogField.fill(text)
    const before = await contextFiles(testProject.path)
    await flow.dialogSend.click()
    await expect(flow.status).toContainText('Sent Change to Terminal', { timeout: WAIT_MS })
    const capture = await newCapture(testProject.path, before)
    expect(capture.text).toContain('li.item-row')

    // Show terminal: the terminal panel comes back, and the prompt is in it once.
    await flow.showTerminal.click()
    await expect(agent.terminal.getTerminal()).toBeVisible({ timeout: WAIT_MS })
    // One submission shows twice: the terminal echoes the line `cat` reads, and `cat` writes it back.
    await expect.poll(() => agent.count(text), { timeout: WAIT_MS }).toBe(PER_PROMPT)
    // Open capture: the context file opens in an editor tab.
    await flow.openCapture.click()
    await new TabBarPage(windowWithTestProject).waitForTab(capture.name)
    expect(await contextFiles(testProject.path)).toHaveLength(before.length + 1)
    expect(await agent.count(text)).toBe(PER_PROMPT)
    await trap.expectNoKeys()
  })

  test('the same walk with Explain sends with no dialog', async ({ appWithTestProject, windowWithTestProject, browserServers, testProject }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    await flow.load(browserServers.sites.react18.url('/'))
    const trap = await NoKeyTrap.arm(appWithTestProject, windowWithTestProject, flow)

    await flow.pickButton.click()
    await flow.pickByClick(REACT_ITEM, REACT_ITEM_LABEL)
    await flow.parentButton.click()
    await expect(flow.chip).toHaveText(/^button\.save-button · /)
    await flow.childButton.click()
    await expect(flow.chip).toHaveText(/^span\.save-label · /)
    await flow.crumb('div.item-actions').click()
    await expect(flow.chip).toHaveText(/^div\.item-actions · /)
    const before = await contextFiles(testProject.path)
    await flow.action('Explain').click()
    await expect(flow.status).toContainText('Sent Explain to Terminal', { timeout: WAIT_MS })
    expect((await newCapture(testProject.path, before)).text).toContain('div.item-actions')
    await expect(flow.dialog).toHaveCount(0)
    await trap.expectNoKeys()
  })

  test('Pick this element from a right-click opens the menu at once on that element, and the send completes', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    await flow.load(browserServers.sites.react18.url('/'))
    const trap = await NoKeyTrap.arm(appWithTestProject, windowWithTestProject, flow)

    const item = await flow.rect(REACT_ITEM)
    const at = await flow.aim(item)
    const pageMenu = flow.panel.menu('Page actions')
    await expect(async () => {
      // The first click into a page that does not hold focus may only focus it: right-click until the menu opens.
      if ((await pageMenu.count()) === 0) await flow.click(at.x, at.y, 'right')
      await expect(pageMenu).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: WAIT_MS })
    const pickThis = pageMenu.getByRole('menuitem', { name: 'Pick this element' })
    await expectTarget24(pickThis, 'Pick this element')
    // Pressed, then given up by sliding onto another part of the menu before release: nothing is picked.
    await pressAndSlideOff(windowWithTestProject, pickThis, pageMenu.getByRole('menuitem').first())
    await expect(pageMenu).toBeVisible()
    expect((await flow.state()).active).toBe(false)
    await expect(flow.actions).toHaveCount(0)
    await pickThis.click()
    // At once: no further click.
    await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
    await expect(flow.chip).toHaveText(/^span\.save-label · /)
    const before = await contextFiles(testProject.path)
    await flow.action('Explain').click()
    await expect(flow.status).toContainText('Sent Explain to Terminal', { timeout: WAIT_MS })
    expect((await newCapture(testProject.path, before)).text).toContain('span.save-label')
    await trap.expectNoKeys()
  })

  test('a hover-only menu item: click Pick element, hover the menu open, click the item – the menu stays open and the item is picked', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/hover-menu.html'))
    const trap = await NoKeyTrap.arm(appWithTestProject, windowWithTestProject, flow)

    await flow.pickButton.click()
    await flow.waitForActive(true)
    const trigger = await flow.rect('#menu-trigger')
    await flow.move(trigger.x + trigger.width / 2, trigger.y + trigger.height / 2)
    await (await flow.panel.page()).waitFor(`window.__fixture.menuOpen()`, 'the hover menu opened')
    await flow.pickByClick('#item-reports', 'a#item-reports ')
    await expect(flow.chip).toHaveText(/^a#item-reports · /)
    expect(await flow.eval<boolean>('window.__fixture.menuOpen()'), 'the hover menu stayed open').toBe(true)
    expect((await flow.pageLog()).filter((e) => e.type === 'item-click')).toEqual([])
    await trap.expectNoKeys()
  })

  test('toward a shell, a click on Choose terminal opens the terminal menu, a click on a terminal there answers the warning, and the menu stays open with the pick', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).open()
    await flow.load(browserServers.sites.react18.url('/'))
    const trap = await NoKeyTrap.arm(appWithTestProject, windowWithTestProject, flow)

    await flow.pickButton.click()
    await flow.pickByClick(REACT_ITEM, REACT_ITEM_LABEL)
    const banner = flow.actions.locator('.erf-brw-banner')
    await expect(banner).toContainText('not an agent')
    const choose = flow.actions.getByRole('button', { name: 'Choose terminal', exact: true })
    await expectTarget24(choose, 'Choose terminal')
    const capture = (await flow.state()).capture
    // Pressed, then given up: the warning stays as it was.
    await pressAndSlideOff(windowWithTestProject, choose, banner.locator('.erf-brw-banner__text'))
    await expect(banner).toContainText('not an agent')
    await expect(flow.actions).toBeVisible()
    // Choose terminal opens the terminal menu (025-FR-061, 025-AC-077); a click on a terminal there sets the target.
    await choose.click()
    const menu = flow.panel.menu('Target terminal')
    await expect(menu).toBeVisible()
    await expect(flow.actions).toBeVisible()
    await menu.getByRole('menuitem', { name: /^Terminal · \S+/ }).first().click()
    await expect(menu).toHaveCount(0)
    await expect(flow.actions).toBeVisible()
    // The chosen terminal still runs only a shell, so the banner says so again (as in 025-AC-077); nothing was sent.
    await expect(banner).toContainText('No agent is running in Terminal')
    expect((await flow.state()).capture).toEqual(capture)
    expect(await captureFiles(testProject.path)).toEqual([])
    await trap.expectNoKeys()
  })

  test('with no terminal open, the send guard\'s Open terminal shows the terminal panel and the dialog stays open with the pick', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    // The app opens a terminal as it starts, and the pick row's "No terminal open" comes only from a terminal session
    // torn down (useXtermSession); so the terminal's process is ended and the send guard (main, 025-FR-061) is what
    // finds no terminal – the guard banner the criterion names.
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    const agent = new AgentTerminal(windowWithTestProject, flow)
    await agent.open()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the preload bridge, untyped in e2e
    await windowWithTestProject.evaluate((id) => (window as any).api.terminal.kill(id), agent.id)
    await agent.terminal.close()
    await flow.load(browserServers.sites.react18.url('/'))
    const trap = await NoKeyTrap.arm(appWithTestProject, windowWithTestProject, flow)

    await flow.pickButton.click()
    await flow.pickByClick(REACT_ITEM, REACT_ITEM_LABEL)
    await flow.action('Ask').click()
    await expect(flow.dialog).toBeVisible()
    await flow.dialogField.fill(instruction('guard'))
    const capture = (await flow.state()).capture
    expect(capture).not.toBeNull()
    await flow.dialogSend.click()
    const banner = flow.dialog.locator('.erf-brw-banner')
    await expect(banner).toContainText('no terminal is open', { timeout: WAIT_MS })
    const open = banner.getByRole('button', { name: 'Open terminal', exact: true })
    await expectTarget24(open, 'Open terminal')
    // Pressed, then given up: the terminal panel stays hidden.
    await pressAndSlideOff(windowWithTestProject, open, banner.locator('.erf-brw-banner__text'))
    await expect(agent.terminal.getTerminal()).toBeHidden()
    await expect(flow.dialog).toBeVisible()
    await open.click()
    await expect(agent.terminal.getTerminal()).toBeVisible({ timeout: WAIT_MS })
    await expect(flow.dialog).toBeVisible()
    expect((await flow.state()).capture?.id, 'the same pick').toBe(capture!.id)
    await expect(flow.status).not.toContainText('Sent ')
    await trap.expectNoKeys()
  })

  test('a click on the page outside the menu, and separately on the toolbar, closes it with nothing sent', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    const agent = new AgentTerminal(windowWithTestProject, flow)
    await agent.start()
    await flow.load(browserServers.sites.react18.url('/'))
    const trap = await NoKeyTrap.arm(appWithTestProject, windowWithTestProject, flow)
    const terminalBefore = await agent.text()

    await flow.pickButton.click()
    await flow.pickByClick(REACT_ITEM, REACT_ITEM_LABEL)
    const at = await stillOutsideMenu(flow, 'h2')
    await windowWithTestProject.mouse.click(at.x, at.y)
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    expect((await flow.state()).capture).toBeNull()

    await flow.waitForPageFocus()
    await flow.pickByClick(REACT_ITEM, REACT_ITEM_LABEL)
    await flow.panel.addressBar.click()
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    expect((await flow.state()).capture).toBeNull()

    expect(await captureFiles(testProject.path)).toEqual([])
    expect(await agent.text()).toBe(terminalBefore)
    await trap.expectNoKeys()
  })

  test('in the dialog, Cancel closes it and ← Actions returns to the menu, with nothing sent', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    await flow.load(browserServers.sites.react18.url('/'))
    const trap = await NoKeyTrap.arm(appWithTestProject, windowWithTestProject, flow)

    await flow.pickButton.click()
    await flow.pickByClick(REACT_ITEM, REACT_ITEM_LABEL)
    await flow.action('Prompt').click()
    await expect(flow.dialog).toBeVisible()
    await flow.dialogField.fill(instruction('back'))
    await flow.dialogBack.click()
    await expect(flow.dialog).toHaveCount(0)
    await expect(flow.actions).toBeVisible()
    await expect(flow.chip).toHaveText(/^span\.save-label · /)

    await flow.action('Prompt').click()
    await expect(flow.dialog).toBeVisible()
    await flow.dialogField.fill(instruction('cancel'))
    await flow.dialogCancel.click()
    await expect(flow.dialog).toHaveCount(0)
    await expect(flow.actions).toHaveCount(0)
    expect(await captureFiles(testProject.path)).toEqual([])
    await trap.expectNoKeys()
  })

  test('every control of the walk is at least 24 × 24 px, and pressing one then sliding off before release does nothing', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    const agent = new AgentTerminal(windowWithTestProject, flow)
    await agent.start()
    await flow.load(browserServers.sites.react18.url('/'))
    const trap = await NoKeyTrap.arm(appWithTestProject, windowWithTestProject, flow)
    const terminalBefore = await agent.text()
    const nothingSent = async (): Promise<void> => {
      expect(await captureFiles(testProject.path)).toEqual([])
      expect(await agent.text()).toBe(terminalBefore)
    }

    // Pick element: given up, pick mode stays off.
    await expectTarget24(flow.pickButton, 'Pick element')
    await pressAndSlideOff(windowWithTestProject, flow.pickButton, flow.status)
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'false')
    expect((await flow.state()).active).toBe(false)

    await flow.pickButton.click()
    await flow.pickByClick(REACT_ITEM, REACT_ITEM_LABEL)
    const chip = await flow.chip.textContent()
    // Off-control spot inside the menu: its footer hint.
    const menuSpot = flow.actions.locator('.erf-brw-actions__hint')
    const controls: Array<[string, Locator]> = [
      ['Parent element', flow.parentButton],
      ['Child element', flow.childButton],
      ['the path name li.item-row', flow.crumb('li.item-row')],
      ['Explain', flow.action('Explain')],
      ['Ask…', flow.action('Ask')],
      ['Change…', flow.action('Change')],
      ['Prompt…', flow.action('Prompt')],
      ['the target button', flow.panelTarget]
    ]
    for (const [name, control] of controls) {
      await expectTarget24(control, name)
      await pressAndSlideOff(windowWithTestProject, control, menuSpot)
      await expect(flow.actions, `${name}: the menu stays`).toBeVisible()
      await expect(flow.dialog, `${name}: no dialog`).toHaveCount(0)
      await expect(flow.chip, `${name}: the pick is unchanged`).toHaveText(chip!)
      await expect(windowWithTestProject.getByRole('menu'), `${name}: no chooser`).toHaveCount(0)
    }
    await nothingSent()

    // The dialog's controls: Send, Cancel and ← Actions.
    await flow.action('Change').click()
    await expect(flow.dialog).toBeVisible()
    await flow.dialogField.fill(instruction('slide'))
    const dialogSpot = flow.dialog.getByRole('heading').first()
    for (const [name, control] of [
      ['Send', flow.dialogSend],
      ['Cancel', flow.dialogCancel],
      ['← Actions', flow.dialogBack]
    ] as const) {
      await expectTarget24(control, name)
      await pressAndSlideOff(windowWithTestProject, control, dialogSpot)
      await expect(flow.dialog, `${name}: the dialog stays`).toBeVisible()
    }
    await nothingSent()

    // The send notice's Show terminal and Open capture: given up, nothing shows or opens.
    const before = await contextFiles(testProject.path)
    await flow.dialogSend.click()
    await expect(flow.status).toContainText('Sent Change to Terminal', { timeout: WAIT_MS })
    const capture = await newCapture(testProject.path, before)
    await agent.terminal.close()
    const statusSpot = flow.status.locator('.erf-brw-banner-line__first').or(flow.status.getByText('Sent Change to Terminal')).first()
    for (const [name, control] of [
      ['Show terminal', flow.showTerminal],
      ['Open capture', flow.openCapture]
    ] as const) {
      await expectTarget24(control, name)
      await pressAndSlideOff(windowWithTestProject, control, statusSpot)
    }
    await expect(agent.terminal.getTerminal()).toBeHidden()
    await expect(new TabBarPage(windowWithTestProject).tab(capture.name)).toHaveCount(0)
    await trap.expectNoKeys()
  })
})
