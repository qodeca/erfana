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
  const asciiHost = parsed.hostname
  const port = parsed.port === '' ? null : parsed.port
  const base = { kind: 'web', scheme: scheme === 'http' ? 'http' : null, port } as const
  if (isIpOrSingleLabel(asciiHost)) {
    return { ...base, subdomain: '', registrableDomain: asciiHost, punycode: false }
  }
  const asciiDomain = resolve(asciiHost) ?? asciiHost
  const shown = displayHost(asciiHost, asciiDomain)
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
  const opener = formatOrigin(openerUrl, resolve) ?? 'a page'
  return `about:blank${TITLE_SEPARATOR}opened by ${opener}`
}

/** The ellipsis that stands for removed subdomain labels: "…" plus the dot. */
export const SUBDOMAIN_ELISION = '….'

/**
 * The formatted origin fitted to `maxChars` characters (design § States ›
 * Tiers, step 8): whole subdomain labels are removed from the front behind
 * `….`; only when the scheme, registrable domain and port still do not fit is
 * the domain cut from its start behind "…", so its end, the TLD and the port
 * stay. The scheme is kept at every width. The formatter writes the "…"
 * itself; callers never use CSS `direction` (bidi would reorder a digit-led
 * domain).
 */
export function fitOrigin(parts: WebOriginParts, maxChars: number): string {
  const full = originText(parts)
  if ([...full].length <= maxChars) return full
  const scheme = parts.scheme === null ? '' : `${parts.scheme}://`
  const port = parts.port === null ? '' : `:${parts.port}`
  const labels = parts.subdomain === '' ? [] : parts.subdomain.slice(0, -1).split('.')
  for (let drop = 1; drop <= labels.length; drop++) {
    const kept = labels.slice(drop)
    const sub = kept.length === 0 ? SUBDOMAIN_ELISION : `${SUBDOMAIN_ELISION}${kept.join('.')}.`
    const text = `${scheme}${sub}${parts.registrableDomain}${port}`
    if ([...text].length <= maxChars) return text
  }
  const room = maxChars - [...scheme].length - [...port].length - 1
  const domain = [...parts.registrableDomain]
  const tail = room > 0 ? domain.slice(Math.max(domain.length - room, 0)).join('') : ''
  return `${scheme}…${tail}${port}`
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
