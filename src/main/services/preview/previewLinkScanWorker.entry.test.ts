// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The link scan worker's entry (issue #124 audit, follow-up): loaded in a
 * thread whose `workerData` names its role, the module starts answering on
 * `parentPort` by itself. `node:worker_threads` is mocked at module scope,
 * hence a file of its own; the shell on any port is
 * `previewLinkScanWorker.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'

const port = vi.hoisted(() => {
  const listeners: Array<(message: unknown) => void> = []
  return {
    listeners,
    posted: [] as unknown[],
    on(event: string, listener: (message: unknown) => void): void {
      if (event === 'message') listeners.push(listener)
    },
    postMessage(message: unknown): void {
      this.posted.push(message)
    }
  }
})

vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>()
  const { PREVIEW_LINK_SCAN_WORKER_ROLE } = await import('./previewLinkScanProtocol')
  const workerData = { role: PREVIEW_LINK_SCAN_WORKER_ROLE }
  return {
    ...actual,
    default: { ...actual, parentPort: port, workerData },
    parentPort: port,
    workerData
  }
})

describe('previewLinkScanWorker – entry', () => {
  it('in its role, listens on parentPort and answers a request', async () => {
    await import('./previewLinkScanWorker')
    expect(port.listeners).toHaveLength(1)

    port.listeners[0]({ type: 'scan', id: 7, html: new TextEncoder().encode('<img src="a.png">'), frames: true })
    expect(port.posted).toEqual([
      { type: 'result', id: 7, outcome: { kind: 'ok', links: ['a.png'], frames: null, limits: [] } }
    ])
  })
})
