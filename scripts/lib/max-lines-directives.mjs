// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Finds the inline ESLint directives that switch `max-lines` off, for
// scripts/check-max-lines.mjs (docs/technical-debt.md #26).
//
// ESLint reads a directive from a whole comment: a block comment from `/*` to
// the next `*/`, however many lines it spans, or a line comment to the end of
// its line. The comment text, trimmed, must start with the directive. So each
// comment is read as one piece and reported at the line it starts on: a
// `/* eslint-disable no-console,` line followed by a `max-lines */` line is one
// directive that names max-lines.
//
// No parser: every `/*` and `//` in the file is taken as a possible comment
// start, including one inside a string or inside another comment. That can
// only add candidates, so a real comment is never skipped; a false match needs
// text that itself reads as a max-lines directive.
//
// The file content is contributor-controlled, so the work is linear in its
// size: the search for each `*/` resumes where the last one ended, and at most
// MAX_DIRECTIVE_CHARS of a comment are read, and only of one that starts with
// `eslint`. The regexes have no nested quantifiers.

// ESLint's line-break pattern (eslint/lib/shared/ast-utils.js)
export const LINE_BREAK = /\r\n|[\r\n\u2028\u2029]/u
const LINE_BREAKS = new RegExp(LINE_BREAK.source, 'gu')
// A rule list longer than this is a comment of thousands of characters, which
// review sees; the cap only bounds the work on a file full of `/*` in strings.
const MAX_DIRECTIVE_CHARS = 2000
const SPACE = /\s/
// The keyword a directive starts with, and the ` -- ` that ends its rule list
const DIRECTIVE = /^(eslint-disable(?:-next-line|-line)?|eslint)(?:\s|$)/
const DESCRIPTION = /\s-{2,}\s/
const RULE_SEPARATOR = /[\s,:"'[\]{}]+/

/**
 * True when one comment's text is a directive that switches max-lines off or
 * reconfigures it: an `eslint-disable…` naming it or naming no rule (which
 * switches every rule off), or an inline `eslint` config naming it.
 */
export function touchesMaxLines(comment) {
  const body = comment.trimStart()
  const match = DIRECTIVE.exec(body)
  if (!match) return false
  const [ruleText] = body.slice(match[1].length).split(DESCRIPTION)
  const rules = ruleText.split(RULE_SEPARATOR).filter(Boolean)
  if (match[1] !== 'eslint' && rules.length === 0) return true
  return rules.includes('max-lines')
}

// Where each line starts and ends (before its line break), by offset
function lineTable(text) {
  const starts = [0]
  const ends = []
  for (const brk of text.matchAll(LINE_BREAKS)) {
    ends.push(brk.index)
    starts.push(brk.index + brk[0].length)
  }
  ends.push(text.length)
  return { starts, ends }
}

// The 0-based line holding `offset`
function lineIndex(starts, offset) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

// True when the comment text from `from` to `to` is a max-lines directive.
// Leading space is skipped first, so only text starting `eslint` is sliced.
function isMaxLinesDirective(text, from, to) {
  let at = from
  while (at < to && SPACE.test(text[at])) at++
  if (!text.startsWith('eslint', at)) return false
  return touchesMaxLines(text.slice(at, Math.min(to, at + MAX_DIRECTIVE_CHARS)))
}

/** 1-based start lines of every comment in `text` that switches max-lines off. */
export function findMaxLinesDirectives(text) {
  if (!text.includes('eslint')) return []
  const { starts, ends } = lineTable(text)
  const found = new Set()
  let close = -1
  for (let at = text.indexOf('/*'); at !== -1; at = text.indexOf('/*', at + 2)) {
    if (close < at + 2) {
      const next = text.indexOf('*/', at + 2)
      close = next === -1 ? text.length : next
    }
    if (isMaxLinesDirective(text, at + 2, close)) found.add(lineIndex(starts, at) + 1)
  }
  for (let at = text.indexOf('//'); at !== -1; at = text.indexOf('//', at + 2)) {
    const line = lineIndex(starts, at)
    if (isMaxLinesDirective(text, at + 2, ends[line])) found.add(line + 1)
  }
  return [...found].sort((a, b) => a - b)
}
