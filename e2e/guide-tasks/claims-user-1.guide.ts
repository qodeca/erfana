// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide claims: user-facing ledger entries in docs/user-guide/claims.json that
 * name behaviour only the running app shows (Monaco defaults, OS window
 * roles, the terminal's shell, the image viewer's keys, excluded folders and
 * git status, what export does after it writes the file).
 *
 * Every test drives the real, built app; controls are found by the labels a
 * reader sees. Only the native save dialog is stubbed, because Playwright
 * cannot drive OS dialogs.
 */

import * as fs from 'fs'
import * as path from 'path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { stubDialog } from 'electron-playwright-helpers'

import { test as base, expect } from '../fixtures'
import {
  buildAppEnv,
  closeAppAndWait,
  createWorkerHome,
  removeDirWithRetry,
  E2E_CHROMIUM_ARGS
} from '../fixtures/isolation'
import { KeyboardHelper } from '../pages/keyboard.helper'
import { MonacoPage } from '../pages/monaco.page'
import { ProjectTreePage } from '../pages/project-tree.page'
import { TerminalPage } from '../pages/terminal.page'
import { ImageViewerPage } from '../pages/image-viewer.page'
import { initRepoWithCommit, writeFileTree, isGitAvailable } from '../utils/git-helpers'
import { waitForAppReady, openProject, createTestProject, createTempUserDataDir } from '../utils/helpers'

const PROJECT_ROOT = path.join(__dirname, '..', '..')

/** Open `fileName` from the tree and return a focused Monaco editor on it. */
async function openInEditor(window: Page, fileName: string): Promise<MonacoPage> {
  const monaco = new MonacoPage(window, new KeyboardHelper(window))
  await window.getByText(fileName, { exact: true }).first().click()
  await window.getByTitle('Editor Only', { exact: true }).click()
  await monaco.waitForReady()
  await monaco.focus()
  return monaco
}

// ---------------------------------------------------------------------------
// ED-01 / KEY-14: Monaco's own commands work in Erfana's editor
// ---------------------------------------------------------------------------

base.describe('Claims: Monaco editor commands', () => {
  base.use({ testProjectFiles: { 'monaco.md': 'alpha beta alpha\nsecond line\n' } })

  base('F1 palette, multi-cursor, toggle comment and move line work in the editor', async ({
    windowWithTestProject: window
  }) => {
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    // Start of the document: ⌘↑ on macOS, Ctrl+Home elsewhere.
    const top = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'
    const monaco = await openInEditor(window, 'monaco.md')
    const editor = monaco.getEditor()

    await base.step('F1 opens the command palette and runs a command from it', async () => {
      await window.keyboard.press(top)
      await window.keyboard.press('F1')
      const palette = editor.locator('.quick-input-widget')
      await expect(palette).toBeVisible()
      await window.keyboard.type('Delete Line')
      await palette.getByRole('option', { name: /^Delete Line(,|$)/ }).click()
      await expect(palette).toBeHidden()
      await expect.poll(() => monaco.getContent()).toBe('second line\n')
      await window.keyboard.press(`${mod}+z`)
      await expect.poll(() => monaco.getContent()).toBe('alpha beta alpha\nsecond line\n')
    })

    await base.step('⌘D / Ctrl+D selects the next match into a second cursor', async () => {
      await window.keyboard.press(top)
      await window.keyboard.press(`${mod}+d`)
      await window.keyboard.press(`${mod}+d`)
      await expect(editor.locator('.cursors-layer .cursor')).toHaveCount(2)
      await window.keyboard.insertText('gamma')
      await expect.poll(() => monaco.getContent()).toBe('gamma beta gamma\nsecond line\n')
      await window.keyboard.press('Escape')
    })

    await base.step('Holding ⌥ / Alt while selecting adds a cursor', async () => {
      await window.keyboard.press(top)
      const secondLine = editor.locator('.view-line').filter({ hasText: 'second line' })
      await secondLine.click({ modifiers: ['Alt'], position: { x: 1, y: 5 } })
      await expect(editor.locator('.cursors-layer .cursor')).toHaveCount(2)
      await window.keyboard.insertText('>')
      await expect.poll(() => monaco.getContent()).toBe('>gamma beta gamma\n>second line\n')
      await window.keyboard.press('Escape')
    })

    await base.step('⌘/ / Ctrl+/ toggles a comment', async () => {
      await window.keyboard.press(top)
      await window.keyboard.press(`${mod}+/`)
      await expect.poll(() => monaco.getContent()).toMatch(/^<!-- >gamma beta gamma -->\n/)
      await window.keyboard.press(`${mod}+/`)
      await expect.poll(() => monaco.getContent()).toBe('>gamma beta gamma\n>second line\n')
    })

    await base.step('⌥↑ / Alt+↑ moves the line up', async () => {
      await window.keyboard.press('ArrowDown')
      await window.keyboard.press('Alt+ArrowUp')
      await expect.poll(() => monaco.getContent()).toBe('>second line\n>gamma beta gamma\n')
      await window.keyboard.press('Alt+ArrowDown')
      await expect.poll(() => monaco.getContent()).toBe('>gamma beta gamma\n>second line\n')
    })
  })
})

// ---------------------------------------------------------------------------
// KEY-25: window management keys come from the OS-standard menu roles
// ---------------------------------------------------------------------------

base.describe('Claims: window management', () => {
  base('the app menu carries the standard window roles with their OS-default keys', async ({
    appWithTestProject: app,
    windowWithTestProject: window
  }) => {
    base.skip(process.platform !== 'darwin', 'the macOS keys are checked here; Windows keys come from the same roles')

    const roles = await app.evaluate(({ Menu }) => {
      const out: Record<string, string> = {}
      const walk = (items: Electron.MenuItem[]): void => {
        for (const item of items) {
          if (item.role) {
            const withDefault = item as Electron.MenuItem & { getDefaultRoleAccelerator?: () => string | undefined }
            out[item.role.toLowerCase()] = String(item.accelerator ?? withDefault.getDefaultRoleAccelerator?.() ?? '')
          }
          if (item.submenu) walk(item.submenu.items)
        }
      }
      walk(Menu.getApplicationMenu()?.items ?? [])
      return out
    })
    // ⌘M, ⌘H, ⌘Q and ⌃⌘F are the roles' own (OS-standard) keys; Erfana sets none of them.
    expect(roles.minimize).toBe('CommandOrControl+M')
    expect(roles.hide).toBe('Command+H')
    expect(roles.quit).toBe('CommandOrControl+Q')
    expect(roles.togglefullscreen).toBe('Control+Command+F')

    await expect(window.getByRole('button', { name: /^Terminal\b/ })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// TERM-01: the terminal runs your shell and any CLI program
// ---------------------------------------------------------------------------

base.describe('Claims: built-in terminal', () => {
  base.use({
    testProjectFiles: {
      'agent.js': [
        "const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout })",
        "rl.question('stand-in agent ready> ', (answer) => {",
        "  require('fs').writeFileSync(require('path').join(process.cwd(), 'agent-out.txt'), answer)",
        '  rl.close()',
        '})'
      ].join('\n')
    }
  })

  base('the terminal runs the login shell named by SHELL and an interactive CLI program', async ({
    appWithTestProject: app,
    windowWithTestProject: window,
    testProject
  }) => {
    base.skip(process.platform === 'win32', 'POSIX shell identity check')
    const terminal = new TerminalPage(window)
    await terminal.open()

    const appShell = await app.evaluate(() => process.env.SHELL ?? '')
    expect(appShell).not.toBe('')
    const shellOut = path.join(testProject.path, 'shell.txt')
    await terminal.sendCommand('ps -p $$ -o comm= > shell.txt')
    await expect.poll(() => (fs.existsSync(shellOut) ? fs.readFileSync(shellOut, 'utf8').trim() : '')).not.toBe('')
    const running = path.basename(fs.readFileSync(shellOut, 'utf8').trim().replace(/^-/, ''))
    expect(running).toBe(path.basename(appShell))

    await terminal.waitForPrompt()
    await terminal.sendCommand(`"${process.execPath}" agent.js`)
    await terminal.waitForOutput('stand-in agent ready>')
    await terminal.sendCommand('edit notes please')
    const agentOut = path.join(testProject.path, 'agent-out.txt')
    await expect
      .poll(() => (fs.existsSync(agentOut) ? fs.readFileSync(agentOut, 'utf8') : ''))
      .toBe('edit notes please')
  })
})

// ---------------------------------------------------------------------------
// image viewer: no key enters full screen; Esc only exits it
// ---------------------------------------------------------------------------

base.describe('Claims: image viewer full screen keys', () => {
  base.use({
    testProjectFiles: {
      'picture.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#3a6"/></svg>'
    }
  })

  base('no viewer key enters full screen, and Esc exits it', async ({ windowWithTestProject: window }) => {
    const viewer = new ImageViewerPage(window)
    await viewer.openFromTree('picture.svg')
    const overlay = window.getByRole('dialog', { name: 'Full screen image viewer' })

    // Focus inside the viewer so its keys are live.
    await window.getByRole('button', { name: 'Zoom in' }).focus()
    for (const key of ['f', 'F', '+', '=', '-', '0', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Home']) {
      await window.keyboard.press(key)
    }
    await expect(window.getByRole('button', { name: 'Zoom in' })).toBeFocused()
    await expect(overlay).toHaveCount(0)

    await window.getByRole('button', { name: 'Enter full screen' }).click()
    await expect(overlay).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(overlay).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// TREE-16: files.exclude hides a folder, git status still counts it
// ---------------------------------------------------------------------------

const gitTest = base.extend({
  testProject: async ({ testProject }, use) => {
    initRepoWithCommit(testProject.path, {})
    // Untracked output inside the excluded folder: the only change in the repo.
    writeFileTree(testProject.path, 'scratch/out.log', 'build output\n')
    await use(testProject)
  }
})

gitTest.describe('Claims: excluded folders and git status', () => {
  gitTest.use({
    testProjectFiles: {
      'README.md': '# Readme\n',
      '.erfana/settings.json': JSON.stringify({ files: { exclude: ['scratch'] } })
    }
  })

  gitTest('an excluded folder is not in the tree but git status still counts it', async ({
    windowWithTestProject: window
  }) => {
    gitTest.skip(!isGitAvailable(), 'needs git')
    const tree = new ProjectTreePage(window)
    await tree.waitForFile('README.md')
    // The git status bar under the tree: "U1" is one untracked entry, the excluded folder.
    await expect(window.getByText(/^U\d+$/)).toBeVisible()
    await expect(window.getByText('Clean', { exact: true })).toHaveCount(0)
    await expect(tree.folderRow('scratch')).toHaveCount(0)
    await expect(window.getByText('scratch', { exact: true })).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// export-to-pdf-or-word: Erfana does not open the exported file
// ---------------------------------------------------------------------------

base.describe('Claims: export does not open the file', () => {
  base('exporting to PDF and Word asks the OS to open nothing', async () => {
    base.setTimeout(120_000)
    const { projectPath, cleanup: cleanupProject } = await createTestProject({ 'report.md': '# Report\n\nBody.\n' })
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir('claims-export')
    const homeDir = await createWorkerHome('claims-export-home-')
    const outDir = await fs.promises.mkdtemp(path.join(PROJECT_ROOT, '.e2e-temp', 'claims-export-out-'))
    let app: ElectronApplication | undefined
    try {
      app = await electron.launch({
        args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, ...E2E_CHROMIUM_ARGS],
        env: buildAppEnv({ homeDir })
      })
      const electronApp = app
      const window = await electronApp.firstWindow()
      await waitForAppReady(window)
      await openProject(window, projectPath)
      await window.getByText('report.md', { exact: true }).first().click()
      await window.getByTitle('Preview Only', { exact: true }).click()

      // Record every way the main process could hand a file to the OS.
      await electronApp.evaluate(({ shell }) => {
        const g = globalThis as unknown as { __opened: string[] }
        g.__opened = []
        const s = shell as unknown as Record<string, (...a: unknown[]) => unknown>
        for (const name of ['openPath', 'openExternal', 'showItemInFolder']) {
          s[name] = (...args: unknown[]) => {
            g.__opened.push(`${name}:${String(args[0])}`)
            return name === 'showItemInFolder' ? undefined : Promise.resolve('')
          }
        }
      })

      for (const [label, file, toast] of [
        ['Export to PDF', 'out.pdf', 'PDF exported'],
        ['Export to Word', 'out.docx', 'DOCX exported']
      ] as const) {
        const target = path.join(outDir, file)
        await stubDialog(electronApp, 'showSaveDialog', { filePath: target, canceled: false })
        await window.getByRole('button', { name: label }).click()
        await expect.poll(() => (fs.existsSync(target) ? fs.statSync(target).size : 0), { timeout: 30_000 }).toBeGreaterThan(0)
        await expect(window.getByText(toast, { exact: false }).first()).toBeVisible({ timeout: 15_000 })
      }

      const opened = await electronApp.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)
      expect(opened).toEqual([])
      expect(electronApp.windows()).toHaveLength(1)
    } finally {
      if (app) await closeAppAndWait(app)
      await cleanupProject()
      await cleanupUserData()
      await removeDirWithRetry(homeDir)
      await removeDirWithRetry(outDir)
    }
  })
})
