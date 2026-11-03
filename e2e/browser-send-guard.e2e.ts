// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser send, the shell guard as the user meets it (spec 025,
 * 025-FR-061, S-23): no terminal, a bare shell, a wrapper (`ssh`, `sudo`,
 * `tmux`, `screen`) and an agent in front of the target terminal.
 *
 * No title carries 025-AC-077. Erfana has one terminal – the terminal panel's
 * single session, named "Terminal" as its panel header names it – so the parts
 * that need a second terminal cannot be built or proven on this build:
 * choosing another terminal in the toolbar's chooser and the next send going
 * there, the same from the dialog's and the menu's chooser at 400 px, and a
 * terminal name longer than 8 characters being cut (the design's "Terminal 1"
 * naming, CF-16, is an open owner question). An unreadable foreground is not
 * set up here. `nu.exe` is Windows only; it and the unknown foreground are
 * unit-tested in `src/main/services/browser/capture/BrowserTargetStatus.test.ts`,
 * the 10-second start-up window in `src/main/services/terminalForegroundRead.test.ts`. The app
 * opens a terminal at start, so "no terminal open" is reached through a
 * terminal whose shell exited. These tests prove the rest: the refusal with
 * no terminal and with a bare shell (nothing typed or written, no toast, focus
 * on the banner's button, the dialog kept with its text), **Open terminal**
 * starting a new terminal, **Choose terminal** opening the terminal menu where
 * a click sets the target, the wrappers' **Send anyway**, and one bracketed
 * paste and Enter to an agent.
 *
 * The wrappers are stand-ins: links named `ssh`, `sudo`, … to node running the
 * stub agent, so the foreground reads by that name. Condition-based waits only.
 */
import { test, expect } from './fixtures/browserHarness'
import { BrowserSendUi, SEND_WAIT_MS } from './pages/browser-send.page'

const IS_POSIX = process.platform !== 'win32'

// Pick, key routing and focus moving into the page all follow the page's
// native focus, which ends when the window stops being the OS key window: run
// with the OS-focus lock held exclusive (e2e/fixtures/osFocusLock.ts).
test.use({ needsOsFocus: true })

test.describe('built-in browser send, the shell guard', () => {
  test.skip(!IS_POSIX, 'The foreground is read by name on macOS and Linux; the stand-ins are POSIX links')

  test('when the target terminal is gone, Change shows Open terminal with focus on it, keeps the dialog and its text and writes nothing', async ({
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

  test('with a bare shell in front, Change and Explain type nothing and show Choose terminal with focus on it', async ({
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

  test('with ssh, sudo, tmux or screen in front, a banner offers Send anyway, which types the prompt as one paste and Enter', async ({
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

  test('with an agent in front, the prompt arrives as one bracketed paste followed by Enter; the dialog carries the target as a menu button', async ({
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
})
