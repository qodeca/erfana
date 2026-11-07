// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The words of the load-error and certificate pages (spec 025, 025-FR-059,
 * 025-FR-021; design deck *Load error* and *Certificate warning*, the
 * load-error message table and the per-code caution text). Pure: no React.
 *
 * `{host}` is always main's formatted host (Security rule 2); a code the
 * table does not name gets the deck's *Any other* row. The loopback hint
 * replaces the general next step on a loopback address (CT-18).
 */
import { hostText } from '../../../../../shared/browser/originFormat'
import { netErrorCodeText } from '../../../../../shared/browser/netErrorMessages'
import type { OriginPartsPayload } from '../../../../../shared/ipc/browser-tab-schema'

/** The load-error page's sentences for one failure. */
export interface LoadErrorCopy {
  readonly title: string
  readonly sentence: string
  /** The general next step, or the loopback hint on a loopback address. */
  readonly nextStep: string
  /** The address and code lines' code part, e.g. `ERR_CONNECTION_REFUSED (-102)`. */
  readonly code: string
}

interface Row {
  readonly title: (host: string, file: string, port: string) => string
  readonly sentence: string
  readonly next: string
  /** `null`: no hint, `same`: the next step stands, a string: the hint. */
  readonly loopback: string | null | 'same'
}

const RESET_HINT = 'If your dev server is restarting, wait for it, then press Reload.'
const STUCK_HINT = 'If your dev server is running, it may be stuck – restart it.'

/** The deck's load-error table, by Chromium code. */
const LOAD_ERRORS: ReadonlyMap<number, Row> = new Map<number, Row>([
  [-102, { title: h => `${h} refused to connect`, sentence: 'Nothing is accepting connections at this address.', next: 'Check that the server is running, then press Reload.', loopback: 'Is your dev server running? Start it in a terminal, then press Reload.' }],
  [-105, { title: h => `Can't find ${h}`, sentence: 'No server with this name could be found.', next: 'Check the address for typos, then press Reload.', loopback: 'Names ending in .localhost need no setup; other local names need an entry in your hosts file or local DNS.' }],
  [-137, { title: h => `Can't find ${h}`, sentence: 'The name lookup failed.', next: 'Check your network connection, then press Reload.', loopback: null }],
  [-118, { title: h => `${h} took too long to respond`, sentence: "The server didn't answer in time.", next: 'Check your network connection, or press Reload in a moment.', loopback: STUCK_HINT }],
  [-7, { title: h => `${h} took too long to respond`, sentence: 'The page took too long to load.', next: 'Press Reload to try again.', loopback: STUCK_HINT }],
  [-106, { title: () => "You're offline", sentence: "This computer isn't connected to a network.", next: 'Check your network connection, then press Reload.', loopback: null }],
  [-21, { title: () => 'Your network changed', sentence: 'The connection was interrupted because your network changed.', next: 'Press Reload to try again.', loopback: null }],
  [-101, { title: h => `The connection to ${h} was reset`, sentence: 'The connection closed before the page finished loading.', next: 'Press Reload to try again.', loopback: RESET_HINT }],
  [-100, { title: h => `${h} closed the connection`, sentence: 'The server closed the connection without sending a page.', next: 'Press Reload to try again.', loopback: RESET_HINT }],
  [-324, { title: h => `${h} didn't send anything`, sentence: 'The server answered with an empty response.', next: 'Press Reload to try again.', loopback: "Check your dev server's terminal for an error." }],
  [-109, { title: h => `Can't reach ${h}`, sentence: "This address can't be reached from your network.", next: "Check the address, and that you're on the right network or VPN.", loopback: null }],
  [-312, { title: (_h, _f, p) => `Browser tabs can't open port ${p}`, sentence: 'Chromium blocks this port because other services use it.', next: 'Run your server on another port, such as 3000 or 5173.', loopback: 'same' }],
  [-107, { title: h => `Can't make a secure connection to ${h}`, sentence: "The server's response couldn't be used for a secure connection.", next: 'If the server only uses http, change https to http in the address.', loopback: 'Dev servers often run without https – try http://{host}.' }],
  [-310, { title: h => `${h} redirected too many times`, sentence: 'The page keeps sending the browser to another address.', next: 'Clearing cookies with Clear browsing data… may fix it.', loopback: 'Check your app’s redirect rules – it may redirect to itself.' }],
  [-6, { title: (_h, f) => `Can't find ${f}`, sentence: "There's no file at this path.", next: "Check that the file exists and hasn't been moved or renamed.", loopback: null }],
  [-10, { title: (_h, f) => `Can't open ${f}`, sentence: "Erfana isn't allowed to read this file.", next: "Check the file's permissions, then press Reload.", loopback: null }],
  [-20, { title: () => 'Erfana blocked this address', sentence: "Browser tabs don't open this kind of address, to keep your computer safe.", next: 'Go back, or type a different address.', loopback: null }]
])

/** Whether `origin` names a loopback host: `localhost`, `*.localhost`, `127.x.y.z` or `[::1]`. */
export function isLoopbackOrigin(origin: OriginPartsPayload | null): boolean {
  if (origin?.kind !== 'web') return false
  const host = `${origin.subdomain}${origin.registrableDomain}`.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(host) || host === '[::1]'
}

/** The host for a sentence: main's formatted host, or a plain fallback. */
export function sentenceHost(origin: OriginPartsPayload | null): string {
  return origin?.kind === 'web' ? hostText(origin) : 'this address'
}

/**
 * The load-error page's words for `code` at the failed address.
 *
 * @param code - Chromium's net error code (negative)
 * @param origin - The failed address's origin parts from main
 * @param fileName - The file's name for a `file://` address (`ERR_FILE_NOT_FOUND`)
 * @returns Title, sentence, next step (or loopback hint) and code text
 *
 * @example
 * ```ts
 * loadErrorCopy(-102, localhostParts, '').nextStep
 * // 'Is your dev server running? Start it in a terminal, then press Reload.'
 * ```
 */
export function loadErrorCopy(code: number, origin: OriginPartsPayload | null, fileName: string): LoadErrorCopy {
  const host = sentenceHost(origin)
  const row = LOAD_ERRORS.get(code)
  const codeText = netErrorCodeText(code)
  if (row === undefined) {
    return {
      title: "Can't open this page",
      sentence: `The page at ${host} didn't load.`,
      nextStep: 'Press Reload to try again. If it keeps happening, the code below helps with a bug report.',
      code: codeText
    }
  }
  const port = origin?.kind === 'web' && origin.port !== null ? origin.port : ''
  const hint = isLoopbackOrigin(origin) && row.loopback !== null && row.loopback !== 'same' ? row.loopback : null
  return {
    title: row.title(host, fileName || 'this file', port),
    sentence: row.sentence,
    nextStep: (hint ?? row.next).replace('{host}', host),
    code: codeText
  }
}

/** The certificate page's sentence and the caution text beside **Proceed anyway**. */
export interface CertificateCopy {
  readonly sentence: string
  readonly caution: string
}

const SEVEN_DAYS = 'Erfana remembers this choice for 7 days, or until you clear browsing data.'

/**
 * The certificate page's per-code words (deck *Certificate warning* table).
 *
 * @param code - Chromium's certificate error code
 * @param host - Main's formatted host
 * @returns The sentence and the caution text
 */
export function certificateCopy(code: number, host: string): CertificateCopy {
  switch (code) {
    case -202:
      return {
        sentence: "Its certificate wasn't issued by an authority Erfana trusts – it may be self-signed.",
        caution: `If this is your own server, such as a staging site with a self-signed certificate, you can proceed. Erfana remembers this choice for ${host} for 7 days, or until you clear browsing data.`
      }
    case -201:
      return {
        sentence: "Its certificate has expired, or isn't valid yet. Check that your computer's date is right.",
        caution: `Proceed only if you know this server's certificate has lapsed – for example, a test server you look after. ${SEVEN_DAYS}`
      }
    case -200:
      return {
        sentence: `Its certificate is for a different site, not ${host}.`,
        caution: `Proceed only if you know why this certificate doesn't match – for example, a test server you set up. ${SEVEN_DAYS}`
      }
    case -206:
      return {
        sentence: 'Its certificate was withdrawn by the authority that issued it.',
        caution: `The authority that issued this certificate withdrew it, which often means it was misused. Proceed only if you're sure this is your own test server. ${SEVEN_DAYS}`
      }
    default:
      return {
        sentence: "Its certificate isn't valid.",
        caution: `Proceed only if you know why this certificate isn't valid – for example, a test server you set up. ${SEVEN_DAYS}`
      }
  }
}
