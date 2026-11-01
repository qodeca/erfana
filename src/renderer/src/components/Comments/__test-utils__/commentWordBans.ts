// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** The words each preview may not show (spec 024 024-AC-008, 024-FR-007), for the word tests. Test-only. */

/**
 * The words no Markdown string may hold (024-AC-008): "element", "page",
 * "block" outside "code block" and "block quote", a bare tag as a word, "pin"
 * or "pick" as nouns, and "section" outside "collapsed section" and "HTML
 * section" (I-26: the HTML `{kind}` word).
 *
 * @param text - A sentence the Markdown Preview shows.
 * @returns What it holds, empty when it is clean.
 */
export function bannedMarkdownWords(text: string): string[] {
  const found: string[] = []
  if (/\belements?\b/i.test(text)) found.push('element')
  if (/\bpages?\b/i.test(text)) found.push('page')
  if (/\bblocks?\b/i.test(text.replace(/\bcode blocks?\b/gi, '').replace(/\bblock quotes?\b/gi, ''))) found.push('block')
  const bareTag = /\b(?:p|li|ul|ol|tr|td|th|pre|hr|img|div|blockquote|h[1-6])\b/.exec(text.replace(/\bH[1-6] heading/g, ''))
  if (bareTag !== null) found.push(`tag ${bareTag[0]}`)
  if (/\b(?:a|the|this|your|each)\s+(?:pins?|picks?)\b/i.test(text) || /\bpins?\b/i.test(text)) found.push('pin/pick noun')
  if (/\bsections?\b/i.test(text.replace(/\bcollapsed sections?\b/gi, '').replace(/\bHTML section\b/g, ''))) found.push('section')
  return found
}

/**
 * The words no HTML string may hold: "element" and "thread" gave way to
 * "section" and "conversation" (owner decision, 2026-10-31), the "this" title
 * to the plain kind word (2026-11-01), and a selector shows on hover only.
 *
 * @param text - A sentence the HTML Preview shows.
 * @returns What it holds, empty when it is clean.
 */
export function bannedHtmlWords(text: string): string[] {
  const found: string[] = []
  if (/\belements?\b/i.test(text)) found.push('element')
  if (/\bthreads?\b/i.test(text)) found.push('thread')
  if (/\bpins?\b/i.test(text)) found.push('pin')
  if (/\bblocks?\b/i.test(text)) found.push('block')
  if (/\b(?:comments?) on this section\b/i.test(text)) found.push('this section')
  if (/(?:^|\s)[a-z][a-z0-9-]*[#.][a-z_-][\w-]*(?=$|[\s,])/.test(text.replace(/\S+\.(?:html?|md)\b/g, ''))) found.push('selector')
  return found
}
