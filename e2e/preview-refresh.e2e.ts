// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E tests for live preview refresh (issue #70).
 *
 * The reported defect: an SVG open in a preview tab kept showing the bytes it
 * was opened with, forever, no matter what happened to the file on disk. These
 * tests drive the real pipeline – chokidar in the main process, the IPC
 * `file-watch:*` channels, the read-only subscription hook, the decode-first
 * refresh – and assert what the user sees.
 *
 * Covered acceptance criteria:
 * - AC1: in-place rewrite AND atomic replace repaint the open tab
 * - AC1: a deleted file shows a banner, keeps the last image, and Reload recovers
 * - AC3: "Reloaded from disk" appears and clears itself
 * - AC4: zoom survives a same-size rewrite; a size change re-fits in fit mode
 *   and keeps a deliberate zoom otherwise
 * - UX-4: no flicker – the image element is never unmounted and never blanks
 *
 * Terminal routing (an image path clicked in the terminal must open the viewer,
 * not Monaco) needs its own launch environment and lives in
 * `preview-refresh-terminal.e2e.ts`.
 *
 * Freshness is asserted on the DECODED bytes (`data-marker` inside the SVG),
 * not on the DOM attribute alone, so a test can only pass if the panel really
 * repainted the new file.
 *
 * Condition-based waits only. The watcher has an inherent ~600 ms floor
 * (`awaitWriteFinish.stabilityThreshold` 300 ms + 300 ms debounce, plus 100 ms
 * when the atomic-save detector engages), so budgets are generous – but every
 * wait is a polled condition, never a sleep.
 *
 * @see temp/design-70.md § 7.4
 * @see docs/file-watching/README.md
 */

import * as fs from 'fs'
import * as path from 'path'

import { test, expect } from './fixtures/index'
import { ImageViewerPage } from './pages/image-viewer.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import {
  VIEWER_BANNER_COPY,
  VIEWER_STATUS_COPY
} from '../src/renderer/src/components/Panels/ImageViewerPanel/imageViewerStatus.logic'

// =============================================================================
// Constants and helpers
// =============================================================================

/**
 * Budget for a disk write to reach the screen.
 *
 * Floor is ~600 ms (chokidar `awaitWriteFinish` 300 ms + the service's 300 ms
 * debounce), +100 ms when the atomic-save detector engages, plus IPC, a base64
 * round trip and an off-DOM decode. Windows adds `ReadDirectoryChangesW`
 * latency and Defender's on-access scan of the freshly written file.
 */
const REFRESH_BUDGET_MS = process.platform === 'win32' ? 12_000 : 8_000

/** The image under test, seeded into every test's isolated project. */
const IMAGE_NAME = 'icon.svg'

/**
 * Build an SVG carrying a version marker and explicit intrinsic dimensions.
 *
 * `data-marker` is what the assertions read back out of the painted data URL.
 * `width`/`height` drive the intrinsic-dimension branch of `applySourceChange`,
 * which is the difference between "keep the user's zoom" and "reset to fit".
 */
function svg(marker: string, size: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-marker="${marker}" ` +
    `width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="#1f1f1f"/>` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 4}" fill="#c8ff00"/>` +
    `</svg>\n`
  )
}

/** Non-atomic rewrite: truncate the existing file and write over it. */
async function rewriteInPlace(projectPath: string, marker: string, size: number): Promise<void> {
  await fs.promises.writeFile(path.join(projectPath, IMAGE_NAME), svg(marker, size), 'utf-8')
}

/**
 * Atomic replace: write a sibling temp file, then rename it over the target.
 *
 * This is how design tools and coding agents actually rewrite an SVG, and it is
 * the path that used to kill the watch permanently (the rename unlinks the
 * inode chokidar's single-file watch is bound to).
 *
 * The temp file is written OUTSIDE the project directory-watcher's interest by
 * using a dot-prefixed name in the same directory – it must be on the same
 * filesystem for `rename` to be atomic.
 */
async function rewriteAtomically(projectPath: string, marker: string, size: number): Promise<void> {
  const target = path.join(projectPath, IMAGE_NAME)
  const tmp = path.join(projectPath, `.${IMAGE_NAME}.tmp`)
  await fs.promises.writeFile(tmp, svg(marker, size), 'utf-8')
  await fs.promises.rename(tmp, target)
}

/** One attribute mutation observed on the `<img>` during a refresh. */
type FlickerRecord = { attribute: string; at: number; src: string }

/** What the in-page flicker probe collects. */
type FlickerReport = {
  records: FlickerRecord[]
  /** True if the `<img>` was removed from its parent at any point. */
  unmounted: boolean
  /** True if `src` was ever set to an empty value. */
  blankSrc: boolean
}

declare global {
  interface Window {
    /** Installed by the flicker probe; returns a snapshot of what it observed. */
    __erfanaFlickerReport?: () => FlickerReport
  }
}

/** Escape a copy constant for use inside a `RegExp` text assertion. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Every test seeds its own isolated project, so a rewrite in one test can never
// be seen by another – the specs run in parallel across two workers.
test.use({
  testProjectFiles: {
    [IMAGE_NAME]: svg('v1', 200),
    'notes.md': '# Notes\n'
  }
})

// =============================================================================
// Tests
// =============================================================================

test.describe('Image viewer refreshes when the file changes on disk', () => {
  test('should repaint the open tab when the file is rewritten in place', async ({
    windowWithTestProject,
    testProject
  }) => {
    const viewer = new ImageViewerPage(windowWithTestProject, REFRESH_BUDGET_MS)

    await viewer.openFromTree(IMAGE_NAME)
    expect(await viewer.marker()).toBe('v1')

    await rewriteInPlace(testProject.path, 'v2', 200)

    await viewer.waitForMarker('v2')
    // The tab was never closed and reopened: the same panel is still mounted.
    await expect(viewer.panel()).toBeVisible()
  })

  test('should repaint the open tab when the file is replaced atomically', async ({
    windowWithTestProject,
    testProject
  }) => {
    const viewer = new ImageViewerPage(windowWithTestProject, REFRESH_BUDGET_MS)

    await viewer.openFromTree(IMAGE_NAME)
    expect(await viewer.marker()).toBe('v1')

    // tmp + rename. On macOS, chokidar v3 with fsevents reports this as a
    // `change`; elsewhere it arrives as unlink+add and the service's re-arm
    // path handles it. The assertion is deliberately about the user-visible
    // outcome, so it holds either way.
    await rewriteAtomically(testProject.path, 'v2', 200)
    await viewer.waitForMarker('v2')

    // A second atomic replace proves the watch SURVIVED the first one – the
    // original defect made every write after the first rename invisible.
    await rewriteAtomically(testProject.path, 'v3', 200)
    await viewer.waitForMarker('v3')
  })

  test('should report "Reloaded from disk" in the status slot and clear it', async ({
    windowWithTestProject,
    testProject
  }) => {
    const viewer = new ImageViewerPage(windowWithTestProject, REFRESH_BUDGET_MS)

    await viewer.openFromTree(IMAGE_NAME)
    // The live region is permanently mounted and empty when idle – a region
    // that mounts with its message never announces it.
    await viewer.expectStatusState('idle')
    await expect(viewer.statusSlot()).toHaveText('')

    await rewriteInPlace(testProject.path, 'v2', 200)

    await viewer.expectStatusState('reloading')
    await expect(viewer.statusSlot()).toHaveText(VIEWER_STATUS_COPY.reloading)

    // Self-clearing after INDICATOR_DURATION_MS – nothing in the test dismisses it.
    await viewer.expectStatusState('idle')
    await expect(viewer.statusSlot()).toHaveText('')
  })
})

test.describe('View state across a refresh', () => {
  test('should preserve zoom when the intrinsic dimensions are unchanged', async ({
    windowWithTestProject,
    testProject
  }) => {
    const viewer = new ImageViewerPage(windowWithTestProject, REFRESH_BUDGET_MS)

    await viewer.openFromTree(IMAGE_NAME)

    // Four discrete ZOOM_LEVELS steps up from whatever the initial fit was –
    // the fit depends on the panel's size, so the assertions are relative to
    // the recorded value rather than to a hard-coded percentage.
    const fitted = await viewer.zoomText()
    const zoomed = await viewer.zoomIn(4)
    expect(zoomed).not.toBe(fitted)

    // Same width/height, different content: the flagship case – an agent edits
    // an SVG while the user is zoomed into a detail.
    await rewriteInPlace(testProject.path, 'v2', 200)
    await viewer.waitForMarker('v2')

    expect(await viewer.zoomText()).toBe(zoomed)
    await expect(viewer.dimensions()).toHaveAttribute('aria-label', 'Dimensions: 200 x 200')
  })

  test('should keep a deliberate zoom when the intrinsic dimensions change', async ({
    windowWithTestProject,
    testProject
  }) => {
    const viewer = new ImageViewerPage(windowWithTestProject, REFRESH_BUDGET_MS)

    await viewer.openFromTree(IMAGE_NAME)
    const fitted = await viewer.zoomText()
    const zoomed = await viewer.zoomIn(4)
    expect(zoomed).not.toBe(fitted)

    await rewriteInPlace(testProject.path, 'v2', 400)
    await viewer.waitForMarker('v2')

    // A resized image must not cost the user the magnification they chose –
    // agents rewrite an SVG's width/height routinely (QG-11a). The view is
    // still made valid: the pan is recentred so the bigger image cannot end up
    // off-screen.
    await expect(viewer.dimensions()).toHaveAttribute('aria-label', 'Dimensions: 400 x 400')
    expect(await viewer.zoomText()).toBe(zoomed)
    expect(await viewer.transformStyle()).toContain('translate(0px, 0px)')
  })

  test('should re-fit when the dimensions change and the user was fitting', async ({
    windowWithTestProject,
    testProject
  }) => {
    const viewer = new ImageViewerPage(windowWithTestProject, REFRESH_BUDGET_MS)

    await viewer.openFromTree(IMAGE_NAME)
    await viewer.clickFit()
    const fitted = await viewer.zoomText()

    // 4000 px is far wider than any panel this window can produce, so the
    // re-fit has to scale down and the zoom label must change.
    await rewriteInPlace(testProject.path, 'v2', 4000)
    await viewer.waitForMarker('v2')

    await expect(viewer.dimensions()).toHaveAttribute('aria-label', 'Dimensions: 4000 x 4000')
    await expect
      .poll(async () => viewer.zoomText(), {
        timeout: REFRESH_BUDGET_MS,
        message: `zoom never left ${fitted} after a re-fit`
      })
      .not.toBe(fitted)
    expect(await viewer.transformStyle()).toContain('translate(0px, 0px)')
  })
})

test.describe('Refresh does not flicker', () => {
  test('should keep the image mounted and commit src and style together', async ({
    windowWithTestProject,
    testProject
  }) => {
    const viewer = new ImageViewerPage(windowWithTestProject, REFRESH_BUDGET_MS)

    await viewer.openFromTree(IMAGE_NAME)

    // Probe installed BEFORE the write, so nothing about the refresh can happen
    // unobserved. It records every `src`/`style` attribute mutation with a
    // timestamp, whether `src` was ever blanked, and whether the element was
    // ever removed from the DOM (a remount is the classic blank frame).
    await windowWithTestProject.evaluate((testId) => {
      const target = document.querySelector(`[data-testid="${testId}"]`) as HTMLImageElement | null
      if (!target) throw new Error('flicker probe: image element not found')

      const report: FlickerReport = { records: [], unmounted: false, blankSrc: false }
      const attributeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          const element = mutation.target as HTMLImageElement
          const src = element.getAttribute('src') ?? ''
          report.records.push({
            attribute: mutation.attributeName ?? '',
            at: performance.now(),
            src
          })
          if (mutation.attributeName === 'src' && src === '') report.blankSrc = true
        }
      })
      attributeObserver.observe(target, {
        attributes: true,
        attributeFilter: ['src', 'style']
      })

      const parent = target.parentElement
      const childObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.removedNodes.forEach((node) => {
            if (node === target) report.unmounted = true
          })
        }
      })
      if (parent) childObserver.observe(parent, { childList: true })

      // The probe hands its collected state back through a getter rather than
      // a global read, so the report cannot be observed half-written.
      window.__erfanaFlickerReport = () => ({
        records: [...report.records],
        unmounted: report.unmounted,
        blankSrc: report.blankSrc
      })
    }, TEST_IDS.IMAGE_VIEWER_IMAGE)

    await rewriteInPlace(testProject.path, 'v2', 200)
    await viewer.waitForMarker('v2')

    const report = await windowWithTestProject.evaluate(() => window.__erfanaFlickerReport!())

    // (a) the element survived – no remount, therefore no blank frame
    expect(report.unmounted).toBe(false)
    // (b) `src` was never emptied on the way to the new bytes
    expect(report.blankSrc).toBe(false)
    // (c) the refresh really did rewrite `src`
    const srcRecords = report.records.filter((record) => record.attribute === 'src')
    expect(srcRecords.length).toBeGreaterThan(0)
    // (d) `src` and `style` land in one commit. A style write is only emitted
    //     when the transform string actually changes, so an empty style set is
    //     the strongest possible outcome, not a missing assertion.
    const times = report.records.map((record) => record.at)
    expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(16)
    // (e) the panel still shows an image, not an error or empty state
    await expect(viewer.image()).toBeVisible()
  })
})

test.describe('Deleted file', () => {
  test('should show the deleted banner, keep the last image, and recover via Reload', async ({
    windowWithTestProject,
    testProject
  }) => {
    const viewer = new ImageViewerPage(windowWithTestProject, REFRESH_BUDGET_MS)

    await viewer.openFromTree(IMAGE_NAME)
    expect(await viewer.marker()).toBe('v1')
    await viewer.expectNoBanner(2000)

    await fs.promises.rm(path.join(testProject.path, IMAGE_NAME))

    await viewer.expectBanner('deleted')
    await expect(viewer.banner()).toHaveText(new RegExp(escapeRegExp(VIEWER_BANNER_COPY.deleted)))
    // The tab is not closed and the pixels are not thrown away: the last
    // version that was loaded stays on screen.
    await expect(viewer.image()).toBeVisible()
    expect(await viewer.marker()).toBe('v1')

    // A genuine delete drops the main-process watch by design, so a restored
    // file does not auto-refresh – Reload is the documented escape hatch.
    await rewriteInPlace(testProject.path, 'v2', 200)
    await viewer.clickReload()

    await viewer.expectNoBanner()
    await viewer.waitForMarker('v2')
  })
})
