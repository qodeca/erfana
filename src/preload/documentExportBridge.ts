// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload document-export bridges: `window.api.pdf` and `window.api.docx`,
 * typed as {@link PdfBridge} and {@link DocxBridge}. Each sends the rendered
 * Markdown preview HTML; main asks where to save and writes the file.
 */
import { ipcRenderer } from 'electron'
import type { DocxBridge } from '../shared/ipc/docx-schema'
import type { PdfBridge } from '../shared/ipc/pdf-schema'

export const pdfBridge: PdfBridge = {
  exportToPdf: (request) => ipcRenderer.invoke('pdf:exportToPdf', request)
}

export const docxBridge: DocxBridge = {
  exportToDocx: (request) => ipcRenderer.invoke('docx:exportToDocx', request)
}
