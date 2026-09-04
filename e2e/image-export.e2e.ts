// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E tests for the image viewer's PNG / PDF / clipboard export (issue #73).
 *
 * This spec exists for exactly the things the unit suites cannot reach. jsdom
 * decodes no image format, `electron` is mocked in the main-process project,
 * and the rasterize harness only runs inside a real Chromium page — so every
 * assertion below is about bytes that a real decoder produced and a real
 * `printToPDF` / `clipboard.writeImage` consumed.
 *
 * What is proven here, and nowhere else:
 * - real pixel output for all eight supported extensions
 * - an SVG rasterized at exactly 2x its intrinsic (viewBox) size
 * - an animated GIF exporting its first frame; a multi-size ICO its largest
 * - PDF geometry: exactly one page, MediaBox = pixels x 0.75 pt, verified with
 *   the SAME `verifyPdfGeometry` the runtime gate uses, so gate and assertion
 *   cannot drift
 * - transparency: PNG keeps alpha; the white-flattened sink (shared by PDF and
 *   clipboard, § 6.5) turns a transparent pixel opaque white
 *
 * The behavioural half — fresh-from-disk, the full-screen overlay, and a
 * cancelled save dialog — lives in `image-export.behaviour.e2e.ts`, so both
 * files stay under the 500-line cap.
 *
 * Two conventions this spec is held to:
 * - **Condition-based waits only.** Every wait is either Playwright
 *   auto-waiting, a POM wait, or `expect.poll` on a real condition. No sleeps.
 * - **No test-only production hook.** The native save dialog cannot be driven
 *   by Playwright, so it is stubbed at the Electron level with `stubDialog`
 *   from `electron-playwright-helpers` — the same seam `showOpenDialog`
 *   already uses in `e2e/utils/helpers.ts`.
 *
 * The clipboard is a global OS resource, so the tests that touch it run in
 * serial mode: two workers writing the clipboard at once would read each
 * other's image back.
 *
 * @see temp/design-73.md § 12 Test plan
 * @see docs/testing/e2e-testing.md
 */

import { expect } from './fixtures/index'
import {
  armSaveDialog,
  EXPORT_BUDGET_MS,
  expectPdfSinglePageOfSize,
  FORMAT_ROWS,
  imageExportTest as test,
  openImage,
  readClipboardImage,
  readExported,
  toastWithMessage,
  topLeftPixel
} from './utils/image-export-helpers'
import { IMAGE_EXPORT_TOAST_COPY } from '../src/renderer/src/components/Panels/ImageViewerPanel/imageViewerStatus.logic'
import {
  GIF_FIRST_FRAME_COLOUR,
  GIF_FRAME_COUNT,
  ICO_SIZES,
  IMAGE_FIXTURES,
  readPngHeader
} from './fixtures/images/generateImageFixtures'

// =============================================================================
// Constants
// =============================================================================

/** PNG colour type 6: truecolour with an alpha channel. */
const PNG_COLOUR_TYPE_RGBA = 6

/** Opaque white, as `nativeImage.toBitmap()` reports it (BGRA). */
const WHITE_BGRA = [255, 255, 255, 255]

// Seed one text file so the tree is never empty for a reason unrelated to
// images; the images themselves are seeded by `imageExportTest`'s
// `testProject` override (see `e2e/utils/image-export-helpers.ts`).
test.use({ testProjectFiles: { 'notes.md': '# Notes\n' } })

// =============================================================================
// Tests — real pixels, every format
// =============================================================================

test.describe('image export – pixel output per format', () => {
  for (const [key, fixture] of FORMAT_ROWS) {
    test(`should export a real PNG at the source's own pixel size when the source is a .${key}`, async ({
      appWithTestProject,
      windowWithTestProject,
      exportDir
    }) => {
      const viewer = await openImage(windowWithTestProject, fixture.fileName)
      const out = await armSaveDialog(appWithTestProject, exportDir, `${key}-export.png`)

      await viewer.clickExport(viewer.exportPngButton())

      const header = readPngHeader(await readExported(out))
      expect(header.width).toBe(fixture.expected.width)
      expect(header.height).toBe(fixture.expected.height)
    })
  }
})

// =============================================================================
// Tests — the format-specific selections
// =============================================================================

test.describe('image export – frame and size selection', () => {
  test('should export the first frame and name the frame count when the source is an animated GIF', async ({
    appWithTestProject,
    windowWithTestProject,
    exportDir
  }) => {
    const viewer = await openImage(windowWithTestProject, IMAGE_FIXTURES.gif.fileName)
    const out = await armSaveDialog(appWithTestProject, exportDir, 'first-frame.png')

    await viewer.clickExport(viewer.exportPngButton())
    await readExported(out)

    // Frame 0 is red, frames 1 and 2 are green and blue: the pixel is the proof
    // that a later frame was not taken. BGRA, so the channels are reversed.
    const [blue, green, red] = await topLeftPixel(appWithTestProject, out)
    expect({ red, green, blue }).toEqual({
      red: GIF_FIRST_FRAME_COLOUR.r,
      green: GIF_FIRST_FRAME_COLOUR.g,
      blue: GIF_FIRST_FRAME_COLOUR.b
    })

    await expect(
      toastWithMessage(windowWithTestProject, IMAGE_EXPORT_TOAST_COPY.gifFrame(GIF_FRAME_COUNT))
    ).toBeVisible({ timeout: EXPORT_BUDGET_MS })
  })

  test('should export the largest size and name the size count when the source is a multi-size ICO', async ({
    appWithTestProject,
    windowWithTestProject,
    exportDir
  }) => {
    const largest = Math.max(...ICO_SIZES)
    const viewer = await openImage(windowWithTestProject, IMAGE_FIXTURES.ico.fileName)
    const out = await armSaveDialog(appWithTestProject, exportDir, 'largest.png')

    await viewer.clickExport(viewer.exportPngButton())

    const header = readPngHeader(await readExported(out))
    expect({ width: header.width, height: header.height }).toEqual({
      width: largest,
      height: largest
    })

    await expect(
      toastWithMessage(
        windowWithTestProject,
        IMAGE_EXPORT_TOAST_COPY.icoSize(largest, largest, ICO_SIZES.length)
      )
    ).toBeVisible({ timeout: EXPORT_BUDGET_MS })
  })
})

// =============================================================================
// Tests — PDF geometry
// =============================================================================

test.describe('image export – PDF geometry', () => {
  test('should produce a single-page PDF whose MediaBox equals the raster size in points', async ({
    appWithTestProject,
    windowWithTestProject,
    exportDir
  }) => {
    const fixture = IMAGE_FIXTURES.png
    const viewer = await openImage(windowWithTestProject, fixture.fileName)
    const out = await armSaveDialog(appWithTestProject, exportDir, 'raster.pdf')

    await viewer.clickExport(viewer.exportPdfButton())

    await expectPdfSinglePageOfSize(
      await readExported(out),
      fixture.expected.width,
      fixture.expected.height
    )
  })

  test('should size the PDF page at 2x the intrinsic size when the source is an SVG', async ({
    appWithTestProject,
    windowWithTestProject,
    exportDir
  }) => {
    const fixture = IMAGE_FIXTURES.svg
    const viewer = await openImage(windowWithTestProject, fixture.fileName)
    const out = await armSaveDialog(appWithTestProject, exportDir, 'vector.pdf')

    await viewer.clickExport(viewer.exportPdfButton())

    await expectPdfSinglePageOfSize(
      await readExported(out),
      fixture.expected.width,
      fixture.expected.height
    )
  })
})

// =============================================================================
// Tests — transparency, clipboard
// =============================================================================

test.describe('image export – transparency', () => {
  test('should keep the alpha channel when exporting a transparent PNG', async ({
    appWithTestProject,
    windowWithTestProject,
    exportDir
  }) => {
    const viewer = await openImage(windowWithTestProject, IMAGE_FIXTURES.png.fileName)
    const out = await armSaveDialog(appWithTestProject, exportDir, 'alpha-kept.png')

    await viewer.clickExport(viewer.exportPngButton())

    const header = readPngHeader(await readExported(out))
    expect(header.colourType).toBe(PNG_COLOUR_TYPE_RGBA)

    // The source's pixel (0, 0) is fully transparent, and a PNG export must not
    // put a background behind it.
    const [, , , alpha] = await topLeftPixel(appWithTestProject, out)
    expect(alpha).toBe(0)
  })
})

// The clipboard is one global OS resource. Serial mode keeps these three tests
// on one worker and in order, so no test can read an image another one wrote.
test.describe.serial('image export – clipboard', () => {
  test('should put a PNG image of the source size on the clipboard', async ({
    appWithTestProject,
    windowWithTestProject
  }) => {
    const fixture = IMAGE_FIXTURES.png
    const viewer = await openImage(windowWithTestProject, fixture.fileName)

    await viewer.clickExport(viewer.copyButton())
    await expect(
      toastWithMessage(windowWithTestProject, IMAGE_EXPORT_TOAST_COPY.copied)
    ).toBeVisible({ timeout: EXPORT_BUDGET_MS })

    const clip = await readClipboardImage(appWithTestProject)
    expect(clip.empty).toBe(false)
    expect({ width: clip.width, height: clip.height }).toEqual(fixture.expected)
  })

  test('should flatten transparency onto white when copying to the clipboard', async ({
    appWithTestProject,
    windowWithTestProject
  }) => {
    // The white-flattened canvas is a single pixel source shared by the PDF and
    // clipboard sinks (design § 6.5), so this is the automatable half of
    // "the PDF flattens alpha onto white" — a PDF's own pixels cannot be read
    // back without a rasterizer, and are on the manual checklist instead.
    const viewer = await openImage(windowWithTestProject, IMAGE_FIXTURES.png.fileName)

    await viewer.clickExport(viewer.copyButton())
    await expect(
      toastWithMessage(windowWithTestProject, IMAGE_EXPORT_TOAST_COPY.copied)
    ).toBeVisible({ timeout: EXPORT_BUDGET_MS })

    const clip = await readClipboardImage(appWithTestProject)
    expect(clip.topLeft).toEqual(WHITE_BGRA)
  })

  test('should copy an SVG to the clipboard at 2x its intrinsic size', async ({
    appWithTestProject,
    windowWithTestProject
  }) => {
    const fixture = IMAGE_FIXTURES.svg
    const viewer = await openImage(windowWithTestProject, fixture.fileName)

    await viewer.clickExport(viewer.copyButton())
    await expect(
      toastWithMessage(windowWithTestProject, IMAGE_EXPORT_TOAST_COPY.copied)
    ).toBeVisible({ timeout: EXPORT_BUDGET_MS })

    const clip = await readClipboardImage(appWithTestProject)
    expect(clip.empty).toBe(false)
    expect({ width: clip.width, height: clip.height }).toEqual(fixture.expected)
  })
})
