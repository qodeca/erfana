// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview PDF export controller (Issue #74, work item 37).
 *
 * Exports the LIVE preview page to PDF via `webContents.printToPDF`. `PdfService`
 * cannot do this: its save path is private and `IPdfService` exposes only
 * `exportToPdf`, which builds its own HTML from markdown and cannot print an
 * arbitrary `WebContents` (design §1.7). This controller therefore runs its OWN
 * `dialog.showSaveDialog` + `writeFile`, and reuses the shared
 * `deriveSafeFilename` (the same helper `PdfService` uses) so the #161
 * Windows-reserved-name handling is not duplicated. **`PdfService` is NOT
 * modified.**
 *
 * `printToPDF` is called with `printBackground: true`: Electron defaults it to
 * `false`, which drops every CSS background colour and image from the output —
 * exactly what a previewed page relies on (design §1.7).
 *
 * @see specs/designs/sd-074-html-preview.md §1.7
 */
import { writeFile } from 'node:fs/promises'

import { BrowserWindow, dialog } from 'electron'

import { ErrorCode } from '../../../shared/errors'
import type { PdfExportResult } from '../../../shared/ipc/preview-types'
import { deriveSafeFilename } from '../../utils/validateFilename'

/** Fallback basename when the source name reduces to empty. */
const DEFAULT_EXPORT_NAME = 'preview'

/** Leave headroom for the `.pdf` extension and OS path limits (matches PdfService). */
const MAX_FILENAME_LENGTH = 200

/** The `printToPDF` options subset this controller sets. */
export interface PreviewPrintToPdfOptions {
  printBackground: boolean
}

/** The `WebContents` print surface this controller uses. Structural for tests. */
export interface PreviewPrintContents {
  printToPDF(options: PreviewPrintToPdfOptions): Promise<Buffer>
}

/** A save-dialog result subset (matches Electron's `SaveDialogReturnValue`). */
export interface PreviewSaveDialogResult {
  canceled: boolean
  filePath?: string
}

/** Injectable side effects so the controller is testable without Electron IO. */
export interface PreviewExportControllerDeps {
  /**
   * Show the save dialog, parented to the window `windowId` names when it is
   * still alive. A file picker (unlike the external-link consent) may fall back
   * to an unowned dialog when no window is found: it asks nothing security-
   * relevant, and a lost picker costs one retry.
   */
  showSaveDialog?: (
    options: {
      title: string
      defaultPath: string
      buttonLabel: string
      filters: { name: string; extensions: string[] }[]
    },
    windowId?: number
  ) => Promise<PreviewSaveDialogResult>
  writeFile?: (path: string, data: Buffer) => Promise<void>
}

export interface IPreviewExportController {
  /**
   * Show a save dialog, print `wc` to PDF with backgrounds on, and write it.
   * Returns a cancelled result if the user dismisses the dialog and a failed
   * result on any print/write error; never throws.
   */
  exportToPdf(
    wc: PreviewPrintContents,
    suggestedName: string,
    windowId?: number
  ): Promise<PdfExportResult>
}

export class PreviewExportController implements IPreviewExportController {
  private readonly showSaveDialog: NonNullable<PreviewExportControllerDeps['showSaveDialog']>
  private readonly writeFile: NonNullable<PreviewExportControllerDeps['writeFile']>

  constructor(deps: PreviewExportControllerDeps = {}) {
    this.showSaveDialog =
      deps.showSaveDialog ??
      ((options, windowId) => {
        const win = windowId === undefined ? null : BrowserWindow.fromId(windowId)
        return win !== null && !win.isDestroyed()
          ? dialog.showSaveDialog(win, options)
          : dialog.showSaveDialog(options)
      })
    this.writeFile = deps.writeFile ?? ((path, data) => writeFile(path, data))
  }

  async exportToPdf(
    wc: PreviewPrintContents,
    suggestedName: string,
    windowId?: number
  ): Promise<PdfExportResult> {
    // #161: app-derived name → silent transform (reserved basenames, invalid
    // chars, control/bidi) via the shared helper, then length-bounded.
    const safeName = deriveSafeFilename(suggestedName, DEFAULT_EXPORT_NAME).slice(
      0,
      MAX_FILENAME_LENGTH
    )

    const result = await this.showSaveDialog({
      title: 'Export preview to PDF',
      defaultPath: `${safeName}.pdf`,
      buttonLabel: 'Export',
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
    }, windowId)

    if (result.canceled || !result.filePath) {
      return { ok: false, errorCode: ErrorCode.PDF_EXPORT_CANCELLED }
    }

    const filePath = result.filePath.toLowerCase().endsWith('.pdf')
      ? result.filePath
      : `${result.filePath}.pdf`

    try {
      // printBackground:true — default false drops CSS backgrounds/images.
      const pdf = await wc.printToPDF({ printBackground: true })
      await this.writeFile(filePath, pdf)
      return { ok: true, path: filePath }
    } catch {
      return { ok: false, errorCode: ErrorCode.PDF_EXPORT_FAILED }
    }
  }
}

/** Factory mirroring the codebase interface + class + factory convention. */
export function createPreviewExportController(
  deps: PreviewExportControllerDeps = {}
): IPreviewExportController {
  return new PreviewExportController(deps)
}
