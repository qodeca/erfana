// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * No "in use" indicator for the camera or microphone (spec 025, 025-FR-019,
 * 025-AC-019; owner decision, 2026-11-05: the engine never reports that a
 * capture ends, so Erfana shows no indicator at all). A site is allowed the
 * camera and, separately, the microphone through the strip prompt; while the
 * fake device's capture is live, neither the address bar's chips, the browser
 * tab's editor tab nor any other part of Erfana's window names it.
 *
 * Screen sharing is not walked here: it needs the source picker, and its
 * prompt is covered elsewhere. Media run on Chromium's fake device
 * (`--use-fake-device-for-media-stream`). Condition-based waits only.
 */
import { test, expect } from './fixtures/browserHarness'
import { BROWSER_CHROMIUM_ARGS } from './fixtures/browser/serve'
import { PickFlow, PICK_WAIT_MS as WAIT_MS } from './pages/browser-pick-flow.page'
import { BrowserTabUiPage } from './pages/browser-tab-ui.page'

test.use({ extraLaunchArgs: [...BROWSER_CHROMIUM_ARGS, '--use-fake-device-for-media-stream'] })

test.describe('025-FR-019 no in-use indicator', () => {
  for (const device of ['camera', 'microphone'] as const) {
    test(`025-AC-019 with the ${device} allowed and capturing, no in-use indicator shows in the address bar, the tab or the tab strip`, async ({
      appWithTestProject,
      windowWithTestProject,
      browserServers
    }) => {
      const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
      await flow.trustTestCa(browserServers.tls.caPem)
      // The fixture host the test certificate names for this device; each test has its own project profile,
      // so no earlier answer is saved for it.
      const host = device === 'camera' ? 'camera.test' : 'mic.test'
      await flow.load(browserServers.sites.static.url('/permissions.html', { host, secure: true }), { pointer: false })

      await flow.eval(`document.getElementById('request-${device}').click(); 0`)
      await expect(flow.panel.stripRow('permission')).toBeVisible({ timeout: WAIT_MS })
      await flow.panel.answerRow('permission', 'Allow')
      // Positive control: the page got the device and its capture is live.
      const page = await flow.panel.page()
      await page.waitFor(`document.getElementById('result-${device}').textContent === 'granted'`, `${device} granted`)
      expect(await flow.eval<boolean>(`streams.length === 1 && streams[0].getTracks().every((t) => t.readyState === 'live')`)).toBe(true)
      await expect(flow.panel.stripRow('permission')).toHaveCount(0)

      // No indicator: no chip in the address bar, nothing on the editor tab, nothing anywhere in the window.
      const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
      const deviceWords = /camera|microphone|screen|is using your/i
      await expect(flow.panel.chips.getByText(deviceWords)).toHaveCount(0)
      await expect(flow.panel.chips.getByRole('img')).toHaveCount(0)
      await expect(ui.editorTabs).toHaveCount(1)
      await expect(ui.editorTabs.first()).not.toHaveText(deviceWords)
      await expect(ui.editorTabs.first().getByLabel(deviceWords)).toHaveCount(0)
      await expect(windowWithTestProject.getByLabel(/is using your/i)).toHaveCount(0)
      await expect(windowWithTestProject.getByText(/is using your/i)).toHaveCount(0)
    })
  }
})
