// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The link scan worker shell (issue #124 audit, follow-up): it answers only
 * well-formed requests, with the scan of `previewLinkScanCore.ts`, moves the
 * `srcdoc` buffers to main, and starts only in its role. The entry's own start
 * is `previewLinkScanWorker.entry.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { scanLinkDocument } from './previewLinkScanCore'
import { PREVIEW_LINK_SCAN_WORKER_ROLE, isLinkScanReply, type LinkScanReply } from './previewLinkScanProtocol'
import {
  answerLinkScanRequest,
  isLinkScanWorker,
  startLinkScanWorker,
  type LinkScanPort
} from './previewLinkScanWorker'

const PAGE = '<link rel="stylesheet" href="a.css"><iframe srcdoc="&lt;p&gt;x"></iframe>'

/** A port that records every reply and the buffers moved with it. */
function makePort(): LinkScanPort & {
  replies: Array<{ message: LinkScanReply; transfer?: ArrayBuffer[] }>
  listener?: (message: unknown) => void
} {
  const port = {
    replies: [] as Array<{ message: LinkScanReply; transfer?: ArrayBuffer[] }>,
    listener: undefined as ((message: unknown) => void) | undefined,
    on(_event: 'message', listener: (message: unknown) => void) {
      port.listener = listener
      return port
    },
    postMessage(message: LinkScanReply, transfer?: ArrayBuffer[]) {
      port.replies.push({ message, transfer })
    }
  }
  return port
}

describe('answerLinkScanRequest', () => {
  it("answers a scan of bytes with the core's outcome, moving the srcdoc buffers", () => {
    const port = makePort()

    answerLinkScanRequest(port, { type: 'scan', id: 4, html: new TextEncoder().encode(PAGE), frames: true })

    expect(port.replies).toHaveLength(1)
    const [{ message, transfer }] = port.replies
    expect(message).toEqual({ type: 'result', id: 4, outcome: scanLinkDocument(PAGE, true) })
    expect(isLinkScanReply(message)).toBe(true)
    if (message.outcome.kind !== 'ok' || message.outcome.frames === null) throw new Error('expected frames')
    expect(transfer).toEqual([message.outcome.frames.srcdoc[0].buffer])
  })

  it('lists no frames when not asked', () => {
    const port = makePort()
    answerLinkScanRequest(port, { type: 'scan', id: 5, html: PAGE, frames: false })
    expect(port.replies[0]).toEqual({
      message: { type: 'result', id: 5, outcome: { kind: 'ok', links: ['a.css'], frames: null, limits: [] } },
      transfer: []
    })
  })

  it.each([
    ['nothing', undefined],
    ['a reply', { type: 'result', id: 1, outcome: { kind: 'error', error: 'Error' } }],
    ['a request without its flag', { type: 'scan', id: 1, html: PAGE }]
  ])('ignores %s', (_label, message) => {
    const port = makePort()
    answerLinkScanRequest(port, message)
    expect(port.replies).toEqual([])
  })
})

describe('startLinkScanWorker', () => {
  it('answers every message the port receives', () => {
    const port = makePort()
    startLinkScanWorker(port)
    port.listener?.({ type: 'scan', id: 1, html: '<img src="a.png">', frames: true })
    port.listener?.({ type: 'scan', id: 2, html: '<img src="b.png">', frames: true })
    expect(port.replies.map(({ message }) => message.id)).toEqual([1, 2])
  })
})

describe('isLinkScanWorker', () => {
  it('is true only on a port, in its role', () => {
    const port = makePort()
    expect(isLinkScanWorker({ role: PREVIEW_LINK_SCAN_WORKER_ROLE }, port)).toBe(true)
    expect(isLinkScanWorker({ role: 'erfana-comment-parse' }, port)).toBe(false)
    expect(isLinkScanWorker(undefined, port)).toBe(false)
    expect(isLinkScanWorker({ role: PREVIEW_LINK_SCAN_WORKER_ROLE }, null)).toBe(false)
    expect(isLinkScanWorker({ role: PREVIEW_LINK_SCAN_WORKER_ROLE }, undefined)).toBe(false)
  })
})
