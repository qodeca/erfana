// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser, keys while the prompt-actions menu or the instruction
 * dialog is open, and leaving the tab during a pick (spec 025, 025-FR-049,
 * 025-FR-050, 025-FR-052).
 *
 * The stub agent (`fixtures/browser/stub-agent.cjs`) runs in the terminal so
 * "nothing was sent" is a fact read from the bytes it received. Keys for
 * Erfana's window go through main-side `sendInputEvent` (`windowKey`), the
 * path `before-input-event` and the browser-key routing see; keys for the page
 * through the page's input hook. Condition-based waits only.
 */
import { test, expect } from './fixtures/browserHarness'
import { BrowserTabUiPage } from './pages/browser-tab-ui.page'
import { BrowserSendUi, SEND_WAIT_MS, type StubAgent } from './pages/browser-send.page'
import { mainHook, type Box } from './pages/browser-pick.page'
import type { ElectronApplication, Locator } from '@playwright/test'

type Modifier = 'shift' | 'control' | 'alt' | 'meta'

const IS_MAC = process.platform === 'darwin'
const MOD: Modifier = IS_MAC ? 'meta' : 'control'
const BACK: [string, Modifier[]] = IS_MAC ? ['[', ['meta']] : ['Left', ['alt']]
const FORWARD: [string, Modifier[]] = IS_MAC ? [']', ['meta']] : ['Right', ['alt']]

/** Nothing reached the agent and no capture file was written. */
async function expectNothingSent(send: BrowserSendUi, agent: StubAgent): Promise<void> {
  expect(await agent.received()).toBe('')
  expect(await send.captureFiles()).toEqual([])
}

// Pick, key routing and focus moving into the page all follow the page's
// native focus, which ends when the window stops being the OS key window: run
// with the OS-focus lock held exclusive (e2e/fixtures/osFocusLock.ts).
test.use({ needsOsFocus: true })

test.describe('025-AC-066 leaving the tab by key or by mouse ends the pick and sends nothing', () => {
  test.skip(process.platform === 'win32', 'The stub agent is a node program in front of a POSIX shell (macOS and Linux)')

  test('Ctrl/Cmd+W with the menu open closes the tab and sends nothing', async ({ appWithTestProject, windowWithTestProject, browserServers, testProject }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    await send.pickElement('#save-label', 'span#save-label ')
    await expect(send.pick.action('Explain')).toBeFocused()
    await send.windowKey('w', [MOD])
    await expect(send.ui.editorTabs).toHaveCount(0, { timeout: SEND_WAIT_MS })
    await expect.poll(async () => (await send.ui.tabs.tabs()).length, { timeout: SEND_WAIT_MS }).toBe(0)
    await expectNothingSent(send, agent)
  })

  test('the Change dialog closes when the user clicks another editor tab; its text comes back in Change… and Ask…; after Cancel or a send the dialog opens empty', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const other = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    await other.openWithButton()
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    const [otherTab, ownTab] = [send.ui.editorTabFor(0), send.ui.editorTabFor(1)]

    await send.pickElement('#save-label', 'span#save-label ')
    await send.openDialog('Change', 'label cut off')
    await otherTab.click()
    await ownTab.click()
    await expect(send.pick.dialog).toHaveCount(0, { timeout: SEND_WAIT_MS })
    await expect(send.pick.actions).toHaveCount(0)
    await expectNothingSent(send, agent)

    // A new pick: the text is in Change… and in Ask….
    await send.pickElement('#save-label', 'span#save-label ')
    await expect(await send.openDialog('Change')).toHaveValue('label cut off')
    await send.pick.dialog.getByRole('button', { name: 'Back to actions' }).click()
    await expect(await send.openDialog('Ask')).toHaveValue('label cut off')

    // Cancel empties it.
    await send.pick.dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(send.pick.dialog).toHaveCount(0)
    await send.pickElement('#save-label', 'span#save-label ')
    await expect(await send.openDialog('Change')).toHaveValue('')
    await expectNothingSent(send, agent)

    // A send empties it.
    await send.dialogField.fill('label cut off')
    await send.dialogSend.click()
    await agent.waitForSubmitted()
    await send.pickElement('#save-label', 'span#save-label ')
    await expect(await send.openDialog('Ask')).toHaveValue('')
  })

  test('back, forward, Ctrl/Cmd+R and F5 in pick mode navigate, end pick mode, send nothing and show no page-changed note', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    const pageA = browserServers.sites.static.url('/index.html')
    const pageB = browserServers.sites.static.url('/page-b.html')
    await send.load(pageA)
    await send.load(pageB)
    const driver = await send.driver()

    const cases: Array<[string, [string, Modifier[]], string]> = [
      ['back', BACK, pageA],
      ['forward', FORWARD, pageB],
      ['Ctrl/Cmd+R', ['r', [MOD]], pageB],
      ['F5', ['F5', []], pageB]
    ]
    for (const [name, [key, modifiers], landing] of cases) {
      const page = await send.panel.page()
      await page.eval(`window.__beforeKey = ${JSON.stringify(name)}; 0`)
      // Ctrl/Cmd+E from the page starts pick mode with page focus.
      await page.waitForInputReady()
      await driver.key('e', [MOD])
      await expect(send.pick.pickButton, name).toHaveAttribute('aria-pressed', 'true', { timeout: SEND_WAIT_MS })
      await driver.key(key, modifiers)
      // A new document: the marker is gone, at the expected address.
      await page.waitFor(`location.href === ${JSON.stringify(landing)} && document.readyState === 'complete' && window.__beforeKey === undefined`, `${name} navigated`)
      await expect(send.pick.pickButton, name).toHaveAttribute('aria-pressed', 'false', { timeout: SEND_WAIT_MS })
      await expect(send.pick.status, name).not.toContainText('The page changed')
      expect((await send.pickState()).active, name).toBe(false)
    }
    await expectNothingSent(send, agent)
  })

  test('after a Ctrl/Cmd+E pick, switching editor tabs with the dialog open closes it: nothing sent or written, the page runs, pick mode is off', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const other = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    await other.openWithButton()
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    const driver = await send.driver()
    await driver.key('e', [MOD])
    await expect.poll(async () => (await driver.state()).active, { timeout: SEND_WAIT_MS }).toBe(true)
    await driver.hoverSelector('#save-label', 'span#save-label ')
    await driver.key('e', [MOD])
    await expect(send.pick.actions).toBeVisible({ timeout: SEND_WAIT_MS })
    await expect.poll(async () => (await driver.state()).frozen, { timeout: SEND_WAIT_MS }).toBe(true)
    await send.openDialog('Change', 'label cut off')

    await send.ui.editorTabFor(0).click()
    await send.ui.editorTabFor(1).click()
    await expect(send.pick.dialog).toHaveCount(0, { timeout: SEND_WAIT_MS })
    await expect.poll(async () => driver.state(), { timeout: SEND_WAIT_MS }).toMatchObject({ active: false, frozen: false, capture: null })
    await expect(send.pick.pickButton).toHaveAttribute('aria-pressed', 'false')
    expect(await driver.page.eval<number>('1 + 1')).toBe(2)
    await expectNothingSent(send, agent)
  })

  test('Ctrl/Cmd+T with the menu open opens a new tab; on return the menu is closed, nothing was sent and pick mode is off', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    const tabId = await send.panel.tabId()
    await send.pickElement('#save-label', 'span#save-label ')
    await expect(send.pick.action('Explain')).toBeFocused()
    await send.windowKey('t', [MOD])
    await expect(send.ui.editorTabs).toHaveCount(2, { timeout: SEND_WAIT_MS })
    await expect(send.panel.root).not.toHaveAttribute('data-browser-tab-id', tabId)

    await send.ui.editorTabFor(0).click()
    await expect(send.panel.root).toHaveAttribute('data-browser-tab-id', tabId)
    await expect(send.pick.actions).toHaveCount(0)
    await expect(send.pick.pickButton).toHaveAttribute('aria-pressed', 'false')
    expect((await send.pickState()).active).toBe(false)
    await expectNothingSent(send, agent)
  })
})

/** The keydowns `events.html` logged, oldest first. */
async function pageKeydowns(send: BrowserSendUi): Promise<string[]> {
  return (await send.panel.page()).eval<string[]>(`window.__fixture.log.filter(e => e.type === 'keydown').map(e => e.detail)`)
}

test.describe('025-AC-064 keys with the instruction dialog open', () => {
  test.skip(process.platform === 'win32', 'The stub agent is a node program in front of a POSIX shell (macOS and Linux)')

  test('typing and Ctrl/Cmd+R stay in the dialog, Ctrl/Cmd+W keeps the tab, a click in the tab area does nothing, F6 and Shift+F6 keep focus, an IME composition keeps Esc and Enter', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    const url = browserServers.sites.static.url('/events.html')
    await send.load(url)
    const page = await send.panel.page()
    await page.eval(`window.__notReloaded = true; window.__fixture.clear(); 0`)
    await send.pickElement('#target-label', 'span#target-label ')
    const field = await send.openDialog('Change')
    const slot = 'Picking – Esc or Cancel closes the dialog'
    /** The status slot reads the dialog's line and no note (its chip says the page shows a still image). */
    const expectSlot = async (): Promise<void> => {
      await expect(send.pick.status.locator('.erf-brw-banner-line__first')).toHaveText(slot)
      await expect(send.pick.status.locator('.erf-brw-banner-line__more')).toHaveCount(0)
    }
    await expectSlot()

    // "abc", then Ctrl/Cmd+R and Ctrl/Cmd+W through main's key routing: the text is in the dialog,
    // the tab did not reload or close.
    const keyboard = windowWithTestProject.keyboard
    await keyboard.type('abc')
    await expect(field).toHaveValue('abc')
    await send.windowKey('r', [MOD])
    await send.windowKey('w', [MOD])
    // A sentinel key typed after them: once it shows, the keys before it were handled.
    await keyboard.type('d')
    await expect(field).toHaveValue('abcd')
    await expect(send.ui.editorTabs).toHaveCount(1)
    await expect(send.pick.dialog).toBeVisible()
    expect(await page.eval<boolean>('window.__notReloaded === true')).toBe(true)

    // A click elsewhere in the tab's area (the page's still image) does nothing.
    await send.pick.still.click({ position: { x: 5, y: 5 } })
    await expect(send.pick.dialog).toBeVisible()
    await expect(field).toHaveValue('abcd')

    // F6 and Shift+F6: focus stays in the dialog, no note, the slot reads the same.
    await field.focus()
    for (const modifiers of [[], ['shift']] as Modifier[][]) {
      await send.windowKey('F6', modifiers)
      await keyboard.type('e')
      await expect(field).toHaveValue(modifiers.length === 0 ? 'abcde' : 'abcdee')
      await expect(field).toBeFocused()
      await expectSlot()
    }

    // While an input method composes, Esc and Enter belong to the composition.
    const cdp = await windowWithTestProject.context().newCDPSession(windowWithTestProject)
    await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 })
    await keyboard.press('Escape')
    await keyboard.press('Enter')
    await expect(send.pick.dialog).toBeVisible()
    await cdp.send('Input.insertText', { text: 'に' })
    // Erfana acted on neither: Esc closed nothing and Enter sent nothing. (The emulated Enter still
    // reaches the field as a line break; a real input method consumes it – not Erfana's part.)
    await expect(field).toHaveValue(/^abcdeeに/)
    await expect(send.pick.dialog).toBeVisible()
    await cdp.detach()
    // Positive control: with no composition, Esc closes the dialog.
    await keyboard.press('Escape')
    await expect(send.pick.dialog).toHaveCount(0)

    expect(await pageKeydowns(send)).toEqual([])
    expect(await agent.received()).toBe('')
    expect(await send.captureFiles()).toEqual([])
  })

  test('after a Ctrl/Cmd+E pick, ← Actions returns to the menu on the same frozen capture with focus on Change, and Ask… keeps the typed text', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    const driver = await send.driver()
    await driver.key('e', [MOD])
    await expect.poll(async () => (await driver.state()).active, { timeout: SEND_WAIT_MS }).toBe(true)
    await driver.hoverSelector('#save-label', 'span#save-label ')
    await driver.key('e', [MOD])
    await expect(send.pick.actions).toBeVisible({ timeout: SEND_WAIT_MS })
    await expect.poll(async () => (await driver.state()).frozen, { timeout: SEND_WAIT_MS }).toBe(true)
    const captureId = (await driver.state()).capture!.id

    await send.openDialog('Change', 'label cut off')
    await send.pick.dialog.getByRole('button', { name: 'Back to actions' }).click()
    await expect(send.pick.actions).toBeVisible()
    await expect(send.pick.action('Change')).toBeFocused()
    expect(await driver.state()).toMatchObject({ frozen: true, capture: { id: captureId } })
    await expect(await send.openDialog('Ask')).toHaveValue('label cut off')
    expect(await agent.received()).toBe('')
    expect(await send.captureFiles()).toEqual([])
  })
})

/** One left-button event to the page (`pageMouse`) or to Erfana's window (`windowMouse`), sent main-side. */
async function mouse(send: BrowserSendUi, where: 'pageMouse' | 'windowMouse', type: 'mouseDown' | 'mouseUp', at: { x: number; y: number }, clickCount = 1): Promise<void> {
  await mainHook(send.app, 'browserInput', where, await send.panel.tabId(), type, at.x, at.y, clickCount)
}

const centre = (box: Box): { x: number; y: number } => ({ x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) })

/**
 * **Pick element** at any width: below 380 px its visible label folds away and
 * its accessible name falls back to its tooltip, so it is found by its class.
 */
const pickToggle = (send: BrowserSendUi): Locator => send.pick.row.locator('.erf-brw-pickbtn')

/** {@link BrowserSendUi.pickElement} at any width: pick mode on, hover `selector`, Return, the panel open. */
async function pickAtAnyWidth(send: BrowserSendUi, selector: string, labelPrefix: string): Promise<void> {
  if ((await pickToggle(send).getAttribute('aria-pressed')) !== 'true') await pickToggle(send).click()
  await expect(pickToggle(send)).toHaveAttribute('aria-pressed', 'true')
  await send.pick.confirm(selector, labelPrefix)
}

/** Resize Erfana's window until the browser panel is `width` CSS px wide (the sidebars keep theirs). */
async function setPanelWidth(app: ElectronApplication, panel: Locator, width: number): Promise<void> {
  await expect(async () => {
    const box = await panel.boundingBox()
    if (box === null) throw new Error('The browser panel is not drawn')
    const delta = Math.round(box.width - width)
    if (delta !== 0) {
      await app.evaluate(({ BrowserWindow }, d) => {
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
        if (win === undefined) throw new Error('No visible window')
        const [w, h] = win.getContentSize()
        win.setContentSize(w - d, h)
      }, delta)
    }
    expect(Math.abs(((await panel.boundingBox())?.width ?? 0) - width)).toBeLessThanOrEqual(1)
  }).toPass({ timeout: SEND_WAIT_MS })
}

/*
 * 025-AC-063: every key, the clicks outside the menu, the double-click, a press
 * that began before the menu opened, a press released off its action, and
 * Shift+F6 with and without a strip prompt at 1280 px and at 400 px. Pointer
 * input to the page, and a press or release that lands on Erfana's window,
 * go main-side through `sendInputEvent` (S-27).
 */
test.describe('025-AC-063 keys and clicks with the prompt-actions menu open', () => {
  test.skip(process.platform === 'win32', 'The stub agent is a node program in front of a POSIX shell (macOS and Linux)')

  test('Tab, Shift+Tab and Space are Erfana’s; a, Ctrl/Cmd+E, Ctrl/Cmd+F and a zoom key do nothing; Alt+Up moves to the parent; the page logs none', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/events.html'))
    const page = await send.panel.page()
    const zoom = await page.eval<number>('devicePixelRatio')
    await page.eval(`window.__fixture.clear(); 0`)
    await send.pickElement('#target-label', 'span#target-label ')
    const keyboard = windowWithTestProject.keyboard

    await expect(send.pick.action('Explain')).toBeFocused()
    await send.windowKey('Tab')
    await expect(send.pick.action('Ask')).toBeFocused()
    await send.windowKey('Tab', ['shift'])
    await expect(send.pick.action('Explain')).toBeFocused()
    // Space on Ask… opens its dialog; ← Actions comes back.
    await send.windowKey('Tab')
    await keyboard.press('Space')
    await expect(send.pick.dialog).toBeVisible()
    await send.pick.dialog.getByRole('button', { name: 'Back to actions' }).click()
    await expect(send.pick.actions).toBeVisible()

    for (const [key, modifiers] of [
      ['a', []],
      ['e', [MOD]],
      ['f', [MOD]],
      ['=', [MOD]]
    ] as Array<[string, Modifier[]]>) {
      await send.windowKey(key, modifiers)
    }
    // Alt+Up as a sentinel: once the parent shows, the keys before it were handled.
    await send.windowKey('Up', ['alt'])
    await expect(send.pick.actions.getByRole('navigation', { name: 'Element path' })).toContainText('button#target-button · ')
    await expect(send.pick.actions).toBeVisible()
    await expect(send.panel.findRow).toHaveCount(0)
    expect(await page.eval<number>('devicePixelRatio')).toBe(zoom)
    expect(await pageKeydowns(send)).toEqual([])
    expect(await agent.received()).toBe('')
    expect(await send.captureFiles()).toEqual([])
  })

  test('Ctrl+Tab selects the next editor tab and closes the menu without sending', async ({ appWithTestProject, windowWithTestProject, browserServers, testProject }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    const tabId = await send.panel.tabId()
    await send.ui.openWithButton()
    await send.ui.editorTabFor(0).click()
    await expect(send.panel.root).toHaveAttribute('data-browser-tab-id', tabId)
    await send.pickElement('#save-label', 'span#save-label ')
    await expect(send.pick.action('Explain')).toBeFocused()
    await send.windowKey('Tab', ['control'])
    await expect(send.panel.root).not.toHaveAttribute('data-browser-tab-id', tabId)
    await send.ui.editorTabFor(0).click()
    await expect(send.panel.root).toHaveAttribute('data-browser-tab-id', tabId)
    await expect(send.pick.actions).toHaveCount(0)
    expect(await agent.received()).toBe('')
    expect(await send.captureFiles()).toEqual([])
  })

  test('Ctrl/Cmd+L, and a click on the address bar, close the menu without sending, unfreeze a Ctrl/Cmd+E pick and type into the address bar', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    const driver = await send.driver()
    for (const how of ['Ctrl/Cmd+L', 'click'] as const) {
      await (await send.panel.page()).waitForInputReady()
      await driver.key('e', [MOD])
      await expect.poll(async () => (await driver.state()).active, { timeout: SEND_WAIT_MS }).toBe(true)
      await driver.hoverSelector('#save-label', 'span#save-label ')
      await driver.key('e', [MOD])
      await expect(send.pick.actions, how).toBeVisible({ timeout: SEND_WAIT_MS })
      await expect.poll(async () => (await driver.state()).frozen, { timeout: SEND_WAIT_MS }).toBe(true)
      if (how === 'Ctrl/Cmd+L') await send.windowKey('l', [MOD])
      else await send.panel.addressBar.click()
      await expect(send.pick.actions, how).toHaveCount(0)
      await expect.poll(async () => (await driver.state()).frozen, { timeout: SEND_WAIT_MS }).toBe(false)
      await expect(send.panel.addressBar, how).toBeFocused()
      await send.panel.addressBar.selectText()
      await windowWithTestProject.keyboard.type('typed-here')
      await expect(send.panel.addressBar, how).toHaveValue('typed-here')
      await send.panel.addressBar.press('Escape')
    }
    expect(await agent.received()).toBe('')
    expect(await send.captureFiles()).toEqual([])
  })

  test('a click on the page outside the menu closes it: nothing sent, nothing picked, pick mode still on', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    await send.pickElement('#save-label', 'span#save-label ')
    await send.pick.still.click({ position: { x: 5, y: 5 } })
    await expect(send.pick.actions).toHaveCount(0)
    await expect(send.pick.pickButton).toHaveAttribute('aria-pressed', 'true')
    expect(await send.pickState()).toMatchObject({ active: true, capture: null })
    expect(await agent.received()).toBe('')
    expect(await send.captureFiles()).toEqual([])
  })

  for (const width of [1280, 400]) {
    test(`at ${width} px, F6 closes the menu with focus on Pick element; Shift+F6 closes it with focus on More, the last visible control of the navigation row`, async ({
      appWithTestProject,
      windowWithTestProject,
      browserServers,
      testProject
    }) => {
      const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
      const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
      await send.load(browserServers.sites.static.url('/elements.html'))
      // With no strip row Shift+F6 goes to More; a Linux host without a keyring adds one of its own.
      await send.panel.dismissHostRows()
      await setPanelWidth(appWithTestProject, send.panel.root, width)
      // More is the last navigation control drawn at this width.
      const drawn = send.panel.root.locator('.erf-brw-nav button:visible')
      await expect(drawn.last()).toHaveAccessibleName('More')
      for (const [modifiers, focused] of [
        [[], pickToggle(send)],
        [['shift'], send.panel.tool('More')]
      ] as const) {
        await pickAtAnyWidth(send, '#save-label', 'span#save-label ')
        await expect(send.pick.action('Explain')).toBeFocused()
        // F6 is not a browser key: it reaches the renderer on any focus path.
        await windowWithTestProject.keyboard.press(modifiers.length === 0 ? 'F6' : 'Shift+F6')
        await expect(send.pick.actions).toHaveCount(0)
        await expect(focused).toBeFocused()
      }
      expect(await agent.received()).toBe('')
      expect(await send.captureFiles()).toEqual([])
    })
  }

  test('with a strip prompt showing, Shift+F6 closes the menu with nothing sent and focus on the last control of the strip', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/popups.html'))
    // The strip's last control must be the pop-up row's: no host row ("No keyring" on Linux) beside it.
    await send.panel.dismissHostRows()
    await pickAtAnyWidth(send, 'h1', 'h1 ')
    // The page opens pop-ups with the menu open (no user activation): the strip prompt shows above the page.
    await (await send.panel.page()).eval('window.__fixture.openMany(6)')
    const row = send.panel.stripRow('popupBlocked')
    await expect(row).toBeVisible({ timeout: SEND_WAIT_MS })
    await expect(send.pick.actions).toBeVisible()
    await expect(send.pick.action('Explain')).toBeFocused()
    await windowWithTestProject.keyboard.press('Shift+F6')
    await expect(send.pick.actions).toHaveCount(0)
    await expect(row.getByRole('button').last()).toBeFocused()
    expect(await agent.received()).toBe('')
    expect(await send.captureFiles()).toEqual([])
  })

  test('a double-click in pick mode: the first click confirms the pick, the menu stays open and the second click – on the page or on its still image – is ignored', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    await pickToggle(send).click()
    const driver = await send.driver()
    await expect.poll(async () => (await driver.state()).active, { timeout: SEND_WAIT_MS }).toBe(true)
    const box = await driver.rect('#save-label')
    await driver.hover(box, 'span#save-label ')
    const at = centre(box)

    // A double-click as the system sends it: the second press carries click count 2 and lands on the page.
    await mouse(send, 'pageMouse', 'mouseDown', at, 1)
    await mouse(send, 'pageMouse', 'mouseUp', at, 1)
    await mouse(send, 'pageMouse', 'mouseDown', at, 2)
    await mouse(send, 'pageMouse', 'mouseUp', at, 2)
    await expect(send.pick.actions).toBeVisible({ timeout: SEND_WAIT_MS })
    await expect(send.pick.action('Explain')).toBeFocused()
    const first = (await send.pickState()).capture
    expect(first).not.toBeNull()

    // The second press of a double-click that lands once the still image covers the page: on Erfana's window.
    const still = await send.pick.still.boundingBox()
    if (still === null) throw new Error('The still image is not drawn')
    const onStill = { x: still.x + at.x, y: still.y + at.y }
    await mouse(send, 'windowMouse', 'mouseDown', onStill, 2)
    await mouse(send, 'windowMouse', 'mouseUp', onStill, 2)

    // Sentinel: Alt+Up after the clicks is handled by the same menu, on the same capture.
    await send.windowKey('Up', ['alt'])
    await expect(send.pick.actions.getByRole('navigation', { name: 'Element path' })).toContainText('button#save-button · ')
    await expect(send.pick.actions).toBeVisible()
    expect(await send.pickState()).toMatchObject({ active: true, capture: { id: first!.id } })
    expect(await agent.received()).toBe('')
    expect(await send.captureFiles()).toEqual([])

    // The positive control: a single click on the still image, outside the menu, closes it.
    await send.pick.still.click({ position: { x: 5, y: 5 } })
    await expect(send.pick.actions).toHaveCount(0)
    expect(await send.pickState()).toMatchObject({ active: true, capture: null })
  })

  test('a press that began on the page before the menu opened runs no action when released over it; a press on an action released off it runs nothing', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    await pickToggle(send).click()
    const driver = await send.driver()
    await expect.poll(async () => (await driver.state()).active, { timeout: SEND_WAIT_MS }).toBe(true)
    const box = await driver.rect('#save-label')
    await driver.hover(box, 'span#save-label ')

    // The press on the page confirms the pick; the menu opens under the held button.
    await mouse(send, 'pageMouse', 'mouseDown', centre(box))
    await expect(send.pick.actions).toBeVisible({ timeout: SEND_WAIT_MS })
    const explain = send.pick.action('Explain')
    const over = await explain.boundingBox()
    if (over === null) throw new Error('Explain is not drawn')
    // The release lands on Erfana's window, over Explain.
    await mouse(send, 'windowMouse', 'mouseUp', centre(over))
    // Sentinel: Tab after the release is the menu's, so the release was handled before it.
    await send.windowKey('Tab')
    await expect(send.pick.action('Ask')).toBeFocused()
    await expect(send.pick.actions).toBeVisible()
    expect(await agent.received()).toBe('')
    expect(await send.captureFiles()).toEqual([])

    // A press on Explain released off it, on Ask: nothing runs.
    const window = windowWithTestProject
    await explain.hover()
    await window.mouse.down()
    const ask = await send.pick.action('Ask').boundingBox()
    if (ask === null) throw new Error('Ask is not drawn')
    await window.mouse.move(ask.x + ask.width / 2, ask.y + ask.height / 2, { steps: 4 })
    await window.mouse.up()
    await send.windowKey('Tab', ['shift'])
    await expect(send.pick.actions).toBeVisible()
    await expect(send.pick.dialog).toHaveCount(0)
    expect(await agent.received()).toBe('')
    expect(await send.captureFiles()).toEqual([])

    // The positive control: a whole click on Explain sends.
    await explain.click()
    expect(await agent.waitForSubmitted()).toContain('Explain the element the user picked')
  })
})
