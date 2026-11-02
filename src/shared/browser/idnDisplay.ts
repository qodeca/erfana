// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Whether an internationalised host may be shown in Unicode (spec 025, panel
 * finding S9, owner question Q10; design Security UI rule 3).
 *
 * A host is shown in Unicode only when **every** label passes; otherwise the
 * whole host is shown in its ASCII (`xn--`) form. A label passes when:
 *
 * 1. it decodes as valid punycode and re-encodes to the same text;
 * 2. it holds only letters, combining marks, decimal digits and `-` – no
 *    symbol, punctuation, space or invisible character that could pass for a
 *    dot or a slash;
 * 3. its scripts (ignoring Common and Inherited) form one script, or one of
 *    the UTS #39 "highly restrictive" combinations: Latin with Han and
 *    Hiragana / Katakana (Japanese), Latin with Han and Bopomofo (Chinese),
 *    Latin with Han and Hangul (Korean);
 * 4. it is not a whole-script confusable: a Cyrillic or Greek label made only
 *    of letters that look like Latin letters (`аррӏе`) passes only under a
 *    top-level domain in that same script.
 *
 * Then the host as a whole fails when the skeleton of its registrable domain
 * (look-alikes mapped to Latin, accents removed) equals one of a short list of
 * often-imitated domains while the host is not that domain itself.
 *
 * This is a deliberately small subset of UTS #39 and Chromium's IDN spoof
 * checker, aimed at the confusions a reviewer is most likely to meet.
 */
import { ACE_PREFIX, labelToAscii, labelToUnicode } from './punycode'

const ALLOWED_CHARACTER = /^[\p{L}\p{M}\p{Nd}-]$/u
const IGNORED_SCRIPTS = /^[\p{Script=Common}\p{Script=Inherited}]$/u

/** Scripts checked, each with a test for one character. */
const SCRIPTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Han', /\p{Script=Han}/u],
  ['Hiragana', /\p{Script=Hiragana}/u],
  ['Katakana', /\p{Script=Katakana}/u],
  ['Bopomofo', /\p{Script=Bopomofo}/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Hebrew', /\p{Script=Hebrew}/u]
]

/** The UTS #39 "highly restrictive" multi-script sets. */
const ALLOWED_SCRIPT_SETS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['Latin', 'Han', 'Hiragana', 'Katakana']),
  new Set(['Latin', 'Han', 'Bopomofo']),
  new Set(['Latin', 'Han', 'Hangul'])
]

/** Cyrillic and Greek letters that look like a Latin letter, with that letter. */
const LATIN_LOOKALIKES: Readonly<Record<string, string>> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's',
  һ: 'h', ԁ: 'd', ԛ: 'q', ԝ: 'w', ӏ: 'l', к: 'k', ь: 'b', т: 't', м: 'm', п: 'n',
  ο: 'o', ν: 'v', ι: 'i', κ: 'k', ρ: 'p', υ: 'u', α: 'a', χ: 'x', ε: 'e', τ: 't',
  ı: 'i', ɑ: 'a', ɡ: 'g', ɩ: 'i', ʏ: 'y'
}

/**
 * Registrable-domain names that are often imitated. The skeleton check
 * compares against the label before the public suffix, so `google` covers
 * every `google.*`.
 */
export const IMITATED_NAMES: ReadonlySet<string> = new Set([
  'amazon', 'anthropic', 'apple', 'bing', 'claude', 'cloudflare', 'dropbox', 'facebook',
  'github', 'gitlab', 'gmail', 'google', 'icloud', 'instagram', 'linkedin', 'live',
  'microsoft', 'netflix', 'npmjs', 'office', 'openai', 'outlook', 'paypal', 'stackoverflow',
  'twitter', 'vercel', 'whatsapp', 'wikipedia', 'yahoo', 'youtube'
])

function scriptOf(ch: string): string | null {
  if (IGNORED_SCRIPTS.test(ch)) return null
  for (const [name, re] of SCRIPTS) if (re.test(ch)) return name
  return 'Other'
}

function scriptsOf(label: string): Set<string> {
  const scripts = new Set<string>()
  for (const ch of label) {
    const s = scriptOf(ch)
    if (s !== null) scripts.add(s)
  }
  return scripts
}

function scriptSetAllowed(scripts: Set<string>): boolean {
  if (scripts.size <= 1) return true
  return ALLOWED_SCRIPT_SETS.some(allowed => [...scripts].every(s => allowed.has(s)))
}

/** True when every letter of `label` is a Latin look-alike (and there is at least one). */
function isWholeScriptConfusable(label: string): boolean {
  const letters = [...label].filter(ch => /\p{L}/u.test(ch))
  return letters.length > 0 && letters.every(ch => ch in LATIN_LOOKALIKES)
}

/** Latin skeleton: look-alikes mapped, accents and marks removed, lower case. */
export function latinSkeleton(text: string): string {
  const mapped = [...text.toLowerCase()].map(ch => LATIN_LOOKALIKES[ch] ?? ch).join('')
  return mapped.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Whether one decoded label may be shown in Unicode under the given top-level label. */
function labelPasses(ascii: string, unicode: string, tldScripts: Set<string>): boolean {
  if (labelToAscii(unicode) !== ascii) return false
  if (![...unicode].every(ch => ALLOWED_CHARACTER.test(ch))) return false
  const scripts = scriptsOf(unicode)
  if (!scriptSetAllowed(scripts)) return false
  const only = scripts.size === 1 ? [...scripts][0] : null
  if ((only === 'Cyrillic' || only === 'Greek') && isWholeScriptConfusable(unicode)) {
    return tldScripts.size === 1 && tldScripts.has(only)
  }
  return true
}

/**
 * The host to display: its Unicode form when every label passes the checks
 * above, otherwise the ASCII host unchanged. `asciiHost` is lower-case ASCII,
 * as the URL parser gives it; `registrableDomain` is its registrable domain in
 * ASCII (or `null`), for the imitation check.
 */
export function displayHost(asciiHost: string, registrableDomain: string | null): string {
  const labels = asciiHost.split('.')
  if (!labels.some(l => l.startsWith(ACE_PREFIX))) return asciiHost
  const decoded = labels.map(labelToUnicode)
  if (decoded.some(l => l === null)) return asciiHost
  const unicode = decoded as string[]
  const tldScripts = scriptsOf(unicode[unicode.length - 1] ?? '')
  if (!labels.every((l, i) => labelPasses(l, unicode[i], tldScripts))) return asciiHost
  if (registrableDomain !== null && imitatesKnownName(asciiHost, registrableDomain)) return asciiHost
  return unicode.join('.')
}

/** True when the registrable domain is non-ASCII and its skeleton is an imitated name. */
function imitatesKnownName(asciiHost: string, registrableDomain: string): boolean {
  const hostLabels = asciiHost.split('.')
  const nameLabel = hostLabels[hostLabels.length - registrableDomain.split('.').length]
  if (nameLabel === undefined || !nameLabel.startsWith(ACE_PREFIX)) return false
  const unicode = labelToUnicode(nameLabel)
  return unicode !== null && IMITATED_NAMES.has(latinSkeleton(unicode))
}
