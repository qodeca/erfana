// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide claims (user audience, batch 2): behaviour the user guide states that
 * only the running app can show. Each test names the page and the sentence it
 * proves. The only stubs are native file pickers (Playwright cannot drive OS
 * dialogs).
 */

import * as fs from 'fs'
import * as path from 'path'
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { stubDialog } from 'electron-playwright-helpers'
import { test, expect } from '../fixtures'
import { appLogsDir, buildAppEnv, closeAppAndWait, E2E_CHROMIUM_ARGS } from '../fixtures/isolation'
import { TerminalPage } from '../pages/terminal.page'

const PROJECT_ROOT = path.join(__dirname, '..', '..')

const PDF_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'tests',
  'fixtures',
  'documents',
  'hello-world.pdf'
)

/** Every log file under the sandbox logs folder, concatenated. */
function readAllLogs(homeDir: string): string {
  const dir = appLogsDir(homeDir)
  if (!fs.existsSync(dir)) return ''
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf-8'))
    .join('\n')
}

/** Import the PDF fixture from the tree toolbar and select Done. */
async function importAndSelectDone(app: ElectronApplication, window: Page): Promise<void> {
  await stubDialog(app, 'showOpenDialog', { filePaths: [PDF_FIXTURE], canceled: false })
  await window.getByRole('button', { name: 'Import a file' }).click()
  const dialog = window.getByRole('dialog', { name: 'Import document' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Import', exact: true }).click()
  const done = dialog.getByRole('button', { name: 'Done' })
  await expect(done).toBeVisible({ timeout: 45_000 })
  await done.click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test.describe('Guide claims: import and transcription – Organize Import', () => {
  test.use({ testProjectFiles: { 'test.md': '# Test project\n\nSeed file.\n' } })

  test('Done opens a closed terminal, and a plain shell runs the prompt text as a command', async ({
    appWithTestProject: app,
    windowWithTestProject: window
  }) => {
    test.setTimeout(120_000)
    const terminal = new TerminalPage(window)

    await test.step('close the terminal first', async () => {
      await terminal.open()
      await terminal.close()
    })

    await test.step('"Erfana opens the terminal if it is closed."', async () => {
      await importAndSelectDone(app, window)
      await expect(window.getByTestId('terminal-instance')).toBeVisible({ timeout: 15_000 })
    })

    await test.step('"With only a shell running, the shell receives and runs the prompt text as a command."', async () => {
      // The prompt is Markdown and XML-like tags, not shell syntax: the shell
      // tries to run it and reports its own error (zsh: "parse error near ...").
      await expect
        .poll(async () => (await terminal.readScreen()).lines.join(''), { timeout: 20_000 })
        .toContain('Where should this file be placed?')
      await expect
        .poll(async () => (await terminal.readScreen()).lines.join('\n'), { timeout: 20_000 })
        .toMatch(/\b(zsh|bash|sh): /)
    })
  })
})

test.describe('Guide claims: files Erfana keeps', () => {
  test.use({ testProjectFiles: { 'test.md': '# Test project\n\nSeed file.\n' } })

  test('"Logs never record the text of terminal output."', async ({
    windowWithTestProject: window,
    homeDir
  }) => {
    test.setTimeout(90_000)

    await test.step('raise the log level to Trace, the most detailed level', async () => {
      await window.getByRole('button', { name: 'Settings', exact: true }).click()
      await window.getByLabel('Log level').selectOption({ label: 'Trace' })
      await expect(window.getByLabel('Log level')).toHaveValue('trace')
      await window.keyboard.press('Escape')
    })

    // A fresh shell, so its whole start-up is logged at Trace too.
    const terminal = new TerminalPage(window)
    await test.step('restart the terminal', async () => {
      await terminal.open()
      await terminal.restart()
    })

    // The product is computed by the shell, so it appears in the terminal
    // output but never in the typed command.
    const product = String(4321 * 1001)
    await test.step('run a command whose output text is unique', async () => {
      await terminal.sendCommand('echo $((4321*1001))')
      await terminal.waitForOutputLine(product)
    })

    await test.step('the logs describe the terminal but never hold its output text', async () => {
      // The restarted terminal is logged, so logging was live for its output.
      await expect
        .poll(
          () => {
            const logs = readAllLogs(homeDir)
            return logs.includes('[verbose]') && logs.includes('Terminal terminal-2 created')
          },
          { timeout: 15_000 }
        )
        .toBe(true)
      expect(readAllLogs(homeDir)).not.toContain(product)
    })
  })
})

test.describe('Guide claims: files Erfana keeps – project lock', () => {
  test.use({ testProjectFiles: { 'test.md': '# Test project\n\nSeed file.\n' } })

  test('"opening a project that another Erfana window already has open focuses that window"', async ({
    appWithTestProject: appA,
    windowWithTestProject: windowA,
    testProject,
    userDataDir,
    homeDir
  }) => {
    test.setTimeout(120_000)

    // Watch the first window: its focus() call and the renderer's focus event.
    await appA.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const original = win.focus.bind(win)
      const g = globalThis as unknown as { __focusCalls: number }
      g.__focusCalls = 0
      win.focus = () => {
        g.__focusCalls++
        original()
      }
    })
    await windowA.evaluate(() => {
      const w = window as unknown as {
        __lockFocused: string[]
        api: { projectLock: { onFocused: (cb: (p: { projectPath: string }) => void) => void } }
      }
      w.__lockFocused = []
      w.api.projectLock.onFocused((payload) => w.__lockFocused.push(payload.projectPath))
    })

    // A second Erfana instance, as File > New Window starts one.
    const appB = await electron.launch({
      args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, ...E2E_CHROMIUM_ARGS],
      env: buildAppEnv({ homeDir })
    })
    try {
      const windowB = await appB.firstWindow()
      await stubDialog(appB, 'showOpenDialog', { filePaths: [testProject.path], canceled: false })
      const openProject = windowB
        .getByRole('button', { name: 'Open project', exact: true })
        .or(windowB.getByTitle('Open project', { exact: true }))
        .first()
      await expect(openProject).toBeVisible({ timeout: 20_000 })
      await openProject.click()

      // The first window is focused and told why.
      await expect
        .poll(() => appA.evaluate(() => (globalThis as unknown as { __focusCalls: number }).__focusCalls), {
          timeout: 15_000
        })
        .toBeGreaterThan(0)
      await expect
        .poll(() => windowA.evaluate(() => (window as unknown as { __lockFocused: string[] }).__lockFocused.length))
        .toBeGreaterThan(0)

      // The second instance does not open the project itself.
      await expect(openProject).toBeVisible()
      await expect(windowB.getByText('test.md', { exact: true })).toHaveCount(0)
    } finally {
      await closeAppAndWait(appB)
    }
  })
})

test.describe('Guide claims: keyboard shortcuts – window commands', () => {
  test('"Minimize; hide; quit" use the documented shortcuts and menu items', async ({ app, window }) => {
    await expect(window.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({
      timeout: 15_000
    })
    const items = await app.evaluate(({ Menu }) => {
      const found: { role: string; accelerator: string | null; label: string; top: string }[] = []
      for (const top of Menu.getApplicationMenu()?.items ?? []) {
        for (const item of top.submenu?.items ?? []) {
          if (item.role === 'minimize' || item.role === 'hide' || item.role === 'quit') {
            const withDefault = item as unknown as { getDefaultRoleAccelerator?: () => string | undefined }
            found.push({
              role: String(item.role),
              accelerator: (item.accelerator as string | undefined) ?? withDefault.getDefaultRoleAccelerator?.() ?? null,
              label: item.label,
              top: top.label
            })
          }
        }
      }
      return found
    })
    const byRole = (role: string): (typeof items)[number] | undefined => items.find((i) => i.role === role)

    expect(byRole('minimize')?.accelerator).toBe('CommandOrControl+M')
    expect(byRole('minimize')?.top).toBe('Window')
    if (process.platform === 'darwin') {
      expect(byRole('hide')?.accelerator).toBe('Command+H')
      expect(byRole('quit')?.accelerator).toBe('CommandOrControl+Q')
    } else {
      // Windows and Linux: no Hide item; quit is File > Exit with no shortcut.
      expect(byRole('hide')).toBeUndefined()
      expect(byRole('quit')?.top).toBe('File')
    }
  })
})
