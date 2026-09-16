// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview – shared harness for the native-view bounds specs (#124,
 * part 1: WI-8 `html-preview-bounds.e2e.ts`, WI-27
 * `html-preview-drag-freeze.e2e.ts`).
 *
 * One preview in one app window: reads of the native view (main-side, DIP)
 * against its DOM placeholder (CSS px), the layout moves the specs share, and
 * a reader for this test's own log lines. Not a page object – the checks here
 * are specific to the bounds specs and assert on their own.
 *
 * "Settled" means two reads 100 ms apart agree (part 1 §1.3). Condition-based
 * waits only.
 *
 * @see docs/design/design-issue-124-part1.md
 */

import * as os from 'os'
import * as path from 'path'

import type { ElectronApplication, JSHandle, Page } from '@playwright/test'
import type { BrowserWindow } from 'electron'
import { test as base, expect } from './fixtures/index'
import { LogTail } from './fixtures/logTail'
import { dismissAllToasts } from './pages/html-preview.browser'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS, type ViewBounds } from './pages/html-preview.page'
import { TerminalPage } from './pages/terminal.page'
import { byTestId } from './utils/locators'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { LOGS_DIR_RELATIVE } from '../src/shared/constants'
import { BOUNDS_DROP_MESSAGE } from '../src/shared/dropReporter'

export { expect }

export const FILE = 'bounds.html'
const SENTINEL = '-BOUNDS-'

/**
 * A plain page. The remote image is refused by the preview CSP (never
 * fetched); it only gives the permission band a blocked host, so its list
 * can open and change the band's height.
 */
export const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Bounds page ${SENTINEL}</title></head>
<body style="margin:0;background:#1f4f7a;color:#fff;font:20px sans-serif">
  <h1>Bounds</h1>
  <img src="https://example.com/blocked.png" alt="">
</body>
</html>
`

/** Mirrors `SEARCH_BAR_INSET_PX` (`usePreviewBounds.ts`): the find bar's strip, CSS px. */
const FIND_INSET_PX = 48

/** Rounding slack: fractional CSS rects are rounded to whole DIP main-side. */
const SLACK_PX = 1

/** How far a splitter drag goes: past any minimum, so the editor is squeezed to 400 px. */
export const SQUEEZE_PX = -1200

/** The tree-splitter slide of part 1 §1.3. */
export const SLIDE_PX = 120

export interface CssRect {
  x: number
  y: number
  width: number
  height: number
}

/** One read of both sides: the native view (DIP) and the placeholder (CSS px). */
export interface BoundsRead {
  view: ViewBounds | null
  placeholder: CssRect | null
  zoom: number
  findOpen: boolean
}

/** How far the view sits from where the placeholder says it should, in DIP. */
export interface Offset {
  dx: number
  dy: number
  dw: number
  dh: number
}

/** Signed offset of the view from the expected rect; `null` when a side is missing. */
function offsetOf(read: BoundsRead): Offset | null {
  const { view, placeholder: p, zoom: z } = read
  if (view === null || p === null) return null
  const inset = read.findOpen ? FIND_INSET_PX : 0
  return {
    dx: Math.round(view.x - p.x * z),
    dy: Math.round(view.y - (p.y + inset) * z),
    dw: Math.round(view.width - p.width * z),
    dh: Math.round(view.height - (p.height - inset) * z)
  }
}

/** Zero every component within the rounding slack, so `toEqual` shows only real gaps. */
function beyondSlack(offset: Offset | null): Offset | null {
  if (offset === null) return null
  const cut = (n: number): number => (Math.abs(n) <= SLACK_PX ? 0 : n)
  return { dx: cut(offset.dx), dy: cut(offset.dy), dw: cut(offset.dw), dh: cut(offset.dh) }
}

/** The main log shared by both processes; drop lines from either end up here. */
function combinedLogPath(): string {
  return path.join(os.homedir(), LOGS_DIR_RELATIVE, 'combined.log')
}

/**
 * The lines carrying `message` that this test's preview wrote since `mark()`.
 * Scoped by the temp project folder, which the panel id carries in sanitized
 * form, so another worker's lines never count.
 */
export class LogTrail {
  private readonly tail = new LogTail(combinedLogPath())
  private readonly scope: string

  constructor(
    projectPath: string,
    private readonly message: string
  ) {
    this.scope = path.basename(projectPath).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
  }

  mark(): Promise<void> {
    return this.tail.mark()
  }

  /** `source:reason` per line, in order (e.g. `main:zoom-mismatch`); just `reason` when a line has no source. */
  async reasons(): Promise<string[]> {
    const out: string[] = []
    for (const line of (await this.tail.appended()).split('\n')) {
      if (!line.includes(this.message) || !line.includes(this.scope)) continue
      try {
        const context = JSON.parse(line.slice(line.indexOf('{'))) as { source?: string; reason?: string }
        out.push(context.source === undefined ? `${context.reason}` : `${context.source}:${context.reason}`)
      } catch {
        out.push('unparsed')
      }
    }
    return out
  }
}

/** One preview in one app window, with the reads and layout moves the tests share. */
export class BoundsHarness {
  readonly preview: HtmlPreviewPage
  readonly drops: LogTrail
  readonly terminal: TerminalPage

  constructor(
    readonly page: Page,
    readonly app: ElectronApplication,
    projectPath: string
  ) {
    this.preview = new HtmlPreviewPage(page, app)
    this.drops = new LogTrail(projectPath, BOUNDS_DROP_MESSAGE)
    this.terminal = new TerminalPage(page)
  }

  hostWindow(): Promise<JSHandle<BrowserWindow>> {
    return this.app.browserWindow(this.page)
  }

  /** Host zoom level (0 = 100 %). Chromium keeps it per origin in the worker's profile. */
  async setHostZoomLevel(level: number): Promise<void> {
    await (await this.hostWindow()).evaluate((w, l) => w.webContents.setZoomLevel(l), level)
  }

  /**
   * Toasts are occluders: while one overlaps the preview the guard hides the
   * view, which would read as a missing view rather than a moved one.
   */
  dismissToasts(): Promise<void> {
    return dismissAllToasts(this.page)
  }

  /** Open the page and wait until it runs; the drop trail starts after it settles. */
  async open(): Promise<void> {
    await this.preview.open(FILE)
    await this.preview.waitForTitled(SENTINEL)
    await this.expectOnPlaceholder('after opening')
    await this.drops.mark()
  }

  async read(): Promise<BoundsRead> {
    const placeholder = await this.preview.placeholder(FILE).boundingBox()
    const findOpen = (await byTestId(this.page, TEST_IDS.SEARCH_BAR).count()) > 0
    const zoom = await (await this.hostWindow()).evaluate((w) => w.webContents.getZoomFactor())
    return { view: await this.preview.viewBounds(), placeholder, zoom, findOpen }
  }

  /** Poll until two reads 100 ms apart agree (and, if `shown`, the view is visible). */
  async settled(shown = true): Promise<BoundsRead> {
    let previous = ''
    let last: BoundsRead | null = null
    await expect
      .poll(
        async () => {
          last = await this.read()
          const key = JSON.stringify(last)
          const same = key === previous && (!shown || last.view?.visible === true)
          previous = key
          return same
        },
        { intervals: [100], timeout: PREVIEW_BUDGET_MS, message: 'the preview bounds never settled' }
      )
      .toBe(true)
    return last as unknown as BoundsRead
  }

  /**
   * What, other than the placeholder, is under the view: test ids (or class
   * names) hit at a 5×5 grid of points inside the view's rect.
   */
  async chromeUnderView(read: BoundsRead): Promise<string[]> {
    if (read.view === null) return []
    return this.page.evaluate(
      ({ v, z }) => {
        const hits = new Set<string>()
        for (let i = 1; i <= 5; i += 1) {
          for (let j = 1; j <= 5; j += 1) {
            const el = document.elementFromPoint((v.x + (v.width * i) / 6) / z, (v.y + (v.height * j) / 6) / z)
            if (el === null || el.closest('.html-preview-placeholder') !== null) continue
            const tagged = el.closest('[data-testid]')
            hits.add(tagged?.getAttribute('data-testid') ?? el.className.toString())
          }
        }
        return [...hits]
      },
      { v: read.view, z: read.zoom }
    )
  }

  /** The settled, visible view equals the placeholder rect and covers no chrome. */
  async expectOnPlaceholder(label: string): Promise<void> {
    const read = await this.settled()
    const chrome = await this.chromeUnderView(read)
    const offset = offsetOf(read)
    test.info().annotations.push({ type: 'measured', description: `${label}: ${JSON.stringify({ offset, chrome })}` })
    expect({ offset: beyondSlack(offset), chrome }, `view vs placeholder ${label}`).toEqual({
      offset: { dx: 0, dy: 0, dw: 0, dh: 0 },
      chrome: []
    })
  }

  /** The editor area's left and right edges, CSS px. */
  async editorEdges(): Promise<{ left: number; right: number }> {
    const box = await byTestId(this.page, TEST_IDS.EDITOR_AREA).boundingBox()
    if (box === null) throw new Error('the editor area has no box')
    return { left: box.x, right: box.x + box.width }
  }

  /**
   * The centre of the tall splitter sash nearest `x` (CSS px), or `null` when
   * none sits within 12 px of it. Dockview's sashes carry no test id; the one
   * on an editor-area edge is the one meant.
   */
  async sashNear(x: number): Promise<{ x: number; y: number } | null> {
    const sash = await this.page.evaluate((target) => {
      let best: { x: number; y: number; distance: number } | null = null
      for (const el of Array.from(document.querySelectorAll('.dv-sash'))) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height < 100) continue
        const centre = r.left + r.width / 2
        const distance = Math.abs(centre - target)
        if (best === null || distance < best.distance) best = { x: centre, y: r.top + r.height / 2, distance }
      }
      return best
    }, x)
    return sash === null || sash.distance > 12 ? null : { x: sash.x, y: sash.y }
  }

  /** Drag the top-level splitter sash at `x` by `dx`. */
  async dragSashAt(x: number, dx: number): Promise<void> {
    const sash = await this.sashNear(x)
    if (sash === null) throw new Error(`no splitter sash at x=${x}`)
    await this.page.mouse.move(sash.x, sash.y)
    await this.page.mouse.down()
    await this.page.mouse.move(sash.x + dx, sash.y, { steps: 12 })
    await this.page.mouse.up()
  }

  /** Squeeze the editor to its minimum width by dragging the terminal splitter left. */
  async squeezeEditor(): Promise<void> {
    await this.dragSashAt((await this.editorEdges()).right, SQUEEZE_PX)
  }

  /** Resize the host window once per host frame, `frames` times, then settle on `last`. */
  async resizeBurst(frames: number, last: { width: number; height: number }): Promise<void> {
    await (await this.hostWindow()).evaluate(
      async (w, { n, end }) => {
        for (let i = 0; i < n; i += 1) {
          w.setSize(1000 + ((i * 37) % 400), 700 + ((i * 53) % 200))
          // Paced by the host's own frames, not a timer: one size per painted frame.
          await w.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => r(0)))')
        }
        w.setSize(end.width, end.height)
      },
      { n: frames, end: last }
    )
  }
}

/**
 * The test with a `bounds` harness: zoom reset, terminal open, toasts
 * dismissed, and the drop trail marked before the test; the drop reasons
 * attached, zoom reset, and every other window destroyed after it.
 */
export const test = base.extend<{ bounds: BoundsHarness }>({
  bounds: async ({ windowWithTestProject, appWithTestProject, testProject }, use, testInfo) => {
    const harness = new BoundsHarness(windowWithTestProject, appWithTestProject, testProject.path)
    const hostId = await (await harness.hostWindow()).evaluate((w) => w.id)
    // The zoom a previous test left in this worker's profile must not leak in.
    await harness.setHostZoomLevel(0)
    await harness.terminal.open()
    await harness.dismissToasts()
    await harness.drops.mark()
    await use(harness)
    testInfo.annotations.push({ type: 'drop-reasons', description: (await harness.drops.reasons()).join(', ') || 'none' })
    await harness.setHostZoomLevel(0)
    await appWithTestProject.evaluate(({ BrowserWindow }, keep) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.id !== keep) w.destroy()
    }, hostId)
  }
})

/** The project every bounds spec opens: the page and a Markdown file beside it. */
export const BOUNDS_PROJECT_FILES = { [FILE]: PAGE, 'notes.md': '# Notes\n' }
