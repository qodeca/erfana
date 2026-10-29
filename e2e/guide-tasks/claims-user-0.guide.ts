// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Claim proofs: user-facing documentation claims checked in the real app.
 *
 * Each test proves one ledger entry in docs/user-guide/claims.json (the entry
 * id is in the test title). Controls are found by their user-visible labels;
 * the only stub is the native file picker, which Playwright cannot drive.
 */

import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { stubDialog } from 'electron-playwright-helpers'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCANNED_PDF = path.join(REPO_ROOT, 'tests', 'fixtures', 'documents', 'scanned-page.pdf')

/** A project-tree row, by the file or folder name the user sees. */
function treeRow(window: Page, name: string): Locator {
  return window.getByRole('treeitem').filter({ has: window.getByText(name, { exact: true }) })
}

/** Path of the focused element, relative to the project, with `/` separators. */
async function focusedRel(window: Page, projectPath: string): Promise<string | null> {
  const abs = await window.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.path ?? null)
  if (abs === null) return null
  return abs.slice(projectPath.length).replace(/\\/g, '/').replace(/^\//, '')
}

test.describe('Claims: user docs (batch 0)', () => {
  test('getting-started/02 – Electron 44.9.3 bundles Node.js 24.22.0', async ({ app }) => {
    const versions = await app.evaluate(() => ({
      node: process.versions.node,
      electron: process.versions.electron
    }))
    expect(versions).toEqual({ node: '24.22.0', electron: '44.9.3' })
  })

  test('keyboard-shortcuts/67 – in a packaged build the helper binds no F12 and blocks Cmd/Ctrl+R', async ({
    app,
    window
  }) => {
    type KeyRecord = { code: string; prevented: boolean; devToolsOpen?: boolean }
    type Probe = { wc: Electron.WebContents; keys: KeyRecord[] }
    // Record, per key press on the app window, whether a listener prevented it and
    // whether DevTools was open once every listener had run. The prepended listener
    // wraps preventDefault before the helper's own listener sees the event.
    await app.evaluate(({ BrowserWindow }, url) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url)
      if (!win) throw new Error('app window not found')
      const wc = win.webContents
      const probe: Probe = { wc, keys: [] }
      ;(globalThis as unknown as { __claimProbe: Probe }).__claimProbe = probe
      wc.prependListener('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return
        const record: KeyRecord = { code: input.code, prevented: false }
        const original = event.preventDefault.bind(event)
        event.preventDefault = () => {
          record.prevented = true
          original()
        }
        probe.keys.push(record)
      })
      wc.on('before-input-event', (_event, input) => {
        if (input.type !== 'keyDown') return
        const last = probe.keys[probe.keys.length - 1]
        if (last) last.devToolsOpen = wc.isDevToolsOpened()
      })
    }, window.url())
    // Native key input, the way a real key press reaches the window (Playwright's
    // own key events bypass `before-input-event`).
    const press = (keyCode: string, withCommand = false): Promise<void> =>
      app.evaluate(
        (_electron, { keyCode, withCommand }) => {
          const { wc } = (globalThis as unknown as { __claimProbe: Probe }).__claimProbe
          const modifiers: Array<'meta' | 'control'> = withCommand
            ? [process.platform === 'darwin' ? 'meta' : 'control']
            : []
          wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
          wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
        },
        { keyCode, withCommand }
      )
    const keys = (): Promise<KeyRecord[]> =>
      app.evaluate(() => (globalThis as unknown as { __claimProbe: Probe }).__claimProbe.keys)
    const lastFor = async (code: string): Promise<KeyRecord | undefined> =>
      (await keys()).filter((k) => k.code === code).pop()
    const devToolsOpen = (): Promise<boolean> =>
      app.evaluate(() => (globalThis as unknown as { __claimProbe: Probe }).__claimProbe.wc.isDevToolsOpened())

    // Control: this e2e run is unpackaged, so the helper is in its development
    // branch and F12 toggles DevTools. This proves the helper is attached.
    expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(false)
    await press('F12')
    await expect.poll(devToolsOpen).toBe(true)
    await press('F12')
    await expect.poll(devToolsOpen).toBe(false)

    // Switch the same helper to its packaged branch. `is.dev` is `!app.isPackaged`,
    // read by the helper on every key press.
    await app.evaluate(() => {
      // The instance the app loaded, from the module cache (not a fresh copy).
      const main = (process as unknown as { mainModule: NodeJS.Module }).mainModule
      const cache = (main.constructor as unknown as { _cache: Record<string, NodeJS.Module> })._cache
      const key = Object.keys(cache).find((k) => /@electron-toolkit[\\/]utils[\\/]/.test(k))
      if (!key) throw new Error('@electron-toolkit/utils is not loaded')
      ;(cache[key].exports as { is: { dev: boolean } }).is.dev = false
    })
    await window.evaluate(() => {
      ;(window as unknown as { __claimMarker: number }).__claimMarker = 1
    })
    const before = (await keys()).length

    // Packaged: F12 is not bound – the key arrives, nothing prevents it, DevTools stays closed.
    await press('F12')
    await expect.poll(async () => (await keys()).length).toBeGreaterThan(before)
    const f12 = await lastFor('F12')
    expect(f12?.prevented).toBe(false)
    expect(f12?.devToolsOpen).toBe(false)

    // Packaged: Cmd/Ctrl+R is blocked – prevented, and the page does not reload.
    await press('R', true)
    await expect.poll(async () => (await lastFor('KeyR'))?.prevented).toBe(true)
    expect(await devToolsOpen()).toBe(false)
    expect(await window.evaluate(() => (window as unknown as { __claimMarker?: number }).__claimMarker)).toBe(1)
  })

  test.describe('dialogs', () => {
    test.use({ testProjectFiles: { 'README.md': '# Readme\n' } })

    test('keyboard-shortcuts/73 – Enter on a focused Cancel button cancels', async ({
      windowWithTestProject: window,
      testProject
    }) => {
      const before = fs.readdirSync(testProject.path).sort()
      await window.getByRole('button', { name: 'Create new markdown file' }).click()
      const dialog = window.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await dialog.getByRole('textbox').fill('should-not-exist.md')

      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
      await cancel.focus()
      await expect(cancel).toBeFocused()
      await window.keyboard.press('Enter')

      await expect(dialog).toHaveCount(0, { timeout: 10_000 })
      expect(fs.readdirSync(testProject.path).sort()).toEqual(before)
      await expect(treeRow(window, 'should-not-exist.md')).toHaveCount(0)
    })
  })

  test.describe('project tree', () => {
    test.use({
      testProjectFiles: {
        'notes.md': '# Notes\n\nOriginal.\n',
        'README.md': '# Readme\n',
        'docs/guide.md': '# Guide\n'
      }
    })

    test('readme/14 – live git status, drag-and-drop file management and keyboard navigation', async ({
      app,
      window,
      testProject
    }) => {
      test.setTimeout(90_000)
      const cwd = testProject.path
      const git = (...args: string[]): void => {
        execFileSync('git', args, { cwd, stdio: 'ignore' })
      }
      git('init', '--initial-branch=main')
      git('config', 'user.email', 'e2e@erfana.local')
      git('config', 'user.name', 'Erfana E2E')
      git('config', 'commit.gpgsign', 'false')
      git('add', '.')
      git('commit', '-m', 'baseline')

      await stubDialog(app, 'showOpenDialog', { filePaths: [cwd], canceled: false })
      await window.getByRole('button', { name: 'Open project', exact: true }).first().click()
      const notesRow = treeRow(window, 'notes.md')
      await expect(notesRow).toBeVisible({ timeout: 15_000 })
      await expect(notesRow.getByRole('img', { name: 'Modified' })).toHaveCount(0)

      // Live git status: an edit made outside the app shows as Modified, no refresh.
      fs.writeFileSync(path.join(cwd, 'notes.md'), '# Notes\n\nEdited outside Erfana.\n')
      await expect(notesRow.getByRole('img', { name: 'Modified' })).toBeVisible({ timeout: 15_000 })

      // Keyboard navigation: one Tab stop into the tree, arrows move, Enter opens.
      const tree = window.getByRole('tree')
      await tree.locator('[role="treeitem"][tabindex="0"]').focus()
      expect(await focusedRel(window, cwd)).toBe('')
      await window.keyboard.press('ArrowDown')
      expect(await focusedRel(window, cwd)).toBe('docs')
      await window.keyboard.press('End')
      expect(await focusedRel(window, cwd)).toBe('README.md')
      await window.keyboard.press('ArrowUp')
      expect(await focusedRel(window, cwd)).toBe('notes.md')
      await window.keyboard.press('Enter')
      await expect(window.getByRole('button', { name: 'Close notes.md' })).toBeVisible({ timeout: 10_000 })

      // Drag-and-drop: dragging a file onto a folder moves it on disk.
      const source = treeRow(window, 'README.md')
      const target = treeRow(window, 'docs')
      const from = await source.boundingBox()
      const to = await target.boundingBox()
      if (!from || !to) throw new Error('drag source or target is not visible')
      await window.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await window.mouse.down()
      await window.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 4 })
      await window.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
      await expect(target).toHaveAttribute('data-drop-target', 'true')
      await window.mouse.up()
      await expect.poll(() => fs.existsSync(path.join(cwd, 'docs', 'README.md')), { timeout: 10_000 }).toBe(true)
      expect(fs.existsSync(path.join(cwd, 'README.md'))).toBe(false)
    })
  })

  test.describe('import', () => {
    test.use({ testProjectFiles: { 'test.md': '# Test\n' } })

    test('readme/15 – import 50+ formats with local OCR (LiteParse)', async ({
      appWithTestProject: app,
      windowWithTestProject: window,
      testProject
    }) => {
      test.setTimeout(120_000)
      const importButton = window.getByRole('button', { name: 'Import a file' })
      await expect(importButton).toBeVisible({ timeout: 10_000 })

      // 50+: record the filters the native picker is opened with, then cancel it.
      await app.evaluate(({ dialog }) => {
        const g = globalThis as unknown as { __claimFilters?: unknown }
        dialog.showOpenDialog = (async (...args: unknown[]) => {
          const options = (args.length > 1 ? args[1] : args[0]) as { filters?: unknown }
          g.__claimFilters = options.filters
          return { canceled: true, filePaths: [] }
        }) as typeof dialog.showOpenDialog
      })
      await importButton.click()
      await expect
        .poll(() => app.evaluate(() => (globalThis as unknown as { __claimFilters?: unknown }).__claimFilters !== undefined))
        .toBe(true)
      const filters = (await app.evaluate(
        () => (globalThis as unknown as { __claimFilters: Array<{ name: string; extensions: string[] }> }).__claimFilters
      ))
      const importable = filters.find((f) => f.name === 'All Importable Files')
      expect(importable).toBeDefined()
      expect(new Set(importable?.extensions).size).toBeGreaterThanOrEqual(50)

      // Local OCR: a scanned PDF with no text layer imports to its recognised text.
      await stubDialog(app, 'showOpenDialog', { filePaths: [SCANNED_PDF], canceled: false })
      await importButton.click()
      const dialog = window.getByRole('dialog', { name: 'Import document' })
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await expect(dialog.getByLabel('Enable OCR text recognition')).toBeChecked()
      await dialog.getByRole('button', { name: 'Import', exact: true }).click()
      await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 90_000 })
      const outPath = path.join(testProject.path, 'import', 'scanned-page.md')
      await expect.poll(() => fs.existsSync(outPath), { timeout: 10_000 }).toBe(true)
      expect(fs.readFileSync(outPath, 'utf-8')).toMatch(/hello\s+world/i)
    })
  })
})
