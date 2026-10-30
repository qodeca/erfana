// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment instrumentation for one preview view's protocol handler
 * (docs/designs/comments/html-preview-comments.md §3 "Raw vs instrumented bytes",
 * §4.2 "PreviewProtocolHandler", §6, §19 R3-1, R3-12, R3-13; tests M-030,
 * M-031, M-060).
 *
 * After the handler has confined and read a file, `bodyFor` decides what to
 * serve. The served copy gets a `data-erfana-el` token on every eligible
 * start tag only when ALL of these hold (M-060), else the raw bytes go out:
 * 1. the feature flag `htmlPreview.comments.enabled` is on;
 * 2. the request is a GET of an `.html`/`.htm` file;
 * 3. it is a document load: no `user-agent` header (the request class, R3-1)
 *    AND the ledger note says page (`mainFrame`) or frame (`subFrame`);
 * 4. (spec 024 OD-01) no longer "comments are expected": while the feature is
 *    on every page is instrumented, so a right-click outside comment mode can
 *    comment on a page with no comments yet. Comment mode is still tracked
 *    for the view (`setCommentMode`);
 * 5. the file is at most `COMMENT_FILE_MAX_BYTES` (25 MB, every page the
 *    preview serves), has at most `COMMENT_MAX_TOKENS_PER_DOCUMENT` start
 *    tags (counted before the parse), decodes losslessly as UTF-8, and does
 *    not already contain `data-erfana-el`;
 * 6. the parse worker answered.
 *
 * When comments were expected (4) but a later check fails, the raw bytes go
 * out and the file gets an "unavailable" reason – kept for the comment list
 * and logged, rate-capped, as a code and a path digest only (§18). A missed
 * ledger note is one of those reasons, never a security question: tokens are
 * not authoritative (§6, S24).
 *
 * The parse runs in the persistent worker (R3-12); every instrumented load is
 * registered in the view's {@link ElementTokenTable} with its blocks resolved
 * to tokens from the bytes actually served. Nothing here throws into the
 * handler: any failure serves the raw bytes. The bytes are LENT to the worker
 * (§19 Rev 4): the raw body served after a failure is the one the worker
 * handed back, and when the worker died holding it (a timeout, a crash)
 * `bodyFor` answers `undefined` – the handler reads the file again.
 */
import { createDropReporter, type DropReporter } from '../../../../shared/dropReporter'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import { stablePathDigest } from '../../../../shared/stablePathDigest'
import { logger } from '../../LoggingService'
import { redactedLogError } from '../../../utils/redactUserInput'
import type { PreviewRequestClass } from '../PreviewRequestKindLedger'
import type { InstrumentRefusal } from './commentParseCore'
import type { CommentParseFailure } from '../../comments/CommentParseWorkerAdapter'
import { sharedHtmlCommentParseClient, type HtmlCommentParseClient } from './htmlCommentParseClient'
import { registerCommentE2eSource, type CommentE2eSource } from './commentE2eHook'
import { ElementTokenTable, type CommentLoadScope } from './ElementTokenTable'

/** Why comments are unavailable for a file the view served raw although they were expected. */
export type CommentUnavailableReason =
  | InstrumentRefusal
  /** A header-less request with no document note: the request kind is unknown (S24). */
  | 'request-unknown'
  /** The parse worker gave no answer (busy, timed out, crashed, missing). */
  | 'parse-failed'

/** What the protocol handler knows about a confined, read request. */
export interface CommentServeRequest {
  readonly body: Buffer
  /** Lower-case extension with its dot (`resolveConfined`). */
  readonly ext: string
  /** The confined real path the body was read from. */
  readonly realPath: string
  readonly method: string
  /** The webRequest resource type the ledger handed back, if any. */
  readonly noteType: string | undefined
  readonly requestClass: PreviewRequestClass
}

/** What to serve, before any parsing (M-060). */
export type CommentServeDecision =
  | { readonly action: 'raw'; readonly reason?: CommentUnavailableReason }
  | { readonly action: 'instrument'; readonly scope: CommentLoadScope }

/** The per-view state the decision reads. */
export interface CommentServeState {
  readonly enabled: boolean
  readonly commentMode: boolean
}

/** The document extensions comments are written into (§7.6 step 1). */
const COMMENTABLE_EXTENSIONS: ReadonlySet<string> = new Set(['.html', '.htm'])
/** Files remembered with an unavailable reason; the oldest is forgotten past this. */
const MAX_UNAVAILABLE_FILES = 64

const RAW: CommentServeDecision = { action: 'raw' }

/** The load scope a ledger note names, or `undefined` for a request that is not a document load. */
function scopeOf(noteType: string | undefined): CommentLoadScope | undefined {
  if (noteType === 'mainFrame') return 'page'
  if (noteType === 'subFrame') return 'frame'
  return undefined
}

/** Decide, without parsing, whether a confined response may be instrumented (M-060). */
export function decideCommentServing(
  request: CommentServeRequest,
  state: CommentServeState
): CommentServeDecision {
  if (!state.enabled || request.method !== 'GET') return RAW
  if (!COMMENTABLE_EXTENSIONS.has(request.ext) || request.requestClass !== 'navigation') return RAW
  // OD-01: no "comments expected" gate – a page with no comments is commentable from its menu too.
  if (request.noteType === undefined) return { action: 'raw', reason: 'request-unknown' }
  const scope = scopeOf(request.noteType)
  // An `<object>`/`<embed>` document: header-less, but never a commentable frame.
  if (scope === undefined) return RAW
  if (request.body.length > PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES) {
    return { action: 'raw', reason: 'too-large' }
  }
  return { action: 'instrument', scope }
}

/** One view's comment instrumentation, hung on its protocol handler. */
export interface PreviewCommentServing {
  /**
   * The body to serve for a confined, read request. Never rejects.
   * `undefined`: the request's bytes were lent to the parse worker and lost
   * with it – read the file again and serve it raw.
   */
  bodyFor(request: CommentServeRequest): Promise<Buffer | undefined>
  /** The view's per-load token tables. */
  readonly tokens: ElementTokenTable
  /** Comment mode for the view (P5 drives it); on, a file without blocks is instrumented too. */
  setCommentMode(on: boolean): void
  /** Why comments are unavailable for `realPath`, if they are. */
  unavailableReason(realPath: string): CommentUnavailableReason | undefined
  /** The view is gone: drop its tables and stop instrumenting. */
  dispose(): void
}

/** What a view's comment serving is built from; production uses the defaults. */
export interface PreviewCommentServingDeps {
  /** The feature flag, read per request. */
  readonly isEnabled: () => boolean
  readonly client?: Pick<HtmlCommentParseClient, 'instrument' | 'warm'>
  readonly now?: () => number
  readonly registerE2e?: (source: CommentE2eSource) => () => void
}

/**
 * The raw body after the worker answered without an instrumented copy: the
 * bytes it handed back, the request's own when they were never lent (their
 * length is unchanged), or `undefined` when they were lent and lost.
 */
function rawBodyAfter(handedBack: Uint8Array | undefined, own: Buffer, length: number): Buffer | undefined {
  if (handedBack !== undefined) return Buffer.from(handedBack.buffer, handedBack.byteOffset, handedBack.byteLength)
  return own.length === length ? own : undefined
}

function unavailableLog(now: () => number): DropReporter {
  return createDropReporter({
    source: 'main',
    now,
    // The reporter digests its `panelId` field; here it carries the file path.
    emit: ({ context }) =>
      logger.warn('Preview comments unavailable for a page', {
        reason: context.reason,
        file: context.panelId === undefined ? undefined : stablePathDigest(context.panelId),
        ...(context.suppressed === undefined ? {} : { suppressed: context.suppressed })
      })
  })
}

/** Build one view's comment serving. */
export function createPreviewCommentServing(
  deps: PreviewCommentServingDeps
): PreviewCommentServing {
  const client = deps.client ?? sharedHtmlCommentParseClient()
  const now = deps.now ?? (() => performance.now())
  // A settings read that throws counts as off: the safe side is today's preview.
  const isEnabled = (): boolean => {
    try {
      return deps.isEnabled()
    } catch {
      return false
    }
  }
  const tokens = new ElementTokenTable()
  const unavailable = new Map<string, CommentUnavailableReason>()
  const log = unavailableLog(now)
  let commentMode = false
  let disposed = false

  const markUnavailable = (
    realPath: string,
    reason: CommentUnavailableReason,
    detail?: CommentParseFailure
  ): void => {
    unavailable.delete(realPath)
    unavailable.set(realPath, reason)
    if (unavailable.size > MAX_UNAVAILABLE_FILES) {
      unavailable.delete(unavailable.keys().next().value as string)
    }
    const code = detail === undefined ? reason : `${reason}:${detail}`
    log.report({ reason: code, level: 'warn', panelId: realPath })
  }

  const instrument = async (
    request: CommentServeRequest,
    scope: CommentLoadScope
  ): Promise<Buffer | undefined> => {
    const started = now()
    const length = request.body.length
    const result = await client.instrument(request.body)
    if (result.kind === 'failed') {
      markUnavailable(request.realPath, 'parse-failed', result.failure)
      return rawBodyAfter(result.raw, request.body, length)
    }
    if (result.kind === 'unavailable') {
      markUnavailable(request.realPath, result.reason)
      return rawBodyAfter(result.raw, request.body, length)
    }
    if (disposed) return rawBodyAfter(result.raw, request.body, length)
    tokens.register({
      realPath: request.realPath,
      scope,
      fileHash: result.fileHash,
      tokens: result.tokens,
      offsets: result.offsets,
      lines: result.lines,
      tagCodes: result.tagCodes,
      tagNames: result.tagNames,
      blocks: result.blocks
    })
    unavailable.delete(request.realPath)
    logger.debug('Preview comments: page instrumented', {
      file: stablePathDigest(request.realPath),
      tokens: result.offsets.length,
      ms: Math.round(now() - started)
    })
    const { html } = result
    return Buffer.from(html.buffer, html.byteOffset, html.byteLength)
  }

  const unregisterE2e = (deps.registerE2e ?? registerCommentE2eSource)({
    views: () => tokens.views(),
    unavailable: () => [...unavailable].map(([realPath, reason]) => ({ realPath, reason }))
  })
  if (isEnabled()) client.warm()

  return {
    tokens,
    async bodyFor(request) {
      const length = request.body.length
      try {
        if (disposed) return request.body
        const decision = decideCommentServing(request, { enabled: isEnabled(), commentMode })
        if (decision.action === 'raw') {
          if (decision.reason !== undefined) markUnavailable(request.realPath, decision.reason)
          return request.body
        }
        return await instrument(request, decision.scope)
      } catch (error) {
        logger.error('Preview comments: instrumentation failed', redactedLogError(error))
        // A view that lost its length was lent, and its bytes went with the throw.
        return rawBodyAfter(undefined, request.body, length)
      }
    },
    setCommentMode(on) {
      commentMode = on
    },
    unavailableReason: realPath => unavailable.get(realPath),
    dispose() {
      disposed = true
      tokens.clear()
      unavailable.clear()
      unregisterE2e()
    }
  }
}
