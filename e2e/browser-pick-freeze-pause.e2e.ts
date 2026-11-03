// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The freeze really pauses the page (spec 025, 025-AC-028, ADR 0008): after
 * a second-Ctrl/Cmd+E pick, the top document and a cross-origin frame stop,
 * and a resume from outside Erfana (the DevTools debugger) closes the menu
 * with nothing sent.
 *
 * Kept apart from `browser-pick-freeze.e2e.ts` because these tests observe
 * the engine's own pause. The top document used to miss its pause in most
 * runs: Chromium delivers `Debugger.pause` on its interrupt path, ahead of a
 * `Debugger.enable` still queued for the page's main thread, and refused it
 * ("Debugger agent is not enabled"); `pickFreeze.ts` now sends it again once
 * the enable has answered.
 *
 * A same-site popup that may share the page's renderer process is recorded
 * while the page is frozen (S-25) – a test annotation, not an assertion,
 * since Chromium decides whether the process is shared.
 *
 * Method: the page's clock runs on its own `setInterval` from before the
 * pick (nothing is injected into the page while it is frozen – an injected
 * script uses up a pending pause without pausing), and the test listens to
 * the page debugger's `Debugger.paused` / `Debugger.resumed` events in main.
 * Condition-based waits only.
 */
import type { ElectronApplication } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { captureFiles, PickFlow, PICK_WAIT_MS as WAIT_MS } from './pages/browser-pick-flow.page'
import { mainHook } from './pages/browser-pick.page'

/** Open the fixture's script hover menu with the pointer and rest on Reports. */
async function openHoverMenu(flow: PickFlow): Promise<void> {
  const trigger = await flow.rect('#menu-trigger')
  await flow.move(trigger.x + trigger.width / 2, trigger.y + trigger.height / 2)
  await (await flow.panel.page()).waitFor(`window.__fixture.menuOpen()`, 'the hover menu opened')
  const item = await flow.rect('#item-reports')
  await flow.move(item.x + item.width / 2, item.y + item.height / 2)
}

/** The page's own clocks: a timer in the top document and one in the cross-origin frame tick on their own. */
async function startPageClocks(flow: PickFlow): Promise<void> {
  await expect.poll(async () => flow.frameEval<string>('other.test', 'document.readyState').catch(() => ''), { timeout: WAIT_MS }).toBe('complete')
  await flow.eval('setInterval(() => window.__fixture.tick(), 20); 0')
  await flow.frameEval('other.test', 'setInterval(() => window.__fixture.tick(), 20); 0')
}

/** The sessions (`''` the top document) that reported `method` after event `from`. */
async function sessionsWith(flow: PickFlow, method: string, from = 0): Promise<string[]> {
  return [...new Set((await flow.pauses()).slice(from).filter((e) => e.method === method).map((e) => e.session))].sort()
}

/** The clock of the top document (`frameUrl` absent) or of the frame moves on: two reads differ. */
async function expectClockMoves(flow: PickFlow, frameUrl?: string): Promise<void> {
  const read = (): Promise<number> =>
    frameUrl === undefined
      ? flow.eval<number>(`Number(document.getElementById('clock').textContent)`)
      : flow.frameEval<number>(frameUrl, `Number(document.getElementById('clock').textContent)`)
  const first = await read()
  await expect.poll(read, { timeout: WAIT_MS, message: `clock ${frameUrl ?? 'top'} moves` }).toBeGreaterThan(first)
}

/** The popup windows of the run (main's popup hook). */
const popups = (app: ElectronApplication): Promise<Array<{ pageWebContentsId: number; committedUrl: string | null }>> => mainHook(app, 'popup', 'popups')

/** Run `code` in a popup's page; rejects after the hook's 5 s cap (a paused page never answers). */
const popupExec = <T>(app: ElectronApplication, id: number, code: string): Promise<T> => mainHook<T>(app, 'popup', 'popupExec', id, code)

test.describe('025-AC-028 the freeze pauses the page', () => {
  test('after a second-Ctrl/Cmd+E pick the top document and the cross-origin frame stop, and run again once the menu closes', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/hover-menu.html'))
    await startPageClocks(flow)
    await flow.watchPauses()
    await openHoverMenu(flow)
    await flow.pickKey()
    await expect.poll(() => flow.highlightLabel(), { timeout: WAIT_MS }).toMatch(/^a#item-reports /)
    await flow.pickKey()
    await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
    await flow.waitForFrozen(true)
    // Each document's next timer runs into the pause.
    await expect.poll(async () => sessionsWith(flow, 'Debugger.paused'), { timeout: WAIT_MS }).toContain('')
    await expect.poll(async () => (await sessionsWith(flow, 'Debugger.paused')).length, { timeout: WAIT_MS }).toBeGreaterThanOrEqual(2)

    const resumedFrom = (await flow.pauses()).length
    await windowWithTestProject.keyboard.press('Escape')
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    await flow.waitForFrozen(false)
    await expect.poll(async () => (await sessionsWith(flow, 'Debugger.resumed', resumedFrom)).length, { timeout: WAIT_MS }).toBeGreaterThanOrEqual(2)
    await expectClockMoves(flow)
    await expectClockMoves(flow, 'other.test')
  })

  test('a resume from outside Erfana (the DevTools debugger) closes the menu with nothing sent', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/hover-menu.html'))
    await startPageClocks(flow)
    await flow.watchPauses()
    await flow.pickKey()
    await flow.pickByShortcut('#menu-trigger', 'button#menu-trigger ')
    await expect.poll(async () => sessionsWith(flow, 'Debugger.paused'), { timeout: WAIT_MS }).toContain('')
    // The DevTools front end resumes the page: the same protocol command on the page's debugger, not sent by Erfana's pick.
    const id = (await flow.panel.hookTab()).webContentsId
    await appWithTestProject.evaluate(({ webContents }, contentsId) => webContents.fromId(contentsId)!.debugger.sendCommand('Debugger.resume'), id)
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    await flow.waitForFrozen(false)
    expect((await flow.state()).capture).toBeNull()
    expect(await captureFiles(testProject.path)).toEqual([])
    await expectClockMoves(flow)
  })

  test('a same-site popup while the page is frozen is recorded (S-25: Chromium decides whether it shares the process; not asserted)', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/hover-menu.html'))
    await startPageClocks(flow)
    // A same-site popup, opened by a real press on a test-owned button (the popup blocker wants a user action).
    await flow.eval(
      `(() => { const b = document.createElement('button'); b.id = 'open-popup'; b.textContent = 'Open popup'; b.style.cssText = 'position:fixed;right:8px;bottom:8px;width:120px;height:32px'; b.onclick = () => window.open('/popup-child.html?via=s25', 's25', 'width=400,height=300'); document.body.append(b); return 0 })()`
    )
    const button = await flow.rect('#open-popup')
    await flow.click(button.x + button.width / 2, button.y + button.height / 2)
    await expect.poll(async () => (await popups(appWithTestProject)).find((p) => (p.committedUrl ?? '').includes('via=s25')) !== undefined, { timeout: WAIT_MS }).toBe(true)
    const popup = (await popups(appWithTestProject)).find((p) => (p.committedUrl ?? '').includes('via=s25'))!
    await popupExec(appWithTestProject, popup.pageWebContentsId, `window.__s25 = 0; setInterval(() => window.__s25++, 20); 0`)
    const tabContents = (await flow.panel.hookTab()).webContentsId
    const sharesProcess = await appWithTestProject.evaluate(
      ({ webContents }, [a, b]) => webContents.fromId(a)!.getOSProcessId() === webContents.fromId(b)!.getOSProcessId(),
      [tabContents, popup.pageWebContentsId] as const
    )

    await flow.watchPauses()
    await openHoverMenu(flow)
    await flow.pickKey()
    await expect.poll(() => flow.highlightLabel(), { timeout: WAIT_MS }).toMatch(/^a#item-reports /)
    await flow.pickKey()
    await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
    await flow.waitForFrozen(true)
    await expect.poll(async () => sessionsWith(flow, 'Debugger.paused'), { timeout: WAIT_MS }).toContain('')

    // Two reads of the popup's counter while the page is frozen: moving, or no answer at all (paused with it).
    const read = (): Promise<number | null> => popupExec<number>(appWithTestProject, popup.pageWebContentsId, 'window.__s25').catch(() => null)
    const first = await read()
    const moved = first === null ? false : await expect.poll(read, { timeout: 2000 }).toBeGreaterThan(first).then(() => true, () => false)
    const outcome = first === null ? 'paused with the page (no answer)' : moved ? 'kept running' : 'answered but did not move'
    test.info().annotations.push({ type: 'S-25', description: `same-site popup ${sharesProcess ? 'shares' : 'does not share'} the page's renderer process; while frozen it ${outcome}` })

    await windowWithTestProject.keyboard.press('Escape')
    await expect(flow.actions).toHaveCount(0, { timeout: WAIT_MS })
    await flow.waitForFrozen(false)
    // After the unfreeze nothing stays paused: the popup runs again.
    await expect.poll(read, { timeout: WAIT_MS }).not.toBeNull()
    const after = (await read()) ?? 0
    await expect.poll(read, { timeout: WAIT_MS }).toBeGreaterThan(after)
  })
})
