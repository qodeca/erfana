// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure decisions behind the browser panel and its editor tab (spec 025,
 * 025-FR-002, 025-FR-003, 025-FR-004; design `docs/designs/browser/README.md`
 * copy deck and Security UI rules 1–2). No React, no IPC.
 *
 * Every origin shown here comes from main's formatter (`state.origin`, from
 * `originFormat.ts`): the renderer never parses a host itself, so the
 * registrable domain is the one the public-suffix list gave.
 */
import {
  hostText,
  originParts,
  originText,
  type WebOriginParts
} from '../../../../../shared/browser/originFormat'
import type {
  NavigateResponse,
  OriginPartsPayload
} from '../../../../../shared/ipc/browser-tab-schema'
import type { BrowserTabState } from '../../../stores/useBrowserTabStore'
import { NEW_BROWSER_TAB_TITLE } from '../../../utils/openBrowserTab'
import { getBasename } from '../../../utils/fileUtils'

/** The address shown: the pending one for a navigation the user started, else the committed one (025-FR-002). */
export function shownAddress(state: BrowserTabState | null): string | null {
  if (state === null) return null
  return state.pendingUrl ?? state.committedUrl
}

/** The last path segment of a `file:` URL, decoded; `''` when there is none. */
function fileName(url: string): string {
  try {
    // A URL path always uses `/`; getBasename also accepts it.
    return getBasename(decodeURIComponent(new URL(url).pathname))
  } catch {
    return ''
  }
}

/**
 * The editor tab's label (025-FR-004, deck *Browser tab*): the page title;
 * while there is none, the formatted host with no path (a local file: its
 * name); an empty tab reads "New browser tab".
 *
 * @param state - The tab's newest state, or `null` before the first
 * @returns The label text (shown inside `<bdi dir="auto">`)
 *
 * @example
 * ```ts
 * tabLabel({ ...state, title: '', origin: { kind: 'web', scheme: 'http', subdomain: '', registrableDomain: 'localhost', port: '5173', punycode: false } })
 * // 'localhost'
 * ```
 */
export function tabLabel(state: BrowserTabState | null): string {
  if (state === null || state.erfanaPage === 'empty') return NEW_BROWSER_TAB_TITLE
  if (state.title !== '') return state.title
  return originLabel(state.origin, shownAddress(state)) ?? NEW_BROWSER_TAB_TITLE
}

function originLabel(origin: OriginPartsPayload | null, address: string | null): string | null {
  if (origin === null) return null
  if (origin.kind === 'web') return hostText(origin)
  if (origin.kind === 'file') return (address === null ? '' : fileName(address)) || 'Local file'
  return `${origin.scheme}:`
}

/**
 * The editor tab's tooltip (deck *Browser tab – Tooltip*): line 1 the address
 * through the formatter, line 2 "Title: {title}" when there is a title.
 *
 * @param state - The tab's newest state
 * @returns The tooltip, lines joined with `\n`; `''` for an empty tab
 */
export function tabTooltip(state: BrowserTabState | null): string {
  if (state === null || state.erfanaPage === 'empty') return NEW_BROWSER_TAB_TITLE
  const address = addressLine(state.origin, shownAddress(state))
  const lines = [address, state.title === '' ? '' : `Title: ${state.title}`].filter(
    line => line !== ''
  )
  return lines.join('\n')
}

function addressLine(origin: OriginPartsPayload | null, address: string | null): string {
  if (origin?.kind === 'web')
    return `${originText(origin)}${address === null ? '' : pathOf(address)}`
  return address ?? ''
}

/** Path, query and fragment of an address (`/` alone is dropped). */
export function pathOf(address: string): string {
  try {
    const url = new URL(address)
    const rest = `${url.pathname}${url.search}${url.hash}`
    return rest === '/' ? '' : rest
  } catch {
    return ''
  }
}

/** The address bar's resting display, split for the origin field's emphasis (design § Address bar). */
export type AddressDisplay =
  | { readonly kind: 'web'; readonly parts: WebOriginParts; readonly path: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'empty' }

/**
 * What the address bar shows while it is not being edited.
 *
 * @param state - The tab's newest state
 * @returns The display parts; `empty` for an empty tab (the placeholder shows)
 */
export function addressDisplay(state: BrowserTabState | null): AddressDisplay {
  const address = shownAddress(state)
  if (state === null || address === null) return { kind: 'empty' }
  const origin = state.origin
  if (origin?.kind === 'web') return { kind: 'web', parts: origin, path: pathOf(address) }
  if (origin?.kind === 'nonWeb') return { kind: 'text', text: `${origin.scheme}:` }
  return { kind: 'text', text: address }
}

/** The address bar's badge (deck *Badge – …*), or `null` when none shows. */
export interface SecurityBadge {
  readonly word: string
  readonly description: string
  /** `circle-alert` for remote `http`, `triangle-alert` for certificate states, `file` for a local file. */
  readonly icon: 'circle-alert' | 'triangle-alert' | 'file'
  readonly tone: 'warning' | 'error' | 'neutral'
}

const NOT_SECURE = 'Not secure'
const CERT_UNTRUSTED = "Not secure – this site's certificate isn't trusted."

/**
 * The badge for a security state (design § Address bar, deck rows).
 *
 * @param security - `state.security`
 * @returns The badge, or `null` for `secure` and `local` (no badge)
 */
export function securityBadge(security: BrowserTabState['security']): SecurityBadge | null {
  switch (security) {
    case 'notSecureHttp':
      return {
        word: NOT_SECURE,
        description:
          "Not secure – this page isn't encrypted, so others on the network can see or change it.",
        icon: 'circle-alert',
        tone: 'warning'
      }
    case 'warningUp':
      return {
        word: NOT_SECURE,
        description: CERT_UNTRUSTED,
        icon: 'triangle-alert',
        tone: 'error'
      }
    case 'proceeded':
      return {
        word: NOT_SECURE,
        description: `${CERT_UNTRUSTED} You chose Proceed anyway.`,
        icon: 'triangle-alert',
        tone: 'error'
      }
    case 'subresourceFailed':
      return {
        word: NOT_SECURE,
        description:
          "Not secure – part of this page came from a server whose certificate isn't trusted.",
        icon: 'triangle-alert',
        tone: 'error'
      }
    case 'file':
      return { word: 'File', description: 'Local file', icon: 'file', tone: 'neutral' }
    default:
      return null
  }
}

/** A Windows drive path such as `C:\site\index.html` (rule 6 of 025-FR-002). */
const WINDOWS_PATH = /^[A-Za-z]:[\\/]/

/**
 * The inline message for an address main refused (deck *Refused addresses*),
 * or `null` when the answer is not a refusal.
 *
 * @param response - `navigate`'s answer
 * @param input - What the user typed (trimmed)
 * @returns The sentence shown under the navigation row
 *
 * @example
 * ```ts
 * refusedMessage({ refused: 'scheme' }, 'C:\\site\\index.html')
 * // "That's a Windows file path. Type it as file:///C:/site/index.html to open it."
 * ```
 */
export function refusedMessage(response: NavigateResponse, input: string): string | null {
  if (!('refused' in response)) return null
  switch (response.refused) {
    case 'scheme':
      if (WINDOWS_PATH.test(input)) {
        return `That's a Windows file path. Type it as file:///${input.replace(/\\/g, '/')} to open it.`
      }
      return `Browser tabs can't open ${schemeOf(input)} addresses. Type an address that starts with http://, https:// or file://.`
    case 'network-path':
      return "Browser tabs can't open files on a network share. Copy the file into the project and open it from there."
    case 'app-entry':
      return "Browser tabs can't open Erfana's own files."
    case 'local-file':
      return "Browser tabs can't open this file."
  }
}

function schemeOf(input: string): string {
  const colon = input.indexOf(':')
  return colon > 0 ? input.slice(0, colon + 1).toLowerCase() : 'these'
}

/** The navigation group's description while Back and/or Forward are disabled (deck *Nav group description*). */
export function navGroupDescription(canGoBack: boolean, canGoForward: boolean): string | null {
  if (!canGoBack && !canGoForward) return 'No earlier or later page'
  if (!canGoBack) return 'No earlier page'
  if (!canGoForward) return 'No later page'
  return null
}

/**
 * An address for a row, through the origin formatter (Security rule 2). The
 * renderer has no public-suffix list, so the whole host counts as the
 * registrable domain here – nothing is dimmed, nothing is cut.
 */
export function rowAddress(url: string): string {
  const parts = originParts(url, () => null)
  return parts?.kind === 'web' ? `${originText(parts)}${pathOf(url)}` : url
}
