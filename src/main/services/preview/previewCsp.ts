// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Content-Security-Policy builder for previewed pages (Issue #74, work item 12;
 * design §2.5, §2.6).
 *
 * `buildPreviewCsp` is the SOLE author of the preview CSP string. It builds the
 * host-source lists FROM the validated project allowlist — never a bare `https:`
 * (X2b) — so an approved host is the only way a remote origin enters the policy.
 * The output is applied at exactly one site, `buildResponseHeaders` (item 13).
 *
 * Trust model: every host is untrusted data. Each is RE-VALIDATED here (belt and
 * braces over the schema that gate-kept the write path) against the anchored
 * host grammar AND an explicit CR/LF guard, because a newline could break out of
 * the header line. A host that fails is SKIPPED and reported for badging — this
 * function NEVER throws (NEW-4): a throw on the approve-path rebuild would strand
 * the registry on a stale CSP after a successful write. An empty result is still
 * safe: it degrades to the `erfana-preview:` scheme-source only.
 */

import { PreviewHostSchema } from '../../../shared/ipc/preview-settings-schema'

/**
 * The local scheme as a CSP scheme-source. Used INSTEAD of `'self'`: a page
 * served at an opaque origin (from `sandbox allow-scripts`) has no self, so
 * `'self'` would match nothing and mislead (design §2.7). Declared as a literal
 * — `previewScheme.ts` (item 9) is not in this module's dependency set.
 */
const PREVIEW_SCHEME_SOURCE = 'erfana-preview:'

/** Render an approved host as an `https://` CSP host-source. */
function toHostSource(host: string): string {
  return `https://${host}`
}

/**
 * Build the preview CSP from the approved-host allowlist.
 *
 * @param hosts    approved hosts, each re-validated before use
 * @param onReject optional sink for a skipped host, so the caller can record an
 *                 `allowlist-invalid` failure badge (design §2.5). Never throws.
 * @returns a header-ready CSP that ALWAYS contains `default-src 'none'` and
 *          `sandbox allow-scripts`, and never contains `'self'`.
 */
export function buildPreviewCsp(
  hosts: readonly string[],
  onReject?: (host: string) => void
): string {
  const valid: string[] = []
  for (const host of hosts) {
    // Explicit CR/LF guard first — a newline could break out of the header line
    // even though the anchored regex already forbids it (JS `$` without `m`
    // matches end-of-input only, so a trailing newline cannot slip the anchor).
    if (/[\r\n]/.test(host) || !PreviewHostSchema.safeParse(host).success) {
      onReject?.(host)
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
    "frame-src 'none'",
    // Defence-in-depth: the page can only ever load inside its own sealed view,
    // but forbid framing it explicitly to match the documented baseline.
    "frame-ancestors 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    'sandbox allow-scripts'
  ].join('; ')
}
