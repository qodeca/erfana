// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The hidden Chromium page that turns image bytes into pixels.
 *
 * `nativeImage` decodes PNG and JPEG and nothing else, so it cannot be the
 * decoder for eight formats — but Chromium already decodes every one of them,
 * SVG included. This class owns one hidden, sandboxed, network-isolated
 * BrowserWindow for the duration of a single export and drives it as a dumb
 * pixel pump: one instruction in, one result out.
 *
 * Trust, in the order it is applied:
 *
 * 1. The session is hardened BEFORE this window exists (`rasterizeSession.ts`).
 * 2. A per-export UUID is passed via `additionalArguments`; the harness preload
 *    reads it from `process.argv` and echoes it on every send.
 * 3. Listeners are attached to `webContents.mainFrame.ipc`, never the global
 *    `ipcMain`, so a send from any other webContents cannot reach them.
 * 4. Every inbound message must come from the exact URL this window is on,
 *    checked before the payload is even parsed.
 * 5. Only then does the Zod schema see it.
 *
 * All three timeouts race a promise that is separately marked handled, because
 * a timeout followed by `destroy()` would otherwise surface in the
 * main-process crash handlers as an unhandled rejection — i.e. a slow export
 * would look exactly like a crash.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { BrowserWindow, type IpcMainEvent } from 'electron'
import { withTimeout } from '../../utils/withTimeout'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IMAGE_EXPORT_CHANNELS } from '../../../shared/ipc/image-export-channels'
import {
  HarnessResultSchema,
  IMAGE_EXPORT,
  type HarnessRender,
  type HarnessResult
} from '../../../shared/ipc/image-export-schema'
import { logger } from '../LoggingService'
import { redactPath, redactedLogError } from '../../utils/redactUserInput'
import {
  HARNESS_PAGE,
  buildHarnessWebPreferences,
  hardenRasterizeWindow,
  prepareRasterizeSession
} from './rasterizeSession'

/** Built renderer directory, relative to the compiled main-process `__dirname`. */
const RENDERER_DIR_RELATIVE = '../renderer'
/** Harness preload bundle, relative to the compiled main-process `__dirname`. */
const HARNESS_PRELOAD_RELATIVE = '../preload/imageExport.js'

/**
 * Viewport of the hidden window. Irrelevant to the output — the canvas is
 * sized from the instruction and the PDF page from a CSS `@page` rule — but a
 * degenerate viewport can make Chromium skip layout entirely.
 */
const HARNESS_WINDOW_WIDTH = 800
const HARNESS_WINDOW_HEIGHT = 600

/**
 * `printToPDF` options, pinned.
 *
 * No `pageSize`: the geometry comes from the harness's `@page { size: Wpx Hpx }`
 * rule, which `preferCSSPageSize` tells Chromium to honour. `scale` and
 * `pageRanges` are stated rather than left to defaults so a future Electron
 * default change cannot silently resize or paginate the output.
 */
export const HARNESS_PDF_OPTIONS = {
  preferCSSPageSize: true,
  printBackground: true,
  margins: { marginType: 'none' as const },
  scale: 1,
  pageRanges: '1-1'
}

/** The narrow capability `exportSinks` needs from a loaded harness page. */
export interface PdfPageSource {
  /** Print the currently-loaded page to a single-page PDF buffer. */
  printToPdf(): Promise<Buffer>
}

/**
 * One hidden rasterize window, alive for exactly one export.
 *
 * Create with {@link ImageRasterizeWindow.open}, use {@link render} (possibly
 * twice — the ICO contingency re-runs on an extracted slice), then always
 * {@link destroy} in a `finally`.
 */
export class ImageRasterizeWindow implements PdfPageSource {
  private pendingResult: ((result: HarnessResult) => void) | null = null

  /**
   * The URL the harness page committed to, frozen once the load has settled.
   *
   * The sender-frame gate compares against THIS rather than re-reading
   * `webContents.getURL()` per message: a live read makes the expectation
   * follow the window, so a navigation that succeeded would satisfy the check
   * it was supposed to fail. `null` until the handshake completes — see
   * {@link isTrustedHarnessMessage}.
   */
  private loadedUrl: string | null = null

  private constructor(
    private readonly win: BrowserWindow,
    private readonly token: string
  ) {}

  /**
   * Create the window, harden it, load the harness page and wait for its
   * `ready` handshake.
   *
   * @throws Error when the harness preload is missing, the page fails to load,
   *         or the handshake does not arrive inside the load budget.
   */
  static async open(): Promise<ImageRasterizeWindow> {
    const preloadPath = join(__dirname, HARNESS_PRELOAD_RELATIVE)
    if (!existsSync(preloadPath)) {
      throw new Error('Image-export harness preload is missing from this build')
    }

    const rendererDir = join(__dirname, RENDERER_DIR_RELATIVE)
    // Session controls first: a partition inherits no hardening, and the
    // filter must bind before the window issues its first request.
    prepareRasterizeSession(rendererDir)

    const token = randomUUID()
    const win = new BrowserWindow({
      show: false,
      width: HARNESS_WINDOW_WIDTH,
      height: HARNESS_WINDOW_HEIGHT,
      webPreferences: buildHarnessWebPreferences(preloadPath, token)
    })
    hardenRasterizeWindow(win)

    const harness = new ImageRasterizeWindow(win, token)
    try {
      await harness.load(rendererDir)
    } catch (error) {
      harness.destroy()
      throw error
    }
    return harness
  }

  /**
   * Send one rasterize instruction and wait for its result.
   *
   * @param instruction - Everything except the token, which is added here.
   * @returns The harness's own verdict — success carries the dimensions it
   *          actually produced, failure carries a reason.
   * @throws Error when the round trip exceeds `RENDER_TIMEOUT_MS`.
   */
  async render(instruction: Omit<HarnessRender, 'token'>): Promise<HarnessResult> {
    const settled = new Promise<HarnessResult>(resolve => {
      this.pendingResult = resolve
    })

    this.win.webContents.send(IMAGE_EXPORT_CHANNELS.HARNESS_RENDER, {
      ...instruction,
      token: this.token
    })

    try {
      return await withTimeout(settled, IMAGE_EXPORT.RENDER_TIMEOUT_MS, 'Image rasterize')
    } finally {
      this.pendingResult = null
    }
  }

  /**
   * Print the loaded page to PDF with the pinned options.
   *
   * Only meaningful after a `deliver: 'page'` render, which leaves the
   * flattened canvas result in the DOM as a single exactly-sized `<img>`.
   */
  async printToPdf(): Promise<Buffer> {
    return withTimeout(
      this.win.webContents.printToPDF(HARNESS_PDF_OPTIONS),
      IMAGE_EXPORT.PDF_TIMEOUT_MS,
      'PDF generation'
    )
  }

  /** Tear the window down. Safe to call twice, and safe after a failed open. */
  destroy(): void {
    this.pendingResult = null
    try {
      if (!this.win.isDestroyed()) {
        this.win.destroy()
      }
    } catch (error) {
      logger.warn('Failed to destroy the image-export harness window', {
        reason: redactedLogError(error)?.message
      })
    }
  }

  /** Wire the frame-scoped listeners, load the page, await the handshake. */
  private async load(rendererDir: string): Promise<void> {
    const ready = new Promise<void>(resolve => {
      this.win.webContents.mainFrame.ipc.on(
        IMAGE_EXPORT_CHANNELS.HARNESS_READY,
        (event, payload) => {
          if (!this.isTrustedHarnessMessage(event, payload)) return
          resolve()
        }
      )
    })

    this.win.webContents.mainFrame.ipc.on(IMAGE_EXPORT_CHANNELS.HARNESS_RESULT, (event, payload) =>
      this.handleResult(event, payload)
    )

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const loaded =
      is.dev && devUrl
        ? this.win.loadURL(`${devUrl}/${HARNESS_PAGE}`)
        : this.win.loadFile(join(rendererDir, HARNESS_PAGE))

    await withTimeout(
      Promise.all([loaded, ready]).then(() => undefined),
      IMAGE_EXPORT.WINDOW_LOAD_TIMEOUT_MS,
      'Image-export harness load'
    )

    // Both halves have settled, so this is the page the harness answered from.
    // Everything that carries a payload — every result — is checked against it.
    this.loadedUrl = this.win.webContents.getURL()
  }

  /** Validate one inbound harness result and hand it to the waiting render. */
  private handleResult(event: IpcMainEvent, payload: unknown): void {
    if (!this.isTrustedHarnessMessage(event, payload)) return

    const parsed = HarnessResultSchema.safeParse(payload)
    if (!parsed.success) {
      logger.warn('Image-export harness sent a malformed result', {
        issue: parsed.error.issues[0]?.message
      })
      return
    }
    if (parsed.data.token !== this.token) {
      logger.warn('Image-export harness result rejected: token mismatch')
      return
    }
    this.pendingResult?.(parsed.data)
  }

  /**
   * The sender-frame gate, applied before anything is parsed.
   *
   * Frame-scoped listeners already exclude other webContents; this additionally
   * excludes a sub-frame or an unexpected navigation inside this window, whose
   * payload would otherwise flow straight into `writeFile` and
   * `clipboard.writeImage`.
   *
   * The expectation is the URL pinned at the end of `load`. The one message
   * that arrives before that pin exists is the `ready` handshake — which is
   * what ESTABLISHES the loaded page, carries no payload, and only resolves a
   * promise — so it falls back to the live read.
   */
  private isTrustedHarnessMessage(event: IpcMainEvent, payload: unknown): boolean {
    const expected = this.loadedUrl ?? this.win.webContents.getURL()
    const senderUrl = event.senderFrame?.url
    if (!senderUrl || senderUrl !== expected) {
      logger.warn('Image-export harness message rejected: sender frame mismatch', {
        expected: redactPath(expected),
        got: senderUrl ? redactPath(senderUrl) : 'none'
      })
      return false
    }
    if (typeof payload !== 'object' || payload === null) return false
    return (payload as { token?: unknown }).token === this.token
  }
}
