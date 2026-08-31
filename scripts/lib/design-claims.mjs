// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * The claims ledger — every number a design card states, and the code that
 * derives it.
 *
 * WHY THIS EXISTS. Two reviews found nine numbers in design/ that were simply
 * wrong: "7 spinners at 6 speeds" (6 at 3), "all 52 files bypass the registry"
 * (50), "4 warning colours and 3 error" (transposed). Each was written to make a
 * rule credible, and a wrong number does the opposite — the first reader who
 * checks gets to reopen every decision on the card.
 *
 * They were not wrong through carelessness. They were copied from an earlier
 * summary instead of re-read from the code, and then the plan to FIX them was
 * itself reviewed and found to contain eighteen more errors of the same kind.
 * At that point "check the numbers carefully" stops being a credible remedy.
 *
 * So a card has nowhere to type a number by hand. It writes
 * `<span data-claim="spinner-keyframes"></span>`; the value is computed here
 * from the shipping source, written into the generated design/claims.js, and
 * re-derived by design/claims.test.ts on every CI run. A count that drifts turns
 * a silent lie into a red test.
 *
 * SCOPE, stated honestly. These predicates read source as TEXT. They do not
 * parse CSS or TypeScript, so a claim is only as good as its regex, and a
 * refactor that changes how something is spelled will move a number. That is
 * the intended failure: it fails loudly, in CI, naming the card — instead of
 * quietly, in a document someone is about to trust.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** Directories never worth walking for a claim. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.git', 'coverage', 'release'])

/** Every file under `dir` with one of `exts`, as repo-relative posix paths. */
export function walk(root, dir, exts) {
  const abs = path.join(root, dir)
  const found = []
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (exts.some(e => entry.name.endsWith(e))) {
        found.push(path.relative(root, full).split(path.sep).join('/'))
      }
    }
  }
  if (!statSync(abs, { throwIfNoEntry: false })) return found
  visit(abs)
  return found.sort()
}

/**
 * Strip CSS block comments.
 *
 * Not cosmetic. Several stylesheets in this repo document the very things these
 * predicates count — "three spin keyframes", a retired `z-index: 100` — inside
 * comments. Counting those would inflate every CSS claim.
 */
export function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Strip line and block comments from JS/TS, for the same reason. */
export function stripJsComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function bodyOf(file, root) {
  const text = readFileSync(path.join(root, file), 'utf8')
  return file.endsWith('.css') ? stripCssComments(text) : stripJsComments(text)
}

function selectFiles(root, claim) {
  let files = walk(root, claim.dir, claim.ext)
  if (claim.includePath) {
    const re = new RegExp(claim.includePath)
    files = files.filter(f => re.test(f))
  }
  if (claim.excludePath) {
    const re = new RegExp(claim.excludePath)
    files = files.filter(f => !re.test(f))
  }
  if (files.length === 0) {
    // A predicate that matches nothing almost always means a moved directory or
    // a typo, and it would otherwise report a confident 0.
    throw new Error(`no files selected under ${claim.dir} (${claim.ext.join(', ')})`)
  }
  return files
}

/* ---------- colour, for the contrast claims ---------- */

/** Custom properties declared in a stylesheet, last declaration winning. */
export function collectCustomProperties(css) {
  const props = new Map()
  const re = /(--[\w-]+)\s*:\s*([^;}]+)[;}]/g
  let m
  while ((m = re.exec(stripCssComments(css))) !== null) props.set(m[1], m[2].trim())
  return props
}

/** Follow a var() chain to a literal. Throws rather than guessing. */
export function resolveVar(value, props, seen = new Set()) {
  const match = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value.trim())
  if (!match) return value.trim()
  const [, name, fallback] = match
  if (seen.has(name)) throw new Error(`circular custom property: ${name}`)
  seen.add(name)
  const next = props.get(name)
  if (next === undefined) {
    if (fallback !== undefined) return resolveVar(fallback, props, seen)
    throw new Error(`undefined custom property: ${name}`)
  }
  return resolveVar(next, props, seen)
}

function parseHexColor(color) {
  const hex = color.trim().replace(/^#/, '')
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex colour: ${color}`)
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16))
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(color) {
  const [r, g, b] = parseHexColor(color).map(channel => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.x contrast ratio, rounded to two decimals — the precision a card quotes. */
export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const [light, dark] = a > b ? [a, b] : [b, a]
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
}

/* ---------- the predicate kinds ---------- */

const KINDS = {
  /** How many files match, or how many matches there are in total. */
  count(root, claim) {
    const re = new RegExp(claim.match, 'gm')
    let files = 0
    let matches = 0
    for (const file of selectFiles(root, claim)) {
      const hits = bodyOf(file, root).match(re)
      if (hits) {
        files += 1
        matches += hits.length
      }
    }
    return claim.unit === 'files' ? files : matches
  },

  /** How many DISTINCT values a capture group takes across the tree.
   *  "Six spinners at three speeds" is two different questions; this answers
   *  the second one, which is the one the Motion card is actually about. */
  distinct(root, claim) {
    const re = new RegExp(claim.match, 'gm')
    const seen = new Set()
    for (const file of selectFiles(root, claim)) {
      for (const hit of bodyOf(file, root).matchAll(re)) seen.add(hit[claim.group ?? 1])
    }
    return seen.size
  },

  /** Files matching `match` but NOT `without` — "bypasses the registry" is a
   *  claim about absence, and absence needs both halves stated. */
  countWithout(root, claim) {
    const has = new RegExp(claim.match, 'm')
    const lacks = new RegExp(claim.without, 'm')
    let total = 0
    for (const file of selectFiles(root, claim)) {
      const body = bodyOf(file, root)
      if (has.test(body) && !lacks.test(body)) total += 1
    }
    return total
  },

  /** A WCAG ratio, computed from the shipping tokens. Never asserted. */
  contrast(root, claim) {
    const props = collectCustomProperties(
      readFileSync(path.join(root, 'src/renderer/src/styles/design-tokens.css'), 'utf8')
    )
    const read = ref => (ref.startsWith('--') ? resolveVar(`var(${ref})`, props) : ref)
    return contrastRatio(read(claim.foreground), read(claim.background))
  }
}

/** Evaluate every claim in the ledger. Throws naming the claim that failed, so
 *  a broken predicate is never silently reported as a value. */
export function evaluate(root, ledger) {
  const values = {}
  for (const [id, claim] of Object.entries(ledger)) {
    const kind = KINDS[claim.kind]
    if (!kind) throw new Error(`claim "${id}": unknown kind "${claim.kind}"`)
    try {
      values[id] = kind(root, claim)
    } catch (cause) {
      throw new Error(`claim "${id}" failed to evaluate: ${cause.message}`, { cause })
    }
  }
  return values
}
