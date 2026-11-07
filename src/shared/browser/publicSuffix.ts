// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Public Suffix List algorithm (https://github.com/publicsuffix/list/wiki/Format),
 * over a list given as text (spec 025, design OD-1, owner question Q10).
 *
 * The registrable domain – the public suffix plus one label, for example
 * `example.co.uk` – is the part of a host the origin formatter never cuts and
 * draws emphasised. This module only implements the algorithm; the pinned
 * list itself is `publicSuffixList.dat`, read by `publicSuffixList.ts`.
 *
 * Both the ICANN and the private sections count, as in browsers, so
 * `user.github.io` is its own site. Lookups take a host in its ASCII form, as
 * the URL parser produces it; Unicode rules are encoded once at parse time.
 */
import { labelToAscii } from './punycode'

/** The parsed list: plain rules, wildcard parents (`*.x` stored as `x`) and exceptions (`!x` as `x`). */
export interface PublicSuffixRules {
  readonly exact: ReadonlySet<string>
  readonly wildcard: ReadonlySet<string>
  readonly exception: ReadonlySet<string>
}

function toAsciiRule(rule: string): string | null {
  const labels = rule.toLowerCase().split('.')
  const ascii = labels.map(l => (l === '*' ? l : labelToAscii(l)))
  return ascii.every((l): l is string => l !== null && l.length > 0) ? ascii.join('.') : null
}

/**
 * Parse list text in the upstream format: one rule per line, the rule ends at
 * the first white space, lines starting with `//` and blank lines are skipped.
 * A rule that cannot be encoded is skipped rather than failing the whole list.
 */
export function parsePublicSuffixList(text: string): PublicSuffixRules {
  const exact = new Set<string>()
  const wildcard = new Set<string>()
  const exception = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const token = line.trim().split(/\s/)[0] ?? ''
    if (token === '' || token.startsWith('//')) continue
    const isException = token.startsWith('!')
    const rule = toAsciiRule(isException ? token.slice(1) : token)
    if (rule === null) continue
    if (isException) exception.add(rule)
    else if (rule.startsWith('*.')) wildcard.add(rule.slice(2))
    else if (!rule.includes('*')) exact.add(rule)
  }
  return { exact, wildcard, exception }
}

/**
 * The public suffix of an ASCII host: the prevailing rule of the list, or the
 * last label when no rule matches (the implicit `*` rule).
 */
export function publicSuffixOf(asciiHost: string, rules: PublicSuffixRules): string {
  const labels = normaliseHost(asciiHost).split('.')
  const suffixFrom = (i: number): string => labels.slice(i).join('.')
  // An exception prevails over every other rule; its suffix drops its first label.
  for (let i = 0; i < labels.length; i++) {
    if (rules.exception.has(suffixFrom(i))) return suffixFrom(i + 1)
  }
  // Otherwise the matching rule with the most labels prevails.
  for (let i = 0; i < labels.length; i++) {
    if (rules.exact.has(suffixFrom(i))) return suffixFrom(i)
    if (i + 1 < labels.length && rules.wildcard.has(suffixFrom(i + 1))) return suffixFrom(i)
  }
  return labels[labels.length - 1] ?? ''
}

/**
 * The registrable domain of an ASCII host: its public suffix plus one label.
 * `null` when the host is itself a public suffix (for example `co.uk`) or is
 * empty. IP addresses and single-label hosts are not domains; callers handle
 * them before asking (see `originFormat.ts`).
 */
export function registrableDomainOf(asciiHost: string, rules: PublicSuffixRules): string | null {
  const host = normaliseHost(asciiHost)
  if (host === '') return null
  const suffix = publicSuffixOf(host, rules)
  if (host === suffix) return null
  const labels = host.split('.')
  const suffixLabels = suffix.split('.').length
  return labels.slice(labels.length - suffixLabels - 1).join('.')
}

/** Lower case, without one trailing dot (a fully-qualified host). */
function normaliseHost(host: string): string {
  const lower = host.toLowerCase()
  return lower.endsWith('.') ? lower.slice(0, -1) : lower
}
