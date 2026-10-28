// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Main-side client of the persistent comment parse worker
 * (docs/designs/comments/html-preview-comments.md §19 R3-12; pattern
 * `src/main/services/GitStatusWorkerAdapter.ts`).
 *
 * ONE worker for the whole process, started lazily and warmed when the first
 * HTML preview opens with comments on (`warm`), so the first commented page
 * does not pay the worker's start-up and JIT warm-up (about 0.5 s, spike S9).
 * One worker with a serial queue, not a pool: a pool of four halved warm
 * latency but cost 1.2 s cold (S9).
 *
 * The same worker runs the comment file jobs (`runJob`, `commentFileJobs.ts`):
 * the parse a pick, a pin, a list or a write needs, so none of them parses a
 * page on the main thread either. They share the queue and its limits with
 * the instrumentation of served pages.
 *
 * `instrument` and `runJob` never reject. Every failure is a `failed` result
 * – for `instrument` the caller serves the raw bytes (or reads them again,
 * when they were lent and lost):
 * - `busy` – the queue is full (count or bytes), so a page with many large
 *   frames cannot park unbounded copies in main memory;
 * - `timeout` – no answer in time; the worker is terminated;
 * - `crashed` – the worker died (an error, an out-of-memory stop, an exit);
 * - `error` – the worker threw on this document, or answered nonsense;
 * - `poisoned` – these bytes stopped a worker before, so they are not parsed
 *   again (the file is served raw, "comments unavailable");
 * - `unavailable` – no worker: its bundle is missing, or workers died too
 *   often (below).
 *
 * Restart policy (M-068, security review S-M). Before any work the worker
 * names the SHA-256 of the request's bytes (`begin`). When it dies on a
 * request – a crash, an out-of-memory stop, or this client's time limit –
 * that content is POISONED: every later request carries the list (at most
 * {@link MAX_POISONED_HASHES}), and the worker answers `poisoned` for it
 * without parsing it again. One hostile page therefore costs one worker, and
 * every other file keeps its comments. The next request after a death starts
 * a new worker, after a back-off that doubles with each death in the last
 * {@link DEATH_WINDOW_MS} (1 s, 2 s, 4 s … at most 30 s; requests meanwhile
 * answer `busy`). Past {@link DEFAULT_MAX_RESTARTS} deaths in that window
 * comments stay unavailable for the session, so pages that kill the worker
 * with new content every time cannot keep it respawning.
 *
 * Main-thread cost per document (the §5.8 budget, F-002): the message hops
 * and wrapping the result; the parse itself never runs here. Bytes are LENT,
 * not copied (§19 Rev 4): a buffer of at least {@link LEND_MIN_BYTES} that
 * owns its whole `ArrayBuffer` – every file read at that size – moves to the
 * worker, so the caller's view is empty until the answer hands the same
 * memory back as `raw`. A smaller or partial view is copied, which costs
 * microseconds and keeps a shared constant intact. Lent bytes the worker
 * never answered for (a timeout, a crash) are gone: the caller's view stays
 * empty and there is no `raw`.
 *
 * Every request's answer budget is {@link DEFAULT_TIMEOUT_MS} plus
 * {@link DEFAULT_TIMEOUT_PER_MB_MS} for each megabyte waiting in the queue,
 * its own included: the worker answers in order, so a request behind a 25 MB
 * page waits for that page's parse too.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { logger } from '../../LoggingService'
import type { CommentFileJob, CommentFileJobRunner, CommentJobFailure, CommentJobOutcome, JobResultOf } from './commentFileJobs'
import type { InstrumentOutcome } from './commentParseCore'
import {
  COMMENT_PARSE_WORKER_ROLE,
  MAX_POISONED_HASHES,
  isParseBegin,
  isParseReply,
  type CommentParseReply,
  type CommentParseRequest
} from './commentParseProtocol'

/** Why the worker produced no outcome for a document. */
export type CommentParseFailure = CommentJobFailure

/** Lent bytes the worker handed back: the caller's own memory, which its view no longer holds. */
export interface HandedBack {
  readonly raw?: Uint8Array
}

/** What {@link CommentParseClient.instrument} resolves to; `raw` only when the bytes were lent and came back. */
export type CommentParseResult =
  (InstrumentOutcome | { readonly kind: 'failed'; readonly failure: CommentParseFailure }) & HandedBack

/** The slice of a `worker_threads.Worker` the client uses. Structural for tests. */
export interface CommentParseWorkerLike {
  postMessage(message: CommentParseRequest, transfer: ArrayBuffer[]): void
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  terminate(): Promise<number>
  /** Let the process exit while the worker idles. */
  unref?(): void
}

/** Test seams and limits; production uses the defaults. */
export interface CommentParseClientDeps {
  /** Start a worker, or `null` when it cannot be started (its bundle is missing). */
  readonly createWorker?: () => CommentParseWorkerLike | null
  /** Per-request answer budget before the queue's bytes are counted (ms). */
  readonly timeoutMs?: number
  /** Answer budget added per megabyte waiting in the queue, the request's own included (ms). */
  readonly timeoutPerMbMs?: number
  /** New workers allowed within {@link DEATH_WINDOW_MS} of each other's deaths. */
  readonly maxRestarts?: number
  /** Monotonic clock for the restart back-off (ms). */
  readonly now?: () => number
  /** Requests waiting at once. */
  readonly maxPending?: number
  /** Bytes waiting at once. */
  readonly maxPendingBytes?: number
}

const MB = 1024 * 1024
/** A 4 MB page parses in about 0.4 s warm and 0.9 s cold on the slowest box measured (S9). */
const DEFAULT_TIMEOUT_MS = 10_000
/**
 * The slowest job – a save, which parses the file twice – took up to 0.43 s
 * per MB on the slowest box measured (8–11 s for a dense 25 MB page, §19
 * Rev 4), so a second per queued megabyte leaves more than twice that.
 */
const DEFAULT_TIMEOUT_PER_MB_MS = 1_000
/** Worker deaths one window allows a restart after (S-M); one more stops comments for the session. */
export const DEFAULT_MAX_RESTARTS = 4
/** The window worker deaths are counted in. */
export const DEATH_WINDOW_MS = 10 * 60_000
/** The wait before the first restart; it doubles with each death in the window. */
export const RESTART_BACKOFF_MS = 1_000
/** The longest wait before a restart. */
export const RESTART_BACKOFF_MAX_MS = 30_000
/** Two full pages of frames' worth of documents (`MAX_FRAMES_PER_PAGE` is 50). */
const DEFAULT_MAX_PENDING = 64
/** Two files at the comment size limit (25 MB) and a page's small frames: a list never waits out a page load. */
const DEFAULT_MAX_PENDING_BYTES = 64 * MB
/**
 * The worker's heap ceiling. A parse holds about 30 bytes of tree per byte of
 * page (parse5 builds text and attributes one character at a time, and keeps
 * a location per node), and more for every element. Measured on the slowest
 * box (§19 Rev 4): a dense 25 MB page of 456,000 elements runs every job with
 * 1,280 MB and crashes with 1,024 MB; one of 650,000 elements – the most the
 * start-tag count lets through to a parse – with 1,536 MB. A third above that.
 */
export const WORKER_HEAP_MB = 2_048
/** At this size and above, bytes that own their whole buffer are lent to the worker, not copied (module comment). */
export const LEND_MIN_BYTES = 64 * 1024
/** The bundle `electron.vite.config.ts` builds next to `index.js`. */
const WORKER_FILE = 'comment-parse.worker.js'
/** A tiny document that makes the worker load parse5 and JIT the pipeline. */
const WARM_UP_BYTES = new TextEncoder().encode(
  '<!doctype html><title>w</title><p id=a class=b>w</p>'
)

/** What a waiting request is answered with: the reply it accepts, else `failed`. */
type Settled = CommentParseReply | { readonly kind: 'failed'; readonly failure: CommentParseFailure }

/** A settled request, with the caller's bytes when they were lent and handed back. */
interface Answer {
  readonly settled: Settled
  readonly raw?: Uint8Array
}

interface PendingRequest {
  readonly resolve: (answer: Answer) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly bytes: number
  /** The caller's own buffer went to the worker. */
  readonly lent: boolean
  /** The SHA-256 of the bytes, once the worker began on them (`begin`). */
  hash?: string
}

const failed = (failure: CommentParseFailure): { readonly kind: 'failed'; readonly failure: CommentParseFailure } => ({
  kind: 'failed',
  failure
})

/** `value` with the handed-back bytes, when there are any. */
function withRaw<T extends object>(value: T, raw: Uint8Array | undefined): T & HandedBack {
  return raw === undefined ? value : { ...value, raw }
}

/** The instrument outcome a reply carries, or `error` for any other reply. */
function instrumentOutcomeOf({ settled, raw }: Answer): CommentParseResult {
  if ('kind' in settled) return withRaw(settled, raw)
  return withRaw(settled.type === 'result' ? settled.outcome : failed('error'), raw)
}

/** The job answer a reply carries, when it answers a job of `kind`; else `error`. */
function jobOutcomeOf<J extends CommentFileJob>({ settled, raw }: Answer, kind: J['kind']): CommentJobOutcome<J> {
  if ('kind' in settled) return withRaw(settled, raw)
  const result = settled.type === 'job' && settled.result.kind === kind ? (settled.result as JobResultOf<J>) : failed('error')
  return withRaw(result, raw)
}

/**
 * True when `bytes` may be lent – moved to the worker without a copy: big
 * enough for a copy to show on the main thread, and the only view of its own
 * `ArrayBuffer` (moving a view into a larger buffer would take the rest along).
 */
function isLendable(bytes: Uint8Array): boolean {
  return (
    bytes.length >= LEND_MIN_BYTES &&
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  )
}

/** The production worker: the built bundle, or `null` when it is missing. */
function defaultCreateWorker(): CommentParseWorkerLike | null {
  const path = join(__dirname, WORKER_FILE)
  if (!existsSync(path)) return null
  return new Worker(path, {
    workerData: { role: COMMENT_PARSE_WORKER_ROLE },
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB }
  })
}

/** The process-wide comment parse client; also the production {@link CommentFileJobRunner}. */
export class CommentParseClient implements CommentFileJobRunner {
  private readonly createWorker: () => CommentParseWorkerLike | null
  private readonly timeoutMs: number
  private readonly timeoutPerMbMs: number
  private readonly maxRestarts: number
  private readonly maxPending: number
  private readonly maxPendingBytes: number
  private readonly now: () => number
  private worker: CommentParseWorkerLike | null = null
  private disabled = false
  /** When workers died, within the window. */
  private deaths: number[] = []
  /** No new worker before this time (the back-off). */
  private restartAt = 0
  /** Contents that stopped a worker, oldest first (module comment). */
  private readonly poisoned = new Set<string>()
  private nextId = 1
  private pendingBytes = 0
  private readonly pending = new Map<number, PendingRequest>()

  constructor(deps: CommentParseClientDeps = {}) {
    this.createWorker = deps.createWorker ?? defaultCreateWorker
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.timeoutPerMbMs = deps.timeoutPerMbMs ?? DEFAULT_TIMEOUT_PER_MB_MS
    this.maxRestarts = deps.maxRestarts ?? DEFAULT_MAX_RESTARTS
    this.maxPending = deps.maxPending ?? DEFAULT_MAX_PENDING
    this.maxPendingBytes = deps.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES
    this.now = deps.now ?? (() => performance.now())
  }

  /** `false` once comments can no longer be prepared in this session. */
  isAvailable(): boolean {
    return !this.disabled
  }

  /** Start the worker and run one tiny parse, so the first real page finds it warm. */
  warm(): void {
    if (this.worker !== null || this.disabled) return
    void this.instrument(WARM_UP_BYTES)
  }

  /**
   * Instrument one document in the worker. Never rejects. `bytes` may be lent
   * (module comment): read them back from the result's `raw`, never from the
   * caller's view.
   */
  async instrument(bytes: Uint8Array): Promise<CommentParseResult> {
    return instrumentOutcomeOf(await this.request(bytes, (id, sent) => ({ type: 'instrument', id, bytes: sent })))
  }

  /** Run one comment file job on `bytes` in the worker. Never rejects. `bytes` may be lent, as for {@link instrument}. */
  async runJob<J extends CommentFileJob>(bytes: Uint8Array, job: J): Promise<CommentJobOutcome<J>> {
    return jobOutcomeOf<J>(await this.request(bytes, (id, sent) => ({ type: 'job', id, bytes: sent, job })), job.kind)
  }

  /** Queue one request for the worker; resolves with its reply, or why there is none. */
  private request(bytes: Uint8Array, message: (id: number, sent: Uint8Array) => CommentParseRequest): Promise<Answer> {
    if (
      this.pending.size >= this.maxPending ||
      this.pendingBytes + bytes.length > this.maxPendingBytes
    ) {
      return Promise.resolve({ settled: failed('busy') })
    }
    const worker = this.ensureWorker()
    if (worker === 'later') return Promise.resolve({ settled: failed('busy') })
    if (worker === null) return Promise.resolve({ settled: failed('unavailable') })
    const lent = isLendable(bytes)
    // Not lent: a copy the worker may own – a small read can be a view into a larger, shared buffer.
    const sent = lent ? bytes : new Uint8Array(bytes)
    const id = this.nextId++
    // The worker answers in order: this answer waits for every byte queued before it, and its own.
    const budgetMs = this.timeoutMs + Math.floor(((this.pendingBytes + sent.length) * this.timeoutPerMbMs) / MB)
    return new Promise<Answer>(resolve => {
      const timer = setTimeout(() => this.onTimeout(worker, id), budgetMs)
      this.pending.set(id, { resolve, timer, bytes: sent.length, lent })
      this.pendingBytes += sent.length
      const poisoned = this.poisoned.size > 0 ? { poisoned: [...this.poisoned] } : {}
      try {
        worker.postMessage({ ...message(id, sent), ...poisoned }, [sent.buffer as ArrayBuffer])
      } catch {
        // A refused post moves nothing: the caller's bytes are still its own.
        this.settle(id, failed('crashed'))
        this.retire(worker, 'post-failed')
      }
    })
  }

  /** Stop the worker; every waiting request resolves `unavailable`. Safe to call twice. */
  async dispose(): Promise<void> {
    this.disabled = true
    const worker = this.worker
    this.worker = null
    this.failAll('unavailable')
    if (worker !== null) {
      try {
        await worker.terminate()
      } catch {
        // Already gone.
      }
    }
  }

  /** The worker, a new one, `'later'` while the back-off runs, or `null` when there will be none. */
  private ensureWorker(): CommentParseWorkerLike | 'later' | null {
    if (this.worker !== null) return this.worker
    if (this.disabled) return null
    if (this.now() < this.restartAt) return 'later'
    let worker: CommentParseWorkerLike | null
    try {
      worker = this.createWorker()
    } catch {
      worker = null
    }
    if (worker === null) {
      // Missing bundle (or a constructor that throws): nothing a retry fixes.
      logger.error('Preview comments: the parse worker could not be started')
      this.disabled = true
      return null
    }
    this.attach(worker)
    return worker
  }

  private attach(worker: CommentParseWorkerLike): void {
    this.worker = worker
    worker.unref?.()
    worker.on('message', message => this.onMessage(worker, message))
    worker.on('error', () => this.retire(worker, 'error'))
    worker.on('exit', code => this.retire(worker, `exit-${code}`))
  }

  private onMessage(worker: CommentParseWorkerLike, message: unknown): void {
    if (worker !== this.worker) return
    if (isParseBegin(message)) {
      const entry = this.pending.get(message.id)
      if (entry !== undefined) entry.hash = message.hash
      return
    }
    if (!isParseReply(message)) {
      // Our own worker answering nonsense: drop the request it may belong to.
      const id = (message as { id?: unknown } | null)?.id
      if (typeof id === 'number') this.settle(id, failed('error'))
      return
    }
    const reply: CommentParseReply = message
    const settled = reply.type === 'error' || reply.type === 'poisoned' ? failed(reply.type) : reply
    this.settle(reply.id, settled, reply.raw)
  }

  private onTimeout(worker: CommentParseWorkerLike, id: number): void {
    if (!this.pending.has(id)) return
    // Named before the answer: the request that timed out may be waiting behind the one the worker is on.
    const culprit = this.inFlightHash()
    this.settle(id, failed('timeout'))
    this.retire(worker, 'timeout', culprit)
  }

  /** A worker died or hung: poison what it was on, fail what it held, and let the next request restart it. */
  private retire(worker: CommentParseWorkerLike, cause: string, culprit = this.inFlightHash()): void {
    if (worker !== this.worker) return
    this.worker = null
    if (culprit !== undefined) this.poison(culprit)
    this.recordDeath()
    logger.warn('Preview comments: the parse worker stopped', {
      cause,
      poisoned: culprit !== undefined,
      ...(this.disabled ? { unavailable: true } : {})
    })
    this.failAll('crashed')
    void worker.terminate().catch(() => undefined)
  }

  /** The content the worker was on: the oldest request it began and did not answer (it answers in order). */
  private inFlightHash(): string | undefined {
    for (const entry of this.pending.values()) if (entry.hash !== undefined) return entry.hash
    return undefined
  }

  private poison(hash: string): void {
    this.poisoned.delete(hash)
    this.poisoned.add(hash)
    if (this.poisoned.size > MAX_POISONED_HASHES) this.poisoned.delete(this.poisoned.values().next().value as string)
  }

  /** Count a death in the window: past the limit comments stop for the session; else the next start waits. */
  private recordDeath(): void {
    const now = this.now()
    this.deaths = [...this.deaths.filter(at => now - at < DEATH_WINDOW_MS), now]
    if (this.deaths.length > this.maxRestarts) {
      this.disabled = true
      return
    }
    this.restartAt = now + Math.min(RESTART_BACKOFF_MAX_MS, RESTART_BACKOFF_MS * 2 ** (this.deaths.length - 1))
  }

  /** Answer request `id`; `raw` reaches the caller only when its own bytes were lent – a copy's echo is dropped. */
  private settle(id: number, result: Settled, raw?: Uint8Array): void {
    const entry = this.pending.get(id)
    if (entry === undefined) return
    this.pending.delete(id)
    this.pendingBytes -= entry.bytes
    clearTimeout(entry.timer)
    entry.resolve(entry.lent && raw !== undefined ? { settled: result, raw } : { settled: result })
  }

  private failAll(failure: CommentParseFailure): void {
    for (const id of [...this.pending.keys()]) this.settle(id, failed(failure))
  }
}

let shared: CommentParseClient | undefined

/** The process-wide client every preview session shares (one worker, R3-12). */
export function sharedCommentParseClient(): CommentParseClient {
  shared ??= new CommentParseClient()
  return shared
}
