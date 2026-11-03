// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick mode end to end (spec 025): 025-AC-025 (on, off, what the page gets),
 * 025-AC-026 (the outline and the label in the status slot) and 025-AC-081
 * (the banner, the frame and the paused chip).
 *
 * Erfana's controls are driven through its DOM (`PickFlow`); the page's
 * pointer and keys through main-side `webContents.sendInputEvent` (S-27).
 * Notes are timed by a recorder that stamps every change of the status slot,
 * so a 4 s note is measured from when it showed to when it went – no sleep.
 * Condition-based waits only.
 */
import { test, expect, launchBrowserApp, type LaunchedBrowserApp } from './fixtures/browserHarness'
import { testHook } from './pages/browser-page.page'

import { TerminalPage } from './pages/terminal.page'
import { MOD, PickFlow, PICK_KEY_LABEL, PICK_WAIT_MS as WAIT_MS } from './pages/browser-pick-flow.page'

const FIRST = 'Picking – click an element'
const BANNER = `${FIRST} · Esc to stop · ${PICK_KEY_LABEL} picks under the mouse`

/** A note shows for `ms`; the renderer's timer runs on real time, so allow its scheduling slack. */
function expectNoteDuration(actual: number, ms: number): void {
  expect(actual, `note duration ${actual} ms`).toBeGreaterThanOrEqual(ms - 50)
  expect(actual, `note duration ${actual} ms`).toBeLessThan(ms + 1500)
}

test.describe('025-AC-025 pick mode starts, stops and keeps clicks from the page', () => {
  test('Ctrl/Cmd+E starts pick mode after an address-bar load; a click picks without firing the button; Esc and the button each end it', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/elements.html'))
    // An address-bar load leaves keyboard focus in the page.
    await flow.waitForPageFocus()
    await flow.eval('window.__fixture.clear(); 0')

    await flow.pickKey()
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'true')
    await flow.waitForActive(true)

    // A click on the button's label picks it; the button's click handler (the click would bubble to it) never runs.
    await flow.pickByClick('#save-label', 'span#save-label ')
    expect(await flow.eval<number>(`window.__fixture.count('click')`)).toBe(0)
    await windowWithTestProject.keyboard.press('Escape')
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'true')

    // Esc with page focus ends pick mode.
    await flow.key('Escape')
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'false', { timeout: WAIT_MS })
    await flow.waitForActive(false)

    // The button starts it and ends it.
    await flow.pickButton.click()
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'true')
    await flow.waitForActive(true)
    await flow.pickButton.click()
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'false')
    await flow.waitForActive(false)
    expect(await flow.eval<number>(`window.__fixture.count('click')`)).toBe(0)
  })

  test('a new document ends pick mode; pushState keeps it on', async ({ appWithTestProject, windowWithTestProject, browserServers }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/elements.html'))
    await flow.pickButton.click()
    await flow.waitForActive(true)
    await flow.eval(`history.pushState({}, '', '?pushed=1'); 0`)
    await (await flow.panel.page()).waitFor(`location.search === '?pushed=1'`)
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'true')
    expect((await flow.state()).active).toBe(true)

    const next = browserServers.sites.static.url('/plain.html')
    await flow.eval(`setTimeout(() => { location.href = ${JSON.stringify(next)} }, 0); 0`)
    await (await flow.panel.page()).waitForLoaded(next)
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'false', { timeout: WAIT_MS })
    await flow.waitForActive(false)
  })

  test('before the mouse reaches the page, Up, Enter and Ctrl/Cmd+E pick nothing and the status slot asks for the mouse for 4 s', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    // The mouse never moves over this page.
    await flow.load(browserServers.sites.static.url('/events.html'), { pointer: false })
    await flow.eval('window.__fixture.clear(); 0')
    await flow.recordStatus()
    await flow.pickButton.click()
    await flow.waitForActive(true)
    await flow.expectStatus(BANNER)
    const from = (await flow.statusLog()).length

    await flow.key('Up')
    await flow.key('Return')
    await flow.pickKey()
    const moveNote = `${FIRST} · Move the mouse over the page to pick an element`
    await flow.expectStatus(moveNote)
    // A sentinel the page does receive once pick mode is off proves the three keys were not delivered.
    expectNoteDuration(await flow.shownFor(moveNote, from), 4000)
    expect(await flow.highlightLabel()).toBeNull()
    expect((await flow.state()).capture).toBeNull()
    await expect(flow.actions).toHaveCount(0)
    await flow.pickButton.click()
    await flow.waitForActive(false)
    await flow.key('x')
    await expect.poll(() => flow.pageLog(), { timeout: WAIT_MS }).toContainEqual({ type: 'keydown', detail: 'x KeyX' })
    // Focus changes are Erfana moving focus, not input; everything else the page logged is the sentinel alone.
    const logged = (await flow.pageLog()).filter((e) => !['focusin', 'window-focus', 'window-blur'].includes(e.type))
    expect(logged).toEqual([{ type: 'keydown', detail: 'x KeyX' }])
  })

  test('on an empty tab, the certificate page and the load-error page Pick element is disabled and says to load a page; while a page loads it is not', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    const tabId = await flow.tabId()
    const refusedEverywhere = async (where: string): Promise<void> => {
      await expect(flow.pickButton, where).toHaveAttribute('aria-disabled', 'true', { timeout: WAIT_MS })
      await flow.recordStatus()
      const from = (await flow.statusLog()).length
      // Ctrl/Cmd+E on Erfana's window (the tab's own surface holds focus) and the button.
      await testHook(appWithTestProject, 'browserInput', 'windowKey', tabId, 'e', [MOD])
      expect((await flow.state()).active, where).toBe(false)
      // aria-disabled, not disabled: the press still lands and explains itself.
      await flow.pickButton.click({ force: true })
      await flow.expectStatus('Load a page to pick an element')
      expectNoteDuration(await flow.shownFor('Load a page to pick an element', from), 4000)
      await expect(flow.pickButton, where).toHaveAttribute('aria-pressed', 'false')
      expect((await flow.state()).active, where).toBe(false)
    }

    await refusedEverywhere('empty tab')

    // A page held mid-load: the button is live.
    const held = browserServers.sites.static.url('/__hold/pick-loading')
    await flow.panel.load(held)
    await browserServers.held.waitForRequest('pick-loading')
    await flow.panel.waitForState({ loading: true })
    await expect(flow.pickButton).not.toHaveAttribute('aria-disabled', 'true')
    browserServers.held.release('pick-loading', { title: 'Loaded', colour: '#ffffff' })
    await flow.panel.waitForState({ loading: false })

    await flow.panel.load(browserServers.certServers.expired.url('/'))
    await flow.panel.waitForState({ erfanaPage: 'certificate' })
    await refusedEverywhere('certificate page')

    await flow.panel.load('http://no-such-host.invalid/')
    await flow.panel.waitForState({ erfanaPage: 'loadError' })
    await refusedEverywhere('load-error page')
  })

  test('over a span in a button, Up highlights the button, Enter opens the menu, Esc closes it and a second Esc leaves pick mode', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/elements.html'))
    await flow.pickButton.click()
    await flow.waitForActive(true)
    await flow.hover('#save-label', 'span#save-label ')
    await flow.key('Up')
    await expect.poll(() => flow.highlightLabel(), { timeout: WAIT_MS }).toMatch(/^button#save-button /)
    await flow.key('Return')
    await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
    await expect(flow.chip).toContainText('button#save-button')
    await windowWithTestProject.keyboard.press('Escape')
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    expect((await flow.state()).active).toBe(true)
    await flow.waitForPageFocus()
    await flow.key('Escape')
    await flow.waitForActive(false)
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'false')
  })

  test('in pick mode the page gets mousemove and the wheel scrolls it; presses, clicks, double clicks, the context menu and drags never reach it', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/events.html'))
    await flow.pickButton.click()
    await flow.waitForActive(true)
    await flow.eval('window.__fixture.clear(); window.__fixture.counts.mousemove = 0; 0')

    const target = await flow.hover('#target-label', 'span#target-label ')
    expect(await flow.eval<number>('window.__fixture.counts.mousemove')).toBeGreaterThan(0)

    // A press and click: picks; Esc closes the menu.
    const cx = target.x + target.width / 2
    const cy = target.y + target.height / 2
    await flow.click(cx, cy)
    await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
    await windowWithTestProject.keyboard.press('Escape')
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })

    // A double click: the first click picks, the second is part of it.
    await flow.passClickWindows()
    await flow.click(cx, cy, 'left', 2)
    await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
    await windowWithTestProject.keyboard.press('Escape')
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })

    // A right click: Erfana's page menu may open; the page's contextmenu never fires.
    await flow.passClickWindows()
    await flow.click(cx, cy, 'right')
    const pageMenu = windowWithTestProject.getByRole('menu')
    if (await pageMenu.count()) {
      await windowWithTestProject.keyboard.press('Escape')
      await expect(pageMenu).toHaveCount(0, { timeout: WAIT_MS })
    }
    // A drag from the drag source to the drop target.
    await flow.passClickWindows()
    const source = await flow.rect('#drag-source')
    const drop = await flow.rect('#drop-target')
    await flow.input([
      { type: 'mouseMove', x: Math.round(source.x + 10), y: Math.round(source.y + 10) },
      { type: 'mouseDown', x: Math.round(source.x + 10), y: Math.round(source.y + 10), button: 'left', clickCount: 1 },
      { type: 'mouseMove', x: Math.round(source.x + 30), y: Math.round(source.y + 10), button: 'left' },
      { type: 'mouseMove', x: Math.round(drop.x + 10), y: Math.round(drop.y + 10), button: 'left' },
      { type: 'mouseUp', x: Math.round(drop.x + 10), y: Math.round(drop.y + 10), button: 'left', clickCount: 1 }
    ])
    if (await flow.actions.isVisible()) {
      await windowWithTestProject.keyboard.press('Escape')
      await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    }

    // The wheel scrolls the page.
    await flow.input([{ type: 'mouseWheel', x: Math.round(cx), y: Math.round(cy), deltaX: 0, deltaY: -240 }])
    await (await flow.panel.page()).waitFor('window.scrollY > 0', 'the wheel scrolled the page')

    // Sentinel: leave pick mode and click the page; that click is logged, and nothing before it was.
    await flow.pickButton.click()
    await flow.waitForActive(false)
    const after = await flow.rect('#target-label')
    await flow.click(after.x + after.width / 2, after.y + after.height / 2)
    await expect.poll(async () => (await flow.pageLog()).some((e) => e.type === 'click'), { timeout: WAIT_MS }).toBe(true)
    const log = (await flow.pageLog()).map((e) => e.type).filter((t) => t !== 'focusin' && t !== 'window-focus' && t !== 'window-blur')
    const sentinel = log.indexOf('pointerdown')
    expect(log.slice(0, sentinel), 'nothing reached the page before the sentinel click').toEqual([])
  })
})

test.describe('025-AC-026 the outline and its label', () => {
  test('each hovered element is outlined with no fill and labelled in the status slot; the page sees no mutation and no layout change', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/elements.html'))
    await flow.pickButton.click()
    await flow.waitForActive(true)
    await flow.eval('window.__fixture.resetCounters(); 0')
    const driver = await flow.driver()

    /** Hover `selector` (its centre, or `at` inside it); check the hook's box and the status-slot echo; return the label. */
    const hoverAt = async (selector: string, prefix: string, at?: { dx: number; dy: number }): Promise<string> => {
      const box = await flow.rect(selector)
      const point = at ?? { dx: box.width / 2, dy: box.height / 2 }
      await flow.move(box.x + point.dx, box.y + point.dy)
      const shown = await driver.waitForLabel(prefix)
      // The highlight's box against the element's box read again now (a late font may reflow the row once).
      await expect
        .poll(
          async () => {
            const [h, r] = [await driver.highlight(), await flow.rect(selector)]
            if (h?.box === null || h === null) return Infinity
            return Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(h.box![k] - r[k])))
          },
          { timeout: WAIT_MS, message: `${selector}: outline box matches the element` }
        )
        .toBeLessThanOrEqual(1)
      await flow.expectStatus(`${FIRST} · ${shown.label}`)
      return shown.label
    }

    const label = await flow.rect('#save-label')
    // The size is "{width} × {height}" with U+00D7 and a space on each side.
    expect(await hoverAt('#save-label', 'span#save-label ')).toBe(`span#save-label ${Math.round(label.width)} × ${Math.round(label.height)}`)
    expect(await hoverAt('[data-testid="bar-a"]', 'rect.')).toMatch(/^rect\.bar\.bar--a\.bar--tall \d+ × \d+$/)
    expect(await hoverAt('[id=":r1:"]', 'div#:r1: ')).toMatch(/^div#:r1: \d+ × \d+$/)
    expect(await hoverAt('[data-testid="w10-6"]', 'div.w10-6 ')).toBe('div.w10-6 11 × 24')
    for (const [testId, prefix] of [
      ['emoji-label', 'div.aaaa'],
      ['emoji-class', 'div.bbbb']
    ] as const) {
      const text = (await hoverAt(`[data-testid="${testId}"]`, prefix)).replace(/ \d+ × \d+$/, '')
      expect(text, `${testId}: no emoji cut in half`).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/)
      expect([...text].length).toBeLessThanOrEqual(40)
    }
    const long = await hoverAt('[data-testid="long-classes"]', 'div.alpha-component-wrapper')
    const longBox = await flow.rect('[data-testid="long-classes"]')
    // The tag and class text is cut to 40 characters; the size after it is whole.
    const size = ` ${Math.round(longBox.width)} × ${Math.round(longBox.height)}`
    expect(long.endsWith(size)).toBe(true)
    const longText = long.slice(0, long.length - size.length)
    expect([...longText].length).toBeLessThanOrEqual(40)
    expect('div.alpha-component-wrapper.beta-layout-container.gamma-visual-style'.startsWith(longText.replace(/…$/, ''))).toBe(true)

    // One check of the live paint (S-1): the pick colour on the edge of div#outer, and no fill inside it.
    const outer = await flow.rect('#outer')
    await hoverAt('#outer', 'div#outer ', { dx: 4, dy: 4 })
    const near = (c: [number, number, number], want: [number, number, number], tol: number): boolean => c.every((v, i) => Math.abs(v - want[i]) <= tol)
    await expect
      .poll(
        async () => {
          const paint = await flow.livePaint()
          const edge = [-1, 0, 1].some((d) => near(paint(outer.x + outer.width / 2, outer.y + d), [160, 168, 255], 24))
          const inside = paint(outer.x + 6, outer.y + outer.height / 2)
          return { edge, insideIsBackground: near(inside, [236, 239, 241], 3) }
        },
        { timeout: WAIT_MS, message: 'outline painted, no fill' }
      )
      .toEqual({ edge: true, insideIsBackground: true })

    expect(await flow.eval<number>('window.__fixture.mutations()')).toBe(0)
    expect(await flow.eval<number>('window.__fixture.resizeChanges()')).toBe(0)
  })
})

/** The status slot's first clause: clipped, wrapped, or past the slot's edge (the slot hides its overflow). */
async function firstClauseFit(flow: PickFlow): Promise<{ clipped: boolean; lines: number; insideSlot: boolean }> {
  return flow.status.locator('.erf-brw-banner-line__first').evaluate((el) => ({
    clipped: el.scrollWidth > el.clientWidth + 0.5,
    lines: el.getClientRects().length,
    insideSlot: el.getBoundingClientRect().right <= (el.closest('[data-testid="browser-pick-status"]') as HTMLElement).getBoundingClientRect().right + 0.5
  }))
}

// At a 360px tab the target yields its room below 380px (PickRow.css), so the first clause shows whole there too (the test below).
test.describe('pick banner, frame and paused chip (025-AC-081)', () => {
  test('pick mode shows the frame, a crosshair over the top document only and the banner; at 400px the shortcut clause folds and at 360px "Esc to stop" too; the tooltip names both uses', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/frames.html'), { pointer: false })
    await expect(flow.pickButton).toHaveAttribute(
      'title',
      `Pick element (${PICK_KEY_LABEL}) – press ${PICK_KEY_LABEL} again to pick what is under the mouse\nMenus stay open while picking – click to pick`
    )
    await flow.pickButton.click()
    await flow.waitForActive(true)
    await expect(flow.frame).toHaveClass(/(^| )erf-brw-frame--pick( |$)/)
    await flow.expectStatus(BANNER)
    await (await flow.panel.page()).waitFor(`getComputedStyle(document.body).cursor === 'crosshair'`, 'crosshair over the top document')
    // Inside a frame the page's own cursor stays (S-11).
    expect(await flow.eval<string>(`getComputedStyle(document.getElementById('same-origin').contentDocument.body).cursor`)).not.toBe('crosshair')

    await flow.setTabWidth(400)
    await flow.expectStatus(`${FIRST} · Esc to stop`)
    expect(await firstClauseFit(flow)).toEqual({ clipped: false, lines: 1, insideSlot: true })
    await flow.setTabWidth(360)
    await flow.expectStatus(FIRST)
  })

  test('at a 360px tab the first clause shows whole, neither clipped nor wrapped', async ({ appWithTestProject, windowWithTestProject, browserServers }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/elements.html'), { pointer: false })
    await flow.pickButton.click()
    await flow.waitForActive(true)
    await flow.setTabWidth(360)
    await flow.expectStatus(FIRST)
    expect(await firstClauseFit(flow)).toEqual({ clipped: false, lines: 1, insideSlot: true })
  })

  for (const run of ['address bar', 'menu', 'dialog', 'terminal'] as const) {
    test(`from page focus in pick mode, focus moving to the ${run} gives its own banner`, async ({ appWithTestProject, windowWithTestProject, browserServers }) => {
      const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
      const terminal = new TerminalPage(windowWithTestProject)
      if (run === 'terminal') await terminal.open()
      await flow.load(browserServers.sites.static.url('/elements.html'), { pointer: false })
      await flow.pickButton.click()
      await flow.waitForActive(true)
      await flow.waitForPageFocus()
      await flow.expectStatus(BANNER)
      switch (run) {
        case 'address bar':
          await flow.focusErfana()
          await flow.panel.addressBar.click()
          await flow.expectStatus('Picking – Esc returns to the page')
          break
        case 'menu':
          await flow.pickByClick('#save-label', 'span#save-label ')
          await flow.expectStatus('Picking – Esc or click outside closes the panel')
          break
        case 'dialog':
          await flow.pickByClick('#save-label', 'span#save-label ')
          await flow.action('Ask').click()
          await expect(flow.dialog).toBeVisible()
          await flow.expectStatus('Picking – Esc or Cancel closes the dialog')
          break
        case 'terminal':
          await flow.focusErfana()
          await terminal.focus()
          await flow.expectStatus('Picking – click the page to continue')
          break
      }
    })
  }

  test('a second-Ctrl/Cmd+E pick shows Page paused; Esc closes the menu and the chip goes while the frame and banner stay', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/elements.html'))
    await flow.pickKey()
    await flow.pickByShortcut('#save-label', 'span#save-label ')
    await expect(flow.statusChip).toHaveText('Page paused')
    await windowWithTestProject.keyboard.press('Escape')
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    await flow.waitForFrozen(false)
    await expect(flow.statusChip).toHaveCount(0)
    await expect(flow.frame).toHaveClass(/(^| )erf-brw-frame--pick( |$)/)
    await flow.expectStatus(new RegExp(`^${FIRST}`))
  })

  test('focus leaving with the menu open says the panel closed; with the dialog open it says to click back to the dialog', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    const terminal = new TerminalPage(windowWithTestProject)
    await terminal.open()
    await flow.load(browserServers.sites.static.url('/elements.html'))
    await flow.pickButton.click()
    await flow.pickByClick('#save-label', 'span#save-label ')
    await terminal.focus()
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    await flow.expectStatus('Picking – the panel closed when you left; pick again')

    // Back to the page (that click only focuses), pick again, open a dialog, leave.
    const box = await flow.rect('#save-label')
    await flow.click(box.x + box.width / 2, box.y + box.height / 2)
    await flow.waitForPageFocus()
    await flow.passClickWindows()
    await flow.pickByClick('#save-label', 'span#save-label ')
    await flow.action('Ask').click()
    await expect(flow.dialog).toBeVisible()
    await terminal.focus()
    await expect(flow.dialog).toBeVisible()
    await flow.expectStatus('Picking – click to return to the dialog')
  })

  test('closing the window with the menu open over a paused page leaves no frame, banner or freeze once the project reopens', async ({
    userDataDir,
    homeDir,
    testProject,
    browserServers
  }) => {
    const url = browserServers.sites.static.url('/hover-menu.html')
    let launched: LaunchedBrowserApp | null = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    try {
      const flow = await PickFlow.open(launched.app, launched.window)
      await flow.load(url)
      await flow.pickKey()
      await flow.pickByShortcut('#menu-trigger', 'button#menu-trigger ')
      await expect(flow.statusChip).toHaveText('Page paused')
      await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      await launched.close()
      launched = null

      launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
      const again = await PickFlow.open(launched.app, launched.window)
      await again.load(url)
      await expect(again.pickButton).toHaveAttribute('aria-pressed', 'false')
      await expect(again.frame).not.toHaveClass(/erf-brw-frame--pick/)
      await expect(again.status).toHaveText('')
      expect(await again.state()).toEqual({ active: false, frozen: false, capture: null })
      // The page runs: its clock moves.
      expect(await again.eval<number>('window.__fixture.tick()')).toBe(1)
    } finally {
      await launched?.close()
    }
  })
})
