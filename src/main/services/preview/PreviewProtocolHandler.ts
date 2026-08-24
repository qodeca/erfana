// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `erfana-preview://` protocol handler (Issue #74, work item 20; design §2.4,
 * §2.5, §2.6 / GHSA-4p4r-m79c-wq3v).
 *
 * `attach` registers a `protocol.handle` listener ON THE PASSED PARTITION
 * SESSION — never the global `protocol` — so a previewed page's local reads are
 * served only inside its own sealed, in-memory session. The returned function
 * detaches the handler.
 *
 * The handler implements design §2.4's request→response algorithm exactly, in
 * this order: parse the URL (404 on malformed) → method GET/HEAD (405) →
 * empty port + userinfo (404) → `registry.resolve(hostname)` (404 on an
 * unknown/revoked token) → `decodeURIComponent` each path segment (400 on a
 * `URIError`) → `resolveConfined` (which owns steps 6–9: safe-segment,
 * realpath confinement and the bounded read, mapping to 400/403/404/413) →
 * `unsupported-asset-type` badge on a MIME fallthrough for a `script`/`style`
 * destination (still 200) → `buildResponseHeaders(contentType, entry.csp)` as
 * the SINGLE CSP application site → `new Response(body, { headers })`.
 *
 * `buildResponseHeaders` throws `PREVIEW_CSP_INVALID` on an empty or unwired
 * CSP; the handler catches it, records a `csp-missing` failure entry and
 * returns 500 rather than shipping a page with no sandbox (design §1.1, §2.6).
 *
 * Trust model: the request URL is untrusted DATA. It is parsed, decoded,
 * confined and served — never executed, and NO requested path, decoded segment,
 * filename, query string or request header ever reaches a response header value
 * (design §2.6). Response header values are compile-time literals plus the CSP,
 * which is authored solely by `buildPreviewCsp`.
 */

import type { Session } from 'electron'
import { AppError, ErrorCode } from '../../../shared/errors'
import { PREVIEW } from '../../../shared/constants'
import { logger } from '../LoggingService'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import { resolveConfined, type PreviewResolveResult } from './previewPathResolve'
import {
  buildResponseHeaders,
  isKnownAssetType,
  mimeForExtension
} from './previewResponseHeaders'

/**
 * The local scheme (design §2.1). Declared as a literal rather than imported
 * from `previewScheme.ts` (item 9): item 20's dependency set is {11,13,14,15}
 * and does NOT include item 9, so declaring it here keeps the graph compilable
 * at each step and avoids a runtime `electron` import for a constant string. The
 * value is the shared URL-scheme contract; changing it is a coordinated change.
 */
const PREVIEW_SCHEME = 'erfana-preview'

/**
 * The subset of a resolved `PreviewRootEntry` (design §1.1) the handler needs.
 *
 * ASSUMPTION: `PreviewRootRegistry.ts` (item 14, built in parallel) is not yet
 * present, so its `PreviewRootEntry` type cannot be imported. This local mirror
 * matches the §1.1 declaration (`realRoot` + `csp`, both readonly). When item 14
 * lands, replace this with an import of its `PreviewRootEntry`.
 */
export interface PreviewRootEntryLike {
  readonly realRoot: string
  readonly csp: string
}

/**
 * Everything the handler needs from the rest of the feature, injected so the
 * handler stays free of a direct dependency on the registry (item 14) and the
 * failure log (item 15) implementations.
 */
export interface PreviewProtocolContext {
  /**
   * Resolve a URL host (the opaque root token) to its entry, or `null` for an
   * unknown or revoked token — a revoked token yields 404, not 403 (design §2.1).
   */
  resolve(token: string): PreviewRootEntryLike | null
  /** Record a diagnostic failure (a `csp-missing` or `unsupported-asset-type`). */
  recordFailure(input: PreviewFailureInput): void
}

/** Build a bodyless error response for a non-2xx status (no CSP, no leak). */
function errorResponse(status: number, headers?: Record<string, string>): GlobalResponse {
  return new Response(null, { status, headers })
}

/** Acquire/release token pair bounding concurrent work. */
interface ConcurrencyLimiter {
  acquire(): Promise<void>
  release(): void
}

/**
 * A per-session bound on how many asset reads buffer at once. Each read is
 * capped at `MAX_ASSET_BYTES`, so limiting concurrency bounds the peak
 * main-process memory a hostile page can force by fetching many large in-repo
 * assets simultaneously. The token is handed straight to the next waiter on
 * release, so the active count can never exceed `max`.
 */
function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  let active = 0
  const waiters: Array<() => void> = []
  return {
    async acquire(): Promise<void> {
      if (active < max) {
        active += 1
        return
      }
      await new Promise<void>((resolve) => waiters.push(resolve))
      // The token was handed over by release(); `active` already counts it.
    },
    release(): void {
      const next = waiters.shift()
      if (next) {
        next() // hand the slot to the next waiter; active stays the same
      } else {
        active -= 1
      }
    }
  }
}

/**
 * The request `destination` for step 10, read from the `sec-fetch-dest` request
 * header (the authoritative signal), falling back to `request.destination`.
 * Reading a REQUEST header is safe — it is classified, never reflected into a
 * response (design §2.4 step 10 note).
 */
function readDestination(request: GlobalRequest): string {
  const header = request.headers.get('sec-fetch-dest')
  if (header) {
    return header
  }
  const dest = (request as { destination?: string }).destination
  return typeof dest === 'string' ? dest : ''
}

/**
 * The request→response algorithm of design §2.4, wrapped so that any unexpected
 * throw (a rejection from `resolveConfined`, `mimeForExtension`, `new Response`,
 * …) becomes a bodyless 500 with no diagnostic leak, rather than escaping to
 * `protocol.handle` as an unlabelled network failure.
 */
async function handleRequest(
  request: GlobalRequest,
  ctx: PreviewProtocolContext,
  limiter: ConcurrencyLimiter
): Promise<GlobalResponse> {
  try {
    return await handleRequestInner(request, ctx, limiter)
  } catch (error) {
    logger.error(
      'Preview protocol handler error',
      error instanceof Error ? error : undefined
    )
    return errorResponse(500)
  }
}

/** The request→response algorithm of design §2.4. */
async function handleRequestInner(
  request: GlobalRequest,
  ctx: PreviewProtocolContext,
  limiter: ConcurrencyLimiter
): Promise<GlobalResponse> {
  // Step 1: parse the URL. A URL the platform cannot parse is a 404.
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return errorResponse(404)
  }

  // Step 2: only GET and HEAD are served.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse(405, { Allow: 'GET, HEAD' })
  }

  // Step 3: no port, no userinfo — a port or credentials in the authority is a
  // malformed preview URL (design §2.3).
  if (url.port !== '' || url.username !== '' || url.password !== '') {
    return errorResponse(404)
  }

  // Step 4: resolve the opaque root token. Unknown/revoked ⇒ 404, never 403.
  const entry = ctx.resolve(url.hostname)
  if (!entry) {
    return errorResponse(404)
  }

  // Step 5: decode each non-empty path segment. A malformed percent-escape
  // (URIError) is a 400.
  const rawSegments = url.pathname.split('/').filter((segment) => segment.length > 0)
  let segments: string[]
  try {
    segments = rawSegments.map((segment) => decodeURIComponent(segment))
  } catch {
    return errorResponse(400)
  }

  // Steps 6–9: safe-segment check, realpath confinement and the bounded read
  // live in `resolveConfined`, which maps every failure to its §2.4 status. The
  // buffering read runs under a per-session concurrency bound so many large
  // in-repo assets fetched at once cannot exhaust main-process memory.
  await limiter.acquire()
  let resolved: PreviewResolveResult
  try {
    resolved = await resolveConfined(entry.realRoot, segments)
  } finally {
    limiter.release()
  }
  if (!resolved.ok) {
    return errorResponse(resolved.status)
  }

  // Step 10: a MIME fallthrough (octet-stream) for a script/style destination is
  // the "needs a bundler" case (AC7). Badge it, but still serve the bytes (200).
  if (!isKnownAssetType(resolved.ext)) {
    const destination = readDestination(request)
    if (destination === 'script' || destination === 'style') {
      ctx.recordFailure({
        type: 'unsupported-asset-type',
        resourceUrlOrHost: url.pathname,
        reasonCode: ErrorCode.UNKNOWN_ERROR
      })
    }
  }

  // Step 11: the SINGLE CSP application site. An empty or unwired CSP throws
  // PREVIEW_CSP_INVALID ⇒ 500 + a `csp-missing` badge, never an unprotected page.
  let headers: Record<string, string>
  try {
    headers = buildResponseHeaders(mimeForExtension(resolved.ext), entry.csp)
  } catch (error) {
    // Only an invalid/unwired CSP is the `csp-missing` case. Any OTHER throw is
    // unexpected and re-thrown to the outer catch-all (a bodyless 500), so it is
    // never mislabelled as a CSP failure.
    if (!(error instanceof AppError) || error.code !== ErrorCode.PREVIEW_CSP_INVALID) {
      throw error
    }
    ctx.recordFailure({
      type: 'csp-missing',
      resourceUrlOrHost: url.pathname,
      reasonCode: ErrorCode.PREVIEW_CSP_INVALID
    })
    return errorResponse(500)
  }

  // Step 12: serve the confined bytes with the header set built above. A Node
  // `Buffer` is a valid `BodyInit` at runtime (undici accepts a `Uint8Array`),
  // but its `Buffer<ArrayBufferLike>` static type does not satisfy the DOM lib's
  // `BufferSource<ArrayBuffer>` union member, so the value is cast to `BodyInit`.
  return new Response(resolved.body as unknown as BodyInit, { status: 200, headers })
}

/**
 * Register the preview protocol handler on `session`'s own protocol and return a
 * detach function.
 *
 * The registration is on `session.protocol.handle`, NOT the global
 * `protocol.handle`: the sealed preview partition is the only place these local
 * reads are served (design §0, §2.5).
 */
export function attach(session: Session, ctx: PreviewProtocolContext): () => void {
  // One limiter per session so the bound is scoped to a single preview's reads.
  const limiter = createConcurrencyLimiter(PREVIEW.MAX_CONCURRENT_ASSET_READS)
  session.protocol.handle(PREVIEW_SCHEME, (request) => handleRequest(request, ctx, limiter))
  return () => {
    session.protocol.unhandle(PREVIEW_SCHEME)
  }
}
