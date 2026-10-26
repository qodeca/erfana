// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment parse worker client (docs/designs/html-preview-comments.md §19
 * R3-12): one lazy persistent worker, a bounded serial queue, a per-request
 * timeout, and M-068 – a worker that dies is restarted once, after that
 * comments stay unavailable. The worker is a fake that answers with the real
 * pipeline in-process, so these tests drive every failure on purpose.
 */
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeText } from '../../../../shared/htmlComments'
import { instrumentDocument } from './commentParseCore'
import type { CommentParseRequest } from './commentParseProtocol'
import {
  CommentParseClient,
  sharedCommentParseClient,
  type CommentParseWorkerLike
} from './CommentParseWorkerAdapter'

vi.mock('../../LoggingService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const PAGE = encodeText('<!doctype html><main><p id="a">x</p></main>')

/** A fake worker: records what it is sent; answers when told (or at once in `auto` mode). */
class FakeWorker extends EventEmitter implements CommentParseWorkerLike {
  readonly sent: Array<{ message: CommentParseRequest; transfer: ArrayBuffer[] }> = []
  terminated = false
  unrefed = false
  constructor(private readonly auto: boolean) {
    super()
  }
  postMessage(message: CommentParseRequest, transfer: ArrayBuffer[]): void {
    this.sent.push({ message, transfer })
    if (this.auto) queueMicrotask(() => this.answer(message.id))
  }
  /** Answer request `id` the way the real worker would. */
  answer(id: number): void {
    const request = this.sent.find(entry => entry.message.id === id)!.message
    this.emit('message', { type: 'result', id, outcome: instrumentDocument(request.bytes) })
  }
  terminate(): Promise<number> {
    this.terminated = true
    return Promise.resolve(1)
  }
  unref(): void {
    this.unrefed = true
  }
}

/** A client over fake workers; `workers` lists every one it started. */
function makeClient(
  options: {
    auto?: boolean
    timeoutMs?: number
    maxPending?: number
    maxPendingBytes?: number
  } = {}
) {
  const workers: FakeWorker[] = []
  const client = new CommentParseClient({
    createWorker: () => {
      const worker = new FakeWorker(options.auto ?? true)
      workers.push(worker)
      return worker
    },
    timeoutMs: options.timeoutMs,
    maxPending: options.maxPending,
    maxPendingBytes: options.maxPendingBytes
  })
  return { client, workers }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('CommentParseClient', () => {
  it('starts one worker lazily, unrefs it, and answers with the pipeline outcome', async () => {
    const { client, workers } = makeClient()
    expect(workers).toHaveLength(0)

    const result = await client.instrument(PAGE)
    expect(result.kind).toBe('ok')
    await client.instrument(PAGE)
    expect(workers).toHaveLength(1)
    expect(workers[0].unrefed).toBe(true)
  })

  it('sends a copy of the bytes and transfers that copy, never the caller’s buffer', async () => {
    const { client, workers } = makeClient()
    const pooled = Buffer.from(PAGE)
    await client.instrument(pooled)
    const { message, transfer } = workers[0].sent[0]
    expect(message.type).toBe('instrument')
    expect(message.bytes).toEqual(new Uint8Array(PAGE))
    expect(message.bytes.buffer).not.toBe(pooled.buffer)
    expect(transfer).toEqual([message.bytes.buffer])
  })

  it('warm starts the worker with one tiny parse, once', async () => {
    const { client, workers } = makeClient()
    client.warm()
    client.warm()
    expect(workers).toHaveLength(1)
    expect(workers[0].sent).toHaveLength(1)
    await Promise.resolve()
    expect(client.isAvailable()).toBe(true)
  })

  it('answers busy instead of queueing past the request or byte bound', async () => {
    const byCount = makeClient({ auto: false, maxPending: 1 })
    const first = byCount.client.instrument(PAGE)
    await expect(byCount.client.instrument(PAGE)).resolves.toEqual({
      kind: 'failed',
      failure: 'busy'
    })
    byCount.workers[0].answer(1)
    expect((await first).kind).toBe('ok')

    const byBytes = makeClient({ auto: false, maxPendingBytes: PAGE.length + 1 })
    void byBytes.client.instrument(PAGE)
    await expect(byBytes.client.instrument(PAGE)).resolves.toEqual({
      kind: 'failed',
      failure: 'busy'
    })
  })

  it('times out a request, terminates the hung worker and fails what it held', async () => {
    vi.useFakeTimers()
    const { client, workers } = makeClient({ auto: false, timeoutMs: 1_000 })
    const first = client.instrument(PAGE)
    const second = client.instrument(PAGE)
    vi.advanceTimersByTime(1_000)

    await expect(first).resolves.toEqual({ kind: 'failed', failure: 'timeout' })
    await expect(second).resolves.toEqual({ kind: 'failed', failure: 'crashed' })
    expect(workers[0].terminated).toBe(true)
    // A late answer from the retired worker is ignored.
    workers[0].answer(1)
  })

  it('M-068 a worker that crashes is restarted once; a second crash leaves comments unavailable', async () => {
    const { client, workers } = makeClient({ auto: false })
    const first = client.instrument(PAGE)
    workers[0].emit('error', new Error('boom'))
    await expect(first).resolves.toEqual({ kind: 'failed', failure: 'crashed' })
    expect(client.isAvailable()).toBe(true)

    // The restart: a second worker serves the next request.
    const second = client.instrument(PAGE)
    expect(workers).toHaveLength(2)
    workers[1].answer(2)
    expect((await second).kind).toBe('ok')

    // It dies too (an exit this time): no third worker, ever.
    workers[1].emit('exit', 1)
    expect(client.isAvailable()).toBe(false)
    await expect(client.instrument(PAGE)).resolves.toEqual({
      kind: 'failed',
      failure: 'unavailable'
    })
    client.warm()
    expect(workers).toHaveLength(2)
  })

  it('treats an answer that is not a well-formed reply as an error for that request', async () => {
    const { client, workers } = makeClient({ auto: false })
    const malformed = client.instrument(PAGE)
    workers[0].emit('message', { type: 'result', id: 1, outcome: { kind: 'ok', tokens: 'x' } })
    await expect(malformed).resolves.toEqual({ kind: 'failed', failure: 'error' })

    const thrown = client.instrument(PAGE)
    workers[0].emit('message', { type: 'error', id: 2 })
    await expect(thrown).resolves.toEqual({ kind: 'failed', failure: 'error' })

    // Noise without an id, or for an unknown id, changes nothing.
    workers[0].emit('message', 'noise')
    workers[0].emit('message', {
      type: 'result',
      id: 99,
      outcome: { kind: 'unavailable', reason: 'encoding' }
    })
    const next = client.instrument(PAGE)
    workers[0].answer(3)
    expect((await next).kind).toBe('ok')
  })

  it('passes a refusal from the worker through as the outcome', async () => {
    const { client } = makeClient()
    const utf16 = Uint8Array.from([0xff, 0xfe, 0x3c, 0x00])
    await expect(client.instrument(utf16)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'encoding'
    })
  })

  it('a worker that cannot be started (missing bundle) makes comments unavailable', async () => {
    const client = new CommentParseClient({ createWorker: () => null })
    await expect(client.instrument(PAGE)).resolves.toEqual({
      kind: 'failed',
      failure: 'unavailable'
    })
    expect(client.isAvailable()).toBe(false)

    const throwing = new CommentParseClient({
      createWorker: () => {
        throw new Error('no worker_threads')
      }
    })
    await expect(throwing.instrument(PAGE)).resolves.toEqual({
      kind: 'failed',
      failure: 'unavailable'
    })
  })

  it('a post that throws fails the request and retires the worker', async () => {
    const { client, workers } = makeClient({ auto: false })
    client.warm()
    workers[0].postMessage = () => {
      throw new Error('DataCloneError')
    }
    await expect(client.instrument(PAGE)).resolves.toEqual({ kind: 'failed', failure: 'crashed' })
    expect(workers[0].terminated).toBe(true)
  })

  it('dispose stops the worker, fails what waits, and refuses new work', async () => {
    const { client, workers } = makeClient({ auto: false })
    const waiting = client.instrument(PAGE)
    await client.dispose()
    await expect(waiting).resolves.toEqual({ kind: 'failed', failure: 'unavailable' })
    expect(workers[0].terminated).toBe(true)
    await expect(client.instrument(PAGE)).resolves.toEqual({
      kind: 'failed',
      failure: 'unavailable'
    })
    await client.dispose()

    const rejecting = makeClient({ auto: false })
    void rejecting.client.instrument(PAGE)
    rejecting.workers[0].terminate = () => Promise.reject(new Error('gone'))
    await expect(rejecting.client.dispose()).resolves.toBeUndefined()
  })

  it('shares one client across the process', () => {
    expect(sharedCommentParseClient()).toBe(sharedCommentParseClient())
  })
})
