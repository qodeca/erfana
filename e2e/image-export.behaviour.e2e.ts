// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E tests for how the image export BEHAVES, as opposed to what it produces
 * (issue #73).
 *
 * The sibling spec, `image-export.e2e.ts`, is about bytes: real pixel output
 * per format, PDF geometry, alpha. This one is about the promises the feature
 * makes around those bytes, and each needs a whole app to prove:
 *
 * - **a conversion, not a screenshot** — the output follows the FILE, not the
 *   panel: zooming the viewer changes nothing, and rewriting the source
 *   between two exports changes everything;
 * - **the full-screen overlay is a first-class surface** — all three actions
 *   run from it, and the settled sentence goes to the in-overlay live region
 *   rather than a toast the `aria-modal` overlay would hide;
 * - **a cancelled save dialog is silent** — nothing written, nothing said.
 *
 * Split out of `image-export.e2e.ts` to keep both halves under the 500-line
 * cap. They share `e2e/utils/image-export-helpers.ts` and the fixture
 * generator, and each composes its own `exportDir`, so the two files can run in
 * parallel without writing into one another's directory.
 *
 * Two conventions this spec is held to:
 * - **Condition-based waits only.** Every wait is either Playwright
 *   auto-waiting, a POM wait, or `expect.poll` on a real condition. No sleeps.
 * - **No test-only production hook.** The native save dialog cannot be driven
 *   by Playwright, so it is stubbed at the Electron level with `stubDialog`
 *   from `electron-playwright-helpers` — the same seam `showOpenDialog`
 *   already uses in `e2e/utils/helpers.ts`.
 *
 * @see temp/design-73.md § 12 Test plan
 * @see docs/testing/e2e-testing.md
 */

import * as fs from 'fs'

import { expect } from './fixtures/index'
import {
  ANY_TOAST,
  armCancelledSaveDialog,
  armSaveDialog,
  EXPORT_BUDGET_MS,
  imageExportTest as test,
  openImage,
  readExported,
  toastWithMessage
} from './utils/image-export-helpers'
import {
  IMAGE_EXPORT_COPY,
  IMAGE_EXPORT_TOAST_COPY
} from '../src/renderer/src/components/Panels/ImageViewerPanel/imageViewerStatus.logic'
import { verifyPdfGeometry } from '../src/main/services/imageExport/pdfGeometry'
import {
  FRESH_PNG_REWRITTEN_SIZE,
  FRESH_PNG_SIZE,
  IMAGE_FIXTURES,
  readPngHeader,
  rewriteFreshPng
} from './fixtures/images/generateImageFixtures'

// Seed one text file so the tree is never empty for a reason unrelated to
// images; the images themselves are seeded by `imageExportTest`'s
// `testProject` override (see `e2e/utils/image-export-helpers.ts`).
test.use({ testProjectFiles: { 'notes.md': '# Notes\n' } })

// =============================================================================
// Tests — conversion, not a screenshot
// =============================================================================

test.describe('image export – source of truth', () => {
  test('should export the source pixels regardless of the zoom the user is viewing at', async ({
    appWithTestProject,
    windowWithTestProject,
    exportDir
  }) => {
    const fixture = IMAGE_FIXTURES.png
    const viewer = await openImage(windowWithTestProject, fixture.fileName)

    // Four zoom steps take the viewer well past 100 %: if the export were a
    // screenshot of the panel, the output would follow the zoom.
    const zoom = await viewer.zoomIn(4)
    expect(zoom).not.toBe('100%')

    const out = await armSaveDialog(appWithTestProject, exportDir, 'zoomed.png')
    await viewer.clickExport(viewer.exportPngButton())

    const header = readPngHeader(await readExported(out))
    expect({ width: header.width, height: header.height }).toEqual(fixture.expected)
  })

  test('should re-read the file from disk on every export', async ({
    appWithTestProject,
    windowWithTestProject,
    testProject,
    exportDir
  }) => {
    const viewer = await openImage(windowWithTestProject, IMAGE_FIXTURES.fresh.fileName)

    const first = await armSaveDialog(appWithTestProject, exportDir, 'fresh-1.png')
    await viewer.clickExport(viewer.exportPngButton())
    const before = readPngHeader(await readExported(first))
    expect({ width: before.width, height: before.height }).toEqual(FRESH_PNG_SIZE)

    // Rewrite the source at a different size, and wait for the viewer's own
    // metadata to report the new intrinsic size — a condition-based proof that
    // the write settled and the watcher saw it, with no sleep.
    rewriteFreshPng(testProject.path)
    await expect(viewer.dimensions()).toHaveAttribute(
      'aria-label',
      `Dimensions: ${FRESH_PNG_REWRITTEN_SIZE.width} x ${FRESH_PNG_REWRITTEN_SIZE.height}`,
      { timeout: EXPORT_BUDGET_MS }
    )

    const second = await armSaveDialog(appWithTestProject, exportDir, 'fresh-2.png')
    await viewer.clickExport(viewer.exportPngButton())
    const after = readPngHeader(await readExported(second))
    expect({ width: after.width, height: after.height }).toEqual(FRESH_PNG_REWRITTEN_SIZE)
  })
})

// =============================================================================
// Tests — the full-screen overlay
// =============================================================================

test.describe('image export – full-screen overlay', () => {
  test('should run all three export actions from the full-screen overlay', async ({
    appWithTestProject,
    windowWithTestProject,
    exportDir
  }) => {
    const fixture = IMAGE_FIXTURES.png
    const viewer = await openImage(windowWithTestProject, fixture.fileName)
    await viewer.enterFullScreen()

    await test.step('PNG from the overlay', async () => {
      const out = await armSaveDialog(appWithTestProject, exportDir, 'overlay.png')
      await viewer.clickExport(viewer.fullScreenExportPngButton())

      const header = readPngHeader(await readExported(out))
      expect({ width: header.width, height: header.height }).toEqual(fixture.expected)

      // While the overlay is `aria-modal`, the settled sentence goes into the
      // in-overlay live region instead of being left to the toast outside it.
      await viewer.expectExportAnnouncement(
        `${IMAGE_EXPORT_COPY.png.toastTitle}: ${IMAGE_EXPORT_TOAST_COPY.saved('overlay.png')}`,
        EXPORT_BUDGET_MS
      )
    })

    await test.step('PDF from the overlay', async () => {
      const out = await armSaveDialog(appWithTestProject, exportDir, 'overlay.pdf')
      await viewer.clickExport(viewer.fullScreenExportPdfButton())

      const verdict = verifyPdfGeometry(
        await readExported(out),
        fixture.expected.width,
        fixture.expected.height
      )
      expect(verdict, `PDF geometry rejected: ${JSON.stringify(verdict)}`).toMatchObject({
        ok: true,
        pageCount: 1
      })
    })

    await test.step('copy from the overlay', async () => {
      await viewer.clickExport(viewer.fullScreenCopyButton())
      await viewer.expectExportAnnouncement(
        `${IMAGE_EXPORT_COPY.clipboard.toastTitle}: ${IMAGE_EXPORT_TOAST_COPY.copied}`,
        EXPORT_BUDGET_MS
      )
    })
  })
})

// =============================================================================
// Tests — cancellation
// =============================================================================

test.describe('image export – cancellation', () => {
  test('should write nothing and show no toast when the save dialog is cancelled', async ({
    appWithTestProject,
    windowWithTestProject,
    exportDir
  }) => {
    const viewer = await openImage(windowWithTestProject, IMAGE_FIXTURES.png.fileName)

    await armCancelledSaveDialog(appWithTestProject)
    await viewer.clickExport(viewer.exportPngButton())

    // A cancellation is deliberately silent, so it offers no settle signal of
    // its own. A SECOND, successful export provides one: when its toast is up,
    // the cancelled run has certainly finished, and the assertions below are
    // then about a settled app rather than a race.
    const out = await armSaveDialog(appWithTestProject, exportDir, 'after-cancel.png')
    await viewer.clickExport(viewer.exportPngButton())
    await expect(
      toastWithMessage(
        windowWithTestProject,
        IMAGE_EXPORT_TOAST_COPY.saved('after-cancel.png')
      )
    ).toBeVisible({ timeout: EXPORT_BUDGET_MS })
    await readExported(out)

    // The cancelled export wrote no file: the only thing in the directory is
    // the second export.
    expect(await fs.promises.readdir(exportDir)).toEqual(['after-cancel.png'])

    // ...and said nothing: exactly one toast is on screen, the successful one.
    await expect(windowWithTestProject.locator(ANY_TOAST)).toHaveCount(1)
  })
})
