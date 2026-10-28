// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment parse worker client (docs/designs/html-preview-comments.md §19
 * R3-12): one lazy persistent worker, a bounded serial queue, a per-request
 * timeout, and M-068 with security review S-M – the content a worker died on
 * is poisoned, a dead worker is replaced after a back-off, and too many deaths
 * leave comments unavailable. The worker is a fake that answers with the real
 * pipeline in-process, so these tests drive every failure on purpose.
 */
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeText } from '../../../../shared/htmlComments'
import { runCommentFileJob } from './commentFileJobs'
import { CommentDocCache, sha256HexOf } from './commentJobDocs'
import { instrumentDocument } from './commentParseCore'
import { MAX_POISONED_HASHES, type CommentParseRequest } from './commentParseProtocol'
import {
  CommentParseClient,
  DEATH_WINDOW_MS,
  LEND_MIN_BYTES,
  RESTART_BACKOFF_MAX_MS,
  RESTART_BACKOFF_MS,
  sharedCommentParseClient,
  WORKER_HEAP_MB,
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
  /** The request `id` this worker was sent. */
  request(id: number): CommentParseRequest {
    return this.sent.find(entry => entry.message.id === id)!.message
  }
  /** Name the content of request `id` before working on it, as the real worker does (S-M). */
  begin(id: number): void {
    this.emit('message', { type: 'begin', id, hash: sha256HexOf(this.request(id).bytes) })
  }
  /** Answer request `id` the way the real worker would: refusing a poisoned content unparsed. */
  answer(id: number): void {
    const request = this.request(id)
    this.begin(id)
    if (request.poisoned?.includes(sha256HexOf(request.bytes)) === true) {
      this.emit('message', { type: 'poisoned', id })
      return
    }
    if (request.type === 'job') {
      this.emit('message', { type: 'job', id, result: runCommentFileJob(request.bytes, request.job, { cache: new CommentDocCache() }) })
      return
    }
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
    timeoutPerMbMs?: number
    maxPending?: number
    maxPendingBytes?: number
    maxRestarts?: number
  } = {}
) {
  const workers: FakeWorker[] = []
  /** The client's clock, moved by hand (ms). */
  const clock = { now: 0 }
  const client = new CommentParseClient({
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

/** The id of the last request `worker` was sent. */
const lastId = (worker: FakeWorker): number => worker.sent.at(-1)!.message.id

afterEach(() => {
  vi.useRealTimers()
})

describe('CommentParseClient jobs', () => {
  it('runs a comment file job in the worker on a copy of the bytes, and answers with its result', async () => {
    const { client, workers } = makeClient()
    const pooled = Buffer.from(PAGE)

    const result = await client.runJob(pooled, { kind: 'list' })

    expect(result).toMatchObject({ kind: 'list', ok: true, summary: { writable: true, threads: [] } })
    const { message, transfer } = workers[0].sent[0]
    expect(message).toMatchObject({ type: 'job', job: { kind: 'list' } })
    expect(message.bytes.buffer).not.toBe(pooled.buffer)
    expect(transfer).toEqual([message.bytes.buffer])
  })

  it('an answer of another kind, an instrument answer or an error is an error; a full queue is busy', async () => {
    const { client, workers } = makeClient({ auto: false, maxPending: 3 })
    const wrongKind = client.runJob(PAGE, { kind: 'list' })
    const wrongType = client.runJob(PAGE, { kind: 'list' })
    const thrown = client.runJob(PAGE, { kind: 'list' })
    expect(await client.runJob(PAGE, { kind: 'list' })).toEqual({ kind: 'failed', failure: 'busy' })
    const [first, second, third] = workers[0].sent.map(entry => entry.message.id)
    workers[0].emit('message', { type: 'job', id: first, result: { kind: 'pin', blocks: [] } })
    workers[0].emit('message', { type: 'result', id: second, outcome: instrumentDocument(PAGE) })
    workers[0].emit('message', { type: 'error', id: third })

    expect(await wrongKind).toEqual({ kind: 'failed', failure: 'error' })
    expect(await wrongType).toEqual({ kind: 'failed', failure: 'error' })
    expect(await thrown).toEqual({ kind: 'failed', failure: 'error' })
  })

  it('an instrument request answered with a job result is an error', async () => {
    const { client, workers } = makeClient({ auto: false })
    const pending = client.instrument(PAGE)
    workers[0].emit('message', { type: 'job', id: workers[0].sent[0].message.id, result: { kind: 'list', ok: false, refusal: 'encoding' } })
    expect(await pending).toEqual({ kind: 'failed', failure: 'error' })
  })
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

  it('M-068 a dead worker is replaced after a back-off; past the death limit comments stay unavailable', async () => {
    const { client, workers, clock } = makeClient({ auto: false, maxRestarts: 2 })
    const first = client.instrument(PAGE)
    workers[0].emit('error', new Error('boom'))
    await expect(first).resolves.toEqual({ kind: 'failed', failure: 'crashed' })
    expect(client.isAvailable()).toBe(true)

    // The back-off: busy, and no new worker, until it has passed.
    clock.now += RESTART_BACKOFF_MS - 1
    await expect(client.instrument(PAGE)).resolves.toEqual({ kind: 'failed', failure: 'busy' })
    client.warm()
    expect(workers).toHaveLength(1)
    clock.now += 1
    const second = client.instrument(PAGE)
    expect(workers).toHaveLength(2)
    workers[1].answer(lastId(workers[1]))
    expect((await second).kind).toBe('ok')

    // It dies too (an exit this time): the wait doubles.
    workers[1].emit('exit', 1)
    clock.now += 2 * RESTART_BACKOFF_MS - 1
    await expect(client.instrument(PAGE)).resolves.toEqual({ kind: 'failed', failure: 'busy' })
    clock.now += 1
    void client.instrument(PAGE)
    expect(workers).toHaveLength(3)

    // A third death in the window is one past the limit: no worker, ever.
    workers[2].emit('exit', 1)
    expect(client.isAvailable()).toBe(false)
    clock.now += DEATH_WINDOW_MS
    await expect(client.instrument(PAGE)).resolves.toEqual({ kind: 'failed', failure: 'unavailable' })
    client.warm()
    expect(workers).toHaveLength(3)
  })

  it('M-068 the wait doubles up to its ceiling, and deaths older than the window are forgotten', async () => {
    const { client, workers, clock } = makeClient({ auto: false, maxRestarts: 6 })
    void client.instrument(PAGE)
    for (const [death, wait] of [1_000, 2_000, 4_000, 8_000, 16_000, RESTART_BACKOFF_MAX_MS].entries()) {
      workers.at(-1)!.emit('exit', 1)
      clock.now += wait - 1
      await expect(client.instrument(PAGE)).resolves.toEqual({ kind: 'failed', failure: 'busy' })
      clock.now += 1
      void client.instrument(PAGE)
      expect(workers).toHaveLength(death + 2)
    }
    expect(client.isAvailable()).toBe(true)

    // Ten minutes on, the old deaths no longer count: the wait is the first one again.
    clock.now += DEATH_WINDOW_MS
    workers.at(-1)!.emit('exit', 1)
    expect(client.isAvailable()).toBe(true)
    clock.now += RESTART_BACKOFF_MS
    void client.instrument(PAGE)
    expect(workers).toHaveLength(8)
  })

  it('S-M the content a worker died on is not parsed again, and every other file keeps its comments', async () => {
    const { client, workers, clock } = makeClient({ auto: false })
    const hostile = encodeText('<!doctype html><body><div><div><div>')
    const killing = client.instrument(hostile)
    const queued = client.instrument(PAGE)
    workers[0].begin(workers[0].sent[0].message.id)
    workers[0].emit('error', new Error('ERR_WORKER_OUT_OF_MEMORY'))
    await expect(killing).resolves.toEqual({ kind: 'failed', failure: 'crashed' })
    // The page queued behind it fails with it, and is not blamed: the worker never began it.
    await expect(queued).resolves.toEqual({ kind: 'failed', failure: 'crashed' })

    clock.now += RESTART_BACKOFF_MS
    const other = client.instrument(PAGE)
    expect(workers[1].sent[0].message.poisoned).toEqual([sha256HexOf(hostile)])
    workers[1].answer(lastId(workers[1]))
    expect((await other).kind).toBe('ok')

    // The same bytes again – a reload, or a job on the file – are answered unparsed.
    const reload = client.instrument(new Uint8Array(hostile))
    workers[1].answer(lastId(workers[1]))
    await expect(reload).resolves.toEqual({ kind: 'failed', failure: 'poisoned' })
    const job = client.runJob(new Uint8Array(hostile), { kind: 'list' })
    workers[1].answer(lastId(workers[1]))
    await expect(job).resolves.toEqual({ kind: 'failed', failure: 'poisoned' })
    expect(workers).toHaveLength(2)
    expect(client.isAvailable()).toBe(true)
  })

  it('S-M a time-out poisons the content the worker was on, not the one that waited behind it', async () => {
    vi.useFakeTimers()
    const { client, workers, clock } = makeClient({ auto: false, timeoutMs: 1_000, timeoutPerMbMs: 0 })
    const slow = encodeText('<!doctype html><p>slow')
    const stuck = client.instrument(slow)
    const behind = client.instrument(PAGE)
    workers[0].begin(workers[0].sent[0].message.id)
    vi.advanceTimersByTime(1_000)
    await expect(stuck).resolves.toEqual({ kind: 'failed', failure: 'timeout' })
    await expect(behind).resolves.toEqual({ kind: 'failed', failure: 'crashed' })

    clock.now += RESTART_BACKOFF_MS
    void client.instrument(PAGE)
    expect(workers[1].sent[0].message.poisoned).toEqual([sha256HexOf(slow)])
  })

  it(`S-M keeps the last ${MAX_POISONED_HASHES} poisoned contents, and a death before any begin poisons nothing`, async () => {
    const { client, workers, clock } = makeClient({ auto: false, maxRestarts: Infinity })
    void client.instrument(PAGE)
    workers[0].emit('exit', 1)
    clock.now += RESTART_BACKOFF_MAX_MS
    void client.instrument(PAGE)
    expect(workers[1].sent[0].message.poisoned).toBeUndefined()

    const pages = Array.from({ length: MAX_POISONED_HASHES + 1 }, (_, n) => encodeText(`<p>${n}`))
    for (const page of pages) {
      workers.at(-1)!.emit('exit', 1)
      clock.now += RESTART_BACKOFF_MAX_MS
      void client.instrument(page)
      const worker = workers.at(-1)!
      worker.begin(lastId(worker))
    }
    workers.at(-1)!.emit('exit', 1)
    clock.now += RESTART_BACKOFF_MAX_MS
    void client.instrument(PAGE)
    const sent = workers.at(-1)!.sent[0].message.poisoned!
    expect(sent).toHaveLength(MAX_POISONED_HASHES)
    expect(sent).not.toContain(sha256HexOf(pages[0]))
    expect(sent.at(-1)).toBe(sha256HexOf(pages.at(-1)!))
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

describe('CommentParseClient – §19 Rev 4 lent bytes and time per megabyte', () => {
  const MB = 1024 * 1024
  /** A refusal answer that hands `raw` back, as the real worker does. */
  const refusalWith = (id: number, raw: Uint8Array) => ({ type: 'result', id, outcome: { kind: 'unavailable', reason: 'encoding' }, raw })

  it(`lends bytes of at least ${LEND_MIN_BYTES} that own their buffer, and resolves with the bytes handed back`, async () => {
    const { client, workers } = makeClient({ auto: false })
    const bytes = new Uint8Array(LEND_MIN_BYTES)
    const pending = client.instrument(bytes)
    const { message, transfer } = workers[0].sent[0]
    expect(message.bytes).toBe(bytes)
    expect(transfer).toEqual([bytes.buffer])

    const handedBack = new Uint8Array(LEND_MIN_BYTES)
    workers[0].emit('message', refusalWith(message.id, handedBack))
    const result = await pending
    expect(result).toMatchObject({ kind: 'unavailable', reason: 'encoding' })
    expect(result.raw).toBe(handedBack)
  })

  it('copies a smaller buffer or a view into a larger one, and drops the echo of a copy', async () => {
    const { client, workers } = makeClient({ auto: false })
    const small = new Uint8Array(LEND_MIN_BYTES - 1)
    const view = new Uint8Array(LEND_MIN_BYTES + 8).subarray(8)
    const smallResult = client.runJob(small, { kind: 'list' })
    const viewResult = client.instrument(view)
    const [first, second] = workers[0].sent
    expect(first.message.bytes).not.toBe(small)
    expect(second.message.bytes).not.toBe(view)
    expect(second.message.bytes.buffer).not.toBe(view.buffer)

    workers[0].emit('message', { type: 'job', id: first.message.id, result: { kind: 'list', ok: false, refusal: 'encoding' }, raw: first.message.bytes })
    workers[0].emit('message', refusalWith(second.message.id, second.message.bytes))
    expect(await smallResult).toEqual({ kind: 'list', ok: false, refusal: 'encoding' })
    expect(await viewResult).toEqual({ kind: 'unavailable', reason: 'encoding' })
  })

  it('a job answer and an error hand lent bytes back too; a timeout loses them', async () => {
    vi.useFakeTimers()
    const { client, workers } = makeClient({ auto: false, timeoutMs: 1_000, timeoutPerMbMs: 0 })
    const forJob = new Uint8Array(LEND_MIN_BYTES)
    const forError = new Uint8Array(LEND_MIN_BYTES)
    const job = client.runJob(forJob, { kind: 'list' })
    const thrown = client.instrument(forError)
    const [first, second] = workers[0].sent.map(entry => entry.message.id)
    workers[0].emit('message', { type: 'job', id: first, result: { kind: 'list', ok: false, refusal: 'encoding' }, raw: forJob })
    workers[0].emit('message', { type: 'error', id: second, raw: forError })
    expect((await job).raw).toBe(forJob)
    expect(await thrown).toEqual({ kind: 'failed', failure: 'error', raw: forError })

    const lost = client.instrument(new Uint8Array(LEND_MIN_BYTES))
    vi.advanceTimersByTime(1_000)
    expect(await lost).toEqual({ kind: 'failed', failure: 'timeout' })
  })

  it('gives each request its base time plus a second per megabyte queued, its own included', async () => {
    vi.useFakeTimers()
    const { client, workers } = makeClient({ auto: false, timeoutMs: 1_000, maxPendingBytes: 8 * MB })
    const first = client.instrument(new Uint8Array(2 * MB))
    const second = client.instrument(new Uint8Array(MB))
    const [firstId] = workers[0].sent.map(entry => entry.message.id)

    // The first: 1 s + 2 MB. Answered just in time.
    vi.advanceTimersByTime(2_999)
    workers[0].emit('message', refusalWith(firstId, new Uint8Array(0)))
    expect((await first).kind).toBe('unavailable')
    // The second waited behind the first: 1 s + 3 MB.
    vi.advanceTimersByTime(1_000)
    expect(workers[0].terminated).toBe(false)
    vi.advanceTimersByTime(1)
    expect(await second).toEqual({ kind: 'failed', failure: 'timeout' })
    expect(workers[0].terminated).toBe(true)
  })

  it('caps the worker heap where a 25 MB page at the element cap still parses (measured, §19 Rev 4)', () => {
    expect(WORKER_HEAP_MB).toBeGreaterThanOrEqual(1_536)
  })
})
