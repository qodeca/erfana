// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What kind of request each `erfana-preview:` URL was (issue #124, WI-12;
 * design part 2 §2.2 – user answer 5).
 *
 * `protocol.handle` sees no request type: `sec-fetch-dest` is null and
 * `request.destination` empty for every request Electron 39 hands it (spike
 * S1, 11 of 11 cases), so the handler's old header read returned `''` in the
 * real app and its "entry page missing" and "unsupported asset type" badges
 * never fired. `webRequest` does see `resourceType`. The request filter
 * therefore notes each preview-scheme URL it lets through with its resource
 * type, and the protocol handler takes that note back when the same request
 * reaches it. One ledger per session, built with the filter context in every
 * `PreviewSessionFactory.create` (`previewSessionFilterContext.ts`).
 *
 * A FIFO queue per URL: one URL can be requested as an image and as a frame
 * at once. Bounded: at most `REQUEST_KIND_LEDGER_MAX` notes, the oldest
 * dropped first, and a note is forgotten `REQUEST_KIND_LEDGER_TTL_MS` after it
 * was made, so a request the filter let through but that never reached the
 * handler does not linger. A URL with no note has kind `''`: no badge, and the
 * bytes are still served.
 *
 * Request classes (HTML Preview comments, spike S1e; design §19 R3-1). A page
 * that fetches its own URL while it is reloaded used to poison the queue: the
 * fetches the reload aborted were noted but never reached the handler, so the
 * next document load took a stale `xhr` note (28–29 of 30 reloads wrong). Two
 * rules fix it, 30 of 30:
 * - a note carries the webRequest id, and `forget(id)` drops it when that
 *   request fails (`onErrorOccurred`) before it reaches the handler;
 * - `take(url, requestClass)` only hands back a note of the request's own
 *   class. Document and frame loads (and `<object>`/`<embed>` documents) reach
 *   `protocol.handle` WITHOUT a `user-agent` header; every fetch and
 *   subresource – script, style, image, font, media, XHR – carries one, and a
 *   page cannot remove it (S1e, re-checked on Electron 44.9 for every type
 *   listed). This is undocumented Electron behaviour: an Electron upgrade must
 *   re-check it (the comments e2e exit test fails if it changes).
 *
 * The kind picks a diagnostic, and whether comment instrumentation is
 * attempted (only for a document-class note taken by a header-less request).
 * It never changes how a request is confined, and security never depends on
 * it: a token served to a `fetch` is harmless, and a missed note only makes
 * comments unavailable for that page (design §6, threat S24).
 *
 * Trust model: the URL is page-controlled data. It is only compared, never
 * parsed, run or reflected. Its fragment is dropped – the network layer and the
 * handler need not agree on carrying it (S15) – and a long URL is cut to a
 * bounded key, so the ledger's memory is bounded whatever the page requests.
 */
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'

/** The request kinds a handler diagnostic depends on; `''` when unknown. */
export type PreviewRequestKind = 'document' | 'iframe' | 'script' | 'style' | ''

/**
 * The longest URL (fragment dropped) kept whole as a key. A longer one keeps
 * this many characters plus its length: two such URLs with the same head and
 * the same length share a key, which at worst mislabels one badge.
 */
export const REQUEST_KIND_KEY_MAX_CHARS = 2048

/**
 * What a request is, as `protocol.handle` can tell: a `navigation` loads a
 * document into a frame and carries no `user-agent` header; a `subresource`
 * (fetch, script, style, image, font, media) always carries one (S1e).
 */
export type PreviewRequestClass = 'navigation' | 'subresource'

/** webRequest resource types that load a document, and so arrive without `user-agent`. */
const NAVIGATION_RESOURCE_TYPES: ReadonlySet<string> = new Set(['mainFrame', 'subFrame', 'object'])

/**
 * The class of a request the handler received, from its headers alone. A
 * request without a headers object is not one Chromium built; it is treated
 * as a subresource, the class that is never instrumented.
 */
export function requestClassOf(headers: Pick<Headers, 'has'> | undefined): PreviewRequestClass {
  return headers === undefined || headers.has('user-agent') ? 'subresource' : 'navigation'
}

/** The class of request a webRequest resource type belongs to. */
export function resourceTypeClass(resourceType: string): PreviewRequestClass {
  return NAVIGATION_RESOURCE_TYPES.has(resourceType) ? 'navigation' : 'subresource'
}

/** One session's notes, written by the request filter and read by the handler. */
export interface PreviewRequestKindLedger {
  /**
   * The filter let `url` through; `resourceType` is webRequest's value and
   * `requestId` its `details.id`, which {@link forget} drops the note by.
   */
  note(url: string, resourceType: string, requestId?: number): void
  /**
   * The handler received `url`: the oldest live note for it of `requestClass`,
   * removed from the ledger, or `undefined` when there is none. Without a
   * class, the oldest note of any class (a reader that cannot see the request).
   */
  take(url: string, requestClass?: PreviewRequestClass): string | undefined
  /** Request `requestId` failed before reaching the handler (`onErrorOccurred`): drop its note. */
  forget(requestId: number): void
}

/** Test seams; production uses the defaults. */
export interface PreviewRequestKindLedgerDeps {
  /** A monotonic clock in ms; defaults to `performance.now`. */
  readonly now?: () => number
}

interface KindNote {
  readonly key: string
  readonly resourceType: string
  readonly requestClass: PreviewRequestClass
  readonly requestId: number | undefined
  readonly notedAt: number
}

/**
 * The handler's view of a request: `mainFrame` is the page's own document,
 * `subFrame` a frame's document, `script` and `stylesheet` the two types a
 * MIME fallthrough badges. Anything else, or no note at all, is `''`.
 */
export function requestKind(resourceType: string | undefined): PreviewRequestKind {
  switch (resourceType) {
    case 'mainFrame':
      return 'document'
    case 'subFrame':
      return 'iframe'
    case 'script':
      return 'script'
    case 'stylesheet':
      return 'style'
    default:
      return ''
  }
}

/**
 * The key a URL is noted and taken under. The fragment goes first, so the
 * suffix a long URL gets (`#` and its length) can never equal a short URL.
 */
function ledgerKey(url: string): string {
  const fragmentAt = url.indexOf('#')
  const bare = fragmentAt === -1 ? url : url.slice(0, fragmentAt)
  if (bare.length <= REQUEST_KIND_KEY_MAX_CHARS) {
    return bare
  }
  return `${bare.slice(0, REQUEST_KIND_KEY_MAX_CHARS)}#${bare.length}`
}

/** Build one session's ledger. */
export function createPreviewRequestKindLedger(
  deps: PreviewRequestKindLedgerDeps = {}
): PreviewRequestKindLedger {
  const now = deps.now ?? (() => performance.now())
  // Oldest first. At most REQUEST_KIND_LEDGER_MAX entries, so the linear
  // search in `take` is bounded and a Map per URL would buy nothing.
  const notes: KindNote[] = []

  const forgetExpired = (): void => {
    const cutoff = now() - PREVIEW_LIMITS.REQUEST_KIND_LEDGER_TTL_MS
    let expired = 0
    while (expired < notes.length && notes[expired].notedAt <= cutoff) {
      expired += 1
    }
    if (expired > 0) {
      notes.splice(0, expired)
    }
  }

  return {
    note(url, resourceType, requestId) {
      forgetExpired()
      if (notes.length >= PREVIEW_LIMITS.REQUEST_KIND_LEDGER_MAX) {
        notes.shift()
      }
      notes.push({
        key: ledgerKey(url),
        resourceType,
        requestClass: resourceTypeClass(resourceType),
        requestId,
        notedAt: now()
      })
    },
    take(url, requestClass) {
      forgetExpired()
      const key = ledgerKey(url)
      const index = notes.findIndex(
        (entry) =>
          entry.key === key && (requestClass === undefined || entry.requestClass === requestClass)
      )
      if (index === -1) {
        return undefined
      }
      return notes.splice(index, 1)[0].resourceType
    },
    forget(requestId) {
      const index = notes.findIndex((entry) => entry.requestId === requestId)
      if (index !== -1) {
        notes.splice(index, 1)
      }
    }
  }
}
