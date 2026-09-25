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

const PROJECT_ROOT = path.join(__dirname, '..', '..')

export function buildVisualLaunchOptions(
  userDataDir: string,
  projectPath?: string
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
    env: { ...process.env, NODE_ENV: 'development' }
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
  try {
    await app.close()
  } catch (e) {
    if (process.env.CI) console.warn('forceCloseApp: app.close() failed –', e)
  }
}

export async function resizeBrowserWindow(
  app: ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        win.setSize(size.width, size.height)
        win.setContentSize(size.width, size.height)
      }
    },
    { width, height }
  )
}
