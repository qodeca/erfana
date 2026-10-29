// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide task: docs/user-guide/how-to/send-a-screenshot-or-photo-to-the-agent.md
 *
 * Follows the page step by step, finding every control by the label the page
 * names. Chromium's fake camera stands in for a real webcam (the page's own
 * screenshot shows that test pattern). Window and area capture open the
 * interactive macOS system picker, which a test cannot drive, so only their
 * buttons are proved. Screen capture depends on macOS Screen Recording
 * permission for the test Electron binary: the test accepts either outcome
 * the page promises – a pasted path, or the permission dialog.
 */

import * as fs from 'fs'
import { test, expect } from '../fixtures'
import { TerminalPage } from '../pages/terminal.page'

test.use({
  extraLaunchArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
})

/** Quoted absolute image path pasted at the prompt, or null. */
function findPastedPath(screen: string, ext: RegExp): string | null {
  const flat = screen.replace(/\n/g, '')
  const re = new RegExp(`['"](/[^'"]+\\.(?:${ext.source}))['"]`, 'i')
  const m = flat.match(re)
  return m ? m[1] : null
}

test('send a screenshot or photo to the agent', async ({ windowWithTestProject: window }) => {
  test.setTimeout(120_000)
  const terminal = new TerminalPage(window)

  // Before you start: "open the terminal – the capture buttons appear only
  // while a terminal is running." (Terminal reference: a terminal opens when a
  // project loads.)
  await terminal.open()
  let screenshotPath: string | null = null
  const readScreen = async (): Promise<string> => (await terminal.readScreen()).lines.join('\n')

  // The page names the buttons by their tooltips (title attributes).
  // Step 1: "Select **Capture screen**, **Capture window** or **Capture area**
  // in the terminal header."
  const captureScreen = window.getByTitle('Capture screen', { exact: true })
  await expect(captureScreen).toBeVisible()
  await expect(window.getByTitle('Capture window', { exact: true })).toBeVisible()
  await expect(window.getByTitle('Capture area', { exact: true })).toBeVisible()
  await captureScreen.click()

  // Step 2: "Choose what to capture. If more than one display is connected,
  // **Capture screen** opens **Select display** – select a display, then
  // select **Capture**."
  // Step 3: "Erfana pastes the quoted file path into the terminal for your agent."
  // If something goes wrong: "If macOS blocks a screenshot, Erfana shows
  // **Screen Recording permission needed**."
  const permissionTitle = window.getByText('Screen Recording permission needed')
  const selectDisplay = window.getByText('Select display', { exact: true })
  let screenOutcome: 'pasted' | 'permission' | undefined
  let pickedDisplay = false
  await expect
    .poll(
      async () => {
        if (findPastedPath(await readScreen(), /png|jpe?g/)) return (screenOutcome = 'pasted')
        if (await permissionTitle.isVisible()) return (screenOutcome = 'permission')
        if (!pickedDisplay && (await selectDisplay.isVisible())) {
          // The first display is preselected; select **Capture** to confirm.
          const picker = window.getByRole('dialog').filter({ has: selectDisplay })
          await picker.getByRole('button', { name: 'Capture', exact: true }).click()
          pickedDisplay = true
        }
        return undefined
      },
      { timeout: 30_000 }
    )
    .toBeTruthy()
  test.info().annotations.push({ type: 'display-picker', description: String(pickedDisplay) })

  if (screenOutcome === 'pasted') {
    screenshotPath = findPastedPath(await readScreen(), /png|jpe?g/)
    expect(screenshotPath && fs.existsSync(screenshotPath)).toBeTruthy()
    // The file holds the developer's real screen: remove it once proved.
    fs.rmSync(screenshotPath as string, { force: true })
  } else {
    // "Select **Open Screen Recording settings**, allow Erfana, then select
    // **Relaunch Erfana** and try again." – both buttons must exist. They are
    // not selected: one opens real System Settings, the other relaunches.
    await expect(window.getByRole('button', { name: 'Open Screen Recording settings' })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Relaunch Erfana' })).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(permissionTitle).toBeHidden()
  }
  test.info().annotations.push({ type: 'screen-capture', description: screenOutcome ?? 'none' })

  // Step 4: "Select **Capture photo**, then select **Capture** in the dialog to
  // take a JPEG photo."
  await window.getByTitle('Capture photo', { exact: true }).click()
  const dialog = window.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // "**Mirror preview (saved photo is never mirrored)** is remembered per
  // camera and changes only the preview."
  await expect(dialog.getByText('Mirror preview (saved photo is never mirrored)')).toBeVisible()
  const capture = dialog.getByRole('button', { name: 'Capture', exact: true })
  await expect(capture).toBeEnabled({ timeout: 20_000 })
  await capture.click()

  // "Erfana pastes the photo's file path into the terminal."
  let photo: string | null = null
  await expect
    .poll(
      async () => {
        const found = findPastedPath(await readScreen(), /jpe?g/)
        photo = found && found !== screenshotPath ? found : null
        return photo
      },
      { timeout: 20_000 }
    )
    .toBeTruthy()
  expect(fs.existsSync(photo as unknown as string)).toBe(true)
  const head = fs.readFileSync(photo as unknown as string).subarray(0, 3)
  // JPEG magic bytes FF D8 FF
  expect([...head]).toEqual([0xff, 0xd8, 0xff])
})
