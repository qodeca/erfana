// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * The claims ledger — every number a design card states, and the code that
 * derives it.
 *
 * WHY THIS EXISTS. Two reviews found nine numbers in docs/design-system/ that were simply
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
 * from the shipping source and BAKED into the card's own text by
 * scripts/design-sync.mjs (`npm run design`). `npm run design -- --check` and
 * scripts/design-claims.test.mjs re-derive it on every CI run and fail, naming
 * the card and line, when the baked text and the source disagree. A count that
 * drifts turns a silent lie into a red check. The cards run no JavaScript.
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

/**
 * Parse a CSS colour literal to { r, g, b, a } (channels 0-255, alpha 0-1).
 * Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba() in comma or space
 * syntax. Anything else throws: a contrast claim over a colour this cannot read
 * must fail, not guess.
 */
export function parseColor(color) {
  const text = String(color).trim().toLowerCase()
  if (text.startsWith('#')) {
    const hex = text.slice(1)
    if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(hex)) throw new Error(`not a colour: ${color}`)
    const full = hex.length <= 4 ? [...hex].map(c => c + c).join('') : hex
    const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16))
    const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }
  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(text)
  if (!fn) throw new Error(`not a colour: ${color}`)
  const parts = fn[1].split(/\s*[,/]\s*|\s+/).filter(Boolean)
  if (parts.length !== 3 && parts.length !== 4) throw new Error(`not a colour: ${color}`)
  const channel = part => {
    const value = part.endsWith('%') ? (parseFloat(part) / 100) * 255 : parseFloat(part)
    if (!Number.isFinite(value)) throw new Error(`not a colour: ${color}`)
    return Math.min(255, Math.max(0, value))
  }
  const alpha = part => {
    if (part === undefined) return 1
    const value = part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part)
    if (!Number.isFinite(value)) throw new Error(`not a colour: ${color}`)
    return Math.min(1, Math.max(0, value))
  }
  return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha(parts[3]) }
}

/** Source-over compositing of `top` onto an opaque `bottom`. */
export function composite(top, bottom) {
  const mix = key => top.a * top[key] + (1 - top.a) * bottom[key]
  return { r: mix('r'), g: mix('g'), b: mix('b'), a: 1 }
}

/** WCAG 2.x relative luminance of an opaque colour (sRGB, 0.04045 threshold). */
export function relativeLuminance(color) {
  const parsed = typeof color === 'string' ? parseColor(color) : color
  const [r, g, b] = [parsed.r, parsed.g, parsed.b].map(channel => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * WCAG 2.x contrast ratio, UNROUNDED. A verdict compares this raw value with the
 * bar, and a card quotes it through formatRatio(), which rounds DOWN: rounding
 * to nearest let 4.4951:1 print as "4.50:1 · pass" while it fails 4.5:1.
 *
 * A translucent foreground is composited over the background first, which is
 * what the screen shows. A translucent BACKGROUND has no single colour until it
 * sits on something, so `over` names that surface; without it this throws
 * rather than measuring against a colour nobody sees.
 */
export function contrastRatio(foreground, background, over) {
  let bg = parseColor(background)
  if (bg.a < 1) {
    if (over === undefined) {
      throw new Error(`translucent background ${background} needs an "over" surface`)
    }
    const base = parseColor(over)
    if (base.a < 1) throw new Error(`the "over" surface ${over} must be opaque`)
    bg = composite(bg, base)
  }
  let fg = parseColor(foreground)
  if (fg.a < 1) fg = composite(fg, bg)
  const a = relativeLuminance(fg)
  const b = relativeLuminance(bg)
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

/**
 * A ratio as a card quotes it: two decimals, rounded DOWN, so the printed figure
 * never overstates the raw value a verdict was judged on ("4.49", never "4.50"
 * for 4.4951). The 1e-9 absorbs float noise in an exact value such as 21.
 */
export function formatRatio(ratio) {
  return (Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2)
}

/** The shipping token file, parsed once per call site. */
export function readTokens(root) {
  return collectCustomProperties(
    readFileSync(path.join(root, 'src/renderer/src/styles/design-tokens.css'), 'utf8')
  )
}

/** Resolve `--name` (or a literal) against the token file. */
export function resolveToken(ref, props) {
  return ref.startsWith('--') ? resolveVar(`var(${ref})`, props) : ref
}

/** Contrast between two token references, with the optional `over` surface. */
export function tokenContrast(props, foreground, background, over) {
  return contrastRatio(
    resolveToken(foreground, props),
    resolveToken(background, props),
    over === undefined ? undefined : resolveToken(over, props)
  )
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
    return tokenContrast(readTokens(root), claim.foreground, claim.background, claim.over)
  },

  /** The literal a token resolves to in the shipping token file. A string. */
  token(root, claim) {
    return resolveToken(claim.token, readTokens(root))
  },

  /** One regex capture, read as a number – a breakpoint, a duration, a size
   *  that the card must quote exactly. `index` picks the Nth match across the
   *  selected files (in path order), default the first. */
  capture(root, claim) {
    const re = new RegExp(claim.match, 'gm')
    const hits = []
    for (const file of selectFiles(root, claim)) hits.push(...bodyOf(file, root).matchAll(re))
    const hit = hits[claim.index ?? 0]
    if (!hit) throw new Error(`no match number ${claim.index ?? 0} for ${claim.match}`)
    // A numeric separator (4_000) is how the source spells the number, not part of it.
    const value = Number(hit[claim.group ?? 1].replace(/_/g, ''))
    if (!Number.isFinite(value)) throw new Error(`capture "${hit[claim.group ?? 1]}" is not a number`)
    return value
  },

  /** The DISTINCT capture values themselves, sorted, as a readable list – the
   *  "which ones" next to a `distinct` count. A string; "none" when empty. */
  list(root, claim) {
    const re = new RegExp(claim.match, 'gm')
    const seen = new Set()
    for (const file of selectFiles(root, claim)) {
      for (const hit of bodyOf(file, root).matchAll(re)) seen.add(hit[claim.group ?? 1])
    }
    const sorted = [...seen].sort((a, b) =>
      Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a) - Number(b) : a < b ? -1 : 1
    )
    return sorted.length === 0 ? 'none' : sorted.join(claim.separator ?? ', ')
  },

  /** Tokens declared in design-tokens.css that nothing reads – not another
   *  token, not a stylesheet, not a script. A string list, or "none". */
  unusedTokens(root, claim) {
    const tokenFile = 'src/renderer/src/styles/design-tokens.css'
    const declared = [...readTokens(root).keys()].filter(name =>
      claim.prefix ? new RegExp(claim.prefix).test(name) : true
    )
    const bodies = selectFiles(root, claim).map(file => {
      const body = bodyOf(file, root)
      // In the token file a declaration is not a use of itself.
      return file === tokenFile ? body.replace(/(--[\w-]+)\s*:/g, ':') : body
    })
    const used = name => {
      const re = new RegExp(`${name.replace(/[-]/g, '\\-')}(?![\\w-])`)
      return bodies.some(body => re.test(body))
    }
    const unused = declared.filter(name => !used(name)).sort()
    return unused.length === 0 ? 'none' : unused.join(', ')
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
