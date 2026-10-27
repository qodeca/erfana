// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preview link scan worker (issue #124 security audit, follow-up; pattern
 * `comments/commentParseWorker.ts`).
 *
 * Built as its own main-process bundle entry (`preview-link-scan.worker`,
 * electron.vite.config.ts → `out/main/preview-link-scan.worker.js`) and
 * started by `PreviewLinkScanWorkerAdapter.ts`. Auto-refresh scans every page
 * a preview loads, and each frame document it holds, for the files to watch:
 * a 4 MiB page costs 0.2–0.6 s of tokenizing on the emulated Windows box, and
 * one walk can scan up to 51 documents, which on the main thread froze every
 * Erfana window. Here it freezes nothing but this thread.
 *
 * The shell only moves messages; the work is `scanLinkDocument`
 * (`previewLinkScanCore.ts`), which never throws. Requests are answered one at
 * a time, in order. The `srcdoc` markup of an answer is transferred, not copied.
 *
 * It starts listening only when its `workerData` names its role, so the module
 * can be imported anywhere – a test runner's own worker thread included –
 * without answering messages that are not addressed to it.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { scanLinkDocument, transferablesOf } from './previewLinkScanCore'
import {
  PREVIEW_LINK_SCAN_WORKER_ROLE,
  isLinkScanRequest,
  type LinkScanReply
} from './previewLinkScanProtocol'

/** The slice of a `MessagePort` the shell uses. */
export interface LinkScanPort {
  on(event: 'message', listener: (message: unknown) => void): unknown
  postMessage(message: LinkScanReply, transfer?: ArrayBuffer[]): void
}

/** Answer one request on `port`; anything that is not a request is ignored. */
export function answerLinkScanRequest(port: LinkScanPort, message: unknown): void {
  if (!isLinkScanRequest(message)) return
  const outcome = scanLinkDocument(message.html, message.frames)
  port.postMessage({ type: 'result', id: message.id, outcome }, transferablesOf(outcome))
}

/** Start answering requests on `port`. */
export function startLinkScanWorker(port: LinkScanPort): void {
  port.on('message', message => answerLinkScanRequest(port, message))
}

/** True when this thread was started as the link scan worker. */
export function isLinkScanWorker(data: unknown, port: unknown): boolean {
  const role = (data as { role?: unknown } | null | undefined)?.role
  return port !== null && port !== undefined && role === PREVIEW_LINK_SCAN_WORKER_ROLE
}

if (isLinkScanWorker(workerData, parentPort)) {
  startLinkScanWorker(parentPort as unknown as LinkScanPort)
}
