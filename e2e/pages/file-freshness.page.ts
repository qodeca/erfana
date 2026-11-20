// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * File freshness Page Object Model (#478): what a tab shows of its file on
 * disk, the notices that say it no longer follows it, the main-process
 * freshness test hook, and a recorder of WHEN a version first showed.
 *
 * - Content: an editor tab's text is found by a unique marker anywhere in its
 *   `editor-content` (preview pane or Monaco), so a test names the version it
 *   expects, never the view mode.
 * - Hook: `__erfanaTestHooks.freshness` in main (`src/main/testHooks/freshnessHook.ts`),
 *   reached through `app.evaluate`; an app built without hooks fails loudly.
 * - Recorder: a page `MutationObserver` that stamps `Date.now()` the moment an
 *   armed marker appears in the page text or in an image (a `data-version`
 *   attribute, or the `data-marker` inside an SVG `data:` URL). Main, the test
 *   and the page share one wall clock, so `seenAt - t0` is the delay a user
 *   sees.
 *
 * @see e2e/file-freshness-gaps.e2e.ts
 * @see e2e/file-freshness-latency.timing.e2e.ts
 */
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'
import { TabBarPage } from './tab-bar.page'
import { TerminalPage } from './terminal.page'

/** `__erfanaTestHooks.freshness.watchStats()`. */
export interface FreshnessWatchStats {
  /** Watched files, whoever follows them (tabs and main's own owners: comment watches, the HTML preview). */
  totalWatched: number
  subscriptions: number
  paused: number
  /** Files an editor or image tab follows. */
  tabWatches: number
  /** Tab subscriptions attached to a file – what a reload leak grows. */
  tabSubscriptions: number
}

/** The page-side recorder's state. */
interface SeenRecorder {
  armed: Set<string>
  seen: Record<string, number>
  scan: () => void
}

declare global {
  interface Window {
    __erfanaFreshnessSeen?: SeenRecorder
    __erfanaAppearances?: Record<string, number>
  }
}

/**
 * `FRESHNESS_NOTICE_TEST_IDS` of `freshnessNoticeCopy.ts` (#478 § 3.6), copied:
 * that module sits in the renderer's component tree, which the e2e TypeScript
 * project does not compile. The stopped ids are the ones the old
 * "auto-refresh stopped" notice used, kept so these locators still hold.
 */
const NOTICE_IDS = {
  stopped: 'file-watch-stopped-notice',
  reload: 'file-watch-stopped-btn-reload',
  deleted: 'freshness-notice-deleted',
  unavailable: 'freshness-notice-unavailable',
  queued: 'freshness-notice-queued',
  status: 'freshness-status-region',
  restore: 'freshness-notice-btn-restore',
  close: 'freshness-notice-btn-close'
} as const

/** Default budget for one hook round trip or one UI condition. */
const STEP_TIMEOUT_MS = 15_000
/** Terminal link: the shell echo plus the link provider's IPC check. */
const LINK_TIMEOUT_MS = 30_000
/**
 * Rows above the cursor tried for the printed path. Git Bash's prompt wraps to
 * four or more rows in the narrow terminal panel, and a long path to three, so
 * the path's rows can sit well above the cursor.
 */
const TERMINAL_ROWS_TRIED = 10
/** A column inside the printed path (it starts at column 0). */
const LINK_COLUMN = 4

export class FileFreshnessPage {
  constructor(
    private readonly page: Page,
    private readonly app: ElectronApplication
  ) {}

  // ---------------------------------------------------------------------------
  // What a tab shows
  // ---------------------------------------------------------------------------

  /** Every editor tab body whose text contains `marker` (shown or hidden tab). */
  contentWith(marker: string): Locator {
    return byTestId(this.page, TEST_IDS.EDITOR_CONTENT).filter({ hasText: marker })
  }

  /**
   * Waits until an editor tab shows `marker`. `message` names the gap the
   * caller is checking, so a gap test can pin it.
   */
  async waitForContent(marker: string, timeout = STEP_TIMEOUT_MS, message?: string): Promise<void> {
    await expect(this.contentWith(marker).first(), message ?? `no editor tab shows "${marker}"`).toBeAttached({
      timeout
    })
  }

  // ---------------------------------------------------------------------------
  // Notices
  // ---------------------------------------------------------------------------

  /** "Auto-refresh stopped" (the freshness notice's stopped entry). */
  watchStoppedNotice(): Locator {
    return byTestId(this.page, NOTICE_IDS.stopped)
  }

  /** Its Reload button. */
  watchStoppedReload(): Locator {
    return byTestId(this.page, NOTICE_IDS.reload)
  }

  /** The watch-limit notice of a tab waiting for a watch slot (G9). */
  watchQueuedNotice(): Locator {
    return byTestId(this.page, NOTICE_IDS.queued)
  }

  /** The editor's deleted notice ("… was deleted, renamed or moved on disk."). */
  deletedNotice(): Locator {
    return byTestId(this.page, NOTICE_IDS.deleted)
  }

  /** The notice of a tab that cannot show its file now (too large, binary, encoding, unreadable – C1, L2). */
  unavailableNotice(): Locator {
    return byTestId(this.page, NOTICE_IDS.unavailable)
  }

  /** Every panel's always-mounted `role="status"` region (one per editor or image panel – F13). */
  statusRegions(): Locator {
    return byTestId(this.page, NOTICE_IDS.status)
  }

  /** The deleted notice's Restore file button (F14). */
  restoreFileButton(): Locator {
    return byTestId(this.page, NOTICE_IDS.restore)
  }

  /** The deleted notice's Close tab button (F14). */
  closeTabButton(): Locator {
    return byTestId(this.page, NOTICE_IDS.close)
  }

  /** The conflict bar ("changed on disk"). */
  conflictNotice(): Locator {
    return byTestId(this.page, TEST_IDS.FILE_CONFLICT_NOTIFICATION)
  }

  /** The deleted mark on an editor tab, by the file name the tab shows. */
  deletedTabMark(fileName: string): Locator {
    return new TabBarPage(this.page).tab(fileName).locator('.editor-tab-deleted')
  }

  /**
   * Starts counting how many times an element with each test id is inserted
   * into the page (a reload removes the counter). Lets a test prove a notice
   * or indicator never showed (N1), or showed once (N4), without sampling it.
   */
  async countAppearances(testIds: readonly string[]): Promise<void> {
    await this.page.evaluate((ids) => {
      const counts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]))
      const selectorOf = (id: string): string => `[data-testid="${id}"]`
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (!(node instanceof Element)) continue
            for (const id of ids) {
              if (node.matches(selectorOf(id))) counts[id]++
              counts[id] += node.querySelectorAll(selectorOf(id)).length
            }
          }
        }
      }).observe(document.body, { subtree: true, childList: true })
      window.__erfanaAppearances = counts
    }, testIds)
  }

  /** How many times an element with `testId` was inserted since {@link countAppearances}. */
  async appearances(testId: string): Promise<number> {
    return this.page.evaluate((id) => {
      const counts = window.__erfanaAppearances
      if (!counts || !(id in counts)) throw new Error(`countAppearances([${id}]) first`)
      return counts[id]
    }, testId)
  }

  /** Fires the window `focus` event the renderer's freshness check listens to (S1, N2). */
  async signalWindowFocus(): Promise<void> {
    await this.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  }

  // ---------------------------------------------------------------------------
  // Main-process freshness hook
  // ---------------------------------------------------------------------------

  private async hook<T>(name: string, ...args: unknown[]): Promise<T> {
    return (await this.app.evaluate(
      async (_electron, [fnName, fnArgs]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the hooks live on main's globalThis, untyped there
        const hooks = (globalThis as any).__erfanaTestHooks
        if (!hooks?.freshness) throw new Error('Freshness test hook is not installed (build with npm run build:e2e)')
        return hooks.freshness[fnName as string](...(fnArgs as unknown[]))
      },
      [name, args] as const
    )) as T
  }

  watchStats(): Promise<FreshnessWatchStats> {
    return this.hook('watchStats')
  }

  setWatchLimit(limit: number): Promise<number> {
    return this.hook('setWatchLimit', limit)
  }

  failNextSubscribe(code: string): Promise<void> {
    return this.hook('failNextSubscribe', code)
  }

  pendingSubscribeFailure(): Promise<string | null> {
    return this.hook('pendingSubscribeFailure')
  }

  muteWatchEvents(on: boolean): Promise<void> {
    return this.hook('muteWatchEvents', on)
  }

  killWatchesSilently(): Promise<number> {
    return this.hook('killWatchesSilently')
  }

  simulateResume(): Promise<void> {
    return this.hook('simulateResume')
  }

  holdNextWrite(): Promise<void> {
    return this.hook('holdNextWrite')
  }

  writeHeld(): Promise<boolean> {
    return this.hook('writeHeld')
  }

  releaseWrite(): Promise<void> {
    return this.hook('releaseWrite')
  }

  /** Waits until main holds a write that `holdNextWrite` armed. */
  async waitForHeldWrite(timeout = STEP_TIMEOUT_MS): Promise<void> {
    await expect.poll(() => this.writeHeld(), { timeout, message: 'no save reached the held write' }).toBe(true)
  }

  // ---------------------------------------------------------------------------
  // When a version first showed
  // ---------------------------------------------------------------------------

  /** Installs the recorder (idempotent; a page reload removes it). */
  async installSeenRecorder(): Promise<void> {
    await this.page.evaluate(() => {
      if (window.__erfanaFreshnessSeen) return
      const imageText = (img: Element): string => {
        const version = img.getAttribute('data-version') ?? ''
        const src = img.getAttribute('src') ?? ''
        const svg = 'data:image/svg+xml;base64,'
        return src.startsWith(svg) ? `${version} ${atob(src.slice(svg.length))}` : version
      }
      const recorder: SeenRecorder = {
        armed: new Set(),
        seen: {},
        scan: () => {
          if (recorder.armed.size === 0) return
          const now = Date.now()
          const text = document.body.textContent ?? ''
          const images = Array.from(document.querySelectorAll('img'), imageText).join('\n')
          for (const marker of Array.from(recorder.armed)) {
            if (text.includes(marker) || images.includes(marker)) {
              recorder.seen[marker] = now
              recorder.armed.delete(marker)
            }
          }
        }
      }
      new MutationObserver(recorder.scan).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['src', 'data-version']
      })
      window.__erfanaFreshnessSeen = recorder
    })
  }

  /** Starts looking for `marker`; call before the write that introduces it. */
  async armMarker(marker: string): Promise<void> {
    await this.page.evaluate((m) => {
      const recorder = window.__erfanaFreshnessSeen
      if (!recorder) throw new Error('installSeenRecorder() first')
      recorder.armed.add(m)
      recorder.scan()
    }, marker)
  }

  /** Resolves the `Date.now()` at which `marker` first showed; rejects after `timeout`. */
  async waitForSeen(marker: string, timeout = STEP_TIMEOUT_MS): Promise<number> {
    const handle = await this.page.waitForFunction(
      (m) => window.__erfanaFreshnessSeen?.seen[m] ?? null,
      marker,
      { timeout, polling: 50 }
    )
    return (await handle.jsonValue()) as number
  }

  // ---------------------------------------------------------------------------
  // Opening a file the way a terminal link does
  // ---------------------------------------------------------------------------

  /**
   * Prints `filePath` in the integrated terminal and clicks it, so the file
   * opens with exactly that spelling (for example a lower-case drive letter).
   */
  async openThroughTerminalLink(filePath: string, opened: Locator): Promise<void> {
    const terminal = new TerminalPage(this.page)
    await terminal.open()
    // Single quotes print the path verbatim in bash and PowerShell alike
    await terminal.sendCommand(`echo '${filePath}'`)
    await terminal.waitForOutputLine(filePath)
    const deadline = Date.now() + LINK_TIMEOUT_MS
    while (Date.now() < deadline && !(await opened.isVisible())) {
      // Re-measured every round: the prompt moves as the shell redraws. The
      // path is printed just above the prompt, which is one row (PowerShell,
      // `$ `) or several (Git Bash's, wrapped), so the rows above the cursor
      // are tried, down to the top of the viewport.
      const grid = await this.terminalGrid()
      for (let above = 1; above <= Math.min(TERMINAL_ROWS_TRIED, grid.cursorRow); above++) {
        const x = grid.left + (LINK_COLUMN + 0.5) * grid.cellWidth
        const y = grid.top + (grid.cursorRow - above + 0.5) * grid.cellHeight
        // Hover first: the link provider checks the path over IPC before a link exists
        await this.page.mouse.move(x, y)
        await this.page.mouse.click(x, y)
      }
      // A bounded condition wait, not a sleep: ends as soon as the tab opens
      await opened.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined)
    }
    await expect(opened).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  }

  /** xterm's cell size, its origin and the cursor's viewport row, read from its helper textarea. */
  private async terminalGrid(): Promise<{ left: number; top: number; cellWidth: number; cellHeight: number; cursorRow: number }> {
    const handle = await this.page.waitForFunction(
      () => {
        const root = document.querySelector('.xterm')
        const helper = document.querySelector('.xterm-helper-textarea') as HTMLElement | null
        if (!root || !helper) return null
        const cellWidth = parseFloat(helper.style.width)
        const cellHeight = parseFloat(helper.style.height)
        if (!cellWidth || !cellHeight) return null
        const box = root.getBoundingClientRect()
        return {
          left: box.left,
          top: box.top,
          cellWidth,
          cellHeight,
          cursorRow: Math.round(parseFloat(helper.style.top) / cellHeight)
        }
      },
      undefined,
      { timeout: STEP_TIMEOUT_MS }
    )
    return (await handle.jsonValue()) as { left: number; top: number; cellWidth: number; cellHeight: number; cursorRow: number }
  }
}
