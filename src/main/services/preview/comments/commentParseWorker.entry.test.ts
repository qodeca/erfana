// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment parse worker's entry (docs/designs/html-preview-comments.md
 * §19 R3-12): loaded in a thread whose `workerData` names its role, the module
 * starts answering on `parentPort` by itself. `node:worker_threads` is mocked
 * at module scope, hence a file of its own; the shell's behaviour on any port
 * is `commentParseWorker.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { encodeText } from '../../../../shared/htmlComments'

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
  const { COMMENT_PARSE_WORKER_ROLE } = await import('./commentParseProtocol')
  const workerData = { role: COMMENT_PARSE_WORKER_ROLE }
  return {
    ...actual,
    default: { ...actual, parentPort: port, workerData },
    parentPort: port,
    workerData
  }
})

describe('commentParseWorker – entry', () => {
  it('in its role, listens on parentPort and answers a request', async () => {
    await import('./commentParseWorker')
    expect(port.listeners).toHaveLength(1)

    port.listeners[0]({ type: 'instrument', id: 7, bytes: encodeText('<p id="a">x</p>') })
    expect(port.posted).toEqual([
      // The content's name before any work (S-M), then the answer.
      { type: 'begin', id: 7, hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      expect.objectContaining({
        type: 'result',
        id: 7,
        outcome: expect.objectContaining({ kind: 'ok' })
      })
    ])
  })
})
