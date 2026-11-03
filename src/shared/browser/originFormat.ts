// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The one formatter for every origin Erfana writes (spec 025, 025-FR-004,
 * 025-FR-011; design Security UI rule 2, OD-1; panel finding S9): the address
 * bar, the editor-tab label while no title is known, strip rows, notices and a
 * popup's OS title.
 *
 * - `https://` is dropped; any other scheme is kept (`http://`, `file://`).
 * - The port is kept only when it is not the scheme's default (the URL parser
 *   already drops a default port).
 * - User info (`user:password@`) is never shown.
 * - The host is split into subdomain labels and the registrable domain, the
 *   part that is never cut; an internationalised host is shown in Unicode only
 *   when `idnDisplay.ts` lets it, otherwise in punycode.
 * - Any scheme other than `http`, `https` and `file` is a non-web target and
 *   is shown as its scheme word, never as a host.
 *
 * The registrable domain comes from a resolver the caller passes – in main,
 * `pinnedRegistrableDomain` from `publicSuffixList.ts` – so this module stays
 * small enough for any bundle (OD-1).
 */
import { displayHost } from './idnDisplay'
import { sanitizePageText } from './pageText'

/** Gives the registrable domain of an ASCII host, or `null` (host is a public suffix). */
export type RegistrableDomainResolver = (asciiHost: string) => string | null

/** A web origin split for display. Every string is display text. */
export interface WebOriginParts {
  readonly kind: 'web'
  /** `'http'` when shown; `null` for `https`, which is never shown. */
  readonly scheme: 'http' | null
  /** Subdomain labels before the registrable domain, with their trailing dot (`'www.'`), or `''`. */
  readonly subdomain: string
  /** The part never cut or wrapped: the registrable domain, an IP address or a single-label host. */
  readonly registrableDomain: string
  /** The port when it is not the default, without the colon. */
  readonly port: string | null
  /** True when an internationalised host is shown in punycode by the spoofing checks. */
  readonly punycode: boolean
}

export type OriginParts =
  | WebOriginParts
  | { readonly kind: 'file' }
  | { readonly kind: 'nonWeb'; readonly scheme: string }

/** The separator of a popup's OS title, "{host} – Erfana" (025-FR-011). */
const TITLE_SEPARATOR = ' – '

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

function withoutTrailingDot(host: string): string {
  return host.endsWith('.') ? host.slice(0, -1) : host
}

function isIpOrSingleLabel(host: string): boolean {
  return host.startsWith('[') || IPV4.test(host) || !host.includes('.')
}

/** Split `url` for display, or `null` when it does not parse as a URL. */
export function originParts(url: string, resolve: RegistrableDomainResolver): OriginParts | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const scheme = parsed.protocol.slice(0, -1)
  if (scheme === 'file') return { kind: 'file' }
  if (scheme !== 'http' && scheme !== 'https') return { kind: 'nonWeb', scheme }
  // A fully-qualified host (`evil.github.io.`) is split without its trailing
  // dot: the resolver drops it too, and a kept dot would move the emphasis one
  // label to the right (`evil.` dimmed, `github.io.` bright).
  const asciiHost = withoutTrailingDot(parsed.hostname)
  const port = parsed.port === '' ? null : parsed.port
  const base = { kind: 'web', scheme: scheme === 'http' ? 'http' : null, port } as const
  if (isIpOrSingleLabel(asciiHost)) {
    return { ...base, subdomain: '', registrableDomain: asciiHost, punycode: false }
  }
  const resolved = resolve(asciiHost)
  const asciiDomain = resolved ?? asciiHost
  // An unknown registrable domain (`null`) makes the imitation check look at every label.
  const shown = displayHost(asciiHost, resolved)
  const punycode = shown === asciiHost && asciiHost.split('.').some(l => l.startsWith('xn--'))
  const domainLabels = asciiDomain.split('.').length
  const labels = shown.split('.')
  const cut = labels.length - domainLabels
  return {
    ...base,
    subdomain: cut > 0 ? `${labels.slice(0, cut).join('.')}.` : '',
    registrableDomain: labels.slice(Math.max(cut, 0)).join('.'),
    punycode
  }
}

/** The host as shown: subdomain labels and the registrable domain. */
export function hostText(parts: WebOriginParts): string {
  return `${parts.subdomain}${parts.registrableDomain}`
}

/** The formatted origin: `[http://]host[:port]`. */
export function originText(parts: WebOriginParts): string {
  const scheme = parts.scheme === null ? '' : `${parts.scheme}://`
  const port = parts.port === null ? '' : `:${parts.port}`
  return `${scheme}${hostText(parts)}${port}`
}

/**
 * The formatted origin of `url` for one line of text: the web origin, `file://`
 * for a local file, or the scheme word with a colon for a non-web target
 * (`mailto:`). `null` when `url` does not parse.
 */
export function formatOrigin(url: string, resolve: RegistrableDomainResolver): string | null {
  const parts = originParts(url, resolve)
  if (parts === null) return null
  if (parts.kind === 'file') return 'file://'
  if (parts.kind === 'nonWeb') return `${parts.scheme}:`
  return originText(parts)
}

/**
 * The editor-tab label while the page has no title (025-FR-004): the host with
 * no scheme, port or path. A local file shows its file name, cleaned of control
 * and bidi characters; anything else falls back to `fallback`.
 */
export function tabTitleFallback(url: string, resolve: RegistrableDomainResolver, fallback: string): string {
  const parts = originParts(url, resolve)
  if (parts?.kind === 'web') return hostText(parts)
  if (parts?.kind === 'file') {
    const name = new URL(url).pathname.split('/').pop() ?? ''
    const shown = sanitizePageText(safeDecode(name))
    return shown === '' ? fallback : shown
  }
  return fallback
}

/**
 * A popup's OS title, "{host} – Erfana", from its committed address only –
 * never from the page title (025-FR-011). Before the first commit, or for an
 * address with no host (`about:blank`), "about:blank – opened by {origin}"
 * names the opener (spec change S-22).
 */
export function popupWindowTitle(
  committedUrl: string | null,
  openerUrl: string,
  resolve: RegistrableDomainResolver
): string {
  const parts = committedUrl === null ? null : originParts(committedUrl, resolve)
  if (parts?.kind === 'web') return `${hostText(parts)}${TITLE_SEPARATOR}Erfana`
  return popupBlankText(popupOpenerName(openerUrl, resolve))
}

/**
 * Who opened a popup, as its title and strip name it: the formatted origin of
 * the opening frame, or "a page" when it has none (an opaque `"null"` origin).
 */
export function popupOpenerName(openerUrl: string, resolve: RegistrableDomainResolver): string {
  return formatOrigin(openerUrl, resolve) ?? 'a page'
}

/** "about:blank – opened by {opener}": a popup with no committed web address (S-22). */
export function popupBlankText(openerName: string): string {
  return `about:blank${TITLE_SEPARATOR}opened by ${openerName}`
}

/** The ellipsis that stands for removed subdomain labels: "…" plus the dot. */
export const SUBDOMAIN_ELISION = '….'

/** A fitted origin, one display string per part; an absent part is `''`. */
export interface FittedOrigin {
  /** `'http://'` or `''`. */
  readonly scheme: string
  /** Kept subdomain labels, led by `….` when labels were removed, or `''`. */
  readonly subdomain: string
  /** The registrable domain; led by "…" only after the last-resort start cut. */
  readonly registrableDomain: string
  /** `':8080'` or `''`. */
  readonly port: string
}

const charCount = (text: string): number => [...text].length

/** The fitted origin as one string. */
export function fittedText(fitted: FittedOrigin): string {
  return `${fitted.scheme}${fitted.subdomain}${fitted.registrableDomain}${fitted.port}`
}

/**
 * The formatted origin fitted to `maxChars` characters, split into its parts
 * (design § States › Tiers, step 8): whole subdomain labels are removed from
 * the front behind `….`; only when the scheme, registrable domain and port
 * still do not fit is the domain cut from its start behind "…", so its end,
 * the TLD and the port stay. The scheme is kept at every width. The formatter
 * writes the "…" itself; callers never use CSS `direction` (bidi would
 * reorder a digit-led domain).
 */
export function fitOriginParts(parts: WebOriginParts, maxChars: number): FittedOrigin {
  const scheme = parts.scheme === null ? '' : `${parts.scheme}://`
  const port = parts.port === null ? '' : `:${parts.port}`
  const whole = { scheme, subdomain: parts.subdomain, registrableDomain: parts.registrableDomain, port }
  if (charCount(fittedText(whole)) <= maxChars) return whole
  const labels = parts.subdomain === '' ? [] : parts.subdomain.slice(0, -1).split('.')
  for (let drop = 1; drop <= labels.length; drop++) {
    const kept = labels.slice(drop)
    const subdomain = kept.length === 0 ? SUBDOMAIN_ELISION : `${SUBDOMAIN_ELISION}${kept.join('.')}.`
    const fitted = { ...whole, subdomain }
    if (charCount(fittedText(fitted)) <= maxChars) return fitted
  }
  const room = maxChars - charCount(scheme) - charCount(port) - 1
  const domain = [...parts.registrableDomain]
  const tail = room > 0 ? domain.slice(Math.max(domain.length - room, 0)).join('') : ''
  return { scheme, subdomain: '', registrableDomain: `…${tail}`, port }
}

/** {@link fitOriginParts} as one string. */
export function fitOrigin(parts: WebOriginParts, maxChars: number): string {
  return fittedText(fitOriginParts(parts, maxChars))
}

/**
 * The longest fitting of `parts` whose drawn width, by `measure`, is at most
 * `widthPx` – for a surface that knows its width in pixels rather than in
 * characters (the address bar, the popup strip, the editor-tab label). A
 * non-positive or non-finite width (not laid out yet) gives the whole origin.
 *
 * @param measure - The drawn width of a string in the surface's font, in px
 */
export function fitOriginToWidth(
  parts: WebOriginParts,
  widthPx: number,
  measure: (text: string) => number
): FittedOrigin {
  const whole = fitOriginParts(parts, Number.POSITIVE_INFINITY)
  if (!Number.isFinite(widthPx) || widthPx <= 0) return whole
  for (let max = charCount(fittedText(whole)); max > 0; max--) {
    const fitted = fitOriginParts(parts, max)
    if (measure(fittedText(fitted)) <= widthPx) return fitted
  }
  return fitOriginParts(parts, 0)
}

/**
 * `url` without its user info (`user:password@`): what Erfana sends to its
 * own renderer as an address, so no surface – the bar at rest or while
 * edited, the tooltip, a row – can show a host-like name before the real host
 * (`https://accounts.example.com@evil.test/`). A string that does not parse,
 * or has no user info, comes back unchanged.
 */
export function withoutUserInfo(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.username === '' && parsed.password === '') return url
  parsed.username = ''
  parsed.password = ''
  return parsed.href
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
