// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer document-export gateways: the one place `window.api.pdf` and
 * `window.api.docx` are read.
 *
 * Renderer code calls `pdfGateway` or `docxGateway`, which forward to the
 * preload bridges with the same contracts ({@link PdfBridge},
 * {@link DocxBridge}). Keeping the access in one module gives the renderer a
 * single seam to change or fake.
 */
import type { DocxBridge } from '../../../shared/ipc/docx-schema'
import type { PdfBridge } from '../../../shared/ipc/pdf-schema'

interface DocumentExportBridges {
  pdf: PdfBridge
  docx: DocxBridge
}

/** The bridges are read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves these bridges out of its type; this module is the only place they are put back
const bridges = (): DocumentExportBridges => (window as unknown as { api: DocumentExportBridges }).api

export const pdfGateway: PdfBridge = {
  exportToPdf: (...args) => bridges().pdf.exportToPdf(...args)
}

export const docxGateway: DocxBridge = {
  exportToDocx: (...args) => bridges().docx.exportToDocx(...args)
}
