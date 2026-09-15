// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview – "Open in default browser" helpers (#124, part 4, WI-26).
 *
 * No test may start a real browser. The launcher has an e2e seam (part 4
 * §4.4): in an unpackaged build launched with `ERFANA_E2E_BROWSER_SEAM=1`, a
 * function at `globalThis.__erfanaE2eBrowserLaunch` in the MAIN process
 * replaces `execFile` / `openPath` and receives `{ via, appPath, filePath }`
 * (`E2eBrowserLaunch`). `armBrowserSeam()` installs one that records each call
 * and, by mode, answers at once, holds until `releaseBrowserSeam()`, or throws
 * (a thrown seam is `LAUNCH_FAILED`). It refuses to arm – and so fails the
 * test before anything is clicked – unless the main process really has the
 * variable set and is unpackaged, because otherwise a click would reach the
 * real launcher.
 *
 * The seam replaces only the launch; the default-browser lookup still runs.
 * `stubBrowserLookup()` replaces `app.getApplicationInfoForProtocol` (the
 * launcher reads it through a call-time lambda) so the answer is fixed: a
 * known app path, or a rejection that forces the fallback.
 *
 * Plain functions, like `html-preview.frames.ts`: they take the
 * `ElectronApplication` or the `Page`. Nothing here sleeps; waits are
 * Playwright polls on a condition.
 *
 * @see docs/design/design-issue-124-part4.md §4.3–§4.5
 */

import { expect } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import type { E2eBrowserLaunch } from '../../src/main/services/browserLaunch/browserLauncher'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'
import { PREVIEW_BUDGET_MS } from './html-preview.page'

export type { E2eBrowserLaunch }

/** How the armed seam answers a launch. */
export type SeamMode = 'answer' | 'hold' | 'throw'

/** The environment variable that arms the seam (mirrors `E2E_BROWSER_SEAM_ENV`). */
export const BROWSER_SEAM_ENV = 'ERFANA_E2E_BROWSER_SEAM'

/** The toolbar button's accessible name and the tree item's label. */
export const OPEN_IN_BROWSER_LABEL = 'Open in default browser'

/** A default browser that does not exist: only the seam ever sees it. */
export function stubBrowserPath(platform: string): string {
  return platform === 'win32' ? 'C:\\E2E\\erfana-e2e-browser.exe' : '/Applications/Erfana E2E Browser.app'
}

interface SeamState {
  mode: SeamMode
  calls: E2eBrowserLaunch[]
  held: Array<() => void>
}

/**
 * Install the recording seam in the main process. Throws, before any click,
 * when the seam could not be live (variable missing or a packaged build).
 */
export async function armBrowserSeam(app: ElectronApplication, mode: SeamMode = 'answer'): Promise<void> {
  const armed = await app.evaluate(({ app: electronApp }, { initial, envName }) => {
    if (electronApp.isPackaged || process.env[envName] !== '1') return false
    const store = globalThis as { __erfanaE2eBrowserSeam?: SeamState; __erfanaE2eBrowserLaunch?: unknown }
    const state: SeamState = { mode: initial, calls: [], held: [] }
    store.__erfanaE2eBrowserSeam = state
    store.__erfanaE2eBrowserLaunch = (launch: E2eBrowserLaunch): Promise<void> | void => {
      state.calls.push({ via: launch.via, appPath: launch.appPath, filePath: launch.filePath })
      if (state.mode === 'throw') throw new Error('e2e seam: launch refused')
      if (state.mode === 'hold') return new Promise<void>((resolve) => state.held.push(resolve))
      return undefined
    }
    return true
  }, { initial: mode, envName: BROWSER_SEAM_ENV })
  if (!armed) {
    throw new Error(`${BROWSER_SEAM_ENV}=1 is not set in the app (or the build is packaged); refusing to click – a real browser would start`)
  }
}

/** Change how the armed seam answers the next launch. */
export async function setBrowserSeamMode(app: ElectronApplication, mode: SeamMode): Promise<void> {
  await app.evaluate((_electron, next) => {
    const state = (globalThis as { __erfanaE2eBrowserSeam?: SeamState }).__erfanaE2eBrowserSeam
    if (!state) throw new Error('browser seam not armed')
    state.mode = next
  }, mode)
}

/** Let every held launch finish. Returns how many were released. */
export async function releaseBrowserSeam(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => {
    const state = (globalThis as { __erfanaE2eBrowserSeam?: SeamState }).__erfanaE2eBrowserSeam
    const held = state?.held.splice(0) ?? []
    for (const resolve of held) resolve()
    return held.length
  })
}

/** Every launch the seam has received, oldest first. */
export async function browserSeamCalls(app: ElectronApplication): Promise<E2eBrowserLaunch[]> {
  return app.evaluate(
    () => (globalThis as { __erfanaE2eBrowserSeam?: SeamState }).__erfanaE2eBrowserSeam?.calls.slice() ?? []
  )
}

/** Wait until the seam has received exactly `count` launches, and return them. */
export async function waitForBrowserSeamCalls(app: ElectronApplication, count: number): Promise<E2eBrowserLaunch[]> {
  await expect
    .poll(async () => (await browserSeamCalls(app)).length, {
      timeout: PREVIEW_BUDGET_MS,
      message: `the browser seam never received ${count} launch(es)`
    })
    .toBe(count)
  return browserSeamCalls(app)
}

/**
 * Fix the default-browser lookup: resolve `{ path }`, or reject with
 * `'reject'` (no browser found → the fallback runs).
 */
export async function stubBrowserLookup(app: ElectronApplication, answer: { path: string } | 'reject'): Promise<void> {
  await app.evaluate(({ app: electronApp }, result) => {
    const stub = async (): Promise<{ path: string; name: string; icon: unknown }> => {
      if (result === 'reject') throw new Error('e2e: no default browser')
      return { path: result.path, name: 'Erfana E2E Browser', icon: null }
    }
    Object.defineProperty(electronApp, 'getApplicationInfoForProtocol', {
      value: stub,
      configurable: true,
      writable: true
    })
  }, answer)
}

/** The platform the renderer reports – the source of the Finder / Explorer wording. */
export async function rendererPlatform(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { api: { utils: { getPlatform(): string } } }).api.utils.getPlatform())
}

/** The file manager's reveal command the launch-failure toast must name. */
export function revealCommandFor(platform: string): string {
  if (platform === 'darwin') return 'Reveal in Finder'
  if (platform === 'win32') return 'Reveal in Explorer'
  return 'Reveal in File Manager'
}

/** What the seam should receive for `realPath`: Linux never tries the lookup. */
export function expectedBrowserLaunch(platform: string, realPath: string): E2eBrowserLaunch {
  return platform === 'darwin' || platform === 'win32'
    ? { via: 'browser', appPath: stubBrowserPath(platform), filePath: realPath }
    : { via: 'fallback', appPath: null, filePath: realPath }
}

/** The preview toolbar's Open in default browser button (one preview open). */
export function openInBrowserButton(page: Page): Locator {
  return page.getByTestId('preview-band-open-in-browser')
}

/** Toasts of one type (`toast-error`, `toast-info`, …). */
export function toastsOf(page: Page, type: 'error' | 'info' | 'success' | 'warning'): Locator {
  return byTestId(page, `${TEST_IDS.TOAST}-${type}`)
}

/**
 * Dismiss every toast. The "Project Opened" toast counts as an overlay and
 * hides the native preview view, which would swallow a trusted click.
 */
export async function dismissAllToasts(page: Page): Promise<void> {
  const dismiss = byTestId(page, TEST_IDS.TOAST_BTN_DISMISS)
  await expect(async () => {
    if ((await dismiss.count()) > 0) await dismiss.first().click()
    await expect(dismiss).toHaveCount(0, { timeout: 1_000 })
  }).toPass({ timeout: PREVIEW_BUDGET_MS })
}
