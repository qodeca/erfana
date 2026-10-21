// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Launch helpers behind the `visualTest` fixtures, exported so the #138
 * screenshot capture script (`scripts/capture/`) launches the app exactly the
 * way the visual-regression suite does. Moved unchanged out of
 * `e2e/fixtures/index.ts`; `visualTest` imports them from here.
 */

import type { ElectronApplication } from '@playwright/test'
import * as path from 'path'

import { buildAppEnv, closeAppAndWait } from './isolation'

const PROJECT_ROOT = path.join(__dirname, '..', '..')

export function buildVisualLaunchOptions(
  userDataDir: string,
  projectPath?: string,
  homeDir?: string
): {
  args: string[]
  env: Record<string, string>
  recordVideo?: { dir: string; size: { width: number; height: number } }
} {
  const args = [PROJECT_ROOT, '--force-device-scale-factor=1', `--user-data-dir=${userDataDir}`]
  if (projectPath) {
    args.splice(1, 0, projectPath)
  }
  const opts: ReturnType<typeof buildVisualLaunchOptions> = {
    args,
    env: buildAppEnv({ homeDir })
  }
  if (process.env.CI) {
    opts.recordVideo = {
      dir: path.join(__dirname, '..', '..', 'test-results', 'videos'),
      size: { width: 1280, height: 720 }
    }
  }
  return opts
}

export async function forceCloseApp(app: ElectronApplication): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100))
  try {
    await app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.destroy()
      }
    })
  } catch (e) {
    if (process.env.CI) console.warn('forceCloseApp: window destroy failed –', e)
  }
  await closeAppAndWait(app)
}

/**
 * Give the first window a content area of exactly `width` × `height`.
 *
 * Waits for the window first: right after `electron.launch()` the app has not
 * created it yet, so a resize sent then did nothing – except on a slow run,
 * where it landed and every visual case failed (#267). Throws when the window
 * manager does not grant the size, so a wrong size fails here, not as a
 * pixel diff.
 */
export async function resizeBrowserWindow(
  app: ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await app.firstWindow()
  const granted = await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setContentSize(size.width, size.height)
      return win.getContentSize()
    },
    { width, height }
  )
  if (granted[0] !== width || granted[1] !== height) {
    throw new Error(
      `resizeBrowserWindow: asked for ${width}×${height}, got ${granted[0]}×${granted[1]}`
    )
  }
}
