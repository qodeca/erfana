// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Content-Security-Policy builder for previewed pages (Issue #74, work item 12;
 * design §2.5, §2.6; issue #124 WI-13, design part 2 §2.1).
 *
 * `buildPreviewCsp` is the SOLE author of the preview CSP string. It builds the
 * host-source lists FROM the validated project allowlist — never a bare `https:`
 * (X2b) — so an approved host is the only way a remote origin enters the policy.
 * The output is applied at exactly one site, `buildResponseHeaders` (item 13).
 *
 * Frames (#124): `frame-src` names the page's OWN root token and nothing else —
 * never the bare scheme, never a host (not even an approved one), never `data:`
 * or `blob:`. A frame on another project's token or on a remote host is then
 * refused by the browser itself, before any main-process event (spikes S2, S10).
 * `srcdoc` frames inherit the parent's sandbox and CSP and need no entry (S3).
 *
 * Trust model: every host is untrusted data. Each is RE-VALIDATED here (belt and
 * braces over the schema that gate-kept the write path) against the anchored
 * host grammar AND an explicit CR/LF guard, because a newline could break out of
 * the header line. A host that fails is SKIPPED and reported for badging. The
 * own token is checked too: anything but 32 lowercase hex degrades to
 * `frame-src 'none'` and is reported. This function NEVER throws (NEW-4): a
 * throw on the approve-path rebuild would strand the registry on a stale CSP
 * after a successful write. An empty result is still safe: it degrades to the
 * `erfana-preview:` scheme-source only, and to no frames at all.
 */

import { PreviewOriginSchema } from '../../../shared/ipc/preview-settings-schema'

/**
 * The local scheme as a CSP scheme-source. Used INSTEAD of `'self'`: a page
 * served at an opaque origin (from `sandbox allow-scripts`) has no self, so
 * `'self'` would match nothing and mislead (design §2.7). Declared as a literal
 * — `previewScheme.ts` (item 9) is not in this module's dependency set.
 */
const PREVIEW_SCHEME_SOURCE = 'erfana-preview:'

/**
 * The root-token grammar `PreviewRootRegistry` mints: `randomUUID()` without its
 * dashes. Anchored at both ends; JS `$` without the `m` flag matches only at the
 * end of input, so a trailing newline cannot slip past it into the header.
 *
 * Exported for the frame modules (issue #124, WI-14), which must recognise the
 * token `frame-src` names by this grammar rather than by a copy of it. No `g`
 * flag, so `test()` keeps no state between calls.
 */
export const OWN_TOKEN_PATTERN = /^[0-9a-f]{32}$/

/** The `frame-src` value when the own token is unusable: no frames at all. */
const NO_FRAMES = "'none'"

/** Inputs to the policy that are not host data. */
export interface PreviewCspOptions {
  /**
   * The root token the page is served under – the URL host of
   * `erfana-preview://<token>/…`, and the only source `frame-src` ever names.
   */
  readonly ownToken: string
}

/**
 * What the builder left out of the policy, reported to the caller's sink. An
 * unusable token is reported WITHOUT its value: the caller already has it, and
 * a malformed one may carry a line break that has no place in a log line.
 */
export type PreviewCspRejection =
  | { readonly kind: 'host'; readonly host: string }
  | { readonly kind: 'own-token' }

/**
 * Render an approved origin as a CSP host-source.
 *
 * IDENTITY, and that is the whole point of storing a canonical origin: the
 * origin serialization IS a valid CSP host-source for every case the schema
 * admits. Nothing is constructed here, so there is no second opinion about what
 * the grant covers — `previewFilterDecision` compares the same string.
 *
 * This used to be `` `https://${host}` ``, which is why a port could never be
 * granted: the emitted source carried no port, and a source with no port matches
 * only the scheme's default.
 */
function toHostSource(origin: string): string {
  return origin
}

/**
 * The `frame-src` source list: the own token as a host-source, or `'none'`
 * (reported) when it is not 32 lowercase hex. Takes `unknown` so a value that
 * slipped past the types degrades instead of throwing.
 */
function frameSource(
  ownToken: unknown,
  onReject?: (rejection: PreviewCspRejection) => void
): string {
  if (typeof ownToken === 'string' && OWN_TOKEN_PATTERN.test(ownToken)) {
    return `${PREVIEW_SCHEME_SOURCE}//${ownToken}`
  }
  onReject?.({ kind: 'own-token' })
  return NO_FRAMES
}

/**
 * Build the preview CSP from the approved-host allowlist and the page's own
 * root token.
 *
 * @param hosts    approved hosts, each re-validated before use
 * @param options  `ownToken`: the root token `frame-src` names; anything but 32
 *                 lowercase hex gives `frame-src 'none'`
 * @param onReject optional sink for what was left out: a skipped host, so the
 *                 caller can record an `allowlist-invalid` failure badge (design
 *                 §2.5), or an unusable own token. Never throws.
 * @returns a header-ready CSP that ALWAYS contains `default-src 'none'` and
 *          `sandbox allow-scripts`, and never contains `'self'` or
 *          `frame-ancestors`.
 */
export function buildPreviewCsp(
  hosts: readonly string[],
  options: PreviewCspOptions,
  onReject?: (rejection: PreviewCspRejection) => void
): string {
  const valid: string[] = []
  for (const host of hosts) {
    // Explicit CR/LF guard first — a newline could break out of the header line
    // even though the anchored regex already forbids it (JS `$` without `m`
    // matches end-of-input only, so a trailing newline cannot slip the anchor).
    if (/[\r\n]/.test(host) || !PreviewOriginSchema.safeParse(host).success) {
      onReject?.({ kind: 'host', host })
      continue
    }
    valid.push(host)
  }

  const hostSources = valid.map(toHostSource).join(' ')
  const suffix = hostSources ? ` ${hostSources}` : ''

  return [
    "default-src 'none'",
    // `'unsafe-inline' 'unsafe-eval'` are DELIBERATE: the whole point of the
    // preview is to run the user's own untrusted page JS. The real containment
    // boundary is `sandbox allow-scripts` (an opaque origin, no
    // `allow-same-origin`) plus the sealed in-memory session — NOT script-src. Do
    // not "tighten" this to nonces/hashes; that would break the feature without
    // adding security (OWASP CSP cheat-sheet, inline-script carve-out).
    `script-src 'unsafe-inline' 'unsafe-eval' ${PREVIEW_SCHEME_SOURCE}${suffix}`,
    `style-src 'unsafe-inline' ${PREVIEW_SCHEME_SOURCE}${suffix}`,
    `img-src data: blob: ${PREVIEW_SCHEME_SOURCE}${suffix}`,
    `font-src data: ${PREVIEW_SCHEME_SOURCE}${suffix}`,
    `media-src blob: ${PREVIEW_SCHEME_SOURCE}${suffix}`,
    `connect-src ${PREVIEW_SCHEME_SOURCE}${suffix}`,
    // The own token only (#124): a scheme-wide source would admit another
    // project's token, and an approved host is approved for the page's
    // subresources, never as a frame. `?.`: a JS caller that omits the options
    // still gets a policy, not a throw (NEW-4).
    //
    // There is deliberately NO `frame-ancestors`: an opaque, sandboxed parent can
    // frame a child only when the child carries none — `'none'`, a scheme source
    // and an own-token source all refuse it (spike S2). Dropping it is safe
    // because the scheme is handled only on preview sessions
    // (`previewSchemeScope.test.ts`), so the only documents that can frame a
    // preview page are preview pages, whose `frame-src` is this line. Do not
    // add it back.
    `frame-src ${frameSource(options?.ownToken, onReject)}`,
    "object-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    'sandbox allow-scripts'
  ].join('; ')
}
