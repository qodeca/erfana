// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure network-gating decision for the preview request filter (Issue #74, work
 * item 6; design §1.2, §2.8).
 *
 * `decideRequest` is the second of the two independent chokepoints that gate a
 * previewed page's remote subresource loads (the first is the host-listed CSP,
 * item 12). It is a PURE function — no side effects, no I/O — so the stateful
 * `PreviewRequestFilter` (item 23) can call it per request AND per redirect hop
 * (each hop re-enters `onBeforeRequest` and is decided independently) and own
 * the badging / `callback({cancel})` plumbing itself.
 *
 * Trust model: the URL is untrusted data. It is parsed, classified and either
 * allowed or refused — never executed, never reflected into a response.
 */

import type { PreviewFailureType } from '../../../shared/ipc/preview-types'

/**
 * The local `erfana-preview://` scheme (design §2.1). Declared here as a literal
 * rather than imported, because `previewScheme.ts` (item 9) is not in this leaf
 * module's dependency set; the string is the URL-scheme contract and changing it
 * is a coordinated change across the feature.
 */
const PREVIEW_SCHEME = 'erfana-preview'

/**
 * The outcome of gating a single request. On `cancel`, `reason` classifies the
 * refusal for the failure log and `host` carries the hostname (empty for a URL
 * that could not be parsed or that has no host). `approvable` is deliberately
 * NOT decided here — it depends on the allowlist schema (item 10) and is the
 * filter's concern (item 23), keeping this module a true dependency leaf.
 */
export type FilterVerdict =
  | { readonly action: 'allow' }
  | { readonly action: 'cancel'; readonly reason: PreviewFailureType; readonly host: string }

/**
 * Decide whether a single request URL may proceed, given the set of approved
 * hosts. The set holds ASCII, lower-cased hostnames (the allowlist grammar,
 * item 10); `new URL(...).hostname` applies IDN ⇒ punycode and lower-casing, so
 * a Unicode host round-trips against it.
 *
 * @param url     the request (or redirect-target) URL, untrusted
 * @param allowed the currently-approved hosts for this project
 */
export function decideRequest(url: string, allowed: ReadonlySet<string>): FilterVerdict {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // A URL the network layer could not even parse is never something we serve.
    return { action: 'cancel', reason: 'insecure-scheme', host: '' }
  }

  const { protocol } = parsed

  // The local scheme is served by the protocol handler on its own pipeline. A
  // request — in practice a redirect target — that reaches the network filter
  // carrying it is a scheme-confusion attempt to smuggle a local file read and
  // is ALWAYS refused, regardless of the allowlist (design §1.2, §2.8).
  if (protocol === `${PREVIEW_SCHEME}:`) {
    return { action: 'cancel', reason: 'insecure-scheme', host: parsed.hostname }
  }

  // Non-egress pseudo-schemes are inline / same-document and are gated by the
  // CSP, not by the network allowlist; letting them through keeps legitimate
  // pages working without opening a remote channel.
  if (protocol === 'data:' || protocol === 'blob:' || protocol === 'about:') {
    return { action: 'allow' }
  }

  // Only TLS-bearing remote loads to an approved host are eligible. Everything
  // else (http:, ws:, wss:, ftp:, …) is refused as an insecure scheme — the CSP
  // only ever emits `https://` host-sources, so this keeps the two chokepoints
  // consistent.
  if (protocol === 'https:') {
    const host = parsed.hostname
    if (allowed.has(host)) return { action: 'allow' }
    return { action: 'cancel', reason: 'blocked-host', host }
  }

  return { action: 'cancel', reason: 'insecure-scheme', host: parsed.hostname }
}
