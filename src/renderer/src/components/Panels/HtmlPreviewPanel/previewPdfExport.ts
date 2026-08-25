// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared PDF-export action for the HTML preview (Issue #74, UX-003).
 *
 * Triggers `window.api.preview.exportPdf` and surfaces the outcome as a toast.
 * Extracted so both entry points — the tab context menu ({@link HtmlPreviewTab})
 * and the forwarded Cmd/Ctrl+S accelerator ({@link usePreviewFindShortcuts}) —
 * share one implementation with identical feedback.
 *
 * Main shows a native save dialog and returns `PDF_EXPORT_CANCELLED` when the
 * user dismisses it, so a cancel is silent here; only a real success or failure
 * raises a toast.
 *
 * @module previewPdfExport
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import { ErrorCode } from '../../../../../shared/errors'
import { getBasename } from '../../../utils/fileUtils'
import { showGlobalToast } from '../../Toast/toastService'

/**
 * Exports the given preview panel to PDF and toasts the result.
 *
 * @param panelId - The live preview panel to export.
 * @returns A promise that resolves once the result toast (if any) is dispatched.
 *
 * @example
 * ```ts
 * await exportPreviewPdf(panelId)
 * ```
 */
export async function exportPreviewPdf(panelId: string): Promise<void> {
  const result = await window.api.preview.exportPdf(panelId)

  if (result.ok) {
    showGlobalToast({
      type: 'success',
      title: 'Preview exported',
      message: `Saved ${getBasename(result.path)}.`
    })
    return
  }

  // A cancelled save dialog is a deliberate user action, not an error — stay
  // silent so the user is not nagged for dismissing the picker.
  if (result.errorCode === ErrorCode.PDF_EXPORT_CANCELLED) return

  showGlobalToast({
    type: 'error',
    title: 'Export failed',
    message: 'The preview could not be exported to PDF.'
  })
}
