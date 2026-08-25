// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The per-format export matrix, run from the FULL-SCREEN OVERLAY (issue #73,
 * acceptance criterion 1).
 *
 * AC 1 asks for both surfaces: "each of the three actions works from both the
 * panel toolbar and the full-screen overlay for all eight supported formats".
 * `image-export.e2e.ts` and `image-export.matrix.e2e.ts` pin the 3 x 8 grid on
 * the panel toolbar; this file pins the same grid on the overlay, so the second
 * surface is covered per format rather than by one PNG sample in
 * `image-export.behaviour.e2e.ts`.
 *
 * The two surfaces are not obviously interchangeable from a test's point of
 * view. The overlay is a portal rendered into `#portal-root` with the SAME test
 * ids as the panel, it is `aria-modal`, and while it is open the settled
 * sentence goes to the in-overlay live region instead of a toast the modal
 * would hide. So each row here asserts through overlay-scoped locators
 * (`fullScreen*` on the POM) and reads the announcement, not the toast.
 *
 * Split from the panel matrix so both files stay well under the 500-line cap,
 * and so the clipboard half can be serial without dragging the PDF half onto
 * one worker.
 *
 * Conventions: condition-based waits only, no test-only production hook, and
 * the clipboard — one global OS resource — runs serial.
 *
 * @see e2e/image-export.matrix.e2e.ts (the same grid on the panel toolbar)
 * @see temp/design-73.md § 12 Test plan
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
  readExported
} from './utils/image-export-helpers'
import {
  IMAGE_EXPORT_COPY,
  IMAGE_EXPORT_TOAST_COPY
} from '../src/renderer/src/components/Panels/ImageViewerPanel/imageViewerStatus.logic'
import {
  GIF_FRAME_COUNT,
  ICO_SIZES,
  readPngHeader,
  type ImageFixture
} from './fixtures/images/generateImageFixtures'

// Seed one text file so the tree is never empty for a reason unrelated to
// images; the images themselves are seeded by `imageExportTest`'s
// `testProject` override (see `e2e/utils/image-export-helpers.ts`).
test.use({ testProjectFiles: { 'notes.md': '# Notes\n' } })

/**
 * Separator the toast/announcement builder puts between a subject and its
 * qualifier.
 *
 * Mirrors `QUALIFIER_SEPARATOR` in `imageExportToast.logic.ts`, which is module
 * private. Restating it is deliberate: this is an assertion about the sentence
 * a screen reader speaks, so a change to that separator SHOULD fail here rather
 * than be absorbed by importing whatever the implementation currently uses.
 */
const QUALIFIER_SEPARATOR = ' – '

/**
 * The qualifier the announcement carries for a format, or `null` for the five
 * formats where no choice was made.
 *
 * Asserted rather than skipped over with a substring match: three of the eight
 * formats involve a real decision — a frame, a size, a scale factor — and the
 * announcement is where the user is told which one was taken.
 *
 * @param key - Format key from `FORMAT_ROWS`
 * @param fixture - That format's seeded fixture
 */
function expectedQualifier(key: string, fixture: ImageFixture): string | null {
  if (key === 'gif') return IMAGE_EXPORT_TOAST_COPY.gifFrame(GIF_FRAME_COUNT)
  if (key === 'ico') {
    const largest = Math.max(...ICO_SIZES)
    return IMAGE_EXPORT_TOAST_COPY.icoSize(largest, largest, ICO_SIZES.length)
  }
  if (key === 'svg') {
    return IMAGE_EXPORT_TOAST_COPY.svgScaled(fixture.expected.width, fixture.expected.height)
  }
  return null
}

/**
 * The full sentence the in-overlay live region must settle on.
 *
 * @param title - Toast title for the action
 * @param subject - Body before any qualifier
 * @param qualifier - Format-specific clause, or `null`
 */
function announcement(title: string, subject: string, qualifier: string | null): string {
  return qualifier ? `${title}: ${subject}${QUALIFIER_SEPARATOR}${qualifier}` : `${title}: ${subject}`
}

// =============================================================================
// Tests — PNG export from the overlay, every format
// =============================================================================

test.describe('image export – overlay PNG per format', () => {
  for (const [key, fixture] of FORMAT_ROWS) {
    test(`should export a real PNG at the source's own pixel size from the overlay when the source is a .${key}`, async ({
      appWithTestProject,
      windowWithTestProject,
      exportDir
    }) => {
      const viewer = await openImage(windowWithTestProject, fixture.fileName)
      await viewer.enterFullScreen()

      const target = `overlay-${key}.png`
      const out = await armSaveDialog(appWithTestProject, exportDir, target)

      await viewer.clickExport(viewer.fullScreenExportPngButton())

      const header = readPngHeader(await readExported(out))
      expect({ width: header.width, height: header.height }).toEqual(fixture.expected)

      // The overlay is `aria-modal`, so the settled sentence belongs to the
      // in-overlay live region, not to a toast painted behind it.
      await viewer.expectExportAnnouncement(
        announcement(
          IMAGE_EXPORT_COPY.png.toastTitle,
          IMAGE_EXPORT_TOAST_COPY.saved(target),
          expectedQualifier(key, fixture)
        ),
        EXPORT_BUDGET_MS
      )
    })
  }
})

// =============================================================================
// Tests — PDF export from the overlay, every format
// =============================================================================

test.describe('image export – overlay PDF per format', () => {
  for (const [key, fixture] of FORMAT_ROWS) {
    test(`should produce a single-page PDF at the source's own pixel size from the overlay when the source is a .${key}`, async ({
      appWithTestProject,
      windowWithTestProject,
      exportDir
    }) => {
      const viewer = await openImage(windowWithTestProject, fixture.fileName)
      await viewer.enterFullScreen()

      const out = await armSaveDialog(appWithTestProject, exportDir, `overlay-${key}.pdf`)

      await viewer.clickExport(viewer.fullScreenExportPdfButton())

      await expectPdfSinglePageOfSize(
        await readExported(out),
        fixture.expected.width,
        fixture.expected.height
      )
    })
  }
})

// =============================================================================
// Tests — copy to clipboard from the overlay, every format
// =============================================================================

// The clipboard is one global OS resource. Serial mode keeps every row on one
// worker and in order, so no row can read an image another one wrote.
test.describe.serial('image export – overlay clipboard per format', () => {
  for (const [key, fixture] of FORMAT_ROWS) {
    test(`should put a non-empty image of the source's own size on the clipboard from the overlay when the source is a .${key}`, async ({
      appWithTestProject,
      windowWithTestProject
    }) => {
      const viewer = await openImage(windowWithTestProject, fixture.fileName)
      await viewer.enterFullScreen()

      // Cleared FIRST, and confirmed empty, so `empty: false` below is evidence
      // this export wrote something — two fixtures share a pixel size.
      await clearClipboard(appWithTestProject)

      await viewer.clickExport(viewer.fullScreenCopyButton())
      await viewer.expectExportAnnouncement(
        announcement(
          IMAGE_EXPORT_COPY.clipboard.toastTitle,
          IMAGE_EXPORT_TOAST_COPY.copied,
          expectedQualifier(key, fixture)
        ),
        EXPORT_BUDGET_MS
      )

      const clip = await readClipboardImage(appWithTestProject)
      expect(clip.empty, `.${key} put nothing on the clipboard from the overlay`).toBe(false)
      expect({ width: clip.width, height: clip.height }).toEqual(fixture.expected)
    })
  }
})
