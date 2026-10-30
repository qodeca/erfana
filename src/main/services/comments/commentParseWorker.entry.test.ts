// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment parse worker's entry (docs/designs/comments/html-preview-comments.md
 * §19 R3-12; spec 024 architecture note 001 § 8 C22),
 * `src/main/services/workers/comment-parse.worker.ts`: loaded in a thread whose
 * `workerData` names its role, the module starts answering on `parentPort` by
 * itself, with every file kind's jobs registered and frozen.
 * `node:worker_threads` is mocked at module scope, hence a file of its own; the
 * runner's behaviour on any port is `commentParseWorker.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { encodeText } from '../../../shared/htmlComments'

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
    await import('../workers/comment-parse.worker')
    expect(port.listeners).toHaveLength(1)

    port.listeners[0]({ type: 'job', id: 7, fileKind: 'html', bytes: encodeText('<p id="a">x</p>'), job: { kind: 'instrument' } })
    expect(port.posted).toEqual([
      // The content's name before any work (S-M), then the answer.
      { type: 'begin', id: 7, hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      expect.objectContaining({
        type: 'job',
        id: 7,
        result: { kind: 'instrument', outcome: expect.objectContaining({ kind: 'ok' }) }
      })
    ])
  })

  it('registers the HTML kind’s jobs, and takes no more', async () => {
    const { commentWorkerJobs } = await import('../workers/comment-parse.worker')
    const jobs = commentWorkerJobs()
    for (const job of ['instrument', 'draft', 'pin', 'list', 'write']) expect(jobs.handlerOf('html', job)).toBeDefined()
    expect(jobs.frozen).toBe(true)
  })
})
