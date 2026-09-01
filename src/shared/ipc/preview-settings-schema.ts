// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Versioned `.erfana/settings.json` HTML-preview allowlist schema (Issue #74,
 * work item 10; design §3.1).
 *
 * The allowlist is a one-way door: hosts the user has approved for remote
 * subresource loads inside a previewed page. It is deliberately NOT part of
 * `ProjectSettingsSchema` (§3.1, X1) — a clone-delivered bad host must never
 * block project load. `isApprovableHost` is applied on BOTH the read and the
 * write path (design §3.2/§3.3) so a non-approvable host can never be
 * persisted nor loaded into the live set.
 *
 * zod v4: `z.enum`/`z.literal`; `z.nativeEnum` is deprecated and unused.
 */
import { z } from 'zod'

/** On-disk allowlist schema version. Fail closed on any other value (§3.2). */
export const PREVIEW_ALLOWLIST_VERSION = 1

/** Hard cap on approved hosts; a larger set aborts with `PREVIEW_ALLOWLIST_FULL`. */
export const MAX_ALLOWLIST_HOSTS = 200

/**
 * True unless `host` is a form that must never be approvable: an IPv4 or IPv6
 * literal (including bracketed and hex/octal shorthands), an all-numeric label
 * set, `localhost`, any `*.localhost` / `*.local` / `*.internal` name, or a bare
 * single-label name (which a DNS search domain can resolve to an internal
 * service — an SSRF surface) — and never a value carrying a `\r` or `\n` (CSP /
 * header-injection guard).
 *
 * Pure and dependency-free so it can run in both the main and renderer bundles.
 */
export function isApprovableHost(host: string): boolean {
  // Control characters could break out of a CSP directive or a header line.
  if (/[\r\n]/.test(host)) return false

  const lower = host.toLowerCase()

  // IPv6 literals (bare or bracketed) always contain a colon or a bracket.
  if (lower.includes(':') || lower.includes('[') || lower.includes(']')) return false

  // Loopback / link-local / private-use names.
  if (lower === 'localhost') return false
  if (lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) {
    return false
  }

  const labels = lower.split('.')

  // A bare single-label name (e.g. `intranet`, `wiki`) can resolve to an internal
  // service via a DNS search domain — refuse anything without a registrable
  // (dotted) domain shape.
  if (labels.length < 2) return false

  // IPv4 dotted-decimal literal, e.g. 127.0.0.1.
  if (labels.length === 4 && labels.every((label) => /^\d{1,3}$/.test(label))) return false

  // Any all-numeric label set: a bare decimal like 2130706433 or a shorthand
  // IPv4 form such as 1.1.
  if (labels.every((label) => /^\d+$/.test(label))) return false

  // Hex / octal IPv4 shorthands, e.g. 0x7f.1.
  if (labels.some((label) => /^0x[\da-f]+$/.test(label))) return false

  // Every label must be a real DNS label: alphanumeric, inner hyphens only.
  //
  // Without this the predicate was WIDER than `PreviewHostSchema`, the regex
  // that actually gates the write. A trailing dot (`example.com.`, whose last
  // label is empty) or an underscore (`foo_bar.com`) passed here and failed
  // there, so the reader was offered an Approve button for a host the boundary
  // then refused — and the renderer discards that refusal, so the toast simply
  // dismissed and the decision looked made. The two must agree.
  if (lower.length > 253) return false
  if (!labels.every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false

  return true
}

/**
 * A single approvable host. The regex admits no space, `;`, `'`, `"`, `,`,
 * `\r` or `\n`, so a value that passes cannot carry a CSP delimiter; the
 * `isApprovableHost` refinement then removes IP literals and loopback names.
 */
export const PreviewHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/)
  .refine(isApprovableHost, { message: 'host is not approvable' })

/* ---------------------------------------------------------------------------
 * ORIGINS — the unit a permission is actually granted to.
 * ------------------------------------------------------------------------- */

/**
 * The schemes an approved origin may carry.
 *
 * A CLOSED SET, never "did `new URL` parse it". `ws:`, `ftp:` and friends parse
 * perfectly well and would sail through a parseability check; `blob:` is worse
 * still — `new URL('blob:https://evil.com/1234').origin` is the clean-looking
 * `https://evil.com` while its `hostname` is empty, so anything reading `.origin`
 * validates a string that never described a real fetch target.
 *
 * `http:` is absent DELIBERATELY and temporarily: both chokepoints are https-only
 * today, so admitting it here would write a grant that cannot work. It is added
 * when the refusal is removed from both gates at once.
 */
export const PREVIEW_ORIGIN_SCHEMES: readonly string[] = ['https:']

/** Longest storable origin: 253 host + scheme + `:65535`. */
const MAX_ORIGIN_LENGTH = 300

/**
 * Canonicalise an origin, or refuse it.
 *
 * ONE function is both the canonicaliser and the definition of validity, which
 * is what makes the round trip enforceable: a stored value is valid exactly when
 * it is already what this returns. `PreviewOriginSchema` is nothing but that
 * comparison, so a value the CSP builder and the network filter would read
 * differently cannot be stored in the first place.
 *
 * NEVER BUILT FROM `URL.origin`. Scheme, host and port are read as three
 * separate fields and re-serialised from those — see the `blob:` note above, and
 * note `.origin` also silently DISCARDS userinfo, so `https://user:pw@example.com`
 * would come back looking innocent.
 *
 * @param input - a candidate origin, from disk, from IPC, or derived from a URL
 * @returns the canonical origin, or `null` if it may never be approved
 */
export function parsePreviewOrigin(input: string): string | null {
  // FIRST, and on the RAW string. The WHATWG parser strips tab, LF and CR from
  // anywhere in its input before parsing, so a control-character guard applied
  // after `new URL` passes trivially while the value that reached disk still
  // carries the byte that could break out of a CSP directive or a header line.
  // eslint-disable-next-line no-control-regex -- rejecting them is the point
  if (/[\u0000-\u001F\u007F]/.test(input)) return null
  if (input.length > MAX_ORIGIN_LENGTH) return null

  let url: URL
  try {
    url = new URL(input)
  } catch {
    // Includes a port above 65535, which the parser refuses for us.
    return null
  }

  if (!PREVIEW_ORIGIN_SCHEMES.includes(url.protocol)) return null

  // An origin has no user, no path, no query and no fragment. `pathname` is `/`
  // for a bare origin, so the other three need checking on their own.
  if (url.username !== '' || url.password !== '') return null
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null

  // ONE trailing dot is stripped, not refused. `example.com.` and `example.com`
  // are the same name to a resolver and a CSP host-source has no empty-label
  // production — so refusing it would produce a blocked row carrying an Allow
  // button that the boundary then rejects, and a button that lies is worse than
  // no button. `example.com..` has an empty label and stays refused below.
  const hostname = url.hostname.endsWith('.') ? url.hostname.slice(0, -1) : url.hostname
  if (hostname === '' || hostname.length > 253) return null

  // IPv6, and the only refusal here that is PHYSICS rather than policy: CSP3's
  // `host-char` is `ALPHA / DIGIT / "-"`, so a bracketed literal cannot be
  // written as a host-source at all. Granting one would put it in the network
  // filter and not in the CSP — a grant that looks live and is half-refused.
  if (hostname.includes(':') || hostname.includes('[') || hostname.includes(']')) return null

  // Every label a real DNS label. Catches `foo_bar.com` and the empty label in
  // `example..com`, both of which the URL parser accepts.
  const labels = hostname.split('.')
  if (!labels.every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null

  // Policy, and the layer that is on its way out. Kept for now so this change is
  // about the UNIT of approval and nothing else.
  if (!isApprovableHost(hostname)) return null

  // Port `0` parses, is a valid CSP `port-part`, and never connects — another
  // grant that could only ever be written and never work.
  if (url.port === '0') return null

  return `${url.protocol}//${hostname}${url.port === '' ? '' : `:${url.port}`}`
}

/**
 * A single approvable origin, in canonical form.
 *
 * Validity IS canonicality: anything the parser would rewrite is refused rather
 * than silently normalised, so the string on disk, the string in the CSP and the
 * string the network filter compares are provably the same string.
 */
export const PreviewOriginSchema = z
  .string()
  .min(1)
  .max(MAX_ORIGIN_LENGTH)
  .refine((value) => parsePreviewOrigin(value) === value, {
    message: 'origin is not a canonical approvable origin'
  })

/**
 * What a legacy `hosts` entry always meant.
 *
 * A host grant did exactly two things: it emitted `https://<host>` into the CSP,
 * and it matched a `hostname` under `protocol === 'https:'` in the filter. Both
 * are the origin `https://<host>` at the default port, so this migration is
 * lossless. It is also strictly NARROWING — the filter used to ignore the port
 * while the CSP did not — which is the port bug being closed, not a regression.
 */
export function originFromLegacyHost(host: string): string | null {
  return parsePreviewOrigin(`https://${host}`)
}

/**
 * The versioned allowlist block persisted under `htmlPreview.allowlist`.
 *
 * `origins` IS THE TRUTH; `hosts` is a projection kept for older builds, and the
 * version is deliberately NOT bumped. `load()` on a version it does not know
 * applies an EMPTY set, and `approveHostInner` refuses every write from its own
 * version check — so a bump would leave an older Erfana having silently lost
 * every approved host AND unable to re-approve one, recoverable only by hand.
 * A plain `z.object` strips unknown keys, so an older build reads a file
 * carrying `origins` without noticing it, and keeps working from `hosts`.
 */
export const PreviewAllowlistSchema = z.object({
  version: z.literal(PREVIEW_ALLOWLIST_VERSION),
  hosts: z.array(PreviewHostSchema).max(MAX_ALLOWLIST_HOSTS).default([]),
  /** Optional: absent in a file written before origins existed. */
  origins: z.array(PreviewOriginSchema).max(MAX_ALLOWLIST_HOSTS).optional()
})

export type PreviewAllowlist = z.infer<typeof PreviewAllowlistSchema>
export type PreviewHost = z.infer<typeof PreviewHostSchema>
export type PreviewOrigin = z.infer<typeof PreviewOriginSchema>
