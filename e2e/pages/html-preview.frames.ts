// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview – frame helpers (#124, part 2, WI-24).
 *
 * Frames live inside the sealed preview `WebContentsView`, so, like the page
 * itself, they are read main-side (`app.evaluate`): `frameTree()` lists every
 * frame of a preview with its depth, URL and `document.title`, and
 * `evalInFrame()` runs one expression in one frame. Those reads are the
 * TEST's; the product runs no script in a page's frames.
 *
 * **Which layer wrote a badge entry.** Four layers can list a refused frame:
 * the failed-load writer (`did-fail-provisional-load` -30 / -27, for frames
 * the browser's CSP refused before any other event), the request filter
 * (-20), the protocol handler (the frame commits with its 4xx) and the frame
 * guard (`will-frame-navigate`, cancelled, so nothing follows). The entry text
 * alone cannot say which – the filter and the failed-load writer write the
 * same address – so `armFrameTrail()` records those Electron signals from the
 * test side, on every preview web contents from its creation, and
 * `writerOf()` names the layer the signals point to. A layer that goes silent
 * after an Electron upgrade then shows up as a changed writer, not as a
 * passing test.
 *
 * Plain functions, like `html-preview.native.ts`: the `HtmlPreviewPage` class
 * keeps its app handle private, so these take the `ElectronApplication`.
 * Nothing here sleeps; the waits are Playwright polls on a condition.
 *
 * @see docs/design/design-issue-124-part2.md §2.4–§2.7
 */

import { expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import type { WebFrameMain } from 'electron'

import { SRCDOC_TOO_DEEP_ENTRY } from '../../src/shared/previewFrameBadgeText'
import { PREVIEW_BUDGET_MS, type HtmlPreviewPage, type PreviewTarget } from './html-preview.page'

/** One frame of a preview page: depth 1 is a frame in the page itself. */
export interface FrameRead {
  depth: number
  url: string
  /** `document.title` read in the frame; `''` for a frame left empty. */
  title: string
}

/** One Electron signal about a subframe of a preview page. */
export interface FrameSignal {
  event: 'will-frame-navigate' | 'srcdoc-start' | 'did-fail-provisional-load' | 'did-frame-navigate'
  url: string
  /** The net error code (fail) or the HTTP status (commit); `null` otherwise. */
  code: number | null
}

/** One group of the failure badge's popover. */
export interface BadgeGroup {
  /** The group heading without its `(n)` count, e.g. "Blocked remote frame". */
  label: string
  entries: string[]
}

/** Every frame of the matching preview, parents before children; `[]` when none is live. */
export async function frameTree(
  app: ElectronApplication,
  target: PreviewTarget = {}
): Promise<FrameRead[]> {
  return app.evaluate(async ({ webContents }, urlIncludes) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        const url = c.getURL()
        return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
      } catch {
        return false
      }
    })
    const out: Array<{ depth: number; url: string; title: string }> = []
    if (!wc) return out
    try {
      const top = wc.mainFrame
      for (const frame of top.framesInSubtree) {
        if (frame.frameTreeNodeId === top.frameTreeNodeId) continue
        let depth = 0
        for (let f: WebFrameMain | null = frame; f && f.frameTreeNodeId !== top.frameTreeNodeId; f = f.parent) {
          depth += 1
        }
        let title = ''
        try {
          title = String(await frame.executeJavaScript('document.title'))
        } catch {
          // Mid-load or gone: read as empty, the caller polls.
        }
        out.push({ depth, url: frame.url, title })
      }
    } catch {
      return []
    }
    return out
  }, target.urlIncludes)
}

/**
 * Evaluate `expr` in the first frame (not the page) whose URL contains
 * `frameUrlIncludes`. `null` when no such frame is found or the call throws.
 */
export async function evalInFrame(
  app: ElectronApplication,
  frameUrlIncludes: string,
  expr: string,
  target: PreviewTarget = {}
): Promise<unknown> {
  return app.evaluate(
    async ({ webContents }, { e, frameUrl, urlIncludes }) => {
      const wc = webContents.getAllWebContents().find((c) => {
        try {
          const url = c.getURL()
          return url.startsWith('erfana-preview://') && (urlIncludes === undefined || url.includes(urlIncludes))
        } catch {
          return false
        }
      })
      if (!wc) return null
      const topId = wc.mainFrame.frameTreeNodeId
      const frame = wc.mainFrame.framesInSubtree.find(
        (f) => f.frameTreeNodeId !== topId && f.url.includes(frameUrl)
      )
      if (!frame) return null
      try {
        return await frame.executeJavaScript(e)
      } catch {
        return null
      }
    },
    { e: expr, frameUrl: frameUrlIncludes, urlIncludes: target.urlIncludes }
  )
}

/**
 * Start recording frame signals on every web contents created from now on
 * (the preview's is created when it opens, so call this first). Idempotent
 * per app; the trail lives in the main process of this test's own app.
 */
export async function armFrameTrail(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp }) => {
    const store = globalThis as { __erfanaE2eFrameTrail?: unknown[] }
    if (store.__erfanaE2eFrameTrail !== undefined) return
    const trail: Array<{ event: string; url: string; code: number | null }> = []
    store.__erfanaE2eFrameTrail = trail
    const MAX = 5_000
    electronApp.on('web-contents-created', (_created, wc) => {
      const push = (event: string, url: string, code: number | null): void => {
        try {
          if (trail.length < MAX && wc.getURL().startsWith('erfana-preview://')) trail.push({ event, url, code })
        } catch {
          // Contents gone: nothing to record.
        }
      }
      wc.on('will-frame-navigate', (details) => {
        if (!details.isMainFrame) push('will-frame-navigate', details.url, null)
      })
      wc.on('did-start-navigation', (details) => {
        if (!details.isMainFrame && details.url.startsWith('about:srcdoc')) push('srcdoc-start', details.url, null)
      })
      wc.on('did-fail-provisional-load', (_e, code, _description, url, isMainFrame) => {
        if (!isMainFrame) push('did-fail-provisional-load', url, code)
      })
      wc.on('did-frame-navigate', (_e, url, httpResponseCode, _status, isMainFrame) => {
        if (!isMainFrame) push('did-frame-navigate', url, httpResponseCode)
      })
    })
  })
}

/** The frame signals recorded since `armFrameTrail()`. */
export async function readFrameTrail(app: ElectronApplication): Promise<FrameSignal[]> {
  return app.evaluate(
    () => ((globalThis as { __erfanaE2eFrameTrail?: unknown[] }).__erfanaE2eFrameTrail ?? []) as never
  )
}

const BARE_SCHEME = /^[a-z][a-z0-9+.-]*:$/i
const SRC_OVER_LIMIT = /^\d+ frames? over the limit of \d+ (?:was|were) left empty$/
const SRCDOC_OVER_LIMIT = /^\d+ srcdoc frames? over the limit of \d+ (?:is|are) shown anyway$/

/** Whether a signal's URL is what a badge entry names, in any of the entry forms. */
function names(entry: string, url: string): boolean {
  if (url === entry) return true
  if (BARE_SCHEME.test(entry)) return url.toLowerCase().startsWith(entry.toLowerCase())
  try {
    const parsed = new URL(url)
    if (entry.startsWith('/')) return parsed.pathname === entry
    return `${parsed.protocol}//${parsed.host}` === entry
  } catch {
    return false
  }
}

/**
 * The layer the recorded signals say wrote `entry`:
 * `failed-load writer (-30)`, `request filter (-20)`, `protocol handler (HTTP 403)`,
 * `frame guard`, `srcdoc detector`, or `unobserved (…)` with what was seen.
 */
export function writerOf(entry: string, trail: readonly FrameSignal[]): string {
  if (entry === SRCDOC_TOO_DEEP_ENTRY || SRCDOC_OVER_LIMIT.test(entry)) {
    return trail.some((s) => s.event === 'srcdoc-start') ? 'srcdoc detector' : 'unobserved (no srcdoc start)'
  }
  if (SRC_OVER_LIMIT.test(entry)) {
    const starts = trail.filter((s) => s.event === 'will-frame-navigate').length
    const commits = trail.filter((s) => s.event === 'did-frame-navigate').length
    return starts > commits ? 'frame guard' : `unobserved (${starts} starts, ${commits} commits)`
  }
  const seen = trail.filter((s) => names(entry, s.url))
  const failed = (codes: number[]): FrameSignal | undefined =>
    seen.find((s) => s.event === 'did-fail-provisional-load' && codes.includes(s.code ?? 0))
  const refused = failed([-30, -27])
  if (refused) return `failed-load writer (${refused.code})`
  if (failed([-20])) return 'request filter (-20)'
  const served = seen.find((s) => s.event === 'did-frame-navigate' && (s.code ?? 0) >= 400)
  if (served) return `protocol handler (HTTP ${served.code})`
  if (seen.some((s) => s.event === 'will-frame-navigate') && !seen.some((s) => s.event === 'did-frame-navigate')) {
    return 'frame guard'
  }
  return `unobserved (${seen.map((s) => `${s.event} ${s.code}`).join(', ') || 'no signal'})`
}

/** Wait until the tab's failure badge shows exactly `count`. */
export async function waitForBadgeCount(preview: HtmlPreviewPage, count: number): Promise<void> {
  await expect
    .poll(() => preview.failureBadgeCount(), {
      timeout: PREVIEW_BUDGET_MS,
      message: `the failure badge never showed ${count}`
    })
    .toBe(count)
}

/** Open the failure badge, read its groups, and close it again (Escape). */
export async function readBadgeGroups(page: Page): Promise<BadgeGroup[]> {
  const popover = page.locator('.html-preview-badge-popover')
  await page.locator('.html-preview-badge').first().click()
  await expect(popover).toBeVisible()
  const groups = await popover.locator('.html-preview-badge-group').evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: (node.querySelector('.html-preview-badge-group-label')?.textContent ?? '')
        .trim()
        .replace(/\s*\(\d+\)$/, ''),
      entries: Array.from(node.querySelectorAll('li')).map((li) => (li.textContent ?? '').trim())
    }))
  )
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  return groups
}

/**
 * Dismiss every toast. Toasts carry `toast-<type>` test ids, so the shared
 * helper waits on their dismiss buttons; the "Project Opened" toast counts as
 * an overlay and hides the preview view while it shows.
 */
export { dismissAllToasts as dismissToasts } from './html-preview.browser'

/** Host zoom back to 100 %: Chromium keeps it per origin in the worker's shared profile. */
export async function resetHostZoom(app: ElectronApplication, page: Page): Promise<void> {
  await (await app.browserWindow(page)).evaluate((w) => w.webContents.setZoomLevel(0))
}
