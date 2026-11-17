// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Downloads from browser tabs (spec 025, 025-FR-020; spec change S-18; design
 * `site-prompts.html`, download notice).
 *
 * The session's `will-download` lands in {@link BrowserDownloads.willDownload}:
 *
 * 1. **Staged, not saved.** Electron needs the save path before the handler
 *    returns, and Erfana must ask first, so the file is received into a fresh
 *    private folder under the OS temp folder, named with the sanitised name.
 *    Nothing reaches a folder the user can see until they chose it.
 * 2. **Several files.** The first download of a page load goes ahead. A later
 *    one that the page started without a user action pauses and asks "This
 *    site wants to download several files" (**Allow** / **Block**); the
 *    answer holds for the rest of that page load. Block, or a prompt
 *    withdrawn by navigation or tab close, cancels it.
 * 3. **The save dialog** opens in the OS Downloads folder with the sanitised
 *    name; for a file that can run programs it carries a warning (title and
 *    message, S-18). Cancel cancels the download. A folder inside a `.erfana` folder is
 *    refused (S-18): the agent and the profile live there.
 * 4. **Done.** The staged file is moved to the chosen path (renamed, or
 *    copied across volumes) and a notice names it, with **Show in folder**.
 * 5. **Failed.** An interrupted download, or a move that cannot write the
 *    chosen folder, shows an error notice naming the file and the reason.
 *    The staging folder – the partial file and Chromium's `.crdownload` with
 *    it – is deleted on every outcome, and a half-copied target too.
 *
 * A download belongs to the session, not the tab: it continues when its tab
 * closes, and its notice still goes to the window, with no tab id. File names
 * are never logged.
 */
import { mkdtempSync } from 'node:fs'
import { copyFile, rename, rm, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { NoticeEvent, StripRow } from '../../../../shared/ipc/browser-tab-schema'
import {
  downloadDoneTitle,
  downloadFailedText,
  EXECUTABLE_WARNING_TITLE,
  executableWarningMessage
} from '../../../../shared/browser/downloadNotice'
import { logger } from '../../LoggingService'
import type { TabStrip } from '../permissions/tabStrip'
import { isExecutableDownload, sanitizeDownloadName } from './downloadFileName'

/** The fixed sentence of the several-files prompt (025-FR-020). */
export const SEVERAL_FILES_TEXT = 'This site wants to download several files.'
/** Finished downloads remembered for **Show in folder**, per process. */
export const MAX_REMEMBERED_DOWNLOADS = 100
const STAGING_PREFIX = 'erfana-download-'

export type DownloadFailure = NonNullable<NonNullable<NoticeEvent['download']>['reason']>

/** What the save dialog shows: the start path, and for a file that can run programs a warning. */
export interface SaveDialogRequest {
  readonly defaultPath: string
  readonly title?: string
  readonly message?: string
}

/** The part of Electron's `DownloadItem` used here. */
export interface DownloadItemLike {
  getFilename(): string
  setSavePath(path: string): void
  hasUserGesture(): boolean
  pause(): void
  resume(): void
  cancel(): void
  getState(): 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  once(event: 'done', listener: (event: unknown, state: 'completed' | 'cancelled' | 'interrupted') => void): unknown
  on(event: 'updated', listener: (event: unknown, state: 'progressing' | 'interrupted') => void): unknown
}

/** Downloads counted on the current page load of a tab; reset when a new page commits. */
export interface DownloadLoad {
  started: number
  decision: 'allow' | 'block' | null
}

/** What a download needs of the tab that started it. */
export interface DownloadTab {
  readonly tabId: string
  readonly windowId: number
  readonly strip: TabStrip
  readonly load: DownloadLoad
  isOpen(): boolean
  /** The origin line of the page, for the several-files row. */
  requester(): StripRow['requester'] | undefined
  /** Send a notice to the tab's window – still there after the tab closed. */
  notice(event: NoticeEvent): void
  /** The window a modal save dialog belongs to; `null` once it closed. */
  parentWindow(): unknown
}

export interface BrowserDownloadsDeps {
  /** The OS Downloads folder (`app.getPath('downloads')`). */
  readonly downloadsDir: () => string
  /** Where private staging folders are made (the OS temp folder). */
  readonly stagingRoot: () => string
  /** The OS save dialog; the chosen path, or `null` when cancelled. */
  readonly showSaveDialog: (parent: unknown, request: SaveDialogRequest) => Promise<string | null>
  readonly showItemInFolder: (path: string) => void
  readonly newId?: () => string
}

type DoneState = 'completed' | 'cancelled' | 'interrupted'

/** The save dialog for `name` at `defaultPath`; a file that can run programs gets the warning (S-18). */
export function saveDialogRequest(defaultPath: string, name: string): SaveDialogRequest {
  if (!isExecutableDownload(name)) return { defaultPath }
  return { defaultPath, title: EXECUTABLE_WARNING_TITLE, message: executableWarningMessage(name) }
}

/** Whether `path` lies inside a folder named `.erfana` (any case). */
export function isInsideErfanaFolder(path: string): boolean {
  const parts = path.split(/[/\\]/).slice(0, -1)
  return parts.some((part) => part.toLowerCase() === '.erfana')
}

/** The failure an error from moving the file stands for. */
export function failureOf(error: unknown): DownloadFailure {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'diskFull'
  return 'folderNotWritable'
}

/**
 * How `item` ends. Electron fires `done` only in a terminal state: a download
 * the network interrupted but Chromium could resume (a dropped connection)
 * only reports `updated` with `interrupted`, and would stay paused with its
 * partial file for ever. Such a download is cancelled here and counts as
 * interrupted (025-FR-020: an interrupted download shows an error and loses
 * its partial file).
 */
function endOf(item: DownloadItemLike): Promise<DoneState> {
  return new Promise((resolve) => {
    let interrupted = false
    item.on('updated', (_event, state) => {
      if (state !== 'interrupted' || interrupted) return
      interrupted = true
      item.cancel()
    })
    item.once('done', (_event, state) => resolve(interrupted ? 'interrupted' : state))
  })
}

export class BrowserDownloads {
  private readonly finished = new Map<string, { windowId: number; path: string }>()

  constructor(private readonly deps: BrowserDownloadsDeps) {}

  /** The session's `will-download`; `tab` is `null` when no browser tab started it (it is cancelled). */
  willDownload(event: { preventDefault(): void }, item: DownloadItemLike, tab: DownloadTab | null): void {
    if (tab === null) {
      event.preventDefault()
      logger.warn('Cancelled a download that no browser tab started')
      return
    }
    const name = sanitizeDownloadName(item.getFilename())
    let staging: string
    try {
      staging = mkdtempSync(join(this.deps.stagingRoot(), STAGING_PREFIX))
    } catch (error) {
      event.preventDefault()
      logger.warn('Download staging folder could not be made', { error: String((error as Error).message) })
      this.notifyFailed(tab, name, 'interrupted')
      return
    }
    item.setSavePath(join(staging, name))
    const done = endOf(item)
    void this.run(item, tab, name, staging, done).catch((error: unknown) => {
      logger.error('A browser download failed unexpectedly', error instanceof Error ? error : undefined)
    })
  }

  /** **Show in folder** for a finished download, from the window it was announced to. */
  showInFolder(windowId: number, downloadId: string): boolean {
    const entry = this.finished.get(downloadId)
    if (entry === undefined || entry.windowId !== windowId) {
      logger.warn('Refused Show in folder for an unknown download')
      return false
    }
    this.deps.showItemInFolder(entry.path)
    return true
  }

  private async run(item: DownloadItemLike, tab: DownloadTab, name: string, staging: string, done: Promise<DoneState>): Promise<void> {
    try {
      const allowed = await this.allowedOnThisLoad(item, tab)
      const target = allowed ? await this.askTarget(tab, name) : null
      if (target === null || target === 'refused') {
        if (item.getState() === 'progressing') item.cancel()
        await done
        if (target === 'refused') this.notifyFailed(tab, name, 'refusedFolder')
        return
      }
      const state = await done
      if (state !== 'completed') {
        if (state === 'interrupted') this.notifyFailed(tab, basename(target), 'interrupted')
        return
      }
      await this.moveInto(join(staging, name), target, tab)
    } finally {
      await rm(staging, { recursive: true, force: true }).catch((error: unknown) => {
        logger.warn('Download staging folder could not be deleted', { error: String((error as Error).message) })
      })
    }
  }

  /** The several-files rule: true when this download may go ahead. */
  private allowedOnThisLoad(item: DownloadItemLike, tab: DownloadTab): Promise<boolean> {
    const load = tab.load
    load.started += 1
    if (load.started === 1 || item.hasUserGesture() || load.decision === 'allow') return Promise.resolve(true)
    if (load.decision === 'block') return Promise.resolve(false)
    item.pause()
    return new Promise((resolve) => {
      const spec = { kind: 'download' as const, text: SEVERAL_FILES_TEXT, answers: ['block' as const, 'allow' as const] }
      const requester = tab.requester()
      tab.strip.ask(requester === undefined ? spec : { ...spec, requester }, (outcome) => {
        const allow = 'answer' in outcome && outcome.answer === 'allow'
        if ('answer' in outcome) load.decision = allow ? 'allow' : 'block'
        if (allow) item.resume()
        resolve(allow)
      })
    })
  }

  private async askTarget(tab: DownloadTab, name: string): Promise<string | 'refused' | null> {
    let chosen: string | null
    try {
      chosen = await this.deps.showSaveDialog(tab.parentWindow(), saveDialogRequest(this.defaultSavePath(name), name))
    } catch (error) {
      logger.warn('The download save dialog failed', { error: String((error as Error).message) })
      return null
    }
    if (chosen === null || chosen === '') return null
    return isInsideErfanaFolder(chosen) ? 'refused' : chosen
  }

  /**
   * Where the save dialog opens: the OS Downloads folder, or the bare name
   * when the OS cannot name that folder (Windows throws "Failed to get
   * 'downloads' path" when it was removed or redirected). The dialog still
   * opens then, in the OS default folder, so the user can choose – the
   * download is never dropped silently.
   */
  private defaultSavePath(name: string): string {
    try {
      return join(this.deps.downloadsDir(), name)
    } catch (error) {
      logger.warn('The Downloads folder could not be found; the save dialog opens without it', {
        error: String((error as Error).message)
      })
      return name
    }
  }

  private async moveInto(staged: string, target: string, tab: DownloadTab): Promise<void> {
    try {
      await rename(staged, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        this.notifyFailed(tab, basename(target), failureOf(error))
        return
      }
      try {
        await copyFile(staged, target)
      } catch (copyError) {
        await unlink(target).catch(() => undefined)
        this.notifyFailed(tab, basename(target), failureOf(copyError))
        return
      }
    }
    this.notifyDone(tab, target)
  }

  private notifyDone(tab: DownloadTab, target: string): void {
    const downloadId = (this.deps.newId ?? (() => randomUUID().replaceAll('-', '')))()
    this.finished.set(downloadId, { windowId: tab.windowId, path: target })
    while (this.finished.size > MAX_REMEMBERED_DOWNLOADS) {
      this.finished.delete(this.finished.keys().next().value as string)
    }
    const fileName = basename(target)
    tab.notice({
      tabId: tab.isOpen() ? tab.tabId : null,
      kind: 'downloadDone',
      text: downloadDoneTitle(fileName),
      download: { fileName, downloadId, reason: null }
    })
  }

  private notifyFailed(tab: DownloadTab, fileName: string, reason: DownloadFailure): void {
    logger.warn('A browser download failed', { reason })
    tab.notice({
      tabId: tab.isOpen() ? tab.tabId : null,
      kind: 'downloadFailed',
      text: downloadFailedText(fileName, reason),
      download: { fileName, downloadId: null, reason }
    })
  }
}

