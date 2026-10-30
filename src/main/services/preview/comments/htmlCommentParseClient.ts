// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML kind's view of the comment parse worker
 * (docs/designs/comments/html-preview-comments.md §19 R3-12; spec 024
 * architecture note 001 § 8 C22).
 *
 * The shared client (`CommentParseWorkerAdapter.ts`) runs any kind's job and
 * knows none; this view names the HTML kind, sends its jobs
 * (`htmlCommentJobs.ts`), and checks what they answer before main trusts it:
 * an instrumented page's token table must be internally consistent. It warms
 * the worker with a tiny page, so parse5 is loaded and JIT-compiled before
 * the first real one.
 *
 * Every view shares the one process-wide client: one worker, one queue, one
 * set of limits for every kind.
 */
import { htmlKind } from '../../../../shared/comments/htmlKind'
import type { CommentJobOutcome } from '../../comments/commentFileJobs'
import {
  sharedCommentParseClient,
  type CommentParseClient,
  type CommentParseFailure,
  type HandedBack
} from '../../comments/CommentParseWorkerAdapter'
import { TOKEN_CHARS, type InstrumentOutcome } from './commentParseCore'
import type { HtmlFileJob, HtmlFileJobRunner, InstrumentJob } from './htmlCommentJobs'

/** What {@link HtmlCommentParseClient.instrument} resolves to; `raw` only when the bytes were lent and came back. */
export type CommentParseResult =
  (InstrumentOutcome | { readonly kind: 'failed'; readonly failure: CommentParseFailure }) & HandedBack

const INSTRUMENT: InstrumentJob = { kind: 'instrument' }

/** A tiny document that makes the worker load parse5 and JIT the pipeline. */
const WARM_UP_BYTES = new TextEncoder().encode('<!doctype html><title>w</title><p id=a class=b>w</p>')

/**
 * True when an `ok` outcome's table is internally consistent: one token of
 * {@link TOKEN_CHARS} characters, one offset, one line and one tag code per
 * element. The token table's aligned lookup relies on it, so main checks it at
 * the boundary instead of trusting the other thread.
 */
function isConsistentTable(outcome: InstrumentOutcome & { kind: 'ok' }): boolean {
  const { html, tokens, offsets, lines, tagCodes, tagNames, blocks, fileHash } = outcome
  return (
    html instanceof Uint8Array &&
    offsets instanceof Int32Array &&
    lines instanceof Uint32Array &&
    tagCodes instanceof Uint32Array &&
    typeof tokens === 'string' &&
    typeof fileHash === 'string' &&
    tokens.length === offsets.length * TOKEN_CHARS &&
    tagCodes.length === offsets.length &&
    lines.length === offsets.length &&
    Array.isArray(tagNames) &&
    Array.isArray(blocks)
  )
}

/** True when `outcome`, from the worker, is a refusal with a reason or an `ok` with a consistent table. */
export function isInstrumentOutcome(outcome: unknown): outcome is InstrumentOutcome {
  if (typeof outcome !== 'object' || outcome === null) return false
  const candidate = outcome as InstrumentOutcome
  if (candidate.kind === 'unavailable') return typeof candidate.reason === 'string'
  return candidate.kind === 'ok' && isConsistentTable(candidate)
}

/** The HTML jobs of the comment parse worker; also the production {@link HtmlFileJobRunner}. */
export class HtmlCommentParseClient implements HtmlFileJobRunner {
  constructor(private readonly client: CommentParseClient) {}

  /** `false` once comments can no longer be prepared in this session. */
  isAvailable(): boolean {
    return this.client.isAvailable()
  }

  /** Start the worker and run one tiny parse, so the first real page finds it warm. */
  warm(): void {
    this.client.warm({ fileKind: htmlKind.id, bytes: WARM_UP_BYTES, job: INSTRUMENT })
  }

  /**
   * Instrument one served document in the worker. Never rejects. `bytes` may
   * be lent: read them back from the result's `raw`, never from the caller's view.
   */
  async instrument(bytes: Uint8Array): Promise<CommentParseResult> {
    const answer = await this.client.run<InstrumentJob>(htmlKind.id, bytes, INSTRUMENT, result =>
      isInstrumentOutcome(result.outcome)
    )
    if (answer.kind === 'failed') return answer
    return answer.raw === undefined ? answer.outcome : { ...answer.outcome, raw: answer.raw }
  }

  /** Run one HTML file job on `bytes` in the worker. Never rejects. `bytes` may be lent, as for {@link instrument}. */
  runJob<J extends HtmlFileJob>(bytes: Uint8Array, job: J): Promise<CommentJobOutcome<J>> {
    return this.client.run<J>(htmlKind.id, bytes, job)
  }
}

let shared: HtmlCommentParseClient | undefined

/** The HTML view of the process-wide client every preview session shares (one worker, R3-12). */
export function sharedHtmlCommentParseClient(): HtmlCommentParseClient {
  shared ??= new HtmlCommentParseClient(sharedCommentParseClient())
  return shared
}
