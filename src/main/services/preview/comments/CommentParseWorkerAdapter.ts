// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Main-side client of the persistent comment parse worker
 * (docs/designs/html-preview-comments.md §19 R3-12; pattern
 * `src/main/services/GitStatusWorkerAdapter.ts`).
 *
 * ONE worker for the whole process, started lazily and warmed when the first
 * HTML preview opens with comments on (`warm`), so the first commented page
 * does not pay the worker's start-up and JIT warm-up (about 0.5 s, spike S9).
 * One worker with a serial queue, not a pool: a pool of four halved warm
 * latency but cost 1.2 s cold (S9).
 *
 * `instrument` never rejects. Every failure is a `failed` result and the
 * caller serves the raw bytes:
 * - `busy` – the queue is full (count or bytes), so a page with many large
 *   frames cannot park unbounded copies in main memory;
 * - `timeout` – no answer in time; the worker is terminated;
 * - `crashed` – the worker died (an error, an out-of-memory stop, an exit);
 * - `error` – the worker threw on this document, or answered nonsense;
 * - `unavailable` – no worker: its bundle is missing, or it already failed
 *   once after a restart.
 *
 * Restart policy (M-068): after a worker dies (crash or timeout) the next
 * request starts a new one – once. When that one dies too, comments stay
 * unavailable for the rest of the session instead of respawning a worker that
 * a hostile page can kill on every load.
 *
 * Main-thread cost per document (the §5.8 budget, F-002): one copy of the
 * bytes into a transferable buffer, the message hops, and wrapping the result.
 * The parse itself never runs here.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { logger } from '../../LoggingService'
import type { InstrumentOutcome } from './commentParseCore'
import {
  COMMENT_PARSE_WORKER_ROLE,
  isParseReply,
  type CommentParseReply,
  type CommentParseRequest
} from './commentParseProtocol'

/** Why the worker produced no outcome for a document. */
export type CommentParseFailure = 'busy' | 'timeout' | 'crashed' | 'error' | 'unavailable'

/** What {@link CommentParseClient.instrument} resolves to. */
export type CommentParseResult =
  InstrumentOutcome | { readonly kind: 'failed'; readonly failure: CommentParseFailure }

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
  /** Per-request answer budget (ms). */
  readonly timeoutMs?: number
  /** New workers allowed after the first one dies. */
  readonly maxRestarts?: number
  /** Requests waiting at once. */
  readonly maxPending?: number
  /** Bytes waiting at once. */
  readonly maxPendingBytes?: number
}

/** A 4 MB page parses in about 0.4 s warm and 0.9 s cold on the slowest box measured (S9). */
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RESTARTS = 1
/** Two full pages of frames' worth of documents (`MAX_FRAMES_PER_PAGE` is 50). */
const DEFAULT_MAX_PENDING = 64
const DEFAULT_MAX_PENDING_BYTES = 32 * 1024 * 1024
/** The worker's heap ceiling: a 4 MB page holds about 60 MB while its tree is alive (S9). */
const WORKER_HEAP_MB = 512
/** The bundle `electron.vite.config.ts` builds next to `index.js`. */
const WORKER_FILE = 'comment-parse.worker.js'
/** A tiny document that makes the worker load parse5 and JIT the pipeline. */
const WARM_UP_BYTES = new TextEncoder().encode(
  '<!doctype html><title>w</title><p id=a class=b>w</p>'
)

interface PendingRequest {
  readonly resolve: (result: CommentParseResult) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly bytes: number
}

const failed = (failure: CommentParseFailure): CommentParseResult => ({ kind: 'failed', failure })

/** The production worker: the built bundle, or `null` when it is missing. */
function defaultCreateWorker(): CommentParseWorkerLike | null {
  const path = join(__dirname, WORKER_FILE)
  if (!existsSync(path)) return null
  return new Worker(path, {
    workerData: { role: COMMENT_PARSE_WORKER_ROLE },
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB }
  })
}

/** The process-wide comment parse client. */
export class CommentParseClient {
  private readonly createWorker: () => CommentParseWorkerLike | null
  private readonly timeoutMs: number
  private readonly maxStarts: number
  private readonly maxPending: number
  private readonly maxPendingBytes: number
  private worker: CommentParseWorkerLike | null = null
  private starts = 0
  private disabled = false
  private nextId = 1
  private pendingBytes = 0
  private readonly pending = new Map<number, PendingRequest>()

  constructor(deps: CommentParseClientDeps = {}) {
    this.createWorker = deps.createWorker ?? defaultCreateWorker
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxStarts = 1 + (deps.maxRestarts ?? DEFAULT_MAX_RESTARTS)
    this.maxPending = deps.maxPending ?? DEFAULT_MAX_PENDING
    this.maxPendingBytes = deps.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES
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

  /** Instrument one document in the worker. Never rejects. */
  instrument(bytes: Uint8Array): Promise<CommentParseResult> {
    if (
      this.pending.size >= this.maxPending ||
      this.pendingBytes + bytes.length > this.maxPendingBytes
    ) {
      return Promise.resolve(failed('busy'))
    }
    const worker = this.ensureWorker()
    if (worker === null) return Promise.resolve(failed('unavailable'))
    // A copy the worker may own: the read buffer can be a view into a larger one.
    const copy = new Uint8Array(bytes)
    const id = this.nextId++
    return new Promise<CommentParseResult>(resolve => {
      const timer = setTimeout(() => this.onTimeout(worker, id), this.timeoutMs)
      this.pending.set(id, { resolve, timer, bytes: copy.length })
      this.pendingBytes += copy.length
      try {
        worker.postMessage({ type: 'instrument', id, bytes: copy }, [copy.buffer])
      } catch {
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

  private ensureWorker(): CommentParseWorkerLike | null {
    if (this.worker !== null) return this.worker
    if (this.disabled || this.starts >= this.maxStarts) {
      this.disabled = true
      return null
    }
    this.starts += 1
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
    if (!isParseReply(message)) {
      // Our own worker answering nonsense: drop the request it may belong to.
      const id = (message as { id?: unknown } | null)?.id
      if (typeof id === 'number') this.settle(id, failed('error'))
      return
    }
    const reply: CommentParseReply = message
    this.settle(reply.id, reply.type === 'result' ? reply.outcome : failed('error'))
  }

  private onTimeout(worker: CommentParseWorkerLike, id: number): void {
    if (!this.pending.has(id)) return
    this.settle(id, failed('timeout'))
    this.retire(worker, 'timeout')
  }

  /** A worker died or hung: fail what it held and let the next request decide on a restart. */
  private retire(worker: CommentParseWorkerLike, cause: string): void {
    if (worker !== this.worker) return
    this.worker = null
    logger.warn('Preview comments: the parse worker stopped', { cause })
    this.failAll('crashed')
    if (this.starts >= this.maxStarts) this.disabled = true
    void worker.terminate().catch(() => undefined)
  }

  private settle(id: number, result: CommentParseResult): void {
    const entry = this.pending.get(id)
    if (entry === undefined) return
    this.pending.delete(id)
    this.pendingBytes -= entry.bytes
    clearTimeout(entry.timer)
    entry.resolve(result)
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
