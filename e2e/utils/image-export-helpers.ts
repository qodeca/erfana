// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Support helpers for the image-export e2e spec (issue #73).
 *
 * Split out of `e2e/image-export.e2e.ts` to keep that spec under the 500-line
 * cap. Everything here is about reaching the two surfaces the spec has to
 * observe and Playwright cannot: the **native save dialog**, which is stubbed
 * at the Electron level rather than through any production test hook, and the
 * **main process**, which owns the only real image decoder (`nativeImage`) and
 * the only clipboard the app ever writes to.
 *
 * Two rules the spec depends on and this module enforces:
 * - the clipboard is read back through the main process, never
 *   `navigator.clipboard`, because that is the only place the app writes it;
 * - an export is "done" when its bytes are on disk with a non-zero length, not
 *   when the file exists — the write is not atomic.
 *
 * @module imageExportHelpers
 * @see docs/testing/e2e-testing.md
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { stubDialog } from 'electron-playwright-helpers'
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import { test as base } from '../fixtures/index'
import {
  IMAGE_FIXTURES,
  NON_FORMAT_FIXTURE_KEYS,
  writeImageFixtures,
  type ImageFixture
} from '../fixtures/images/generateImageFixtures'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import {
  PDF_POINTS_PER_CSS_PIXEL,
  verifyPdfGeometry
} from '../../src/main/services/imageExport/pdfGeometry'
import { IMAGE_EXPORT } from '../../src/shared/ipc/image-export-schema'
import { ImageViewerPage } from '../pages/image-viewer.page'

/**
 * Budget for an export to reach the disk.
 *
 * An export spawns a hidden BrowserWindow, loads a page into a fresh session,
 * decodes, rasterizes and writes. Windows adds Defender's on-access scan of the
 * freshly written file.
 */
export const EXPORT_BUDGET_MS = process.platform === 'win32' ? 20_000 : 15_000

/**
 * Every settled toast on screen.
 *
 * `ToastNotification` suffixes its testid with the toast type, so there is no
 * single `toast` id to match; this two-selector list is what "any toast" means.
 */
export const ANY_TOAST =
  `[data-testid="${TEST_IDS.TOAST}-success"], [data-testid="${TEST_IDS.TOAST}-error"]`

/** Open an image from the project tree and return its POM, ready to export. */
export async function openImage(window: Page, fileName: string): Promise<ImageViewerPage> {
  const viewer = new ImageViewerPage(window, EXPORT_BUDGET_MS)
  await viewer.openFromTree(fileName)
  return viewer
}

/**
 * Point the next save dialog at `target` inside `exportDir`.
 *
 * The native dialog cannot be driven by Playwright, so it is stubbed with
 * `stubDialog` — the same seam `showOpenDialog` already uses in
 * `e2e/utils/helpers.ts`, and NOT a test-only branch in production code.
 * `stubDialog` stubs one call, so this is re-armed before every export that
 * opens a dialog; clipboard exports never open one.
 *
 * @param app - The Electron application under test
 * @param exportDir - Directory outside the project to write into
 * @param target - Basename the dialog should "return"
 * @returns The full path the export will be written to
 */
export async function armSaveDialog(
  app: ElectronApplication,
  exportDir: string,
  target: string
): Promise<string> {
  const filePath = path.join(exportDir, target)
  await stubDialog(app, 'showSaveDialog', { canceled: false, filePath })
  return filePath
}

/** Make the next save dialog report a cancellation. */
export async function armCancelledSaveDialog(app: ElectronApplication): Promise<void> {
  await stubDialog(app, 'showSaveDialog', { canceled: true, filePath: undefined })
}

/**
 * Wait until an export has actually landed on disk, then return its bytes.
 *
 * Polls the file's SIZE rather than its existence: the write is not atomic, and
 * a zero-byte file is exactly the failure a naive existence check would call a
 * pass.
 *
 * @param filePath - Where the export was told to write
 * @returns The written bytes
 */
export async function readExported(filePath: string): Promise<Buffer> {
  await expect
    .poll(
      async () => {
        try {
          return (await fs.promises.stat(filePath)).size
        } catch {
          return 0
        }
      },
      {
        timeout: EXPORT_BUDGET_MS,
        message: `export never appeared at ${path.basename(filePath)}`
      }
    )
    .toBeGreaterThan(0)

  return fs.promises.readFile(filePath)
}

/**
 * The toast whose message contains `text`.
 *
 * @param window - The app window
 * @param text - Substring of the toast body
 */
export function toastWithMessage(window: Page, text: string): Locator {
  return window.locator(ANY_TOAST).filter({ hasText: text })
}

/**
 * Read the top-left pixel of an image file through the main process.
 *
 * `nativeImage` is the only real decoder available to a test, and it lives in
 * the main process.
 *
 * @param app - The Electron application under test
 * @param filePath - Image to decode
 * @returns The pixel as BGRA, which is what `toBitmap()` produces
 */
export async function topLeftPixel(
  app: ElectronApplication,
  filePath: string
): Promise<number[]> {
  return app.evaluate(async ({ nativeImage }, target) => {
    const image = nativeImage.createFromPath(target)
    return Array.from(image.toBitmap().subarray(0, 4))
  }, filePath)
}

/** What {@link readClipboardImage} reports. */
export interface ClipboardImageReport {
  empty: boolean
  width: number
  height: number
  /** Top-left pixel as BGRA, or `[]` when the clipboard holds no image. */
  topLeft: number[]
}

/**
 * What the clipboard currently holds, read main-side.
 *
 * Never `navigator.clipboard`: the renderer is sandboxed and the app writes the
 * clipboard through Electron's main-process module, so that is the only place
 * an assertion can observe what the user would paste.
 *
 * @param app - The Electron application under test
 */
export async function readClipboardImage(
  app: ElectronApplication
): Promise<ClipboardImageReport> {
  return app.evaluate(async ({ clipboard }) => {
    const image = clipboard.readImage()
    const size = image.getSize()
    return {
      empty: image.isEmpty(),
      width: size.width,
      height: size.height,
      topLeft: image.isEmpty() ? [] : Array.from(image.toBitmap().subarray(0, 4))
    }
  })
}

/**
 * Empty the clipboard, main-side.
 *
 * A matrix that copies eight formats in a row cannot tell "this format copied
 * an image of 33 x 22" from "this format copied nothing and the previous
 * format's 33 x 22 image is still there" — two fixtures deliberately share a
 * pixel size (`photo.jpg` and `photo-copy.jpeg`). Clearing first turns the
 * `empty === false` assertion into a real one.
 *
 * @param app - The Electron application under test
 */
export async function clearClipboard(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ clipboard }) => {
    clipboard.clear()
  })

  // Condition-based, not a sleep: the write above is an IPC round trip, and the
  // next assertion is only meaningful once the board really reads empty.
  await expect
    .poll(async () => (await readClipboardImage(app)).empty, {
      timeout: EXPORT_BUDGET_MS,
      message: 'clipboard never reported empty after clear()'
    })
    .toBe(true)
}

/**
 * Assert a produced PDF is exactly one page of `width` x `height` CSS pixels.
 *
 * Runs the SAME `verifyPdfGeometry` the runtime gate uses and then restates the
 * arithmetic with the gate's OWN tolerance constant, so a relaxed gate cannot
 * quietly relax this assertion too. The tolerance is genuinely needed: Chromium
 * rounds the page box to a device unit, so a 137 px image comes back as
 * 102.96 pt rather than the exact 102.75, and on the `px % 8 === 6` grid the
 * overshoot reaches 0.54 pt — which is why the shared constant is one whole CSS
 * pixel (0.75 pt) rather than the half point it started as.
 *
 * @param pdf - The exported bytes
 * @param width - Expected page width in CSS pixels
 * @param height - Expected page height in CSS pixels
 */
export async function expectPdfSinglePageOfSize(
  pdf: Buffer,
  width: number,
  height: number
): Promise<void> {
  const verdict = verifyPdfGeometry(pdf, width, height)

  expect(verdict, `PDF geometry rejected: ${JSON.stringify(verdict)}`).toMatchObject({
    ok: true,
    pageCount: 1
  })

  if (verdict.ok) {
    const tolerance = IMAGE_EXPORT.PDF_MEDIABOX_TOLERANCE_PT
    expect(Math.abs(verdict.widthPt - width * PDF_POINTS_PER_CSS_PIXEL)).toBeLessThanOrEqual(
      tolerance
    )
    expect(Math.abs(verdict.heightPt - height * PDF_POINTS_PER_CSS_PIXEL)).toBeLessThanOrEqual(
      tolerance
    )
  }
}

/**
 * The eight supported extensions, in the order acceptance criterion 1 lists
 * them, each paired with its seeded fixture.
 *
 * Derived from `IMAGE_FIXTURES` minus the fixtures that stand for something
 * other than an extension, rather than hand-listed, so a ninth supported format
 * cannot be added to the fixture table and silently skipped by a matrix. Shared
 * by every matrix spec so the surfaces are all held to the SAME row set.
 */
export const FORMAT_ROWS: [string, ImageFixture][] = Object.entries(IMAGE_FIXTURES).filter(
  ([key]) => !(NON_FORMAT_FIXTURE_KEYS as readonly string[]).includes(key)
)

/** The extensions `FORMAT_ROWS` must cover, verbatim from the criterion. */
export const SUPPORTED_FORMAT_KEYS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico'
] as const

/** Extra fixtures every image-export spec composes on top of the base set. */
export interface ImageExportFixtures {
  /** Directory every stubbed save dialog writes into. Outside the project. */
  exportDir: string
}

/**
 * The composed `test` every image-export spec uses.
 *
 * Defined once, here, rather than repeated per spec: three specs seeding their
 * own binaries would be three chances for the seeding rule below to drift.
 *
 * The images are seeded by OVERRIDING `testProject` rather than through
 * `testProjectFiles`, which only carries text. Overriding keeps the write
 * inside the fixture that owns the directory, so the binaries are on disk
 * before Electron launches and before the project tree is first read — a file
 * that appeared later would put the test at the mercy of the directory watcher.
 *
 * `exportDir` is per TEST, so two specs (or two workers) never write into one
 * another's directory and "the only file here is the one I exported" stays a
 * legitimate assertion.
 */
export const imageExportTest = base.extend<ImageExportFixtures>({
  testProject: async ({ testProject }, use) => {
    writeImageFixtures(testProject.path)
    await use(testProject)
  },

  // eslint-disable-next-line no-empty-pattern
  exportDir: async ({}, use) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'erfana-image-export-'))
    await use(dir)
    await fs.promises.rm(dir, { recursive: true, force: true })
  }
})
