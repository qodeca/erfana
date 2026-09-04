// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The per-format export matrix (issue #73, acceptance criterion 1).
 *
 * AC 1 is explicit: each of the three actions works "for all eight supported
 * formats (.png .jpg .jpeg .gif .webp .svg .bmp .ico), with the expected result
 * pinned per format in automated tests". `image-export.e2e.ts` pins the PNG
 * column across all eight; this file pins the other two, so every cell of the
 * 3 x 8 grid has a real assertion behind it rather than an argument that the
 * sink is format-independent once the harness has produced its bytes.
 *
 * That argument is probably true, but it is an argument, and the formats do NOT
 * arrive at the sink alike: an animated GIF contributes its first frame, a
 * multi-size ICO its largest entry, and an SVG rasterizes at 2x its viewBox. If
 * a format regressed on the way in — a decoder change, a size negotiation, a
 * frame pick — a matrix that samples two formats would stay green. Each row
 * below asserts that format's OWN expected size, taken from the same
 * `IMAGE_FIXTURES` table the PNG matrix uses, so no row can be made to pass by
 * weakening it to "some image came out".
 *
 * What each column proves:
 * - **PDF**: exactly one page whose MediaBox equals the source's own pixel size
 *   in points, checked with the SAME `verifyPdfGeometry` and the same tolerance
 *   constant the runtime gate uses (`expectPdfSinglePageOfSize`).
 * - **Clipboard**: a non-empty `nativeImage` of the source's own size, read
 *   back through the MAIN process — the only place the app ever writes the
 *   clipboard.
 *
 * Split from `image-export.e2e.ts` rather than added to it so both stay under
 * the 500-line cap, the same reason `image-export.behaviour.e2e.ts` exists. All
 * three share `e2e/utils/image-export-helpers.ts`, the composed
 * `imageExportTest`, and one fixture generator.
 *
 * Conventions this spec is held to:
 * - **Condition-based waits only.** Playwright auto-waiting, POM waits, or
 *   `expect.poll` on a real condition. No sleeps.
 * - **No test-only production hook.** The native save dialog is stubbed at the
 *   Electron level with `stubDialog`.
 * - **The clipboard is one global OS resource**, so its half runs serial, as
 *   the clipboard cases in `image-export.e2e.ts` already do.
 *
 * @see temp/design-73.md § 12 Test plan
 * @see docs/testing/e2e-testing.md
 */

import { expect } from './fixtures/index'
import {
  armSaveDialog,
  clearClipboard,
  EXPORT_BUDGET_MS,
  expectPdfSinglePageOfSize,
  FORMAT_ROWS,
  imageExportTest as test,
  openImage,
  readClipboardImage,
  readExported,
  SUPPORTED_FORMAT_KEYS,
  toastWithMessage
} from './utils/image-export-helpers'
import { IMAGE_EXPORT_TOAST_COPY } from '../src/renderer/src/components/Panels/ImageViewerPanel/imageViewerStatus.logic'
import {
  IMAGE_FIXTURES,
  PDF_GRID_DEFECT_SIZE
} from './fixtures/images/generateImageFixtures'

// Seed one text file so the tree is never empty for a reason unrelated to
// images; the images themselves are seeded by `imageExportTest`'s
// `testProject` override (see `e2e/utils/image-export-helpers.ts`).
test.use({ testProjectFiles: { 'notes.md': '# Notes\n' } })

// A matrix that quietly shrank to two rows is the exact defect this file was
// written to close, so the row count is itself asserted.
test('the format matrix covers all eight supported extensions', () => {
  expect(FORMAT_ROWS.map(([key]) => key)).toEqual([...SUPPORTED_FORMAT_KEYS])
})

// =============================================================================
// Tests — PDF export, every format
// =============================================================================

test.describe('image export – PDF page geometry per format', () => {
  for (const [key, fixture] of FORMAT_ROWS) {
    test(`should produce a single-page PDF at the source's own pixel size when the source is a .${key}`, async ({
      appWithTestProject,
      windowWithTestProject,
      exportDir
    }) => {
      // Fixture sizes were deliberately NOT chosen to be kind to the PDF sink:
      // `photo.jpg` / `photo-copy.jpeg` are 22 px tall and `tile.bmp` is 14 px
      // tall, heights Chromium's `printToPDF` reproduces 0.54 pt over on its
      // 1/300 in grid. The gate's tolerance is one CSS pixel (0.75 pt), so those
      // rows pass like any other; `image export – PDF page-size grid regression`
      // below holds that line with a PNG at 60 x 22.
      const viewer = await openImage(windowWithTestProject, fixture.fileName)
      const out = await armSaveDialog(appWithTestProject, exportDir, `${key}-export.pdf`)

      await viewer.clickExport(viewer.exportPdfButton())

      // `fixture.expected` is that format's own answer, not a shared constant:
      // 2x the viewBox for the SVG, the first frame for the GIF, the largest
      // entry for the ICO.
      await expectPdfSinglePageOfSize(
        await readExported(out),
        fixture.expected.width,
        fixture.expected.height
      )
    })
  }
})

// =============================================================================
// Tests — copy to clipboard, every format
// =============================================================================

// The clipboard is one global OS resource. Serial mode keeps every row on one
// worker and in order, so no row can read an image another one wrote.
test.describe.serial('image export – clipboard per format', () => {
  for (const [key, fixture] of FORMAT_ROWS) {
    test(`should put a non-empty image of the source's own size on the clipboard when the source is a .${key}`, async ({
      appWithTestProject,
      windowWithTestProject
    }) => {
      const viewer = await openImage(windowWithTestProject, fixture.fileName)

      // Cleared FIRST, and confirmed empty, so `empty: false` below is evidence
      // this export wrote something. Two fixtures share a pixel size
      // (photo.jpg / photo-copy.jpeg), so a stale board would otherwise let a
      // no-op copy pass on size alone.
      await clearClipboard(appWithTestProject)

      await viewer.clickExport(viewer.copyButton())
      await expect(
        toastWithMessage(windowWithTestProject, IMAGE_EXPORT_TOAST_COPY.copied)
      ).toBeVisible({ timeout: EXPORT_BUDGET_MS })

      const clip = await readClipboardImage(appWithTestProject)
      expect(clip.empty, `.${key} put nothing on the clipboard`).toBe(false)
      expect({ width: clip.width, height: clip.height }).toEqual(fixture.expected)
    })
  }
})

// =============================================================================
// Tests — the pixel sizes Chromium rounds
// =============================================================================

test.describe('image export – PDF page-size grid regression', () => {
  test("should produce a single-page PDF when the height lands on Chromium's rounding grid", async ({
    appWithTestProject,
    windowWithTestProject,
    exportDir
  }) => {
    // `printToPDF` quantizes the CSS `@page` size onto a 1/300 in device grid,
    // so for any dimension where `px % 8 === 6` the MediaBox comes back 0.54 pt
    // over. That used to exceed the geometry gate's tolerance, and the export
    // was refused with "the PDF page came out the wrong size" for an ordinary
    // image — roughly one pixel size in eight, per axis, in every format. The
    // tolerance is now one CSS pixel (0.75 pt), so a rounded page is accepted
    // while letterboxing and scaling are still refused.
    //
    // 60 x 22 isolates the effect on one axis and in one format: .png exports
    // fine at 137 x 61 in the matrix above, so a failure here is about the size.
    const fixture = IMAGE_FIXTURES.gridDefect
    const viewer = await openImage(windowWithTestProject, fixture.fileName)
    const out = await armSaveDialog(appWithTestProject, exportDir, 'grid-defect.pdf')

    await viewer.clickExport(viewer.exportPdfButton())

    await expectPdfSinglePageOfSize(
      await readExported(out),
      PDF_GRID_DEFECT_SIZE.width,
      PDF_GRID_DEFECT_SIZE.height
    )
  })
})
