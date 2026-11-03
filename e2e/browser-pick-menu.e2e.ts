// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The pick menu and its dialogs end to end (spec 025): 025-AC-027
 * (refinement by key and by the header controls), 025-AC-030 (the menu, its
 * Tab order, fresh-key rule, Esc, the inert pick key, the target and the
 * placement), 025-AC-031 (which actions open a dialog, submit, cancel, one
 * send per confirmation) and 025-AC-073 (the menu and dialog stay out of the
 * page's document).
 *
 * Erfana's controls through its DOM (`PickFlow`); the page through main-side
 * `sendInputEvent` (S-27). Sends go to the app's terminal running `cat`, a
 * stub agent that echoes what it is sent (`AgentTerminal`); what was sent is
 * read from the capture files under `.erfana/browser/captures/`. Notes are
 * timed by the status recorder; the double-click window by main's test
 * clock. Condition-based waits only.
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { AgentTerminal, IS_MAC, near, PickFlow, PICK_WAIT_MS as WAIT_MS } from './pages/browser-pick-flow.page'
import type { Box } from './pages/browser-pick.page'

const MENU_BANNER = 'Picking – Esc or click outside closes the panel'
const PICK_FIRST = 'Picking – click an element'
const SEND_KEY = IS_MAC ? 'Meta+Enter' : 'Control+Enter'
const PICK_SHORTCUT = IS_MAC ? 'Meta+E' : 'Control+E'

function expectNoteDuration(actual: number, ms: number): void {
  expect(actual, `note duration ${actual} ms`).toBeGreaterThanOrEqual(ms - 50)
  expect(actual, `note duration ${actual} ms`).toBeLessThan(ms + 1500)
}

/** The context files written so far in the project. */
async function contextFiles(projectRoot: string): Promise<string[]> {
  const dir = path.join(projectRoot, '.erfana', 'browser', 'captures')
  return (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.md')).sort()
}

/** `box` (page CSS px) in the window's CSS px: the page area's placeholder origin plus the box (zoom 100%, page not scaled). */
async function inWindow(flow: PickFlow, box: Box): Promise<Box> {
  const origin = (await flow.panel.placeholder.boundingBox())!
  return { x: origin.x + box.x, y: origin.y + box.y, width: box.width, height: box.height }
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** The menu does not cover the outline of `selector` and sits next to it. */
async function expectMenuBeside(flow: PickFlow, box: Box): Promise<void> {
  const outline = await inWindow(flow, box)
  await expect
    .poll(async () => {
      const menu = (await flow.actions.boundingBox())!
      return overlaps(menu, outline)
    }, { timeout: WAIT_MS, message: 'the menu covers the outline' })
    .toBe(false)
}

/** The element's box in the page, inside its open shadow root. */
async function shadowRect(flow: PickFlow, host: string, inner: string): Promise<Box> {
  return flow.eval<Box>(
    `(() => { const r = document.getElementById(${JSON.stringify(host)}).shadowRoot.getElementById(${JSON.stringify(inner)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
  )
}

/** Press Up until the highlight label starts with `prefix` (at most `max` presses). */
async function upUntil(flow: PickFlow, prefix: string, max = 10): Promise<void> {
  for (let i = 0; i < max && !((await flow.highlightLabel()) ?? '').startsWith(prefix); i++) {
    const before = (await flow.highlightLabel()) ?? ''
    await flow.key('Up')
    await expect.poll(async () => (await flow.highlightLabel()) ?? '', { timeout: WAIT_MS }).not.toBe(before)
  }
  await expect.poll(async () => (await flow.highlightLabel()) ?? '', { timeout: WAIT_MS }).toMatch(new RegExp(`^${prefix}`))
}

/** Open a browser tab with pick mode on over `url`. */
async function picking(app: Parameters<typeof PickFlow.open>[0], window: Page, url: string): Promise<PickFlow> {
  const flow = await PickFlow.open(app, window)
  await flow.load(url)
  await flow.pickButton.click()
  await flow.waitForActive(true)
  return flow
}

async function clickEndButton(button: Locator): Promise<void> {
  await expect(button).toHaveAttribute('aria-disabled', 'true')
  // aria-disabled, not disabled: the press lands and explains itself.
  await button.click({ force: true })
}

// Pick, key routing and focus moving into the page all follow the page's
// native focus, which ends when the window stops being the OS key window: run
// with the OS-focus lock held exclusive (e2e/fixtures/osFocusLock.ts).
test.use({ needsOsFocus: true })

test.describe('025-AC-027 Up and Down refinement', () => {
  test('before a confirm Up and Down walk span › button › div › … › html, the ends show their notes for 2 s, and Enter confirms the highlighted element', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await picking(appWithTestProject, windowWithTestProject, browserServers.sites.static.url('/elements.html'))
    await flow.recordStatus()
    await flow.hover('#save-label', 'span#save-label ')

    // At the first-hovered element Down moves nothing.
    let from = (await flow.statusLog()).length
    await flow.key('Down')
    const back = `${PICK_FIRST} · Back at the element you started from`
    expectNoteDuration(await flow.shownFor(back, from), 2000)
    expect(await flow.highlightLabel()).toMatch(/^span#save-label /)

    for (const [key, prefix] of [
      ['Up', 'button#save-button '],
      ['Up', 'div#outer '],
      ['Down', 'button#save-button '],
      ['Down', 'span#save-label '],
      ['Up', 'button#save-button '],
      ['Up', 'div#outer '],
      ['Up', 'body '],
      ['Up', 'html ']
    ] as const) {
      await flow.key(key)
      await expect.poll(async () => (await flow.highlightLabel()) ?? '', { timeout: WAIT_MS }).toMatch(new RegExp(`^${prefix}`))
    }
    from = (await flow.statusLog()).length
    await flow.key('Up')
    expectNoteDuration(await flow.shownFor(`${PICK_FIRST} · Top of the page`, from), 2000)
    expect(await flow.highlightLabel()).toMatch(/^html /)

    await flow.key('Down')
    await expect.poll(async () => (await flow.highlightLabel()) ?? '', { timeout: WAIT_MS }).toMatch(/^body /)
    await flow.key('Down')
    await expect.poll(async () => (await flow.highlightLabel()) ?? '', { timeout: WAIT_MS }).toMatch(/^div#outer /)
    await flow.key('Return')
    await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
    await expect(flow.chip).toHaveText(/^div#outer · /)
  })

  test('Up crosses from a frame\'s root to its <iframe> and from an open shadow root to its host; a new hover makes Down return toward the new element only', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await picking(appWithTestProject, windowWithTestProject, browserServers.sites.static.url('/frames.html'))
    const frame = await flow.rect('#same-origin')
    await flow.move(frame.x + 30, frame.y + 14)
    await expect.poll(async () => (await flow.highlightLabel()) ?? '', { timeout: WAIT_MS }).toMatch(/^(span|button#frame-button)/)
    await upUntil(flow, 'html ')
    await flow.key('Up')
    await expect.poll(async () => (await flow.highlightLabel()) ?? '', { timeout: WAIT_MS }).toMatch(/^iframe#same-origin /)

    await flow.load(browserServers.sites.static.url('/shadow.html'))
    await flow.pickButton.click()
    await flow.waitForActive(true)
    const label = await shadowRect(flow, 'open-host', 'open-label')
    await flow.move(label.x + label.width / 2, label.y + label.height / 2)
    await expect.poll(async () => (await flow.highlightLabel()) ?? '', { timeout: WAIT_MS }).toMatch(/^span#open-label /)
    await upUntil(flow, 'div#open-host ', 4)

    // Up from a span, then hover another element: Down goes back toward that one only.
    await flow.load(browserServers.sites.static.url('/elements.html'))
    await flow.pickButton.click()
    await flow.waitForActive(true)
    await flow.recordStatus()
    await flow.hover('#save-label', 'span#save-label ')
    await flow.key('Up')
    await expect.poll(async () => (await flow.highlightLabel()) ?? '', { timeout: WAIT_MS }).toMatch(/^button#save-button /)
    await flow.hover('[id=":r1:"]', 'div#:r1: ')
    await flow.key('Up')
    await expect.poll(async () => (await flow.highlightLabel()) ?? '', { timeout: WAIT_MS }).toMatch(/^div\.row /)
    await flow.key('Down')
    await expect.poll(async () => (await flow.highlightLabel()) ?? '', { timeout: WAIT_MS }).toMatch(/^div#:r1: /)
    const from = (await flow.statusLog()).length
    await flow.key('Down')
    expectNoteDuration(await flow.shownFor(`${PICK_FIRST} · Back at the element you started from`, from), 2000)
    expect(await flow.highlightLabel()).toMatch(/^div#:r1: /)
  })

  test('with the menu open, Up and the header controls move the pick and the menu follows; the ends show the end look and their notes; a long path is cut from its start', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await picking(appWithTestProject, windowWithTestProject, browserServers.sites.static.url('/elements.html'))
    await flow.recordStatus()
    await flow.pickByClick('#save-label', 'span#save-label ')
    await expect(flow.chip).toHaveText(/^span#save-label · /)

    // Up in the menu: the pick moves to the button and the menu follows it.
    await windowWithTestProject.keyboard.press('ArrowUp')
    await expect(flow.chip).toHaveText(/^button#save-button · /)
    await expectMenuBeside(flow, await flow.rect('#save-button'))
    await windowWithTestProject.keyboard.press('ArrowDown')
    await expect(flow.chip).toHaveText(/^span#save-label · /)

    // Parent twice is Up twice; the path ends with the div's name.
    await flow.parentButton.click()
    await expect(flow.chip).toHaveText(/^button#save-button · /)
    await flow.parentButton.click()
    await expect(flow.chip).toHaveText(/^div#outer · /)
    await expect(flow.path.locator('li').last()).toHaveText(/^div#outer · /)
    await expectMenuBeside(flow, await flow.rect('#outer'))
    await flow.childButton.click()
    await expect(flow.chip).toHaveText(/^button#save-button · /)
    await flow.childButton.click()
    await expect(flow.chip).toHaveText(/^span#save-label · /)
    // A name in the path moves the pick there; the menu follows.
    await flow.crumb('button#save-button').click()
    await expect(flow.chip).toHaveText(/^button#save-button · /)
    await expectMenuBeside(flow, await flow.rect('#save-button'))

    // At <html>: Parent moves nothing, shows its end look and the note for 2 s.
    for (const name of ['div#outer', 'body', 'html']) {
      await flow.parentButton.click()
      await expect(flow.chip).toHaveText(new RegExp(`^${name} · `))
    }
    let from = (await flow.statusLog()).length
    await clickEndButton(flow.parentButton)
    expectNoteDuration(await flow.shownFor(`${MENU_BANNER} · Top of the page`, from), 2000)
    await expect(flow.chip).toHaveText(/^html · /)

    // At the first-hovered element: Child shows "Back at the element you started from".
    for (const name of ['body', 'div#outer', 'button#save-button', 'span#save-label']) {
      await flow.childButton.click()
      await expect(flow.chip).toHaveText(new RegExp(`^${name} · `))
    }
    from = (await flow.statusLog()).length
    await clickEndButton(flow.childButton)
    expectNoteDuration(await flow.shownFor(`${MENU_BANNER} · Back at the element you started from`, from), 2000)
    await expect(flow.chip).toHaveText(/^span#save-label · /)
    await windowWithTestProject.keyboard.press('Escape')
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })

    // A deep element: the path is cut from its start behind "…" and the picked name shows whole.
    await flow.load(browserServers.sites.static.url('/hover-menu.html'))
    await flow.pickButton.click()
    await flow.waitForActive(true)
    await flow.hover('#menu-trigger', 'button#menu-trigger ')
    await (await flow.panel.page()).waitFor(`!document.getElementById('hover-menu').hidden`)
    await flow.pickByClick('#item-reports', 'a#item-reports ')
    await expect(flow.path.locator('li').first()).toHaveText('…')
    await expect(flow.chip).toHaveText(/^a#item-reports · /)
    expect(await flow.chip.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })

  test('a picked element the page removes: Up, Parent and a path name move nothing, both buttons show the end look and "That element is gone – pick again" shows for 2 s; the menu and its capture stay', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await picking(appWithTestProject, windowWithTestProject, browserServers.sites.static.url('/changing.html'))
    await flow.recordStatus()
    await flow.pickByClick('#changing', 'div#changing ')
    const captureId = await flow.captureId()
    expect(await flow.eval<boolean>('window.__fixture.remove()')).toBe(true)
    const gone = `${MENU_BANNER} · That element is gone – pick again`

    let from = (await flow.statusLog()).length
    await windowWithTestProject.keyboard.press('ArrowUp')
    expectNoteDuration(await flow.shownFor(gone, from), 2000)
    await expect(flow.chip).toHaveText(/^div#changing · /)
    await expect(flow.parentButton).toHaveAttribute('aria-disabled', 'true')
    await expect(flow.childButton).toHaveAttribute('aria-disabled', 'true')

    from = (await flow.statusLog()).length
    await clickEndButton(flow.parentButton)
    expectNoteDuration(await flow.shownFor(gone, from), 2000)
    from = (await flow.statusLog()).length
    await flow.crumb('section#changing-parent').click()
    expectNoteDuration(await flow.shownFor(gone, from), 2000)

    await expect(flow.chip).toHaveText(/^div#changing · /)
    await expect(flow.actions).toBeVisible()
    await expect(flow.still).toBeVisible()
    expect((await flow.state()).capture?.id).toBe(captureId)
  })
})

test.describe('025-AC-030 the prompt-actions menu', () => {
  test('the menu shows the tag and size and the header controls, lists exactly the four actions then the target; Explain has focus; Tab and Shift+Tab walk actions, the pre-warn button, the target and wrap', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await picking(appWithTestProject, windowWithTestProject, browserServers.sites.static.url('/elements.html'))
    const box = await flow.pickByClick('#save-label', 'span#save-label ')
    await expect(flow.chip).toHaveText(`span#save-label · ${Math.round(box.width)} × ${Math.round(box.height)}`)
    await expect(flow.parentButton).toBeVisible()
    await expect(flow.childButton).toBeVisible()
    await expect(flow.crumb('button#save-button')).toBeVisible()
    const group = flow.actions.getByRole('group', { name: 'Actions' })
    expect(await group.getByRole('button').allTextContents()).toEqual(['Explain', 'Ask…', 'Change…', 'Prompt…'])
    // The header controls are not actions and not Tab stops.
    for (const control of [flow.parentButton, flow.childButton, flow.crumb('button#save-button'), flow.closeButton]) {
      await expect(control).toHaveAttribute('tabindex', '-1')
    }
    await expect(flow.action('Explain')).toBeFocused()

    // The app's terminal runs a shell: the pre-warning's button comes before the target button.
    await expect(flow.actions.locator('.erf-brw-banner')).toContainText('not an agent')
    const bannerButton = flow.actions.getByRole('button', { name: 'Choose terminal', exact: true })
    await expect(bannerButton).toBeVisible()
    const order = [flow.action('Ask'), flow.action('Change'), flow.action('Prompt'), bannerButton, flow.panelTarget, flow.action('Explain')]
    for (const next of order) {
      await windowWithTestProject.keyboard.press('Tab')
      await expect(next).toBeFocused()
    }
    for (const previous of [flow.panelTarget, bannerButton, flow.action('Prompt'), flow.action('Change'), flow.action('Ask'), flow.action('Explain'), flow.panelTarget]) {
      await windowWithTestProject.keyboard.press('Shift+Tab')
      await expect(previous).toBeFocused()
    }
  })

  test('toward an agent there is no pre-warning: Tab goes from Prompt… to the target and wraps to Explain', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    await flow.load(browserServers.sites.static.url('/elements.html'))
    await flow.pickButton.click()
    await flow.pickByClick('#save-label', 'span#save-label ')
    await expect(flow.panelTarget).toHaveAttribute('aria-label', 'Terminal · cat, target terminal')
    await expect(flow.actions.locator('.erf-brw-banner')).toHaveCount(0)
    await expect(flow.action('Explain')).toBeFocused()
    for (const next of [flow.action('Ask'), flow.action('Change'), flow.action('Prompt'), flow.panelTarget, flow.action('Explain')]) {
      await windowWithTestProject.keyboard.press('Tab')
      await expect(next).toBeFocused()
    }
  })

  test('the Enter that confirmed the pick and its auto-repeat run nothing; a fresh Enter or Space runs the focused action', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await picking(appWithTestProject, windowWithTestProject, browserServers.sites.static.url('/elements.html'))
    await flow.hover('#save-label', 'span#save-label ')
    // Enter held down: the press confirms; its auto-repeats reach Erfana's window once the menu has focus.
    await flow.input([{ type: 'keyDown', keyCode: 'Return' }])
    await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
    await expect(flow.action('Explain')).toBeFocused()
    await appWithTestProject.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      for (let i = 0; i < 5; i++) contents.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: ['isautorepeat'] })
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    })
    await flow.input([{ type: 'keyUp', keyCode: 'Return' }])
    // Sentinel: Tab is handled by the same panel listener after the repeats; nothing ran before it.
    await windowWithTestProject.keyboard.press('Tab')
    await expect(flow.action('Ask')).toBeFocused()
    await expect(flow.actions.getByRole('alert')).toHaveCount(0)
    await expect(flow.action('Explain')).not.toHaveAttribute('aria-busy', 'true')
    await expect(flow.dialog).toHaveCount(0)

    // A fresh Space runs Ask…; Back; a fresh Enter runs Explain (no terminal: the guard answers).
    await windowWithTestProject.keyboard.press('Space')
    await expect(flow.dialog).toBeVisible()
    await flow.dialogBack.click()
    await expect(flow.actions).toBeVisible()
    await flow.action('Explain').focus()
    await windowWithTestProject.keyboard.press('Enter')
    await expect(flow.actions.getByRole('alert')).toContainText(/^No agent is running/, { timeout: WAIT_MS })
  })

  test('Esc closes the menu with pick mode still on; after a second-Ctrl/Cmd+E pick it also unfreezes the page', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await picking(appWithTestProject, windowWithTestProject, browserServers.sites.static.url('/elements.html'))
    await flow.pickByClick('#save-label', 'span#save-label ')
    await windowWithTestProject.keyboard.press('Escape')
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    expect((await flow.state()).active).toBe(true)
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'true')

    await flow.waitForPageFocus()
    await flow.pickByShortcut('#save-label', 'span#save-label ')
    await windowWithTestProject.keyboard.press('Escape')
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    await flow.waitForFrozen(false)
    expect((await flow.state()).active).toBe(true)
  })

  test('while the menu or a dialog is open Ctrl/Cmd+E does nothing', async ({ appWithTestProject, windowWithTestProject, browserServers }) => {
    const flow = await picking(appWithTestProject, windowWithTestProject, browserServers.sites.static.url('/elements.html'))
    await flow.pickByClick('#save-label', 'span#save-label ')
    const captureId = await flow.captureId()
    const pressPick = async (): Promise<void> => {
      // On the page's input path and on Erfana's window, where focus is.
      await flow.pickKey()
      await windowWithTestProject.keyboard.press(PICK_SHORTCUT)
    }
    await pressPick()
    // Sentinel: a key the menu handles, sent after; the menu got it and nothing else changed.
    await windowWithTestProject.keyboard.press('Tab')
    await expect(flow.action('Ask')).toBeFocused()
    expect(await flow.state()).toMatchObject({ active: true, frozen: false, capture: { id: captureId } })
    await expect(flow.actions).toBeVisible()

    await flow.action('Ask').click()
    await expect(flow.dialog).toBeVisible()
    await pressPick()
    await flow.dialogField.fill('sentinel')
    await expect(flow.dialogField).toHaveValue('sentinel')
    expect(await flow.state()).toMatchObject({ active: true, frozen: false, capture: { id: captureId } })
    await expect(flow.dialog).toBeVisible()
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'true')
  })

  test('choosing a terminal with the menu\'s target button keeps the menu and the pick and shows the new target', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    const agent = new AgentTerminal(windowWithTestProject, flow)
    await agent.open()
    await flow.load(browserServers.sites.static.url('/elements.html'))
    await flow.pickButton.click()
    await flow.pickByClick('#save-label', 'span#save-label ')
    const captureId = await flow.captureId()
    await expect(flow.panelTarget).toHaveAttribute('aria-label', /^Terminal · \S+, target terminal, no agent running$/)

    // The agent starts meanwhile (focus stays in the menu); the user chooses the terminal again from the menu's target button.
    await agent.start({ focus: false })
    await flow.panelTarget.click()
    const menu = flow.panel.menu('Target terminal')
    await expect(menu).toBeVisible()
    expect((await flow.state()).capture?.id, 'opening the target menu keeps the pick').toBe(captureId)
    await menu.getByRole('menuitem', { name: /^Terminal · cat/ }).click()
    await expect(menu).toHaveCount(0)
    await expect(flow.actions).toBeVisible()
    await expect(flow.panelTarget).toHaveAttribute('aria-label', 'Terminal · cat, target terminal')
    await expect(flow.chip).toHaveText(/^span#save-label · /)
    expect((await flow.state()).capture?.id).toBe(captureId)
  })

  test('the menu never covers the outline, also for an element touching the tab\'s right and bottom edges', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/elements.html'))
    // A test-owned element pinned to the bottom-right corner of the viewport.
    await flow.eval(
      `(() => { const d = document.createElement('div'); d.id = 'corner'; d.textContent = 'corner'; d.style.cssText = 'position:fixed;right:0;bottom:0;width:140px;height:48px;background:#ffcc80'; document.body.appendChild(d); return 0 })()`
    )
    await flow.pickButton.click()
    for (const [selector, prefix] of [
      ['#corner', 'div#corner '],
      ['#save-label', 'span#save-label ']
    ] as const) {
      const box = await flow.pickByClick(selector, prefix)
      await expectMenuBeside(flow, box)
      const menu = (await flow.actions.boundingBox())!
      const area = (await flow.panel.placeholder.boundingBox())!
      expect(menu.x).toBeGreaterThanOrEqual(area.x - 0.5)
      expect(menu.y).toBeGreaterThanOrEqual(area.y - 0.5)
      expect(menu.x + menu.width).toBeLessThanOrEqual(area.x + area.width + 0.5)
      expect(menu.y + menu.height).toBeLessThanOrEqual(area.y + area.height + 0.5)
      await windowWithTestProject.keyboard.press('Escape')
      await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
      await flow.passClickWindows()
    }
  })
})

test.describe('025-AC-031 dialog rules per action', () => {
  test('Explain opens no dialog and sends at once; a double Explain sends once', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    const agent = new AgentTerminal(windowWithTestProject, flow)
    await agent.start()
    await flow.load(browserServers.sites.static.url('/elements.html'))

    for (const press of ['pointer', 'keys'] as const) {
      const before = await contextFiles(testProject.path)
      await flow.pickButton.click()
      await flow.pickByClick('#save-label', 'span#save-label ')
      if (press === 'pointer') await flow.action('Explain').dblclick()
      else {
        await expect(flow.action('Explain')).toBeFocused()
        await windowWithTestProject.keyboard.press('Enter')
        await windowWithTestProject.keyboard.press('Enter')
      }
      await expect(flow.dialog).toHaveCount(0)
      await expect(flow.status).toContainText('Sent Explain to Terminal', { timeout: WAIT_MS })
      await expect.poll(async () => (await contextFiles(testProject.path)).length, { timeout: WAIT_MS }).toBe(before.length + 1)
      await flow.waitForActive(false)
      // The one prompt reached the agent.
      const written = (await contextFiles(testProject.path)).filter((f) => !before.includes(f))
      await expect.poll(() => agent.count(written[0]), { timeout: WAIT_MS }).toBeGreaterThan(0)
      expect((await contextFiles(testProject.path)).length, `${press}: one send`).toBe(before.length + 1)
    }
  })

  for (const [action, label] of [
    ['Ask', 'Your question'],
    ['Change', 'What to change'],
    ['Prompt', 'Your prompt']
  ] as const) {
    test(`${action}… opens a dialog; empty or blank shows an inline error; Ctrl/Cmd+Enter with text sends, and separately Send does`, async ({
      appWithTestProject,
      windowWithTestProject,
      browserServers,
      testProject
    }) => {
      const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
      await new AgentTerminal(windowWithTestProject, flow).start()
      await flow.load(browserServers.sites.static.url('/elements.html'))
      for (const submit of ['keys', 'Send'] as const) {
        const before = (await contextFiles(testProject.path)).length
        await flow.pickButton.click()
        await flow.pickByClick('#save-label', 'span#save-label ')
        await flow.action(action).click()
        await expect(flow.dialog).toBeVisible()
        const field = flow.dialog.getByRole('textbox', { name: label })
        await expect(field).toBeFocused()
        await flow.dialogSend.click()
        await expect(flow.dialog.getByRole('alert')).toBeVisible()
        await field.fill('   ')
        await windowWithTestProject.keyboard.press(SEND_KEY)
        await expect(flow.dialog.getByRole('alert')).toBeVisible()
        await expect(field).toHaveAttribute('aria-invalid', 'true')
        expect((await contextFiles(testProject.path)).length).toBe(before)

        const text = `${action} via ${submit} ${Date.now()}`
        await field.fill(text)
        if (submit === 'keys') await windowWithTestProject.keyboard.press(SEND_KEY)
        else await flow.dialogSend.click()
        await expect(flow.status).toContainText(`Sent ${action} to Terminal`, { timeout: WAIT_MS })
        await expect(flow.dialog).toHaveCount(0)
        await expect.poll(async () => (await contextFiles(testProject.path)).length, { timeout: WAIT_MS }).toBe(before + 1)
        await flow.waitForActive(false)
      }
    })
  }

  test('Esc and, separately, Cancel close each dialog with nothing sent, the page unfrozen after a Ctrl/Cmd+E pick, and pick mode on', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await picking(appWithTestProject, windowWithTestProject, browserServers.sites.static.url('/elements.html'))
    for (const action of ['Ask', 'Change', 'Prompt'] as const) {
      for (const close of ['Escape', 'Cancel'] as const) {
        await flow.waitForPageFocus()
        await flow.pickByShortcut('#save-label', 'span#save-label ')
        await flow.action(action).click()
        await expect(flow.dialog).toBeVisible()
        await flow.dialogField.fill(`not sent ${action}`)
        if (close === 'Escape') await windowWithTestProject.keyboard.press('Escape')
        else await flow.dialogCancel.click()
        await expect(flow.dialog).toHaveCount(0, { timeout: WAIT_MS })
        await flow.waitForFrozen(false)
        expect((await flow.state()).active, `${action} ${close}`).toBe(true)
        await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'true')
      }
    }
    expect(await contextFiles(testProject.path)).toEqual([])
  })

  test('a double Ctrl/Cmd+Enter and, separately, a double click on Send each send once', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    await flow.load(browserServers.sites.static.url('/elements.html'))
    for (const submit of ['keys', 'pointer'] as const) {
      const before = (await contextFiles(testProject.path)).length
      await flow.pickButton.click()
      await flow.pickByClick('#save-label', 'span#save-label ')
      await flow.action('Change').click()
      await flow.dialogField.fill(`twice by ${submit}`)
      if (submit === 'keys') {
        await windowWithTestProject.keyboard.down(IS_MAC ? 'Meta' : 'Control')
        await windowWithTestProject.keyboard.press('Enter')
        await windowWithTestProject.keyboard.press('Enter')
        await windowWithTestProject.keyboard.up(IS_MAC ? 'Meta' : 'Control')
      } else await flow.dialogSend.dblclick()
      await expect(flow.status).toContainText('Sent Change to Terminal', { timeout: WAIT_MS })
      await flow.waitForActive(false)
      await expect.poll(async () => (await contextFiles(testProject.path)).length, { timeout: WAIT_MS }).toBe(before + 1)
      expect((await contextFiles(testProject.path)).length, `${submit}: one send`).toBe(before + 1)
    }
  })
})

test.describe('025-AC-073 menu and dialog stay out of the page\'s document', () => {
  test('with the menu and then the Change dialog open the page finds no Erfana element, records no mutation and gets none of the typed keys', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await picking(appWithTestProject, windowWithTestProject, browserServers.sites.static.url('/elements.html'))
    await flow.eval(`window.__keys = []; document.addEventListener('keydown', (e) => window.__keys.push(e.key), true); window.__fixture.resetCounters(); 0`)
    const erfanaInPage = `[...document.body.querySelectorAll('*')].filter((el) => /erf-|browser-/.test(el.className + ' ' + (el.getAttribute('data-testid') || ''))).length`
    await flow.pickByClick('#save-label', 'span#save-label ')
    expect(await flow.eval<number>(erfanaInPage)).toBe(0)
    await flow.action('Change').click()
    await expect(flow.dialog).toBeVisible()
    await flow.dialogField.pressSequentially('make it bigger')
    await expect(flow.dialogField).toHaveValue('make it bigger')
    expect(await flow.eval<number>(erfanaInPage)).toBe(0)
    expect(await flow.eval<number>('window.__fixture.mutations()')).toBe(0)
    expect(await flow.eval<string[]>('window.__keys')).toEqual([])
  })

  test('over a running CSS animation the open menu shows the still image and nothing on screen moves', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const MOVER_RED: [number, number, number] = [198, 40, 40] // #c62828, the fixture's moving square
    const TRAVEL_PX = 400 // the fixture's translateX range
    const flow = await picking(appWithTestProject, windowWithTestProject, browserServers.sites.static.url('/animation.html'))
    const mover = await flow.rect('#mover')
    // The button's label, under the square: its menu leaves the square's band in view, so the band shows the still alone.
    await flow.pickByClick('#target-button span', 'span ')
    await expect(flow.still).toBeVisible()
    const area = (await flow.panel.placeholder.boundingBox())!
    const band = { x: area.x, y: area.y + mover.y, width: Math.min(area.width, mover.x + mover.width + TRAVEL_PX), height: mover.height }
    const panel = (await flow.actions.boundingBox())!
    const MARGIN = 32 // the panel's shadow
    const apart = panel.y - MARGIN >= band.y + band.height || panel.y + panel.height + MARGIN <= band.y
    expect(apart, 'the menu leaves the moving square\'s band in view').toBe(true)
    // The still shows the square somewhere along its band.
    const paint = await flow.windowPaint()
    const row = band.y + band.height / 2
    const xs = Array.from({ length: Math.floor(band.width / 4) }, (_, i) => band.x + i * 4)
    expect(xs.some((x) => near(paint(x, row), MOVER_RED, 16)), 'the square is on the still').toBe(true)
    const first = await windowWithTestProject.screenshot({ clip: band })
    const t0 = await flow.eval<number>('document.getAnimations()[0].currentTime')
    // The page's animation runs on (not paused: a click pick), well past one frame.
    await (await flow.panel.page()).waitFor(`document.getAnimations()[0].currentTime > ${t0} + 500`, 'the animation moved on')
    const second = await windowWithTestProject.screenshot({ clip: band })
    expect(second.equals(first), 'the tab shows the same still image where the square moves').toBe(true)
  })

  test('control: with no menu open the same location request enters the strip', async ({ appWithTestProject, windowWithTestProject, browserServers }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.trustTestCa(browserServers.tls.caPem)
    await flow.load(browserServers.sites.static.url('/permissions.html', { host: 'geo.test', secure: true }))
    await flow.eval(`document.getElementById('request-geolocation').click(); 0`)
    await expect(flow.panel.stripRow('permission')).toBeVisible({ timeout: WAIT_MS })
  })

  test('a permission request while the menu is open waits: the strip does not change, the pick row says one request waits, and it enters the strip after the menu closes', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const url = browserServers.sites.static.url('/permissions.html', { host: 'geo.test', secure: true })
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.trustTestCa(browserServers.tls.caPem)
    await flow.load(url)
    await flow.pickButton.click()
    const rows = flow.panel.root.locator('[data-strip-kind]')
    await expect(rows).toHaveCount(0)
    await flow.pickByClick('h1', 'h1 ')
    await flow.eval(`document.getElementById('request-geolocation').click(); 0`)
    await expect(flow.ui.row).toContainText('1 site request waiting', { timeout: WAIT_MS })
    await expect(rows).toHaveCount(0)
    await windowWithTestProject.keyboard.press('Escape')
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    await expect(flow.panel.stripRow('permission')).toBeVisible({ timeout: WAIT_MS })
    await expect(flow.ui.row).not.toContainText('site request waiting')
  })

  test('a permission request while the Change dialog is open waits the same way and enters the strip after Cancel', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const url = browserServers.sites.static.url('/permissions.html', { host: 'geo.test', secure: true })
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.trustTestCa(browserServers.tls.caPem)
    await flow.load(url)
    await flow.pickButton.click()
    const rows = flow.panel.root.locator('[data-strip-kind]')
    await expect(rows).toHaveCount(0)
    await flow.pickByClick('h1', 'h1 ')
    await flow.action('Change').click()
    await expect(flow.dialog).toBeVisible()
    await flow.eval(`document.getElementById('request-geolocation').click(); 0`)
    await expect(flow.ui.row).toContainText('1 site request waiting', { timeout: WAIT_MS })
    await expect(rows).toHaveCount(0)
    await flow.dialogCancel.click()
    await expect(flow.dialog).toHaveCount(0, { timeout: WAIT_MS })
    await expect(flow.panel.stripRow('permission')).toBeVisible({ timeout: WAIT_MS })
    await expect(flow.ui.row).not.toContainText('site request waiting')
  })
})
