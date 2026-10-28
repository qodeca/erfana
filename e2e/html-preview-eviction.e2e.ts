// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The live-view budget: eviction to a still frame, and waking on activation
 * (sd-074b D5).
 *
 * `PREVIEW.MAX_LIVE_VIEWS` previews stay live at once. Opening one more tears
 * the least recently active preview down to its still frame and marks it
 * `suspended`; activating that tab again re-opens it by itself. That "exit
 * state" is what made the LRU budget acceptable, and on Windows the wake half
 * of it was seen not to happen (the tab stayed on its still frame for good),
 * so this asserts BOTH halves against the real `erfana-preview://` web
 * contents: the evicted page is gone, its panel shows the frame, and after a
 * click on its tab the page answers again and the frame is gone.
 *
 * Local gate only: e2e is disabled in CI.
 * Condition-based waits only — never a sleep.
 *
 * @see src/shared/constants.ts (`PREVIEW.MAX_LIVE_VIEWS`)
 * @see docs/html-preview/README.md
 */

import { test, expect } from './fixtures/index'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { PREVIEW } from '../src/shared/constants'

/** One more page than the budget keeps live. */
const PAGE_COUNT = PREVIEW.MAX_LIVE_VIEWS + 1

/** Distinct basenames on purpose: the panel and tab locators are scoped by them. */
const FILES = ['first.html', 'second.html', 'third.html', 'fourth.html']

/** A page with a colour and a sentinel, so a still frame has something to show. */
function page(index: number, colour: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Eviction page ${index} -EVICT-${index}</title></head>
<body style="background:${colour};color:#fff;font:24px sans-serif;padding:32px">
  <h1>Page ${index}</h1>
</body>
</html>
`
}

const COLOURS = ['#7a1f1f', '#1f4f7a', '#1f7a3a', '#6a1f7a']

test.use({
  testProjectFiles: Object.fromEntries(
    FILES.slice(0, PAGE_COUNT).map((name, i) => [name, page(i + 1, COLOURS[i])])
  )
})

test.describe('HTML preview — live-view budget', () => {
  test('the fourth preview evicts the first to a still frame, and its tab wakes it', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    expect(FILES.length).toBeGreaterThanOrEqual(PAGE_COUNT)
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)

    // Open every page and wait for each to be genuinely live (title sentinel),
    // so "first" is the least recently ACTIVE view when the budget is exceeded.
    for (let i = 0; i < PAGE_COUNT; i += 1) {
      await preview.open(FILES[i])
      await preview.waitForTitled(`-EVICT-${i + 1}`)
    }

    // Eviction: exactly the budget stays live, and the first page is not among
    // them — its web contents are gone, not merely hidden.
    const isFirst = (url: string): boolean => url.endsWith('/first.html')
    await expect
      .poll(
        async () => {
          const live = await preview.livePreviews()
          return { count: live.length, firstLive: live.some((p) => isFirst(p.url)) }
        },
        {
          timeout: PREVIEW_BUDGET_MS,
          message: 'opening a fourth preview never evicted the first'
        }
      )
      .toEqual({ count: PREVIEW.MAX_LIVE_VIEWS, firstLive: false })

    // The evicted panel shows its still frame instead of a hole. The panel is
    // an inactive dockview tab (`renderer: 'always'` keeps it mounted), so the
    // frame is asserted ATTACHED, not visible.
    await expect(preview.stillFrame('first.html')).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })

    // Wake: activating the tab re-opens the page by itself.
    await preview.tab('first.html').click()

    await expect
      .poll(async () => (await preview.livePreviews()).some((p) => isFirst(p.url)), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'activating the evicted tab never re-opened its preview'
      })
      .toBe(true)
    // The page answers again — a fresh document, served and run.
    await expect
      .poll(() => preview.eval('document.title', HtmlPreviewPage.target('first.html')), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'the woken preview never served its page'
      })
      .toContain('-EVICT-1')
    // And the live view has replaced the frame.
    await expect(preview.stillFrame('first.html')).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })

    // The budget still holds: waking one evicted the next least recent.
    expect((await preview.livePreviews()).length).toBeLessThanOrEqual(PREVIEW.MAX_LIVE_VIEWS)
  })
})
