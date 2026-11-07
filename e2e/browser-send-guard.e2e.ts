// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser send, the shell guard as the user meets it (spec 025,
 * 025-FR-061, S-23, 025-AC-077): no terminal, a bare shell, `nu.exe`, a
 * wrapper (`ssh`, `sudo`, `tmux`, `screen`), an agent in front of the target
 * terminal, and the target at a narrow width.
 *
 * 025-AC-077 covers one terminal session (owner decision, 2026-11-05):
 * Erfana has one terminal – the terminal panel's single session, named
 * "Terminal" as its panel header names it. Choosing another terminal, the
 * target control in the dialog and menu at narrow widths, and the 8-character
 * name cut are a follow-up and are not tested here.
 *
 * The app opens a terminal at start, so "no terminal open" is reached
 * through a terminal whose shell exited. An unreadable foreground is not set
 * up here: it is unit-tested in
 * `src/main/services/browser/capture/BrowserTargetStatus.test.ts`, and the
 * 10-second start-up window in `src/main/services/terminalForegroundRead.test.ts`.
 *
 * The stand-ins (`nu.exe`, `ssh`, `sudo`, …) are links of those names to node
 * running the stub agent, so the foreground reads by that name; the stub agent
 * itself runs as `node`, the documented limit (a `node` foreground is typed
 * into). Condition-based waits only.
 */
import { test, expect } from './fixtures/browserHarness'
import type { Locator } from '@playwright/test'
import { BrowserSendUi, SEND_WAIT_MS } from './pages/browser-send.page'

const IS_POSIX = process.platform !== 'win32'

/**
 * `inner` is drawn whole: inside `box` – which itself cuts off nothing (no
 * overflow) – and `box` inside `row`, horizontally.
 */
async function drawnWhole(inner: Locator, box: Locator, row: Locator): Promise<boolean> {
  const [i, b, r] = [await inner.boundingBox(), await box.boundingBox(), await row.boundingBox()]
  if (i === null || b === null || r === null || i.width === 0) return false
  const within = (x: { x: number; width: number }, o: { x: number; width: number }): boolean => x.x >= o.x - 0.5 && x.x + x.width <= o.x + o.width + 0.5
  const uncut = await box.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
  return uncut && within(i, b) && within(b, r)
}

// Pick, key routing and focus moving into the page all follow the page's
// native focus, which ends when the window stops being the OS key window: run
// with the OS-focus lock held exclusive (e2e/fixtures/osFocusLock.ts).
test.use({ needsOsFocus: true })

test.describe('built-in browser send, the shell guard', () => {
  test.skip(!IS_POSIX, 'The foreground is read by name on macOS and Linux; the stand-ins are POSIX links')

  test('025-AC-077 when the target terminal is gone, Change shows Open terminal with focus on it, keeps the dialog and its text and writes nothing', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    // The app opens a terminal on start; its shell exits, so no terminal is left to type into.
    await send.startShell()
    await send.run('exit')
    await send.load(browserServers.sites.static.url('/elements.html'))
    await send.recordToasts()
    await send.pickElement('#save-label', 'span#save-label ')
    await send.openDialog('Change', 'label cut off')
    await send.dialogSend.click()

    const banner = send.pick.dialog.getByRole('alert')
    await expect(banner).toContainText('No agent is running in a terminal – no terminal is open. Open one, start your agent there, then send again.')
    const open = send.pick.dialog.getByRole('button', { name: 'Open terminal', exact: true })
    await expect(open).toBeFocused()
    await expect(send.dialogField).toHaveValue('label cut off')
    expect(await send.captureFiles()).toEqual([])
    expect(await send.toastLog()).toEqual([])

    // Open terminal shows the terminal panel and starts a new terminal there; the dialog stays with its text.
    await send.terminal.close()
    await open.click()
    await expect(send.terminalInstance).toBeVisible({ timeout: SEND_WAIT_MS })
    await expect(send.pick.dialog).toBeVisible()
    await expect(send.dialogField).toHaveValue('label cut off')
    // The new terminal runs a shell: the dialog's target reads it, and the next send meets the shell guard, not "no terminal".
    await expect(send.pick.dialog.getByRole('button', { name: /target terminal/ })).toHaveAccessibleName(/^Terminal · \S+, target terminal, no agent running$/, {
      timeout: SEND_WAIT_MS
    })
    await send.dialogSend.click()
    await expect(send.pick.dialog.getByRole('alert').locator('.erf-brw-banner__text')).toHaveText(
      /^No agent is running in Terminal – start your agent there, then send again\.$/
    )
    await expect(send.dialogField).toHaveValue('label cut off')
    expect(await send.captureFiles()).toEqual([])
    expect(await send.toastLog()).toEqual([])
    // And it takes input: the exited shell never could.
    await send.run('echo ERFANA_$((40+2))')
    await send.terminal.waitForOutputLine('ERFANA_42')
  })

  test('025-AC-077 with a bare shell in front, Change and Explain type nothing and show Choose terminal with focus on it', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    await send.startShell()
    await send.load(browserServers.sites.static.url('/elements.html'))
    await send.recordToasts()
    const refusal = /^No agent is running in Terminal – start your agent there, then send again\.$/

    await send.pickElement('#save-label', 'span#save-label ')
    await send.openDialog('Change', 'label cut off')
    await send.dialogSend.click()
    await expect(send.pick.dialog.getByRole('alert').locator('.erf-brw-banner__text')).toHaveText(refusal)
    const choose = send.pick.dialog.getByRole('button', { name: 'Choose terminal', exact: true })
    await expect(choose).toBeFocused()
    await expect(send.dialogField).toHaveValue('label cut off')

    // Choose terminal opens the terminal menu; a click on the terminal there sets it as the target, the dialog keeps its text.
    await choose.click()
    const menu = send.panel.menu('Target terminal')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: /^Terminal · \S+/ }).first().click()
    await expect(menu).toHaveCount(0)
    await expect(send.pick.dialog).toBeVisible()
    await expect(send.dialogField).toHaveValue('label cut off')
    // The chosen terminal still runs only a shell, so the banner says so again.
    await expect(send.pick.dialog.getByRole('alert').locator('.erf-brw-banner__text')).toHaveText(refusal)
    await send.pick.dialog.getByRole('button', { name: 'Back to actions' }).click()

    // Explain from the menu: the banner's button takes focus in the menu.
    await send.pick.action('Explain').click()
    await expect(send.pick.actions.getByRole('alert').locator('.erf-brw-banner__text')).toHaveText(refusal)
    await expect(send.pick.actions.getByRole('button', { name: 'Choose terminal', exact: true })).toBeFocused()

    expect(await send.captureFiles()).toEqual([])
    expect(await send.toastLog()).toEqual([])
    // Nothing reached the shell: the screen shows neither the instruction nor a capture reference.
    const screen = (await send.terminal.readScreen()).lines.join('\n')
    expect(screen).not.toContain('label cut off')
    expect(screen).not.toContain('.erfana/browser/captures')
  })

  test('025-AC-077 with ssh, sudo, tmux or screen in front, a banner offers Send anyway, which types the prompt as one paste and Enter', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    await send.startShell()
    await send.load(browserServers.sites.static.url('/elements.html'))
    const links = test.info().outputPath('wrappers')
    for (const wrapper of ['ssh', 'sudo', 'tmux', 'screen']) {
      const agent = await send.startStubAs(wrapper, links, test.info().outputPath(`${wrapper}.bin`), new RegExp(`· ${wrapper}, target terminal$`))
      await send.pickElement('#save-label', 'span#save-label ')
      const files = await send.captureFiles()
      await send.pick.action('Explain').click()
      const banner = send.pick.actions.getByRole('status').filter({ hasText: 'Send anyway?' })
      await expect(banner).toContainText(`Terminal is running ${wrapper} – it may not be your agent. Send anyway?`)
      expect(await send.captureFiles()).toEqual(files)
      expect(await agent.received()).toBe('')
      await banner.getByRole('button', { name: 'Send anyway', exact: true }).click()
      expect(await agent.waitForSubmitted()).toContain('Explain the element the user picked')
      await expect(send.pick.actions).toHaveCount(0)
      await send.stopStub()
    }
  })

  test('025-AC-077 with an agent (a stub node process) in front, the prompt arrives as one bracketed paste followed by Enter; the dialog carries the target as a menu button', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    await send.pickElement('#save-label', 'span#save-label ')
    await send.openDialog('Change', 'label cut off')
    const target = send.pick.dialog.getByRole('button', { name: /target terminal$/ })
    await expect(target).toHaveAccessibleName('Terminal · node, target terminal')
    await expect(target).toHaveAttribute('aria-haspopup', 'menu')
    await send.dialogSend.click()
    const all = (await agent.waitForSubmitted(), await agent.received())
    expect(all.startsWith('\x1b[200~')).toBe(true)
    expect(all.indexOf('\x1b[200~', 1)).toBe(-1)
    expect(all.endsWith('\x1b[201~\r')).toBe(true)
    expect(all).toContain('<change>\rlabel cut off\r</change>')
  })

  test('025-AC-077 with nu.exe in front, Explain types nothing and shows Choose terminal', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    await send.startShell()
    await send.load(browserServers.sites.static.url('/elements.html'))
    await send.recordToasts()
    // nu is a shell: with nu.exe in front the target names it as nu (the name compared drops `.exe`) and reads "no agent running".
    const nu = await send.startStubAs('nu.exe', test.info().outputPath('shells'), test.info().outputPath('nu.bin'), /· nu, target terminal, no agent running$/)
    await send.pickElement('#save-label', 'span#save-label ')
    await send.pick.action('Explain').click()
    await expect(send.pick.actions.getByRole('alert').locator('.erf-brw-banner__text')).toHaveText(
      /^No agent is running in Terminal – start your agent there, then send again\.$/
    )
    await expect(send.pick.actions.getByRole('button', { name: 'Choose terminal', exact: true })).toBeFocused()
    expect(await send.captureFiles()).toEqual([])
    expect(await send.toastLog()).toEqual([])
    expect(await nu.received()).toBe('')
  })

  test('025-AC-077 in a narrow browser tab the foreground process stays whole, and the target\'s accessible name and the target menu carry the full terminal name', async ({
    appWithTestProject,
    windowWithTestProject,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.ui.setPanelWidth(send.panel, 360)

    const target = send.pick.target
    await expect(target).toHaveAccessibleName('Terminal · node, target terminal')
    const proc = target.locator('.erf-brw-target__proc')
    await expect(proc).toHaveText('· node')
    await expect.poll(() => drawnWhole(proc, target, send.pick.row), { timeout: SEND_WAIT_MS, message: 'the foreground process is drawn whole' }).toBe(true)

    await target.click()
    const menu = send.panel.menu('Target terminal')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /^Terminal · node\b/ })).toHaveCount(1)
  })
})
