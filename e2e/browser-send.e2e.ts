// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser send, end to end (spec 025): pick an element, choose an
 * action in the prompt-actions panel or the dialog, and check what reaches
 * the terminal and the disk.
 *
 * The terminal panel runs the stub agent (`fixtures/browser/stub-agent.cjs`),
 * which records every byte it receives, so the tests assert the exact bytes
 * Erfana typed. Erfana's UI is driven by role and accessible name; the page's
 * pointer and keys go through main-side input hooks. Condition-based waits
 * only.
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { BrowserSendUi, CAPTURES_REL, maskCaptureRefs, PASTE_END, PASTE_START, SEND_WAIT_MS, type StubAgent } from './pages/browser-send.page'

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'browser')
const IS_POSIX = process.platform !== 'win32'
const MOD = process.platform === 'darwin' ? 'meta' : 'control'

/** The golden rendering of one template, with capture names masked; line breaks as typed (`\r`). */
/** Attempts {@link pauseClockNow} makes before it gives up; each one fails only when the read went stale. */
const PAUSE_ATTEMPTS = 20

/**
 * Pause the page clock about now. Playwright pauses only at a future time, and
 * the clock runs in real time until then: on a busy machine the page's
 * `Date.now()` read is already past when the pause arrives ("Cannot
 * fast-forward to the past"), so the pause is asked again, from a fresh read,
 * until it lands.
 */
async function pauseClockNow(window: Page): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await window.clock.pauseAt((await window.evaluate(() => Date.now())) + 1)
      return
    } catch (error) {
      if (attempt >= PAUSE_ATTEMPTS || !String(error).includes('fast-forward to the past')) throw error
    }
  }
}

async function golden(id: string): Promise<string> {
  return (await fs.readFile(path.join(GOLDEN_DIR, `prompt-${id}.golden.txt`), 'utf8')).replace(/\r?\n/g, '\r').replace(/\r$/, '')
}

test.describe('built-in browser send through the template path', () => {
  test.skip(!IS_POSIX, 'The stub agent is a node program in front of a POSIX shell (macOS and Linux)')

  test('025-AC-032 each action types its rendered template as one bracketed paste and Enter; the deny-rule offer shows once', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    await send.recordToasts()
    const denyOffer = send.infoToasts().filter({ hasText: 'Keep your agent out of the browser profile' })
    const denyOffers = async (): Promise<number> =>
      (await send.toastLog()).filter((t) => t.type === 'info' && t.text.includes('Keep your agent out of the browser profile')).length

    // Explain: no dialog; the first send in the project offers the deny rule.
    await send.pickElement('#save-label', 'span#save-label ')
    await send.pick.action('Explain').click()
    const explain = await agent.waitForSubmitted()
    expect(maskCaptureRefs(explain)).toBe(await golden('browser-explain'))
    await expect(denyOffer).toHaveCount(1)
    expect(await denyOffers()).toBe(1)
    await expect(denyOffer).toContainText('.erfana/browser/profile/')
    await expect(denyOffer).toContainText('Read(./.erfana/browser/profile/**)')

    // Change: a multi-line instruction with a control character and a template token.
    for (const [action, id] of [
      ['Change', 'browser-change'],
      ['Ask', 'browser-ask'],
      ['Prompt', 'browser-prompt']
    ] as const) {
      await agent.reset()
      await send.pickElement('#save-label', 'span#save-label ')
      const field = await send.openDialog(action)
      // The bell (U+0007) reaches the field as typed text; the send must remove it.
      await field.evaluate((el: HTMLTextAreaElement, value: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
        setter.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, 'label cut off\nkeep it on one line\u0007 {{x}}')
      await expect(field).toHaveValue('label cut off\nkeep it on one line\u0007 {{x}}')
      await send.dialogSend.click()
      const typed = await agent.waitForSubmitted()
      // One paste, one Enter: no marker inside, nothing after the Enter.
      const all = await agent.received()
      expect(all.split(PASTE_START)).toHaveLength(2)
      expect(all.split(PASTE_END)).toHaveLength(2)
      expect(all.endsWith(`${PASTE_END}\r`)).toBe(true)
      expect(typed).not.toContain('\u0007')
      expect(typed).toContain('label cut off\rkeep it on one line {{x}}')
      expect(maskCaptureRefs(typed)).toBe(await golden(id))
      await expect(send.pick.dialog).toHaveCount(0)
    }

    // The offer was made once: the later sends did not repeat it.
    expect(await denyOffers()).toBe(1)
    // Each send referenced files that exist.
    for (const ref of explain.match(/@(\.erfana\/browser\/captures\/\S+)/g) ?? []) {
      await expect(fs.stat(path.join(testProject.path, ref.slice(1)))).resolves.toBeTruthy()
    }
  })
})

/**
 * What a failed send leaves: nothing typed, no capture file, pick mode on, and
 * one more error toast naming `reason`. The toast is left alone: a click on it
 * would move focus out of the browser tab, which closes the panel by design.
 */
async function expectNothingSent(send: BrowserSendUi, agent: StubAgent, reason: RegExp, toastsBefore: number): Promise<void> {
  const failures = async (): Promise<string[]> =>
    (await send.toastLog()).filter((t) => t.type === 'error' && t.text.includes("Couldn't send to your agent")).map((t) => t.text)
  await expect.poll(failures, { timeout: SEND_WAIT_MS }).toHaveLength(toastsBefore + 1)
  expect((await failures())[toastsBefore]).toMatch(reason)
  expect(await agent.received()).toBe('')
  expect(await send.captureFiles()).toEqual([])
  expect((await send.pickState()).active).toBe(true)
}

test.describe('025-AC-060 a capture that cannot be saved sends nothing', () => {
  test.skip(!IS_POSIX, 'The stub agent is a node program in front of a POSIX shell; a read-only folder is a POSIX mode')

  for (const fault of ['read-only folder', 'forced write failure'] as const) {
    test(`with a ${fault}, Explain reopens the menu and Change keeps the dialog with its text; the retry sends the capture held in memory`, async ({
      appWithTestProject,
      windowWithTestProject,
      browserServers,
      testProject
    }) => {
      const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
      const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
      await send.recordToasts()
      await send.load(browserServers.sites.static.url('/elements.html'))
      const captures = path.join(testProject.path, CAPTURES_REL)
      const arm = async (): Promise<void> => {
        if (fault === 'read-only folder') {
          await fs.mkdir(captures, { recursive: true })
          await fs.chmod(captures, 0o555)
        } else {
          await send.fault('armWriteFailures', 1)
        }
      }
      const disarm = async (): Promise<void> => {
        if (fault === 'read-only folder') await fs.chmod(captures, 0o755).catch(() => undefined)
        else await send.fault('resetFaults')
      }
      const reason =
        fault === 'read-only folder'
          ? /The capture could not be saved: \.erfana\/browser\/captures is read-only/
          : /The capture could not be saved: forced write failure/
      try {
        // Explain: the menu opens again at the element, pick mode stays on.
        await send.pickElement('#save-label', 'span#save-label ')
        const explainCapture = (await send.pickState()).capture!.id
        await arm()
        await send.pick.action('Explain').click()
        await expectNothingSent(send, agent, reason, 0)
        await expect(send.pick.actions).toBeVisible()
        await expect(send.pick.actions.getByRole('navigation', { name: 'Element path' })).toContainText('span#save-label')
        // The folder is fixed: the retry sends the same capture, not a new one.
        await disarm()
        expect((await send.pickState()).capture?.id).toBe(explainCapture)
        await send.pick.action('Explain').click()
        expect(await agent.waitForSubmitted()).toContain('Explain the element the user picked')
        await expect(send.pick.actions).toHaveCount(0)
        expect(await send.captureFiles()).toHaveLength(3)
        await fs.rm(captures, { recursive: true })
        await agent.reset()

        // Change: the dialog stays open with the text.
        await send.pickElement('#save-label', 'span#save-label ')
        const changeCapture = (await send.pickState()).capture!.id
        await send.openDialog('Change', 'label cut off')
        await arm()
        await send.dialogSend.click()
        await expectNothingSent(send, agent, reason, 1)
        await expect(send.pick.dialog).toBeVisible()
        await expect(send.dialogField).toHaveValue('label cut off')
        await disarm()
        expect((await send.pickState()).capture?.id).toBe(changeCapture)
        await send.dialogSend.click()
        expect(await agent.waitForSubmitted()).toContain('<change>\rlabel cut off\r</change>')
        await expect(send.pick.dialog).toHaveCount(0)
      } finally {
        await disarm()
      }
    })
  }

  test('after a Ctrl/Cmd+E pick the page stays frozen through the failure; Esc closes the dialog and the page runs again', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
      await send.recordToasts()
    await send.load(browserServers.sites.static.url('/elements.html'))
    const driver = await send.driver()
    // Ctrl/Cmd+E starts picking; with the pointer on the element, Ctrl/Cmd+E again picks it and freezes the page.
    await driver.key('e', [MOD])
    await expect.poll(async () => (await driver.state()).active, { timeout: SEND_WAIT_MS }).toBe(true)
    await driver.hover(await driver.rect('#save-label'), 'span#save-label ')
    await driver.key('e', [MOD])
    await expect(send.pick.actions).toBeVisible({ timeout: SEND_WAIT_MS })
    await expect.poll(async () => (await send.pickState()).frozen, { timeout: SEND_WAIT_MS }).toBe(true)
    try {
      // The menu (Explain), then the dialog (Change): each failure leaves the page frozen.
      await send.fault('armWriteFailures', 1)
      await send.pick.action('Explain').click()
      await expectNothingSent(send, agent, /forced write failure/, 0)
      await expect(send.pick.actions).toBeVisible()
      expect((await send.pickState()).frozen).toBe(true)

      await send.openDialog('Change', 'label cut off')
      await send.fault('armWriteFailures', 1)
      await send.dialogSend.click()
      await expectNothingSent(send, agent, /forced write failure/, 1)
      await expect(send.pick.dialog).toBeVisible()
      await expect(send.dialogField).toHaveValue('label cut off')
      expect((await send.pickState()).frozen).toBe(true)
    } finally {
      await send.fault('resetFaults')
    }
    await send.dialogField.press('Escape')
    await expect(send.pick.dialog).toHaveCount(0)
    await expect.poll(async () => (await send.pickState()).frozen, { timeout: SEND_WAIT_MS }).toBe(false)
    // The page runs: it answers a script again.
    expect(await driver.page.eval<number>('1 + 1')).toBe(2)
    expect(await agent.received()).toBe('')
  })

  test('when the files were written and the terminal write fails, the files are deleted and the same toast shows', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
      await send.recordToasts()
    await send.load(browserServers.sites.static.url('/elements.html'))
    await send.pickElement('#save-label', 'span#save-label ')
    await send.failNextTerminalPaste()
    await send.pick.action('Explain').click()
    await expectNothingSent(send, agent, /Erfana couldn't type into Terminal/, 0)
    await expect(send.pick.actions).toBeVisible()
    // The retry goes through.
    await send.pick.action('Explain').click()
    expect(await agent.waitForSubmitted()).toContain('Explain the element the user picked')
    expect(await send.captureFiles()).toHaveLength(3)
  })

  test('a screenshot that fails at pick confirmation shows a toast naming the reason, opens no menu and keeps pick mode on', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    await send.load(browserServers.sites.static.url('/elements.html'))
    await send.pick.pickButton.click()
    const driver = await send.driver()
    await expect.poll(async () => (await driver.state()).active, { timeout: SEND_WAIT_MS }).toBe(true)
    try {
      // The first try and its retry both fail.
      await send.fault('armCaptureFailures', 2)
      await driver.hover(await driver.rect('#save-label'), 'span#save-label ')
      await driver.key('Return')
      const toast = send.errorToasts().filter({ hasText: "Couldn't capture this element" })
      await expect(toast).toHaveCount(1, { timeout: SEND_WAIT_MS })
      await expect(toast).toContainText(/\S\. Nothing was sent – pick it again\./)
      await expect(send.pick.actions).toHaveCount(0)
      await expect(send.pick.pickButton).toHaveAttribute('aria-pressed', 'true')
      expect(await driver.state()).toMatchObject({ active: true, capture: null })
    } finally {
      await send.fault('resetFaults')
    }
  })
})

test.describe('025-AC-070 the send notice and the terminal reveal', () => {
  test.skip(!IS_POSIX, 'The stub agent is a node program in front of a POSIX shell (macOS and Linux)')

  test('the notice goes after 5 s on the test clock, and pauses under the pointer and keyboard focus for only the time left', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const window = windowWithTestProject
    const send = await BrowserSendUi.open(appWithTestProject, window, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.static.url('/elements.html'))
    // The renderer's timers on Playwright's clock: they run in real time until paused.
    await window.clock.install()

    /** Pick, press Enter on Explain with the clock stopped, and step the clock only until Enter reached the agent. */
    const sendExplain = async (): Promise<void> => {
      await agent.reset()
      await send.pickElement('#save-label', 'span#save-label ')
      await send.parkPointer()
      await expect(send.pick.action('Explain')).toBeFocused()
      await pauseClockNow(window)
      await window.keyboard.press('Enter')
      // The paste and its Enter are a renderer timer apart: step it, then stop. No step runs after the
      // send settled, so the notice's timer starts at the clock time it is read at below.
      await expect
        .poll(
          async () => {
            const done = (await agent.received()).endsWith(`${PASTE_END}\r`)
            if (!done) await window.clock.runFor(20)
            return done
          },
          { timeout: SEND_WAIT_MS }
        )
        .toBe(true)
      await expect(send.notice).toBeVisible()
      await expect(send.notice).toContainText('Sent Explain to Terminal')
    }
    const resumeAfter = async (): Promise<void> => {
      await window.clock.resume()
    }

    // Pointer and keyboard focus away: still there at 4.9 s, gone at 5 s.
    await sendExplain()
    await window.clock.runFor(4900)
    await expect(send.notice).toBeVisible()
    await window.clock.runFor(100)
    await expect(send.notice).toHaveCount(0)
    await resumeAfter()

    // The pointer parked on Show terminal after 2 s: it stays well past 5 s, then goes 3 s after the pointer left.
    await sendExplain()
    await window.clock.runFor(2000)
    await send.notice.getByRole('button', { name: 'Show terminal' }).hover()
    await window.clock.runFor(10_000)
    await expect(send.notice).toBeVisible()
    await send.parkPointer()
    await window.clock.runFor(2999)
    await expect(send.notice).toBeVisible()
    await window.clock.runFor(1)
    await expect(send.notice).toHaveCount(0)
    await resumeAfter()

    // The same with keyboard focus on Open capture.
    await sendExplain()
    await window.clock.runFor(2000)
    await send.notice.getByRole('button', { name: 'Open capture' }).focus()
    await window.clock.runFor(10_000)
    await expect(send.notice).toBeVisible()
    await send.pick.pickButton.focus()
    await window.clock.runFor(2999)
    await expect(send.notice).toBeVisible()
    await window.clock.runFor(1)
    await expect(send.notice).toHaveCount(0)
    await resumeAfter()
  })

  test('a send with the terminal collapsed reveals it, keeps focus in the browser tab and flashes the outline; Show terminal and Open capture work', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    // Collapse the terminal before the load, so the page is laid out at its final width when picked.
    await send.terminal.close()
    await expect(send.terminalInstance).toBeHidden()
    await send.load(browserServers.sites.static.url('/elements.html'))

    await send.pickElement('#save-label', 'span#save-label ')
    const driver = await send.driver()
    await send.parkPointer()
    await expect(send.pick.action('Explain')).toBeFocused()
    await windowWithTestProject.keyboard.press('Enter')
    // The flash: the sent element's outline shows on the live page, then goes after 1 s of main's clock.
    await expect.poll(async () => (await driver.highlight())?.label ?? '', { timeout: SEND_WAIT_MS, intervals: [25] }).toMatch(/^span#save-label /)
    await send.advanceMainClock(1000)
    await expect.poll(() => driver.highlight(), { timeout: SEND_WAIT_MS }).toBeNull()

    await agent.waitForSubmitted()
    await expect(send.notice).toContainText('Sent Explain to Terminal')
    await expect(send.terminalInstance).toBeVisible()
    // Keyboard focus stays in the browser tab: the page has it, not the revealed terminal.
    await expect.poll(() => send.routingFocus(), { timeout: SEND_WAIT_MS }).toBe('page')
    await expect(send.terminalInstance.locator('textarea')).not.toBeFocused()

    // Keep the notice up with the pointer on it, collapse the terminal, then Show terminal reveals it.
    const show = send.notice.getByRole('button', { name: 'Show terminal' })
    await show.hover()
    await send.terminal.close()
    await expect(send.terminalInstance).toBeHidden()
    await show.click()
    await expect(send.terminalInstance).toBeVisible()

    const contextPath = (await send.captureFiles()).find((name) => name.endsWith('.md'))!
    await send.notice.getByRole('button', { name: 'Open capture' }).click()
    await expect(send.editorTab(contextPath)).toBeVisible({ timeout: SEND_WAIT_MS })
  })
})
