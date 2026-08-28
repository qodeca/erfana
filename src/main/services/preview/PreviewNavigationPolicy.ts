// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What happens when someone clicks a link inside a previewed page (sd-074b §5).
 *
 * A pure decision function. It never touches the filesystem, the registry or
 * Electron: it turns "this href was activated in this document" into one of four
 * intents, and the caller does the I/O. That keeps the security-relevant
 * branching testable as a table.
 *
 * TWO ENTRY POINTS FEED IT, deliberately:
 *
 *  1. The preview preload's click listener — the only source that knows the
 *     anchor's `target`, the modifier keys, `download`, and whether the event
 *     was a genuine user gesture. It is also the only way `target="_blank"`,
 *     named targets and middle-clicks can work at all: those are popups, and the
 *     page's CSP sandbox has no `allow-popups`, so Blink kills them before any
 *     Electron event fires.
 *  2. `will-navigate` — the same-tab path, which fires for a plain link even
 *     with no preload present. Keeping it wired means a missing or broken
 *     preload bundle degrades to "plain links still work" rather than to today's
 *     total silence.
 *
 * NOTE ON `target`. Under D4 every link opens a new Erfana tab, so the attribute
 * does not change the outcome; it is carried through for logging and so that a
 * future in-place mode has it. What the preload actually buys is the click
 * INTERCEPTION, the gesture check, and the popup cases above.
 *
 * TRUST: `href` is attacker-controlled. Everything here is parsing and
 * classification; the resulting path is re-resolved and re-confined by the
 * caller before anything is opened.
 */
import {
  classifyLinkProtocol,
  hasEmbeddedCredentials
} from '../../../shared/linkProtocolPolicy'

/** The custom scheme a previewed page is served over. */
const PREVIEW_PROTOCOL = 'erfana-preview:'

/** Why a link was refused; each maps to a failure-badge entry. */
export type LinkBlockReason =
  /** `javascript:`, `data:`, `file:`, … */
  | 'dangerous-scheme'
  /** Parsed, but on no allow-list — the default arm. */
  | 'unknown-scheme'
  /** `https://user:pass@host` */
  | 'embedded-credentials'
  /** `<a download>` — the sandbox withholds `allow-downloads` by design. */
  | 'download'
  /** An `erfana-preview://` URL for a different preview's root token. */
  | 'foreign-token'
  /** Not parseable as a URL at all. */
  | 'unparseable'

/** What the caller should do about an activated link. */
export type LinkIntent =
  /**
   * A file inside this preview's project root. `relPath` is still UNTRUSTED and
   * must be resolved and confined against the real root before use.
   */
  | { kind: 'in-project'; relPath: string; anchor: string | null }
  /** Hand to the OS browser, after showing the destination. */
  | { kind: 'external'; url: string }
  /** Do nothing: a fragment jump inside the current document. */
  | { kind: 'same-document' }
  /** Refuse and record a failure entry. */
  | { kind: 'blocked'; reason: LinkBlockReason }

/** Everything the decision needs about one activated link. */
export interface LinkActivation {
  /** The anchor's resolved `href` (the IDL property, never the raw attribute). */
  href: string
  /** The URL of the document the click happened in. */
  currentUrl: string
  /** This preview's root token — the expected `erfana-preview://` host. */
  token: string
  /** The anchor's `target`, after `<base target>` fallback. Advisory only. */
  target?: string
  /** `true` when the anchor carried a `download` attribute. */
  download?: boolean
}

/**
 * Decide what an activated link means.
 *
 * @param activation - The href, the document it was clicked in, and this
 * preview's root token.
 * @returns The intent; anything unrecognised is `blocked`, never `external`.
 *
 * @example
 * ```ts
 * decideLinkIntent({ href: 'erfana-preview://tok/docs/a.html', currentUrl: 'erfana-preview://tok/index.html', token: 'tok' })
 * // → { kind: 'in-project', relPath: 'docs/a.html', anchor: null }
 * ```
 */
export function decideLinkIntent(activation: LinkActivation): LinkIntent {
  const { href, currentUrl, token } = activation

  // A download is refused before anything else: the sandbox withholds
  // `allow-downloads`, so honouring one would mean re-opening a file-write
  // surface the preview deliberately does not have.
  if (activation.download === true) {
    return { kind: 'blocked', reason: 'download' }
  }

  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { kind: 'blocked', reason: 'unparseable' }
  }

  if (url.protocol.toLowerCase() === PREVIEW_PROTOCOL) {
    return decideInProject(url, currentUrl, token)
  }

  switch (classifyLinkProtocol(href)) {
    case 'external':
      // Credentials in a URL handed to the OS browser are never legitimate.
      return hasEmbeddedCredentials(href)
        ? { kind: 'blocked', reason: 'embedded-credentials' }
        : { kind: 'external', url: url.href }
    case 'dangerous':
      return { kind: 'blocked', reason: 'dangerous-scheme' }
    default:
      // `unknown` and `relative` both land here. An href from an anchor is
      // already absolute, so `relative` means something malformed; either way
      // the default arm refuses rather than guessing.
      return { kind: 'blocked', reason: 'unknown-scheme' }
  }
}

/** Resolve an `erfana-preview://` link within the previewing project. */
function decideInProject(url: URL, currentUrl: string, token: string): LinkIntent {
  // The host IS the root token. A different token means another preview's root,
  // which this page must not reach into.
  if (url.hostname !== token.toLowerCase()) {
    return { kind: 'blocked', reason: 'foreign-token' }
  }

  const anchor = url.hash.startsWith('#') ? url.hash.slice(1) : null

  // A fragment on the SAME document is a scroll, not a navigation. Chromium
  // handles it natively inside the sandbox, so the click must be left alone.
  if (anchor !== null && sameDocument(url, currentUrl)) {
    return { kind: 'same-document' }
  }

  // Strip the leading slash; the remainder is a project-relative path whose
  // segments are still percent-encoded and still untrusted.
  const relPath = decodeSegments(url.pathname.replace(/^\/+/, ''))
  if (relPath === null) {
    return { kind: 'blocked', reason: 'unparseable' }
  }
  if (relPath === '') {
    // A bare root link (`erfana-preview://token/`) names no file.
    return { kind: 'blocked', reason: 'unknown-scheme' }
  }

  return { kind: 'in-project', relPath, anchor }
}

/** Whether two preview URLs address the same document, ignoring the fragment. */
function sameDocument(url: URL, currentUrl: string): boolean {
  try {
    const current = new URL(currentUrl)
    return current.hostname === url.hostname && current.pathname === url.pathname
  } catch {
    return false
  }
}

/**
 * Percent-decode each path segment.
 *
 * Segment-wise, so an encoded separator (`%2F`) cannot smuggle an extra level
 * into the path — it decodes inside one segment and is later rejected by the
 * caller's confinement check rather than silently splitting the path here.
 *
 * @returns The decoded relative path, or `null` when a segment is malformed.
 */
function decodeSegments(pathname: string): string | null {
  if (pathname === '') return ''
  try {
    return pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
  } catch {
    return null
  }
}
