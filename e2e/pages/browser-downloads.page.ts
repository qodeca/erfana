// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Downloads from a built-in browser tab (spec 025, 025-FR-020; 025-AC-020):
 * the save dialog, the notices main sends, **Show in folder**, and what is
 * left on disk.
 *
 * - **Save dialog.** Stubbed with `stubDialog` (electron-playwright-helpers),
 *   then wrapped so each call's `defaultPath` is recorded – the dialog's start
 *   folder and offered name are part of what the test checks.
 * - **Notices.** `browser-tab:notice` events recorded in Erfana's window.
 * - **Show in folder.** `shell.showItemInFolder` replaced main-side by a
 *   recorder, so no Finder or Explorer window opens.
 * - **Leftovers.** Downloads are received into `erfana-download-*` folders in
 *   the app's temp folder; {@link DownloadsDriver.leftovers} lists every entry
 *   there whose name holds a test's unique token (another worker's downloads
 *   never match).
 *
 * Condition-based waits only.
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { stubDialog } from 'electron-playwright-helpers'

const WAIT_MS = 15_000

export interface DownloadNotice {
  tabId: string | null
  kind: 'downloadDone' | 'downloadFailed'
  text: string
  download: { fileName: string; downloadId: string | null; reason: string | null }
}

interface Recorder {
  __downloadNotices?: DownloadNotice[]
  api: { browserTab: Record<string, (...args: unknown[]) => unknown> }
}

interface MainStore {
  __e2eSaveDialogPaths?: string[]
  __e2eShownInFolder?: string[]
}

export class DownloadsDriver {
  constructor(
    readonly app: ElectronApplication,
    readonly window: Page
  ) {}

  /** Record every download notice the window receives. Idempotent. */
  async recordNotices(): Promise<void> {
    await this.window.evaluate(() => {
      const w = window as unknown as Recorder
      if (w.__downloadNotices) return
      const notices: DownloadNotice[] = []
      w.__downloadNotices = notices
      w.api.browserTab['onNotice']!((e: DownloadNotice) => {
        if (e.kind === 'downloadDone' || e.kind === 'downloadFailed') notices.push(e)
      })
    })
  }

  notices(): Promise<DownloadNotice[]> {
    return this.window.evaluate(() => (window as unknown as Recorder).__downloadNotices ?? [])
  }

  /** Wait for the notice of `kind` that names `fileName`. */
  async waitForNotice(kind: DownloadNotice['kind'], fileName: string): Promise<DownloadNotice> {
    const find = async (): Promise<DownloadNotice | undefined> =>
      (await this.notices()).find((n) => n.kind === kind && n.download.fileName === fileName)
    await expect.poll(async () => (await find()) !== undefined, { timeout: WAIT_MS, message: `a ${kind} notice for ${fileName}` }).toBe(true)
    return (await find())!
  }

  /**
   * The next save dialog answers Cancel (`null`) or Save to `filePath`, and
   * its `defaultPath` is recorded. Call before each expected dialog.
   */
  async answerSaveDialog(filePath: string | null): Promise<void> {
    await stubDialog(this.app, 'showSaveDialog', filePath === null ? { canceled: true, filePath: '' } : { canceled: false, filePath })
    await this.app.evaluate(({ dialog }) => {
      const store = globalThis as MainStore
      store.__e2eSaveDialogPaths ??= []
      const stubbed = dialog.showSaveDialog.bind(dialog)
      dialog.showSaveDialog = ((...args: unknown[]) => {
        const options = (args.length > 1 ? args[1] : args[0]) as { defaultPath?: string }
        store.__e2eSaveDialogPaths!.push(options.defaultPath ?? '')
        return (stubbed as (...a: unknown[]) => unknown)(...args)
      }) as typeof dialog.showSaveDialog
    })
  }

  /** The `defaultPath` of every save dialog opened so far. */
  dialogPaths(): Promise<string[]> {
    return this.app.evaluate(() => (globalThis as MainStore).__e2eSaveDialogPaths ?? [])
  }

  async waitForDialogCount(count: number): Promise<string[]> {
    await expect.poll(async () => (await this.dialogPaths()).length, { timeout: WAIT_MS, message: `${count} save dialog(s)` }).toBe(count)
    return this.dialogPaths()
  }

  /** Replace `shell.showItemInFolder` with a recorder. */
  async recordShowInFolder(): Promise<void> {
    await this.app.evaluate(({ shell }) => {
      const store = globalThis as MainStore
      store.__e2eShownInFolder = []
      shell.showItemInFolder = (p: string) => {
        store.__e2eShownInFolder!.push(p)
      }
    })
  }

  shownInFolder(): Promise<string[]> {
    return this.app.evaluate(() => (globalThis as MainStore).__e2eShownInFolder ?? [])
  }

  /** **Show in folder** for a finished download, as the notice's button calls it. */
  showDownload(downloadId: string): Promise<unknown> {
    return this.window.evaluate((id) => (window as unknown as Recorder).api.browserTab['showDownload']!(id), downloadId)
  }

  /**
   * The OS Downloads folder the app uses. On macOS this is the developer's REAL
   * `~/Downloads` (Electron asks the OS, not `HOME`), so a test compares paths
   * with it and never saves into it or lists it – listing it can stall on a
   * macOS privacy prompt.
   */
  downloadsDir(): Promise<string> {
    return this.app.evaluate(({ app }) => app.getPath('downloads'))
  }

  /** Entries in any download staging folder whose name holds `token` – partial and `.crdownload` files included. */
  async leftovers(token: string): Promise<string[]> {
    const temp = await this.app.evaluate(({ app }) => app.getPath('temp'))
    const found: string[] = []
    for (const dir of await fs.readdir(temp).catch(() => [] as string[])) {
      if (!dir.startsWith('erfana-download-')) continue
      for (const entry of await fs.readdir(path.join(temp, dir)).catch(() => [] as string[])) {
        if (entry.includes(token)) found.push(path.join(dir, entry))
      }
    }
    return found
  }

  /** Wait until no staging entry holds `token`. */
  async waitForNoLeftovers(token: string): Promise<void> {
    await expect.poll(() => this.leftovers(token), { timeout: WAIT_MS, message: `staging files of ${token}` }).toEqual([])
  }
}
