// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The production worker factory of `CommentParseClient`
 * (docs/designs/comments/html-preview-comments.md §19 R3-12): the built bundle next to
 * the main bundle, started in its role with a heap cap – or no worker at all
 * when the bundle is missing, which makes comments unavailable instead of
 * failing the load. `node:fs` and `node:worker_threads` are mocked at module
 * scope, hence a file of its own.
 */
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeText } from '../../../shared/htmlComments'
import { CommentParseClient } from './CommentParseWorkerAdapter'
import { HtmlCommentParseClient } from '../preview/comments/htmlCommentParseClient'
import { COMMENT_PARSE_WORKER_ROLE } from './commentParseProtocol'

const WORKER_FILE = 'comment-parse.worker.js'

const state = vi.hoisted(() => ({
  bundlePresent: false,
  started: [] as Array<{ path: string; options: unknown }>
}))

vi.mock('../LoggingService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const existsSync = (path: string): boolean =>
    path.endsWith('comment-parse.worker.js') ? state.bundlePresent : actual.existsSync(path)
  return { ...actual, default: { ...actual, existsSync }, existsSync }
})

vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>()
  const { EventEmitter } = await import('node:events')
  /** Records how it was started; answers every request with `error`. */
  class RecordingWorker extends EventEmitter {
    constructor(path: string, options: unknown) {
      super()
      state.started.push({ path, options })
    }
    postMessage(message: { id: number }): void {
      queueMicrotask(() => this.emit('message', { type: 'error', id: message.id }))
    }
    terminate(): Promise<number> {
      return Promise.resolve(1)
    }
    unref(): void {}
  }
  return { ...actual, default: { ...actual, Worker: RecordingWorker }, Worker: RecordingWorker }
})

const PAGE = encodeText('<!doctype html><p id="a">x</p>')

beforeEach(() => {
  state.bundlePresent = false
  state.started.length = 0
})

describe('CommentParseClient – the production worker', () => {
  it('starts no worker when the bundle is missing: comments are unavailable', async () => {
    const client = new HtmlCommentParseClient(new CommentParseClient())
    await expect(client.instrument(PAGE)).resolves.toEqual({
      kind: 'failed',
      failure: 'unavailable'
    })
    expect(state.started).toEqual([])
  })

  it('starts the bundle beside the main bundle, in its role, with a heap cap', async () => {
    state.bundlePresent = true
    const parse = new CommentParseClient()
    const client = new HtmlCommentParseClient(parse)
    // The recording worker answers `error`: the request made the round trip.
    await expect(client.instrument(PAGE)).resolves.toEqual({ kind: 'failed', failure: 'error' })
    expect(state.started).toEqual([
      {
        path: join(__dirname, WORKER_FILE),
        options: {
          workerData: { role: COMMENT_PARSE_WORKER_ROLE },
          resourceLimits: { maxOldGenerationSizeMb: expect.any(Number) }
        }
      }
    ])
    await parse.dispose()
  })
})
