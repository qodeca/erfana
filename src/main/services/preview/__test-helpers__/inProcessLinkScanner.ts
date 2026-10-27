// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A link scanner for tests that runs the worker's own scan
 * (`scanLinkDocument`, `previewLinkScanCore.ts`) in the test thread, so a
 * suite about the frame walk or the pipeline needs no built worker bundle.
 * The worker shell, its message contract and the client around it are tested
 * on their own (`previewLinkScanWorker.test.ts`,
 * `PreviewLinkScanWorkerAdapter.test.ts`), and the real bundled worker in
 * `previewLinkScan.perf.test.ts`. Never used in production: there, a document
 * the worker cannot answer for yields no links.
 */
import type { PreviewLinkScanner } from '../PreviewLinkScanWorkerAdapter'
import { scanLinkDocument } from '../previewLinkScanCore'

/** Answers every scan with the worker's own outcome, after a microtask. */
export const inProcessLinkScanner: PreviewLinkScanner = {
  scan: (html, { frames }) => Promise.resolve(scanLinkDocument(html, frames))
}
