// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { EXTERNAL_PROTOCOLS } from '../../shared/linkProtocolPolicy'

/** Upper bound on an accepted URL. Well past any legitimate link. */
export const MAX_EXTERNAL_URL_LENGTH = 2048

/**
 * Parse a URL that may be handed to the operating system.
 *
 * The single main-process answer to "may this string leave the app?". Pure and
 * free of Electron imports so it can be tested as a table.
 *
 * Accepted: a bounded string that parses with `new URL()`, whose protocol is in
 * `EXTERNAL_PROTOCOLS` (the one allowlist), with no embedded credentials and no
 * network-share shape.
 *
 * @param input - The raw value, from any caller.
 * @returns The normalised `URL.href` (what was validated is what gets opened),
 * or `null` when the value must not be opened.
 */
export function parseExternalUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_EXTERNAL_URL_LENGTH) {
    return null
  }

  // Share-looking input (`\\host\share`, `//host/share`): refuse before parsing,
  // because the parser would otherwise normalise some of these into a web URL.
  const trimmed = input.trim()
  if (/^[\\/]{2}/.test(trimmed)) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) return null
  if (parsed.username !== '' || parsed.password !== '') return null
  // A backslash or percent-encoded backslash in the host is a share shape.
  if (/\\|%5c/i.test(parsed.host)) return null

  if (parsed.protocol === 'mailto:') return rebuildMailto(parsed)

  return parsed.href
}

/** The only query fields a mailto link may carry on to the mail client. */
const MAILTO_FIELDS: ReadonlySet<string> = new Set(['to', 'cc', 'bcc', 'subject', 'body'])

/** Percent-encode one value; `@` stays readable in addresses. */
function encodeMailtoPart(value: string): string {
  return encodeURIComponent(value).replace(/%40/g, '@')
}

/**
 * Rebuild a `mailto:` URL from its parts so nothing else rides along.
 *
 * Mail clients act on extra header fields such as `attach` / `attachment`, so
 * only `to`, `cc`, `bcc`, `subject` and `body` are kept. Every kept value is
 * decoded and re-encoded, so the result carries no raw quote, space or control
 * character.
 *
 * @returns The rebuilt URL, or `null` when a part has malformed percent-encoding.
 */
function rebuildMailto(parsed: URL): string | null {
  try {
    const addresses = decodeURIComponent(parsed.pathname)
      .split(',')
      .map((address) => address.trim())
      .filter((address) => address !== '')
      .map(encodeMailtoPart)

    const fields: string[] = []
    for (const [key, value] of new URLSearchParams(parsed.search)) {
      if (MAILTO_FIELDS.has(key.toLowerCase())) {
        fields.push(`${key.toLowerCase()}=${encodeMailtoPart(value)}`)
      }
    }

    return `mailto:${addresses.join(',')}${fields.length > 0 ? `?${fields.join('&')}` : ''}`
  } catch {
    return null
  }
}

/**
 * Scheme + host only, for logging. A URL can carry user content (a mailto body,
 * a query string), so the full value is never written to a log file.
 */
export function describeUrlForLog(href: string): string {
  try {
    const parsed = new URL(href)
    return parsed.host ? `${parsed.protocol}//${parsed.host}` : parsed.protocol
  } catch {
    return '[unparseable]'
  }
}
