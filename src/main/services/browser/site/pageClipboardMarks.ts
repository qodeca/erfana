// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which clipboard text a browser page wrote (spec 025, 025-FR-009 paste
 * guard, spec change S-17; solution design § 3.5 "clipboard writes recorded
 * for S-17", § 9.2).
 *
 * A page can put text on the clipboard without the user seeing it: the async
 * clipboard API, `document.execCommand('copy')`, or a `copy` listener that
 * swaps what the user selected. Chromium raises no event for any of these, so
 * this module watches the clipboard around the only moments a page can write
 * to it – while it holds keyboard focus (both the async API and the copy
 * commands need a focused document), and right after a **Copy** from the page
 * menu:
 *
 * - when a page gains focus, or Erfana's window regains OS focus while a page
 *   holds it, the clipboard's digest is the **baseline**;
 * - when that page loses focus, or the window loses OS focus, a clipboard
 *   that differs from the baseline was written by the page – its digest is
 *   **marked**;
 * - {@link PageClipboardMarks.expectWrite} (the page menu's Copy, which runs
 *   while the page is not focused) marks the next change seen within
 *   {@link EXPECT_WRITE_MS}.
 *
 * The renderer asks {@link PageClipboardMarks.isPageWritten} before it types
 * clipboard text with a line break or a control character into the terminal.
 * Only SHA-256 digests of the text are held, in memory, for the last
 * {@link MAX_MARKS} writes; the text itself is never kept or logged
 * (025-FR-064). A false "page-written" only costs a confirmation; a write
 * missed would type unasked, so every doubt resolves to "marked".
 */
import { createHash } from 'node:crypto'
import type { Clock } from '../../../../shared/clock'

/** How long after a page-menu Copy a clipboard change still counts as the page's. */
export const EXPECT_WRITE_MS = 2000
/** Digests of page-written text kept; older ones are forgotten. */
export const MAX_MARKS = 16

/** The clipboard as this module reads it (Electron's `clipboard`, whose `readText` is async). */
export interface ClipboardTextReader {
  readText(): Promise<string> | string
}

function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Every operation reads the clipboard, which is async, so operations run one
 * after another in the order the events came: a blur's comparison always
 * sees the baseline its focus took.
 */
export class PageClipboardMarks {
  private readonly focusedPages = new Set<string>()
  private baseline: string | null = null
  private expected: { readonly base: string; readonly until: number } | null = null
  private readonly marks: string[] = []
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly clipboard: ClipboardTextReader,
    private readonly clock: Pick<Clock, 'now'>
  ) {}

  /** A browser page (tab id or popup key) gained (`true`) or lost keyboard focus. */
  pageFocus(pageKey: string, focused: boolean): Promise<void> {
    if (focused) {
      this.focusedPages.add(pageKey)
      return this.run(async () => {
        this.baseline = await this.current()
      })
    }
    if (!this.focusedPages.delete(pageKey)) return this.queue.then(() => undefined)
    return this.run(() => this.compare())
  }

  /** Erfana's window gained (`true`) or lost OS focus; only matters while a page holds keyboard focus. */
  windowFocus(focused: boolean): Promise<void> {
    if (this.focusedPages.size === 0) return this.queue.then(() => undefined)
    return this.run(async () => {
      if (focused) this.baseline = await this.current()
      else await this.compare()
    })
  }

  /** A page-menu **Copy** is about to run: the next clipboard change, within {@link EXPECT_WRITE_MS}, is the page's. */
  expectWrite(): Promise<void> {
    const until = this.clock.now() + EXPECT_WRITE_MS
    return this.run(async () => {
      this.expected = { base: await this.current(), until }
    })
  }

  /** Whether the text now on the clipboard was written by a browser page. */
  isPageWritten(): Promise<boolean> {
    return this.run(async () => {
      if (this.focusedPages.size > 0) await this.compare()
      const now = await this.current()
      this.settleExpected(now)
      return this.marks.includes(now)
    })
  }

  private run<T>(op: () => Promise<T>): Promise<T> {
    const result = this.queue.then(op)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async compare(): Promise<void> {
    const now = await this.current()
    if (this.baseline !== null && now !== this.baseline) this.mark(now)
    this.baseline = now
    this.settleExpected(now)
  }

  private settleExpected(now: string): void {
    const expected = this.expected
    if (expected === null) return
    if (now !== expected.base) {
      this.mark(now)
      this.expected = null
    } else if (this.clock.now() > expected.until) {
      this.expected = null
    }
  }

  private mark(value: string): void {
    if (this.marks.includes(value)) return
    this.marks.push(value)
    if (this.marks.length > MAX_MARKS) this.marks.shift()
  }

  private async current(): Promise<string> {
    let text: string
    try {
      text = await this.clipboard.readText()
    } catch {
      text = ''
    }
    return digest(text)
  }
}

type Listener = (...args: never[]) => void

/** A `webContents` as {@link watchPageClipboard} uses it. */
export interface WatchedContents {
  readonly id: number
  on(event: 'focus' | 'blur' | 'destroyed', listener: () => void): unknown
}

/** Electron's `app`, as {@link watchPageClipboard} uses it. */
export interface WatchedApp {
  on(event: 'web-contents-created', listener: (event: unknown, contents: WatchedContents) => void): unknown
  on(event: 'browser-window-focus', listener: Listener): unknown
  on(event: 'browser-window-blur', listener: Listener): unknown
}

/**
 * Feed `marks` from the app: focus and blur of every browser page – tabs,
 * page-opened tabs and popups alike, told apart from Erfana's own windows by
 * `isPage` at the moment of the event (a view registers after it is created)
 * – and the OS focus of Erfana's windows.
 *
 * @param app - Electron's `app`
 * @param marks - The process's {@link PageClipboardMarks}
 * @param isPage - Whether `contents` is a registered browser page view
 */
export function watchPageClipboard(
  app: WatchedApp,
  marks: PageClipboardMarks,
  isPage: (contents: WatchedContents) => boolean
): void {
  app.on('web-contents-created', (_event, contents) => {
    const key = `contents-${contents.id}`
    contents.on('focus', () => {
      if (isPage(contents)) void marks.pageFocus(key, true)
    })
    // Not re-checked: a page destroyed while focused is still the page that held focus.
    contents.on('blur', () => void marks.pageFocus(key, false))
    contents.on('destroyed', () => void marks.pageFocus(key, false))
  })
  app.on('browser-window-focus', () => void marks.windowFocus(true))
  app.on('browser-window-blur', () => void marks.windowFocus(false))
}
