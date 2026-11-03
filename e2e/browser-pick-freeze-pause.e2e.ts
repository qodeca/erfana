// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The freeze really pauses the page (spec 025, 025-AC-028, ADR 0008): after
 * a second-Ctrl/Cmd+E pick, the top document and a cross-origin frame stop,
 * and a resume from outside Erfana (the DevTools debugger) closes the menu
 * with nothing sent.
 *
 * Kept apart from `browser-pick-freeze.e2e.ts` because these tests observe
 * the engine's own pause, and that is not reliable today: with the page's
 * own 20 ms timers running, main's pick hook reports the page frozen while
 * the top document sometimes never reports `Debugger.paused` (5 of 8 runs
 * on macOS, 2026-11-03). That is reported as an open finding, not a
 * test defect – the assertions stay strict.
 *
 * Method: the page's clock runs on its own `setInterval` from before the
 * pick (nothing is injected into the page while it is frozen – an injected
 * script uses up a pending pause without pausing), and the test listens to
 * the page debugger's `Debugger.paused` / `Debugger.resumed` events in main.
 * Condition-based waits only.
 */
import { test, expect } from './fixtures/browserHarness'
import { captureFiles, PickFlow, PICK_WAIT_MS as WAIT_MS } from './pages/browser-pick-flow.page'

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

test.describe('the freeze pauses the page (025-AC-028)', () => {
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
})
