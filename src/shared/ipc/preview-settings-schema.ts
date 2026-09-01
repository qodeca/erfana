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
 * True unless `host` is a form that cannot be written into a CSP host-source.
 *
 * WHAT THIS USED TO DO, AND WHY IT STOPPED. It also refused `localhost`,
 * `*.localhost`, `*.local`, `*.internal`, IPv4 literals, all-numeric and
 * hex/octal shorthands, and any bare single-label name. Those were POLICY: an
 * attempt to keep a previewed page away from loopback and LAN services. They are
 * gone, deliberately, and the reasons are worth keeping.
 *
 * The policy did not work. `docs/security.md` conceded it in the same breath as
 * claiming it: a name that *resolves* to a private address was never detected, so
 * `127.0.0.1.nip.io` walked straight past every clause above. It stopped the
 * honest reader and not a hostile page.
 *
 * And it was paid for in the worst currency. A refused host rendered as a row
 * with no button and no reason — a dead end that teaches the reader the
 * permission band is unreliable, which is a real cost against a control whose
 * only asset is that it is believed. See #108.
 *
 * WHAT SURVIVES IS STRUCTURE, NOT JUDGEMENT. A value carrying `\r` or `\n` could
 * break out of a header line. An IPv6 literal cannot be written as a CSP
 * host-source at all — `host-char` is `ALPHA / DIGIT / "-"`, and Chromium proves
 * it at runtime by reporting "contains an invalid source … It will be ignored",
 * which would leave a grant live in the network filter and absent from the CSP.
 * A label that is not a DNS label is not a host. None of those are opinions.
 *
 * Pure and dependency-free so it can run in both the main and renderer bundles.
 */
export function isApprovableHost(host: string): boolean {
  // Control characters could break out of a CSP directive or a header line.
  if (/[\r\n]/.test(host)) return false

  const lower = host.toLowerCase()

  // IPv6 literals, bare or bracketed, always carry a colon or a bracket. The one
  // refusal here that is physics rather than policy.
  if (lower.includes(':') || lower.includes('[') || lower.includes(']')) return false

  if (lower.length > 253) return false

  // Every label a real DNS label: alphanumeric, inner hyphens only. `localhost`
  // and `127.0.0.1` both pass this now, and that is the point.
  return lower.split('.').every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
}

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
 * `http:` is admitted, and it genuinely works: measured in Electron 39, a plain
 * `http://` subresource inside a preview is NOT refused as mixed content, because
 * the document sits at an opaque origin and mixed content is decided against the
 * origin's scheme rather than against `isSecureContext`. See
 * `docs/designs/108-http-and-ipv6-in-the-preview.md` — this was assumed to be
 * impossible and was measured to be false, which is why the assumption was
 * measured before anything was built on it.
 *
 * What `http:` costs is a different question, and it belongs in the confirm
 * step's words rather than in a refusal here: the connection is not encrypted,
 * so anyone positioned on the network can change what the page loads.
 */
export const PREVIEW_ORIGIN_SCHEMES: readonly string[] = ['https:', 'http:']

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
