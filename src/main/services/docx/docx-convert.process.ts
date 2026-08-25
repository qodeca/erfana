// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DOCX conversion child (Electron utilityProcess entry).
 *
 * Runs `@turbodocx/html-to-docx` in a separate, killable process. The library
 * decodes embedded images synchronously (via image-size), so a crafted image can
 * spin the CPU in an infinite loop. In the main process that would freeze the app
 * with no recovery — the in-thread `Promise.race` timeout can never fire while
 * the event loop is held. Isolating the work here means the parent adapter can
 * `kill()` a hung conversion, and a separate process also caps its memory so a
 * decompression bomb cannot OOM the main process.
 *
 * The HTML that arrives here is already stripped of remote images and wrapped in
 * a document shell by `HtmlToDocxConverter` (main side) — this child only runs
 * the conversion.
 */
import HTMLtoDOCX from '@turbodocx/html-to-docx'

/** Page/typography/table options for the DOCX output. */
const CONVERSION_OPTIONS = {
  orientation: 'portrait',
  margins: { top: 1440, right: 1080, bottom: 1440, left: 1080 },
  title: 'Exported Document',
  creator: 'Erfana',
  font: 'Calibri',
  fontSize: 22,
  heading: {
    heading1: { keepNext: true, keepLines: true, spacing: { before: 360, after: 120 } },
    heading2: { keepNext: true, keepLines: true, spacing: { before: 280, after: 100 } },
    heading3: { keepNext: true, keepLines: true, spacing: { before: 240, after: 80 } },
    heading4: { keepNext: true, keepLines: true, spacing: { before: 200, after: 60 } },
    heading5: { keepNext: true, keepLines: true, spacing: { before: 160, after: 40 } },
    heading6: { keepNext: true, keepLines: true, spacing: { before: 120, after: 40 } }
  },
  table: { row: { cantSplit: true }, addSpacingAfter: false }
} as const

/** Normalise whatever HTMLtoDOCX returns (Buffer/ArrayBuffer/Blob) into a Uint8Array. */
export async function toBytes(result: unknown): Promise<Uint8Array> {
  if (Buffer.isBuffer(result) || result instanceof Uint8Array) {
    return new Uint8Array(result)
  }
  if (result instanceof ArrayBuffer) {
    return new Uint8Array(result)
  }
  if (result instanceof Blob) {
    return new Uint8Array(await result.arrayBuffer())
  }
  throw new Error('Unexpected result type from HTMLtoDOCX')
}

/** Convert already-stripped, already-wrapped HTML into DOCX bytes. */
export async function runConversion(html: string): Promise<Uint8Array> {
  const result = await HTMLtoDOCX(html, null, CONVERSION_OPTIONS, null)
  return toBytes(result)
}

// Only wire the message loop when actually running inside a utilityProcess.
// `process.parentPort` is undefined in the main process and under unit tests,
// which keeps this module importable for testing the pure helpers above.
const parentPort = process.parentPort
if (parentPort) {
  parentPort.on('message', (event) => {
    const msg = event.data as { type?: string; id?: number; html?: string } | undefined
    if (!msg || msg.type !== 'convert' || typeof msg.id !== 'number') return

    const { id, html } = msg
    void runConversion(html ?? '')
      .then((bytes) => {
        parentPort.postMessage({ type: 'result', id, bytes })
      })
      .catch((error: unknown) => {
        parentPort.postMessage({
          type: 'error',
          id,
          error: error instanceof Error ? error.message : String(error)
        })
      })
  })
}
