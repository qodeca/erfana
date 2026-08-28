// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One link-protocol classification for the whole app (sd-074b §5.4).
 *
 * Both the Markdown preview (renderer) and the HTML preview's navigation policy
 * (main) decide "may this link leave the app?", and they must not answer
 * differently. This module is the single answer, and it answers by PARSING.
 *
 * WHY PARSING, NOT PREFIX MATCHING. The previous renderer-side check was
 * `href.toLowerCase().startsWith(proto)`. Electron's own security guidance says
 * plainly to use a URL parser because "simple string comparisons can sometimes
 * be fooled", and the WHATWG URL parser removes ASCII tab and newline characters
 * from input — so `java\nscript:alert(1)` parses to protocol `javascript:` while
 * defeating a literal `startsWith('javascript:')` test. Prefix matching also
 * accepts `https://evil` inside a `javascript:` payload.
 *
 * The allow-list is the decision; the deny-list is a redundant second check that
 * must never be the only thing standing between a page and the OS.
 */

/**
 * Protocols allowed to leave the app for an OS handler.
 *
 * `tel:` and `ftp:` are inherited from the Markdown preview's existing list so
 * this change alters HOW links are checked, not WHICH links work. Both route to
 * an OS-registered handler with no browser in between and are worth revisiting
 * as a product decision, separately.
 */
export const EXTERNAL_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
  'ftp:'
])

/**
 * Protocols that must never be followed or handed onward.
 *
 * - `javascript:` / `vbscript:` — script execution
 * - `data:` / `blob:` — embedded documents that bypass origin reasoning
 * - `file:` — local filesystem access
 * - `about:` — internal pages
 */
export const DANGEROUS_PROTOCOLS: ReadonlySet<string> = new Set([
  'javascript:',
  'vbscript:',
  'data:',
  'blob:',
  'file:',
  'about:'
])

/** What a link is, once parsed. */
export type LinkProtocolKind =
  /** Safe to hand to the OS (`EXTERNAL_PROTOCOLS`). */
  | 'external'
  /** Must be blocked (`DANGEROUS_PROTOCOLS`). */
  | 'dangerous'
  /** No scheme: a project-relative path or a bare fragment. */
  | 'relative'
  /** Parsed, but its scheme is on neither list — refused by default. */
  | 'unknown'

/**
 * Classify a link by its parsed protocol.
 *
 * @param href - The raw href, absolute or relative.
 * @returns The protocol kind; anything unrecognised is `'unknown'`, never
 * `'external'`, so the caller's default branch refuses it.
 *
 * @example
 * ```ts
 * classifyLinkProtocol('https://example.com')   // 'external'
 * classifyLinkProtocol('java\nscript:alert(1)') // 'dangerous' — parser strips the newline
 * classifyLinkProtocol('./page.html')           // 'relative'
 * classifyLinkProtocol('ms-msdt:/id')           // 'unknown'
 * ```
 */
/**
 * A leading `scheme:`, using the WHATWG scheme grammar.
 *
 * Only consulted when `new URL()` has already THROWN, to tell "malformed web
 * address" apart from "no scheme at all". Tab, newline and carriage return are
 * stripped first because the parser strips them too.
 */
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:/i

export function classifyLinkProtocol(href: string): LinkProtocolKind {
  if (typeof href !== 'string' || href.trim() === '') {
    return 'relative'
  }

  let protocol: string
  try {
    protocol = new URL(href).protocol.toLowerCase()
  } catch {
    // Unparseable. That is NOT the same as "has no scheme": `http://exa mple.com`
    // and a bare `http://` both throw, and treating them as relative would hand
    // a malformed WEB address to project-file resolution — which is what the
    // first revision of this module did, silently changing which links work
    // (lens review F23).
    //
    // A href that announces a scheme it cannot honour is refused by default; one
    // with no scheme at all is a project-relative path or fragment, and callers
    // resolve it against the document and confine it to the project.
    // eslint-disable-next-line no-control-regex
    const withoutStrippable = href.replace(/[\u0009\u000a\u000d]/g, '')
    return SCHEME_PREFIX.test(withoutStrippable) ? 'unknown' : 'relative'
  }

  if (DANGEROUS_PROTOCOLS.has(protocol)) return 'dangerous'
  if (EXTERNAL_PROTOCOLS.has(protocol)) return 'external'
  return 'unknown'
}

/**
 * Whether a URL carries embedded credentials (`https://user:pass@host`).
 *
 * A classic phishing and credential-leak shape, and never legitimate in a link
 * a previewed page hands to the OS browser.
 *
 * @param href - The raw href.
 * @returns `true` when a username or password is present.
 */
export function hasEmbeddedCredentials(href: string): boolean {
  try {
    const url = new URL(href)
    return url.username !== '' || url.password !== ''
  } catch {
    return false
  }
}
