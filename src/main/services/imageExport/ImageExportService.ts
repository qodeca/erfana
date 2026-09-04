// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Exporting the image a viewer tab is showing, as PNG, as PDF, or to the
 * clipboard.
 *
 * The whole job happens in the main process. The renderer sends a path and a
 * target; it never sees a byte of image data, in either direction. That is not
 * only a security preference — at the 50 MB source cap, round-tripping the
 * bytes as base64 would put ~67 MB through IPC each way and block the UI
 * thread while it encoded.
 *
 * ## What "export" means here (requirements 1 and 2)
 *
 * A CONVERSION of the file, never a screenshot of the panel. The bytes are
 * read fresh from disk at the moment the user clicks, on every single run, so
 * the panel's zoom, pan and cached `<img>` are irrelevant and a file that
 * changed on disk exports as it is now, not as it was when the tab opened.
 *
 * ## Order of operations, and why
 *
 * The lock is acquired AFTER the save dialog closes, not before. Holding a
 * process-wide mutex across a modal dialog means one user sitting in a file
 * picker blocks every other image tab indefinitely — and it pins a 64 MP page
 * open the whole time. The cost of the reorder is that decode-class failures
 * surface after the filename has been chosen; the common failures (missing
 * file, out-of-project path, over-size file) still fail before the dialog.
 *
 * Every failure leaves this class through one point, which is what makes the
 * `error` string on the wire reliably `ERROR_MESSAGES[errorCode]` rather than
 * "Unknown error".
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 * @see src/shared/ipc/image-export-schema.ts for the wire contract
 */
import { dialog, type BrowserWindow } from 'electron'
import { readFile, stat } from 'fs/promises'
import { extname } from 'path'
import { ErrorCode, ERROR_MESSAGES } from '../../../shared/errors'
import {
  IMAGE_EXPORT,
  type ImageExportErrorCode,
  type ImageExportResponse,
  type ImageExportSelection,
  type ImageExportTarget,
  type HarnessFailureReason,
  type HarnessRender,
  type HarnessResult
} from '../../../shared/ipc/image-export-schema'
import { getImageMimeType } from '../../../shared/ipc/image-formats'
import { assertInsideProject } from '../../utils/projectConfinement'
import { ExportLock } from '../../utils/ExportLock'
import { redactPath, redactedLogError } from '../../utils/redactUserInput'
import { logger } from '../LoggingService'
import { fileService } from '../FileService'
import { MAX_IMAGE_SIZE } from '../file/imageRead'
import {
  countGifFrames,
  readIcoDirectory,
  readSvgIntrinsicSize,
  type IcoDirectory,
  type PixelSize
} from './imageMetadata'
import { readDeclaredDimensions } from './declaredDimensions'
import { forceExtension, isSameExistingFile, suggestExportFilename } from './exportPaths'
import { ImageRasterizeWindow } from './ImageRasterizeWindow'
import { copyPngToClipboard, writePdfFile, writePngFile } from './exportSinks'

/** What `run` needs from its caller. `parentWindow` makes the dialog modal. */
export interface ImageExportRunOptions {
  filePath: string
  target: ImageExportTarget
  parentWindow: BrowserWindow | null
}

/** Extension each file-writing target produces. */
const TARGET_EXTENSION: Record<'png' | 'pdf', string> = { png: '.png', pdf: '.pdf' }

/** Save-dialog copy per target. */
const SAVE_DIALOG_COPY = {
  png: { title: 'Export image as PNG', filterName: 'PNG Images' },
  pdf: { title: 'Export image as PDF', filterName: 'PDF Documents' }
} as const

/**
 * Harness failure reason → the code the user sees.
 *
 * Keyed by the reason UNION, not by `string`: a fourth member added to
 * `HARNESS_FAILURE_REASONS` would otherwise pass the schema, index to
 * `undefined` here, and produce a response with no code and no message at all.
 * Typed this way it is a compile error instead.
 */
const HARNESS_FAILURE_CODES: Record<HarnessFailureReason, ImageExportErrorCode> = {
  decode: ErrorCode.IMAGE_EXPORT_DECODE_FAILED,
  'too-large': ErrorCode.IMAGE_EXPORT_OUTPUT_TOO_LARGE,
  encode: ErrorCode.IMAGE_EXPORT_FAILED
}

/** Everything the byte-parsing pass concluded about one source file. */
interface ExportPlan {
  /** Explicit canvas size (SVG only); `null` means "use the decoded size". */
  targetSize: PixelSize | null
  /** Frame count of an animated GIF, when there is more than one. */
  gifFrameCount: number | null
  /** Parsed ICO directory, when the source is an icon file. */
  ico: IcoDirectory | null
}

/**
 * Where a save dialog ended up.
 *
 * The failure branch carries the caught cause, if there was one, so the single
 * `fail()` call site can log it — this type exists to keep the dialog step from
 * needing a logging path of its own.
 */
type DestinationOutcome =
  | { status: 'ok'; path: string }
  | { status: 'cancelled' }
  | { status: 'error'; code: ImageExportErrorCode; error?: unknown }

export class ImageExportService {
  private readonly exportLock = new ExportLock()

  /**
   * Export one image.
   *
   * @param options - Source path, target, and the window the dialog belongs to.
   * @returns A structured result. Never throws and never rejects: every
   *          failure is a `success: false` branch carrying a code and the
   *          user-facing message for it.
   */
  async run(options: ImageExportRunOptions): Promise<ImageExportResponse> {
    const { filePath, target } = options
    const extension = extname(filePath).toLowerCase()

    const readable = await this.checkSource(filePath)
    if (readable) return readable

    let destination: string | null = null
    if (target !== 'clipboard') {
      const outcome = await this.resolveDestination(options, target)
      if (outcome.status === 'cancelled') return this.cancelled(filePath)
      if (outcome.status === 'error') return this.fail(outcome.code, filePath, outcome.error)
      destination = outcome.path
    }

    if (!this.exportLock.acquire()) {
      return this.fail(ErrorCode.IMAGE_EXPORT_BUSY, filePath)
    }
    try {
      return await this.rasterizeAndDeliver(filePath, extension, target, destination)
    } catch (error) {
      return this.fail(ErrorCode.IMAGE_EXPORT_FAILED, filePath, error)
    } finally {
      this.exportLock.release()
    }
  }

  /**
   * Confinement and the size cap, both before the dialog opens.
   *
   * @returns A failure response, or `null` when the source is usable.
   */
  private async checkSource(filePath: string): Promise<ImageExportResponse | null> {
    try {
      await assertInsideProject(filePath, fileService.getProjectPath())
    } catch (error) {
      return this.fail(ErrorCode.IMAGE_EXPORT_SOURCE_UNREADABLE, filePath, error)
    }

    try {
      const stats = await stat(filePath)
      if (stats.size > MAX_IMAGE_SIZE) {
        return this.fail(ErrorCode.IMAGE_EXPORT_SOURCE_TOO_LARGE, filePath)
      }
    } catch (error) {
      return this.fail(ErrorCode.IMAGE_EXPORT_SOURCE_UNREADABLE, filePath, error)
    }
    return null
  }

  /** Show the save dialog and guard the chosen path against the source. */
  private async resolveDestination(
    options: ImageExportRunOptions,
    target: 'png' | 'pdf'
  ): Promise<DestinationOutcome> {
    const extension = TARGET_EXTENSION[target]
    const copy = SAVE_DIALOG_COPY[target]
    const dialogOptions = {
      title: copy.title,
      defaultPath: suggestExportFilename(options.filePath, extension),
      buttonLabel: 'Export',
      filters: [{ name: copy.filterName, extensions: [extension.slice(1)] }]
    }

    // `showSaveDialog` is the only awaited call in `run` that sits outside a
    // guarded block, and it CAN reject — a parent window destroyed while the
    // picker is up, or a platform-level failure. Unguarded it would escape the
    // class, lose its code, and land on the handler's belt-and-braces catch,
    // putting a hole in the single-error-mapping-point invariant above.
    let result: Awaited<ReturnType<typeof dialog.showSaveDialog>>
    try {
      result = options.parentWindow
        ? await dialog.showSaveDialog(options.parentWindow, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
    } catch (error) {
      return { status: 'error', code: ErrorCode.IMAGE_EXPORT_FAILED, error }
    }

    if (result.canceled || !result.filePath) return { status: 'cancelled' }

    const chosen = forceExtension(result.filePath, extension)
    if (await isSameExistingFile(chosen, options.filePath)) {
      return { status: 'error', code: ErrorCode.IMAGE_EXPORT_SOURCE_COLLISION }
    }
    return { status: 'ok', path: chosen }
  }

  /**
   * The part that runs under the lock: one fresh read, one bounded parse of
   * those bytes, one hidden window, one sink.
   */
  private async rasterizeAndDeliver(
    filePath: string,
    extension: string,
    target: ImageExportTarget,
    destination: string | null
  ): Promise<ImageExportResponse> {
    let buffer: Buffer
    try {
      // Requirement 2: the authoritative bytes, read now. Nothing is cached
      // between runs and nothing is reused from the panel.
      buffer = await readFile(filePath)
    } catch (error) {
      return this.fail(ErrorCode.IMAGE_EXPORT_SOURCE_UNREADABLE, filePath, error)
    }

    const plan = this.buildPlan(buffer, extension)
    if ('code' in plan) return this.fail(plan.code, filePath)

    const mimeType = getImageMimeType(extension)
    if (!mimeType) return this.fail(ErrorCode.IMAGE_EXPORT_INVALID_REQUEST, filePath)

    const instruction: Omit<HarnessRender, 'token'> = {
      mimeType,
      bytes: buffer,
      mode: extension === '.svg' ? 'svg' : 'bitmap',
      targetSize: plan.targetSize,
      background: target === 'png' ? 'transparent' : 'white',
      deliver: target === 'pdf' ? 'page' : 'bytes',
      maxPixels: IMAGE_EXPORT.MAX_OUTPUT_PIXELS
    }

    let harness: ImageRasterizeWindow
    try {
      harness = await ImageRasterizeWindow.open()
    } catch (error) {
      return this.fail(ErrorCode.IMAGE_EXPORT_FAILED, filePath, error)
    }

    try {
      const rendered = await this.renderWithIcoGate(harness, instruction, buffer, plan)
      if ('code' in rendered) return this.fail(rendered.code, filePath)
      return await this.deliver(harness, rendered, filePath, extension, target, destination, plan)
    } finally {
      harness.destroy()
    }
  }

  /** Parse the one authoritative buffer for everything the export needs. */
  private buildPlan(
    buffer: Buffer,
    extension: string
  ): ExportPlan | { code: ImageExportErrorCode } {
    if (extension === '.svg') {
      const intrinsic = readSvgIntrinsicSize(buffer, IMAGE_EXPORT.SVG_HEADER_WINDOW_BYTES)
      if (!intrinsic) return { code: ErrorCode.IMAGE_EXPORT_DECODE_FAILED }
      const targetSize = {
        width: intrinsic.width * IMAGE_EXPORT.SVG_RASTER_SCALE,
        height: intrinsic.height * IMAGE_EXPORT.SVG_RASTER_SCALE
      }
      if (targetSize.width * targetSize.height > IMAGE_EXPORT.MAX_OUTPUT_PIXELS) {
        return { code: ErrorCode.IMAGE_EXPORT_SVG_TOO_LARGE }
      }
      return { targetSize, gifFrameCount: null, ico: null }
    }

    // The decompression-bomb gate: the DECLARED size is checked here, before
    // any byte is handed to a renderer that would try to allocate for it.
    const declared = readDeclaredDimensions(buffer, extension)
    if (!declared) return { code: ErrorCode.IMAGE_EXPORT_DECODE_FAILED }
    if (declared.width * declared.height > IMAGE_EXPORT.MAX_OUTPUT_PIXELS) {
      return { code: ErrorCode.IMAGE_EXPORT_OUTPUT_TOO_LARGE }
    }

    return {
      // Requirement 3: raster sources are never resized. The harness uses the
      // size Chromium decoded.
      targetSize: null,
      gifFrameCount: extension === '.gif' ? countGifFrames(buffer) : null,
      ico: extension === '.ico' ? readIcoDirectory(buffer) : null
    }
  }

  /**
   * Render, then hold the result to requirement 5's promise for icon files.
   *
   * Chromium is BELIEVED to pick the largest entry in an `.ico`, but that is
   * not observable from here and a wrong guess would silently export a 16x16
   * image where the user expected 256x256. So it is checked. If the largest
   * entry happens to carry a PNG payload, that slice is re-rendered directly —
   * a normal runtime path, not a plan B. If it is a BMP payload (the usual
   * case at 48x48 and 128x128), the export fails honestly.
   *
   * The extracted slice goes through `readDeclaredDimensions` before it is
   * sent, exactly as the source file did. Skipping that would open a hole the
   * outer gate cannot close: an ICO directory stores width and height as SINGLE
   * BYTES (`0` meaning 256), so `readIcoSize` can never report more than 65536
   * pixels and the preflight in `buildPlan` therefore ALWAYS passes for an
   * icon — while the PNG inside a "256x256" entry is free to declare
   * 60000 x 60000 in its own IHDR.
   */
  private async renderWithIcoGate(
    harness: ImageRasterizeWindow,
    instruction: Omit<HarnessRender, 'token'>,
    buffer: Buffer,
    plan: ExportPlan
  ): Promise<Extract<HarnessResult, { ok: true }> | { code: ImageExportErrorCode }> {
    const first = await harness.render(instruction)
    if (!first.ok) return { code: HARNESS_FAILURE_CODES[first.reason] }

    const largest = plan.ico?.largest
    if (!largest) return first
    if (first.width === largest.width && first.height === largest.height) return first

    const slice = buffer.subarray(largest.offset, largest.offset + largest.byteLength)
    // `null` means the slice is not a PNG at all (a BMP payload, the usual
    // case) — the same verdict the old signature check gave, from a stricter
    // read: the full eight-byte signature plus a well-formed IHDR.
    const declared = readDeclaredDimensions(slice, '.png')
    if (!declared) return { code: ErrorCode.IMAGE_EXPORT_ICO_SIZE_MISMATCH }
    if (declared.width * declared.height > IMAGE_EXPORT.MAX_OUTPUT_PIXELS) {
      return { code: ErrorCode.IMAGE_EXPORT_OUTPUT_TOO_LARGE }
    }

    const retry = await harness.render({ ...instruction, bytes: slice, mimeType: 'image/png' })
    if (!retry.ok) return { code: HARNESS_FAILURE_CODES[retry.reason] }
    if (retry.width !== largest.width || retry.height !== largest.height) {
      return { code: ErrorCode.IMAGE_EXPORT_ICO_SIZE_MISMATCH }
    }
    return retry
  }

  /** Hand the finished pixels to the sink the target asked for. */
  private async deliver(
    harness: ImageRasterizeWindow,
    rendered: Extract<HarnessResult, { ok: true }>,
    filePath: string,
    extension: string,
    target: ImageExportTarget,
    destination: string | null,
    plan: ExportPlan
  ): Promise<ImageExportResponse> {
    const output = { width: rendered.width, height: rendered.height }
    let outcome

    if (target === 'pdf') {
      outcome = await writePdfFile(destination!, harness, output.width, output.height)
    } else if (!rendered.pngBytes) {
      return this.fail(ErrorCode.IMAGE_EXPORT_FAILED, filePath)
    } else if (target === 'png') {
      outcome = await writePngFile(destination!, rendered.pngBytes)
    } else {
      outcome = copyPngToClipboard(rendered.pngBytes)
    }

    if (!outcome.ok) return this.fail(outcome.code, filePath)

    const selection = this.describeSelection(extension, plan, output)
    return {
      success: true,
      target,
      ...(destination ? { filePath: destination } : {}),
      output,
      ...(selection ? { selection } : {})
    }
  }

  /**
   * Describe the choice the export had to make, when there was one.
   *
   * Suppressed for a single-frame GIF and a single-size ICO: "first frame of
   * 1" is noise, and a parser that returned `null` gets silence rather than a
   * guess.
   */
  private describeSelection(
    extension: string,
    plan: ExportPlan,
    output: PixelSize
  ): ImageExportSelection | undefined {
    if (extension === '.svg') {
      return { kind: 'svg-scaled', scale: IMAGE_EXPORT.SVG_RASTER_SCALE, ...output }
    }
    if (plan.gifFrameCount !== null && plan.gifFrameCount > 1) {
      return { kind: 'gif-frame', frameCount: plan.gifFrameCount }
    }
    const sizeCount = plan.ico?.entries.length ?? 0
    if (sizeCount > 1) {
      return { kind: 'ico-size', sizeCount, ...output }
    }
    return undefined
  }

  /** The one place a failure response is built, so `error` can never drift. */
  private fail(
    code: ImageExportErrorCode,
    sourcePath: string,
    error?: unknown
  ): ImageExportResponse {
    logger.error(`Image export failed (${code})`, redactedLogError(error), {
      source: redactPath(sourcePath)
    })
    return { success: false, errorCode: code, error: ERROR_MESSAGES[code] }
  }

  /** Cancellation is a normal outcome, not a failure — it is not logged as one. */
  private cancelled(sourcePath: string): ImageExportResponse {
    logger.debug('Image export cancelled at the save dialog', {
      source: redactPath(sourcePath)
    })
    return {
      success: false,
      errorCode: ErrorCode.IMAGE_EXPORT_CANCELLED,
      error: ERROR_MESSAGES[ErrorCode.IMAGE_EXPORT_CANCELLED]
    }
  }
}

/** Process-wide singleton, matching `pdfService` / `docxService`. */
export const imageExportService = new ImageExportService()
