// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The link scan worker client (issue #124 audit, follow-up): one lazy
 * persistent worker, bytes moved rather than copied, a bounded queue, a
 * per-request time limit, and a dead worker replaced after a back-off – too
 * many deaths leave the scan unavailable. Every failure answers `failed` and
 * never rejects. The worker is a fake that answers with the real scan
 * in-process, so these tests drive every failure on purpose; the real bundled
 * worker is `previewLinkScan.perf.test.ts`.
 */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { logger } from '../LoggingService'
import {
  DEATH_WINDOW_MS,
  PreviewLinkScanClient,
  RESTART_BACKOFF_MAX_MS,
  RESTART_BACKOFF_MS,
  sharedPreviewLinkScanClient,
  type LinkScanWorkerLike
} from './PreviewLinkScanWorkerAdapter'
import { scanLinkDocument } from './previewLinkScanCore'
import type { LinkScanRequest } from './previewLinkScanProtocol'

const MB = 1024 * 1024
const PAGE = '<link rel="stylesheet" href="a.css"><img src="b.png">'
const PAGE_OUTCOME = scanLinkDocument(PAGE, true)

/** Fresh bytes in a buffer of their own, as the pipeline's reader returns them. */
const owned = (text: string): Uint8Array => new Uint8Array(new TextEncoder().encode(text))

/** A fake worker: records what it is sent; answers when told (or at once in `auto` mode). */
class FakeWorker extends EventEmitter implements LinkScanWorkerLike {
  readonly sent: Array<{ message: LinkScanRequest; transfer: ArrayBuffer[] }> = []
  terminated = false
  unrefed = false
  refusePost = false
  constructor(private readonly auto: boolean) {
    super()
  }
  postMessage(message: LinkScanRequest, transfer: ArrayBuffer[]): void {
    if (this.refusePost) throw new Error('DataCloneError')
    this.sent.push({ message, transfer })
    if (this.auto) queueMicrotask(() => this.answer(message.id))
  }
  /** Answer request `id` the way the real worker would. */
  answer(id: number): void {
    const { message } = this.sent.find(entry => entry.message.id === id)!
    this.emit('message', { type: 'result', id, outcome: scanLinkDocument(message.html, message.frames) })
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
    timeoutPerMbMs?: number
    maxPending?: number
    maxPendingBytes?: number
    maxRestarts?: number
  } = {}
) {
  const workers: FakeWorker[] = []
  /** The client's clock, moved by hand (ms). */
  const clock = { now: 0 }
  const client = new PreviewLinkScanClient({
    createWorker: () => {
      const worker = new FakeWorker(options.auto ?? true)
      workers.push(worker)
      return worker
    },
    timeoutMs: options.timeoutMs,
    timeoutPerMbMs: options.timeoutPerMbMs,
    maxPending: options.maxPending,
    maxPendingBytes: options.maxPendingBytes,
    maxRestarts: options.maxRestarts,
    now: () => clock.now
  })
  return { client, workers, clock }
}

const lastId = (worker: FakeWorker): number => worker.sent.at(-1)!.message.id

beforeEach(() => {
  vi.mocked(logger.warn).mockClear()
  vi.mocked(logger.error).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PreviewLinkScanClient – a scan', () => {
  it('scans a document in one lazily started worker and answers with its outcome', async () => {
    const { client, workers } = makeClient()
    expect(workers).toHaveLength(0)

    expect(await client.scan(owned(PAGE), { frames: true })).toEqual(PAGE_OUTCOME)
    expect(await client.scan(PAGE, { frames: false })).toEqual(scanLinkDocument(PAGE, false))

    expect(workers).toHaveLength(1)
    expect(workers[0].unrefed).toBe(true)
    expect(workers[0].sent.map(({ message }) => message.frames)).toEqual([true, false])
    expect(client.isAvailable()).toBe(true)
  })

  it('moves bytes that own their buffer, without a copy', async () => {
    const { client, workers } = makeClient()
    const bytes = owned(PAGE)

    await client.scan(bytes, { frames: true })

    const { message, transfer } = workers[0].sent[0]
    expect(message.html).toBe(bytes)
    expect(transfer).toEqual([bytes.buffer])
  })

  it('copies a view into a larger buffer, or a pooled Buffer, and moves the copy', async () => {
    const { client, workers } = makeClient()
    const backing = owned(`xx${PAGE}yy`)
    const view = backing.subarray(2, backing.length - 2)
    const pooled = Buffer.from(PAGE)

    expect(await client.scan(view, { frames: true })).toEqual(PAGE_OUTCOME)
    expect(await client.scan(pooled, { frames: true })).toEqual(PAGE_OUTCOME)

    for (const [index, original] of [view, pooled].entries()) {
      const { message, transfer } = workers[0].sent[index]
      expect(message.html).not.toBe(original)
      expect((message.html as Uint8Array).buffer).not.toBe(original.buffer)
      expect(message.html).toEqual(new Uint8Array(original))
      expect(transfer).toEqual([(message.html as Uint8Array).buffer])
    }
  })

  it('clones text: nothing moves', async () => {
    const { client, workers } = makeClient()
    await client.scan(PAGE, { frames: true })
    expect(workers[0].sent[0]).toEqual({ message: { type: 'scan', id: 1, html: PAGE, frames: true }, transfer: [] })
  })
})

describe('PreviewLinkScanClient – the queue', () => {
  it('answers busy past the most requests waiting, and takes them again once answered', async () => {
    const { client, workers } = makeClient({ auto: false, maxPending: 2 })
    const first = client.scan(PAGE, { frames: true })
    const second = client.scan(PAGE, { frames: true })

    expect(await client.scan(PAGE, { frames: true })).toEqual({ kind: 'failed', failure: 'busy' })
    workers[0].answer(1)
    workers[0].answer(2)
    expect(await first).toEqual(PAGE_OUTCOME)
    expect(await second).toEqual(PAGE_OUTCOME)

    const third = client.scan(PAGE, { frames: true })
    workers[0].answer(lastId(workers[0]))
    expect(await third).toEqual(PAGE_OUTCOME)
  })

  it('answers busy past the most bytes waiting, counting text by its length', async () => {
    const { client, workers } = makeClient({ auto: false, maxPendingBytes: 100 })
    const first = client.scan(owned('x'.repeat(60)), { frames: true })

    expect(await client.scan('y'.repeat(41), { frames: true })).toEqual({ kind: 'failed', failure: 'busy' })
    const fits = client.scan('y'.repeat(40), { frames: true })
    workers[0].answer(1)
    workers[0].answer(2)
    await expect(first).resolves.toMatchObject({ kind: 'ok' })
    await expect(fits).resolves.toMatchObject({ kind: 'ok' })
    expect(workers[0].sent).toHaveLength(2)
  })
})

describe('PreviewLinkScanClient – a worker that does not answer', () => {
  it('times a request out, stops the worker and fails what it held; the budget grows with the bytes queued', async () => {
    vi.useFakeTimers()
    const { client, workers } = makeClient({ auto: false, timeoutMs: 100, timeoutPerMbMs: 1000 })
    const megabyte = client.scan(owned('x'.repeat(MB)), { frames: true })
    // Queued behind the megabyte: 100 ms plus a second per megabyte waiting, its own included.
    const behind = client.scan(PAGE, { frames: true })

    await vi.advanceTimersByTimeAsync(1099)
    expect(workers[0].terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect(await megabyte).toEqual({ kind: 'failed', failure: 'timeout' })
    expect(await behind).toEqual({ kind: 'failed', failure: 'crashed' })
    expect(workers[0].terminated).toBe(true)
    expect(vi.mocked(logger.warn).mock.calls).toEqual([
      ['Preview auto-refresh: the link scan worker stopped', { cause: 'timeout' }]
    ])
  })

  it('ignores a late answer from a worker it stopped', async () => {
    vi.useFakeTimers()
    const { client, workers } = makeClient({ auto: false, timeoutMs: 10 })
    const scan = client.scan(PAGE, { frames: true })
    await vi.advanceTimersByTimeAsync(10)
    workers[0].answer(1)
    expect(await scan).toEqual({ kind: 'failed', failure: 'timeout' })
  })
})

describe('PreviewLinkScanClient – a worker that dies', () => {
  it.each([
    ['an error', (worker: FakeWorker) => worker.emit('error', new Error('boom')), 'error'],
    ['an exit', (worker: FakeWorker) => worker.emit('exit', 1), 'exit-1']
  ])('fails what it held on %s, and logs the cause once', async (_label, die, cause) => {
    const { client, workers } = makeClient({ auto: false })
    const scan = client.scan(PAGE, { frames: true })

    die(workers[0])
    // The exit that follows an error is the same death.
    workers[0].emit('exit', 1)

    expect(await scan).toEqual({ kind: 'failed', failure: 'crashed' })
    expect(workers[0].terminated).toBe(true)
    expect(vi.mocked(logger.warn).mock.calls).toEqual([['Preview auto-refresh: the link scan worker stopped', { cause }]])
  })

  it('lets a dead worker go quietly when stopping it fails too', async () => {
    const { client, workers } = makeClient({ auto: false })
    const scan = client.scan(PAGE, { frames: true })
    const stop = vi.fn(() => Promise.reject(new Error('already gone')))
    workers[0].terminate = stop

    workers[0].emit('exit', 1)

    expect(await scan).toEqual({ kind: 'failed', failure: 'crashed' })
    expect(stop).toHaveBeenCalledTimes(1)
    // The rejection is handled: nothing reaches the process as unhandled.
    await new Promise(resolveTick => setImmediate(resolveTick))
  })

  it('starts a new worker after a back-off that doubles with each death, answering busy meanwhile', async () => {
    const { client, workers, clock } = makeClient()
    await client.scan(PAGE, { frames: true })
    workers[0].emit('exit', 1)

    clock.now = RESTART_BACKOFF_MS - 1
    expect(await client.scan(PAGE, { frames: true })).toEqual({ kind: 'failed', failure: 'busy' })
    clock.now = RESTART_BACKOFF_MS
    expect(await client.scan(PAGE, { frames: true })).toEqual(PAGE_OUTCOME)
    expect(workers).toHaveLength(2)

    workers[1].emit('exit', 1)
    clock.now += 2 * RESTART_BACKOFF_MS - 1
    expect(await client.scan(PAGE, { frames: true })).toEqual({ kind: 'failed', failure: 'busy' })
    clock.now += 1
    expect(await client.scan(PAGE, { frames: true })).toEqual(PAGE_OUTCOME)
    expect(workers).toHaveLength(3)
  })

  it(`waits at most ${RESTART_BACKOFF_MAX_MS} ms between restarts`, async () => {
    const { client, workers, clock } = makeClient({ maxRestarts: 10 })
    for (let death = 0; death < 7; death += 1) {
      await client.scan(PAGE, { frames: true })
      workers.at(-1)!.emit('exit', 1)
      clock.now += RESTART_BACKOFF_MAX_MS
    }
    expect(await client.scan(PAGE, { frames: true })).toEqual(PAGE_OUTCOME)
    expect(workers).toHaveLength(8)
  })

  it('stays unavailable for the session past the deaths one window allows', async () => {
    const { client, workers, clock } = makeClient({ maxRestarts: 1 })
    await client.scan(PAGE, { frames: true })
    workers[0].emit('exit', 1)
    clock.now += RESTART_BACKOFF_MS
    await client.scan(PAGE, { frames: true })
    workers[1].emit('exit', 1)

    clock.now += RESTART_BACKOFF_MAX_MS
    expect(await client.scan(PAGE, { frames: true })).toEqual({ kind: 'failed', failure: 'unavailable' })
    expect(client.isAvailable()).toBe(false)
    expect(workers).toHaveLength(2)
    expect(vi.mocked(logger.warn).mock.calls.at(-1)).toEqual([
      'Preview auto-refresh: the link scan worker stopped',
      { cause: 'exit-1', unavailable: true }
    ])
  })

  it(`forgets deaths older than ${DEATH_WINDOW_MS} ms`, async () => {
    const { client, workers, clock } = makeClient({ maxRestarts: 1 })
    await client.scan(PAGE, { frames: true })
    workers[0].emit('exit', 1)
    clock.now += DEATH_WINDOW_MS
    await client.scan(PAGE, { frames: true })
    workers[1].emit('exit', 1)
    clock.now += RESTART_BACKOFF_MS

    expect(await client.scan(PAGE, { frames: true })).toEqual(PAGE_OUTCOME)
    expect(client.isAvailable()).toBe(true)
  })

  it('fails a request the worker refuses to take, and replaces the worker', async () => {
    const { client, workers, clock } = makeClient()
    await client.scan(PAGE, { frames: true })
    workers[0].refusePost = true

    expect(await client.scan(PAGE, { frames: true })).toEqual({ kind: 'failed', failure: 'crashed' })
    expect(workers[0].terminated).toBe(true)
    expect(vi.mocked(logger.warn).mock.calls).toEqual([
      ['Preview auto-refresh: the link scan worker stopped', { cause: 'post-failed' }]
    ])
    clock.now += RESTART_BACKOFF_MS
    expect(await client.scan(PAGE, { frames: true })).toEqual(PAGE_OUTCOME)
  })
})

describe('PreviewLinkScanClient – answers it does not trust', () => {
  it('fails the request a malformed answer names, and drops one that names none', async () => {
    const { client, workers } = makeClient({ auto: false })
    const scan = client.scan(PAGE, { frames: true })

    workers[0].emit('message', null)
    workers[0].emit('message', { type: 'result', outcome: PAGE_OUTCOME })
    workers[0].emit('message', { type: 'result', id: 1, outcome: { kind: 'error', error: 'at C:\\proj' } })

    expect(await scan).toEqual({ kind: 'failed', failure: 'malformed' })
    expect(workers[0].terminated).toBe(false)
  })

  it('drops an answer to a request it is not waiting for', async () => {
    const { client, workers } = makeClient({ auto: false })
    const scan = client.scan(PAGE, { frames: true })
    workers[0].emit('message', { type: 'result', id: 99, outcome: PAGE_OUTCOME })
    workers[0].answer(1)
    expect(await scan).toEqual(PAGE_OUTCOME)
  })
})

describe('PreviewLinkScanClient – no worker', () => {
  it.each([
    ['its bundle is missing', () => null],
    [
      'it cannot be constructed',
      () => {
        throw new Error('ENOENT')
      }
    ]
  ])('is unavailable for the session when %s, logged once', async (_label, createWorker) => {
    const create = vi.fn(createWorker)
    const client = new PreviewLinkScanClient({ createWorker: create })

    expect(await client.scan(PAGE, { frames: true })).toEqual({ kind: 'failed', failure: 'unavailable' })
    expect(await client.scan(PAGE, { frames: true })).toEqual({ kind: 'failed', failure: 'unavailable' })

    expect(create).toHaveBeenCalledTimes(1)
    expect(client.isAvailable()).toBe(false)
    expect(vi.mocked(logger.error).mock.calls).toEqual([
      ['Preview auto-refresh: the link scan worker could not be started']
    ])
  })

  it('dispose fails what waits, stops the worker and refuses later scans; twice is harmless', async () => {
    const { client, workers } = makeClient({ auto: false })
    const scan = client.scan(PAGE, { frames: true })

    await client.dispose()
    await client.dispose()

    expect(await scan).toEqual({ kind: 'failed', failure: 'unavailable' })
    expect(workers[0].terminated).toBe(true)
    expect(await client.scan(PAGE, { frames: true })).toEqual({ kind: 'failed', failure: 'unavailable' })
    expect(workers).toHaveLength(1)
  })

  it('dispose swallows a worker that is already gone', async () => {
    const worker = new FakeWorker(true)
    worker.terminate = () => Promise.reject(new Error('gone'))
    const client = new PreviewLinkScanClient({ createWorker: () => worker })
    await client.scan(PAGE, { frames: true })

    await expect(client.dispose()).resolves.toBeUndefined()
  })
})

describe('sharedPreviewLinkScanClient', () => {
  it('is one client for the process', () => {
    expect(sharedPreviewLinkScanClient()).toBe(sharedPreviewLinkScanClient())
  })
})
