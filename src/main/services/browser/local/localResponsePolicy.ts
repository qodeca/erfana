// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What a local-file server serves, by the request's fetch metadata, and the
 * headers it serves it with (spec 025, 025-FR-005 rule 1; ADR 0012 decisions
 * 5–7 as carried over to option 4, spec change S-7).
 *
 * Chromium sends `Sec-Fetch-*` to `http://127.0.0.1` (a potentially
 * trustworthy origin), which the `erfana-local:` probe of commit 8 could not
 * get. So:
 *
 * - **Script reads refused.** Only these destinations are served: `document`,
 *   `iframe`, `frame`, `script`, `style`, `image`, `font`, `audio`, `video`,
 *   `track`, `worker`, `manifest`. `empty` (`fetch`, `XMLHttpRequest`),
 *   `serviceworker`, `sharedworker`, `object`, `embed` and a missing header
 *   are refused – the last also refuses every client that is not a browser.
 * - **Only an Erfana-started top load gets the folder's origin.** A
 *   `document` request whose exact address `BrowserTab` armed is served
 *   plainly; every other document – a frame, a page reached by a link – is
 *   served with a `sandbox` policy, so it has an opaque origin, no storage
 *   and no access to its parent's or opener's document.
 * - **A worker only from its own folder** (`Sec-Fetch-Site: same-origin`).
 * - **A subresource is never browser-started** (`Sec-Fetch-Site: none`).
 *   `Sec-Fetch-Site` cannot refuse inclusion by other pages any further: a
 *   sandboxed document's own requests are `cross-site` (its origin is
 *   opaque), and every loopback port is the same site. Inclusion inside the
 *   browser session is refused by the session's request filter, by the
 *   requesting tab's top-level page (`LocalFileServers.allowsRequest`);
 *   outside it, by the server's unguessable token. No
 *   `Cross-Origin-Resource-Policy` is sent: Chromium applies `same-site` and
 *   `same-origin` to the opaque origin of a sandboxed document too, so a
 *   frame's or a linked page's own images and styles would not load
 *   (measured in `e2e/browser-local-files.e2e.ts`).
 *
 * Every response: `Cache-Control: no-store`, `X-Content-Type-Options:
 * nosniff` (a text file is never run as a script or a style),
 * `Referrer-Policy: no-referrer` (the token never leaves in a `Referer`), and
 * on documents `Cross-Origin-Opener-Policy: noopener-allow-popups`, so a
 * window the page opens has no handle back.
 */

/** The destinations a local page may load from its folder (025-FR-005 rule 1). */
export const SERVED_DESTINATIONS: ReadonlySet<string> = new Set([
  'document',
  'iframe',
  'frame',
  'script',
  'style',
  'image',
  'font',
  'audio',
  'video',
  'track',
  'worker',
  'manifest'
])

const FRAME_DESTINATIONS: ReadonlySet<string> = new Set(['iframe', 'frame'])

/**
 * The sandbox of every document that is not an armed top load: scripts,
 * forms, dialogs and downloads run, but without `allow-same-origin` the
 * document's origin is opaque (S-7).
 */
export const LOCAL_SANDBOX_POLICY = 'sandbox allow-scripts allow-forms allow-modals allow-downloads'

export interface LocalRequestFacts {
  /** `Sec-Fetch-Dest`, or `undefined` when absent. */
  readonly dest: string | undefined
  /** `Sec-Fetch-Site`, or `undefined` when absent. */
  readonly site: string | undefined
}

/** `served` with how a document is framed, or a refusal. */
export type LocalServeDecision =
  | { readonly serve: true; readonly document: boolean; readonly sandbox: boolean }
  | { readonly serve: false }

/**
 * Decide a request. `consumeArm` is called only for a top-level document, at
 * most once, and uses up the one-shot arm of that address.
 */
export function decideLocalRequest(facts: LocalRequestFacts, consumeArm: () => boolean): LocalServeDecision {
  const { dest, site } = facts
  if (dest === undefined || !SERVED_DESTINATIONS.has(dest)) return { serve: false }
  if (dest === 'document') return { serve: true, document: true, sandbox: !consumeArm() }
  if (FRAME_DESTINATIONS.has(dest)) return { serve: true, document: true, sandbox: true }
  if (dest === 'worker') return site === 'same-origin' ? { serve: true, document: false, sandbox: false } : { serve: false }
  if (site === undefined || site === 'none') return { serve: false }
  return { serve: true, document: false, sandbox: false }
}

/** The headers of a served file; no request-derived value ever reaches one. */
export function localResponseHeaders(
  contentType: string,
  size: number,
  decision: { readonly document: boolean; readonly sandbox: boolean }
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(size),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  }
  if (decision.document) headers['Cross-Origin-Opener-Policy'] = 'noopener-allow-popups'
  if (decision.sandbox) headers['Content-Security-Policy'] = LOCAL_SANDBOX_POLICY
  return headers
}

/** The headers of a refusal: no body to sniff, nothing to cache. */
export const LOCAL_REFUSAL_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Length': '0'
})
