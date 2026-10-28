// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Main-side client of the preview link scan worker (issue #124 security
 * audit, follow-up; pattern `comments/CommentParseWorkerAdapter.ts`).
 *
 * ONE worker for the whole process, started by the first scan (33–43 ms on
 * the emulated Windows box, about 1 ms of it on the main thread), with a
 * serial queue. It is its own worker, not a job kind of the comment parse worker:
 * auto-refresh works with comments off, a page that stops this worker cannot
 * count against comments (or the reverse), and a link scan never waits behind
 * a 25 MB comment parse.
 *
 * `scan` never rejects. Every failure is a `failed` result, and the caller
 * keeps no links for that document – it never scans the page on the main
 * thread instead:
 * - `busy` – the queue is full (count or bytes), or a restart is waiting out
 *   its back-off;
 * - `timeout` – no answer in time; the worker is terminated;
 * - `crashed` – the worker died (an error, an out-of-memory stop, an exit);
 * - `malformed` – the worker answered something that is not a reply;
 * - `unavailable` – no worker: its bundle is missing, or workers died too
 *   often (below).
 *
 * Restart policy, as the comment worker's: the next request after a death
 * starts a new worker, after a back-off that doubles with each death in the
 * last {@link DEATH_WINDOW_MS} (1 s, 2 s, 4 s … at most 30 s). Past
 * {@link DEFAULT_MAX_RESTARTS} deaths in that window the scan stays
 * unavailable for the session – auto-refresh then watches each page's own
 * file only. Unlike the comment worker it poisons no content: the scan is one
 * linear pass under a 4 MiB bound, and the most hostile page measured needed
 * at most 192 MB of the {@link WORKER_HEAP_MB} MB ceiling and 0.8 s of the
 * 10 s limit, so no page is known to drive it to a death.
 *
 * Main-thread cost per document: the message hops and the reply check. Bytes
 * that own their whole `ArrayBuffer` – every read of the pipeline's reader –
 * MOVE to the worker, so the caller's view is empty afterwards; a partial view
 * is copied, and text (a test seam's reader) is cloned. Every request's answer
 * budget is {@link DEFAULT_TIMEOUT_MS} plus {@link DEFAULT_TIMEOUT_PER_MB_MS}
 * for each megabyte waiting in the queue, its own included: the worker answers
 * in order.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { logger } from '../LoggingService'
import {
  PREVIEW_LINK_SCAN_WORKER_ROLE,
  isLinkScanReply,
  type HtmlSource,
  type LinkScanOutcome,
  type LinkScanRequest
} from './previewLinkScanProtocol'

/** Why the worker produced no outcome for a document. */
export type LinkScanFailure = 'busy' | 'timeout' | 'crashed' | 'malformed' | 'unavailable'

/** No outcome for a document. */
export interface LinkScanFailed {
  readonly kind: 'failed'
  readonly failure: LinkScanFailure
}

/** What {@link PreviewLinkScanner.scan} resolves to. */
export type LinkScanResult = LinkScanOutcome | LinkScanFailed

/** Scans one document for its links and frames, off the main thread. */
export interface PreviewLinkScanner {
  /**
   * Scan `html`; never rejects. Bytes that own their buffer are moved, not
   * copied: the caller must not read them afterwards.
   */
  scan(html: HtmlSource, options: { readonly frames: boolean }): Promise<LinkScanResult>
}

/** The slice of a `worker_threads.Worker` the client uses. Structural for tests. */
export interface LinkScanWorkerLike {
  postMessage(message: LinkScanRequest, transfer: ArrayBuffer[]): void
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  terminate(): Promise<number>
  /** Let the process exit while the worker idles. */
  unref?(): void
}

/** Test seams and limits; production uses the defaults. */
export interface PreviewLinkScanClientDeps {
  /** Start a worker, or `null` when it cannot be started (its bundle is missing). */
  readonly createWorker?: () => LinkScanWorkerLike | null
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
/**
 * A 4 MiB page scans in 0.2–0.8 s in the worker on the emulated Windows box –
 * the slowest a hostile page of one long `url(` or `srcdoc` run – and a cold
 * worker starts in under 50 ms. The comment worker's budget, far above both.
 */
const DEFAULT_TIMEOUT_MS = 10_000
/** Five times the slowest scan measured per megabyte (0.19 s). */
const DEFAULT_TIMEOUT_PER_MB_MS = 1_000
/** Worker deaths one window allows a restart after; one more stops the scan for the session. */
export const DEFAULT_MAX_RESTARTS = 4
/** The window worker deaths are counted in. */
export const DEATH_WINDOW_MS = 10 * 60_000
/** The wait before the first restart; it doubles with each death in the window. */
export const RESTART_BACKOFF_MS = 1_000
/** The longest wait before a restart. */
export const RESTART_BACKOFF_MAX_MS = 30_000
/**
 * Each walk waits on one document at a time, so this is walks at once: two
 * runs of every one of the three live views, in several windows.
 */
const DEFAULT_MAX_PENDING = 32
/** Eight documents at the read bound (`PREVIEW.MAX_ENTRY_HTML_BYTES`). */
const DEFAULT_MAX_PENDING_BYTES = 32 * MB
/**
 * The worker's heap ceiling. The scan builds no tree, but parse5 builds an
 * attribute value or a run of text one character at a time: a 4 MiB page that
 * is one long attribute, `srcset` or CSS `url(` run needed between 128 and
 * 192 MB of heap in plain Node 24 (Electron's compressed pointers need less);
 * ordinary 4 MiB pages scan in 16 MB. Close to the ceiling, V8 sometimes
 * aborted the whole PROCESS instead of stopping the worker (at 72 and 96 MB),
 * so the ceiling sits well clear of the need: more than twice the worst.
 */
export const WORKER_HEAP_MB = 512
/** The bundle `electron.vite.config.ts` builds next to `index.js`. */
const WORKER_FILE = 'preview-link-scan.worker.js'

interface PendingScan {
  readonly resolve: (result: LinkScanResult) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly bytes: number
}

const failed = (failure: LinkScanFailure): LinkScanFailed => ({ kind: 'failed', failure })

/** A document's size for the queue's byte bound: bytes, or UTF-16 code units of text. */
function sizeOf(html: HtmlSource): number {
  return typeof html === 'string' ? html.length : html.byteLength
}

/**
 * The document as it is posted, and the buffer that moves with it. Bytes that
 * are the only view of their own `ArrayBuffer` move; any other view is copied
 * first – moving it would take the rest of its buffer along, and a pooled
 * `Buffer`'s pool cannot move at all.
 */
function outgoing(html: HtmlSource): [HtmlSource, ArrayBuffer[]] {
  if (typeof html === 'string') return [html, []]
  const owns =
    html.buffer instanceof ArrayBuffer && html.byteOffset === 0 && html.byteLength === html.buffer.byteLength
  const sent = owns ? html : new Uint8Array(html)
  return [sent, [sent.buffer as ArrayBuffer]]
}

/** The production worker: the built bundle, or `null` when it is missing. */
function defaultCreateWorker(): LinkScanWorkerLike | null {
  const path = join(__dirname, WORKER_FILE)
  if (!existsSync(path)) return null
  return new Worker(path, {
    workerData: { role: PREVIEW_LINK_SCAN_WORKER_ROLE },
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB }
  })
}

/** The process-wide link scan client; the production {@link PreviewLinkScanner}. */
export class PreviewLinkScanClient implements PreviewLinkScanner {
  private readonly createWorker: () => LinkScanWorkerLike | null
  private readonly timeoutMs: number
  private readonly timeoutPerMbMs: number
  private readonly maxRestarts: number
  private readonly maxPending: number
  private readonly maxPendingBytes: number
  private readonly now: () => number
  private worker: LinkScanWorkerLike | null = null
  private disabled = false
  /** When workers died, within the window. */
  private deaths: number[] = []
  /** No new worker before this time (the back-off). */
  private restartAt = 0
  private nextId = 1
  private pendingBytes = 0
  private readonly pending = new Map<number, PendingScan>()

  constructor(deps: PreviewLinkScanClientDeps = {}) {
    this.createWorker = deps.createWorker ?? defaultCreateWorker
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.timeoutPerMbMs = deps.timeoutPerMbMs ?? DEFAULT_TIMEOUT_PER_MB_MS
    this.maxRestarts = deps.maxRestarts ?? DEFAULT_MAX_RESTARTS
    this.maxPending = deps.maxPending ?? DEFAULT_MAX_PENDING
    this.maxPendingBytes = deps.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES
    this.now = deps.now ?? (() => performance.now())
  }

  /** `false` once documents can no longer be scanned in this session. */
  isAvailable(): boolean {
    return !this.disabled
  }

  /** Scan one document in the worker. Never rejects. Owned bytes are moved (module comment). */
  scan(html: HtmlSource, options: { readonly frames: boolean }): Promise<LinkScanResult> {
    const size = sizeOf(html)
    if (this.pending.size >= this.maxPending || this.pendingBytes + size > this.maxPendingBytes) {
      return Promise.resolve(failed('busy'))
    }
    const worker = this.ensureWorker()
    if (worker === 'later') return Promise.resolve(failed('busy'))
    if (worker === null) return Promise.resolve(failed('unavailable'))
    const [sent, transfer] = outgoing(html)
    const id = this.nextId++
    // The worker answers in order: this answer waits for every byte queued before it, and its own.
    const budgetMs = this.timeoutMs + Math.floor(((this.pendingBytes + size) * this.timeoutPerMbMs) / MB)
    return new Promise<LinkScanResult>(resolve => {
      const timer = setTimeout(() => this.onTimeout(worker, id), budgetMs)
      this.pending.set(id, { resolve, timer, bytes: size })
      this.pendingBytes += size
      try {
        worker.postMessage({ type: 'scan', id, html: sent, frames: options.frames }, transfer)
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

  /** The worker, a new one, `'later'` while the back-off runs, or `null` when there will be none. */
  private ensureWorker(): LinkScanWorkerLike | 'later' | null {
    if (this.worker !== null) return this.worker
    if (this.disabled) return null
    if (this.now() < this.restartAt) return 'later'
    let worker: LinkScanWorkerLike | null
    try {
      worker = this.createWorker()
    } catch {
      worker = null
    }
    if (worker === null) {
      // Missing bundle (or a constructor that throws): nothing a retry fixes.
      logger.error('Preview auto-refresh: the link scan worker could not be started')
      this.disabled = true
      return null
    }
    this.attach(worker)
    return worker
  }

  private attach(worker: LinkScanWorkerLike): void {
    this.worker = worker
    worker.unref?.()
    worker.on('message', message => this.onMessage(worker, message))
    worker.on('error', () => this.retire(worker, 'error'))
    worker.on('exit', code => this.retire(worker, `exit-${code}`))
  }

  private onMessage(worker: LinkScanWorkerLike, message: unknown): void {
    if (worker !== this.worker) return
    if (!isLinkScanReply(message)) {
      // Our own worker answering nonsense: drop the request it may belong to.
      const id = (message as { id?: unknown } | null)?.id
      if (typeof id === 'number') this.settle(id, failed('malformed'))
      return
    }
    this.settle(message.id, message.outcome)
  }

  private onTimeout(worker: LinkScanWorkerLike, id: number): void {
    if (!this.pending.has(id)) return
    this.settle(id, failed('timeout'))
    this.retire(worker, 'timeout')
  }

  /** A worker died or hung: fail what it held, and let a later request restart it. Logged by cause only. */
  private retire(worker: LinkScanWorkerLike, cause: string): void {
    if (worker !== this.worker) return
    this.worker = null
    this.recordDeath()
    logger.warn('Preview auto-refresh: the link scan worker stopped', {
      cause,
      ...(this.disabled ? { unavailable: true } : {})
    })
    this.failAll('crashed')
    void worker.terminate().catch(() => undefined)
  }

  /** Count a death in the window: past the limit the scan stops for the session; else the next start waits. */
  private recordDeath(): void {
    const now = this.now()
    this.deaths = [...this.deaths.filter(at => now - at < DEATH_WINDOW_MS), now]
    if (this.deaths.length > this.maxRestarts) {
      this.disabled = true
      return
    }
    this.restartAt = now + Math.min(RESTART_BACKOFF_MAX_MS, RESTART_BACKOFF_MS * 2 ** (this.deaths.length - 1))
  }

  private settle(id: number, result: LinkScanResult): void {
    const entry = this.pending.get(id)
    if (entry === undefined) return
    this.pending.delete(id)
    this.pendingBytes -= entry.bytes
    clearTimeout(entry.timer)
    entry.resolve(result)
  }

  private failAll(failure: LinkScanFailure): void {
    for (const id of [...this.pending.keys()]) this.settle(id, failed(failure))
  }
}

let shared: PreviewLinkScanClient | undefined

/** The process-wide client every preview view shares (one worker). */
export function sharedPreviewLinkScanClient(): PreviewLinkScanClient {
  shared ??= new PreviewLinkScanClient()
  return shared
}
