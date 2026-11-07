// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The picked element's text and source line for the prompt-actions panel
 * (spec 025, 025-FR-030, 025-FR-037; design note § Differences in the build,
 * commit 19 row "The card shows the element's selector, its text and the
 * source file:line").
 *
 * Both come from what the capture already read – the element's outer HTML
 * and its source hints – so no page function runs for them (a frozen page
 * answers none, ADR 0008). The text is page-written and is shown as page
 * text; the source is shown only when Erfana confirmed the file exists in
 * the project (`resolvedSource`, S-13), never as the page reported it.
 *
 * Linear scans only: the HTML is the page's and can be hostile.
 */
import type { SourceHints } from './sourceHints'

/** Longest element text shown, in characters (code points). */
export const PICK_TEXT_MAX_CHARS = 80

/** Elements whose content is not text a reader sees. */
const SKIPPED = ['script', 'style', 'template', 'noscript', 'svg']

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'"
}

function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,6}|#39);/gi, (whole, name: string) => {
    const known = ENTITIES[name.toLowerCase()]
    if (known !== undefined) return known
    const code = name.startsWith('#x') || name.startsWith('#X') ? Number.parseInt(name.slice(2), 16) : name.startsWith('#') ? Number(name.slice(1)) : NaN
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

/** The lower-case name of the tag that starts at `<` in `html` at `start`, or `''`. */
function tagName(html: string, start: number): string {
  let end = start + 1
  if (html[end] === '/') end += 1
  const from = end
  while (end < html.length && /[A-Za-z0-9-]/.test(html[end])) end += 1
  return html.slice(from, end).toLowerCase()
}

/**
 * The visible text of an element's outer HTML: tags, comments and the
 * content of script, style, template, noscript and svg removed, entities
 * decoded, white space collapsed, cut to {@link PICK_TEXT_MAX_CHARS} with "…".
 *
 * @param outerHtml - The element's outer HTML as the capture read it
 * @returns The text, or `null` when there is none
 */
export function elementText(outerHtml: string): string | null {
  const lower = outerHtml.toLowerCase()
  const parts: string[] = []
  let i = 0
  while (i < outerHtml.length) {
    const open = outerHtml.indexOf('<', i)
    if (open === -1) {
      parts.push(outerHtml.slice(i))
      break
    }
    parts.push(outerHtml.slice(i, open), ' ')
    if (outerHtml.startsWith('<!--', open)) {
      const close = outerHtml.indexOf('-->', open + 4)
      i = close === -1 ? outerHtml.length : close + 3
      continue
    }
    const close = outerHtml.indexOf('>', open + 1)
    if (close === -1) break
    const name = tagName(outerHtml, open)
    i = close + 1
    if (outerHtml[open + 1] !== '/' && SKIPPED.includes(name) && outerHtml[close - 1] !== '/') {
      const end = lower.indexOf(`</${name}`, i)
      i = end === -1 ? outerHtml.length : end
    }
  }
  const text = decodeEntities(parts.join('')).replace(/\s+/g, ' ').trim()
  if (text === '') return null
  const chars = Array.from(text)
  return chars.length > PICK_TEXT_MAX_CHARS ? `${chars.slice(0, PICK_TEXT_MAX_CHARS).join('').trimEnd()}…` : text
}

/**
 * The confirmed source location as `path:line` (or `path`), or `null` when
 * the source was not resolved inside the project.
 *
 * @param hints - The element's source hints
 */
export function sourceLine(hints: SourceHints): string | null {
  const resolved = hints.resolvedSource
  if (resolved === undefined) return null
  return resolved.line === undefined ? resolved.path : `${resolved.path}:${resolved.line}`
}
