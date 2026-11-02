// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Address-bar input rules for the built-in browser (spec 025, 025-FR-002).
 *
 * The rules are applied in table order after trimming; the first match wins.
 * This module only classifies text – it never loads anything and never talks
 * to a remote service, so nothing about typed text leaves the machine before
 * Enter (025-FR-002).
 */

/** The search service of rule 8. Receives the typed text only after Enter. */
export const SEARCH_URL_PREFIX = 'https://duckduckgo.com/?q='

export type AddressRule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export type AddressDecision =
  | { readonly kind: 'load'; readonly url: string; readonly rule: 1 | 2 | 3 | 4 | 5 }
  | { readonly kind: 'refused'; readonly reason: 'scheme' | 'network-path'; readonly rule: 6 | 7 }
  | { readonly kind: 'search'; readonly url: string; readonly rule: 8 }

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4 = `${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}`
/** Rest of an address after host and port: a path, query or fragment, no spaces. */
const REST = '(?:[/?#]\\S*)?'
const PORT = '(\\d{1,5})'

const RULE_1 = /^(?:https?|file):\/\//i
const RULE_2 = new RegExp(`^\\[[0-9a-fA-F:.]+\\](?::${PORT})?${REST}$`)
const RULE_3 = new RegExp(
  `^(?:localhost|[A-Za-z0-9-]+\\.localhost|${IPV4}|[A-Za-z0-9-]+):${PORT}${REST}$`,
  'i'
)
const RULE_4 = new RegExp(`^(?:localhost|${IPV4})${REST}$`, 'i')
const RULE_5 = new RegExp(`^[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+(?::${PORT})?(?:/\\S*)?$`)
const RULE_6 = /^[A-Za-z0-9+.-]+:/
const RULE_7 = /^(?:\\\\|\/\/)/

function portOk(port: string | undefined): boolean {
  if (port === undefined) return true
  const n = Number(port)
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

/**
 * Classify what the user typed into the address bar (025-FR-002).
 * `load` results carry the address to navigate to; `refused` results are shown
 * as an inline message (025-FR-005) and never searched; everything else
 * becomes a DuckDuckGo search.
 */
export function classifyAddressInput(raw: string): AddressDecision {
  const input = raw.trim()

  if (RULE_1.test(input)) return { kind: 'load', url: input, rule: 1 }

  const has = (re: RegExp): RegExpMatchArray | null => (/\s/.test(input) ? null : input.match(re))

  const m2 = has(RULE_2)
  if (m2 && portOk(m2[1])) return { kind: 'load', url: `http://${input}`, rule: 2 }

  const m3 = has(RULE_3)
  if (m3 && portOk(m3[1])) return { kind: 'load', url: `http://${input}`, rule: 3 }

  if (has(RULE_4)) return { kind: 'load', url: `http://${input}`, rule: 4 }

  const m5 = has(RULE_5)
  if (m5 && portOk(m5[1])) return { kind: 'load', url: `https://${input}`, rule: 5 }

  if (RULE_6.test(input)) return { kind: 'refused', reason: 'scheme', rule: 6 }
  if (RULE_7.test(input)) return { kind: 'refused', reason: 'network-path', rule: 7 }

  return { kind: 'search', url: `${SEARCH_URL_PREFIX}${encodeURIComponent(input)}`, rule: 8 }
}
