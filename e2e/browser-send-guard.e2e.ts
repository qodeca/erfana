// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser send, the shell guard as the user meets it (spec 025,
 * 025-FR-061, S-23): no terminal, a bare shell, a wrapper (`ssh`, `sudo`,
 * `tmux`, `screen`) and an agent in front of the target terminal.
 *
 * No title carries 025-AC-077: parts of it cannot be proven on this build
 * (one terminal panel, so no other terminal to choose; **Choose terminal**
 * does not open the terminal menu; the target name "Terminal" is never longer
 * than 8 characters, so its cut cannot show; `nu.exe` is Windows only; the
 * app opens a terminal at start, so "no terminal open" is reached through a
 * terminal whose shell exited, where **Open terminal** shows the panel but
 * starts no new terminal; an unreadable foreground and the 400 px toolbar are
 * not set up). These tests prove the rest.
 *
 * The wrappers are stand-ins: links named `ssh`, `sudo`, … to node running the
 * stub agent, so the foreground reads by that name. Condition-based waits only.
 */
import { test, expect } from './fixtures/browserHarness'
import { BrowserSendUi, SEND_WAIT_MS } from './pages/browser-send.page'

const IS_POSIX = process.platform !== 'win32'

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

    // Open terminal shows the terminal panel; the dialog stays with its text.
    await send.terminal.close()
    await open.click()
    await expect(send.terminalInstance).toBeVisible({ timeout: SEND_WAIT_MS })
    await expect(send.pick.dialog).toBeVisible()
    await expect(send.dialogField).toHaveValue('label cut off')
    expect(await send.captureFiles()).toEqual([])
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
    await expect(send.pick.dialog.getByRole('button', { name: 'Choose terminal', exact: true })).toBeFocused()
    await expect(send.dialogField).toHaveValue('label cut off')
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
