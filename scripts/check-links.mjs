#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Offline link, anchor and wording check for the repository's Markdown (#138).
 *
 *   npm run check:links          # the default scope; exit 1 on any finding
 *   npm run check:links -- --all # every tracked .md file, warnings only, exit 0
 *
 * Checks, for every relative link and image in scope: the target exists (with
 * the exact case GitHub will use), and a `#anchor` matches a heading slug (or an
 * explicit HTML id) in the target Markdown file. Inside `docs/user-guide/` it
 * also refuses wording that claims Erfana has built-in AI (see WORDING_RULES).
 * External URLs are never fetched: the check makes no network calls.
 *
 * This is a trust boundary: it reads contributor-controlled Markdown, and the
 * local gate runs it (`.xezar/checks/repository-checks.sh`). Each threat and
 * what bounds it (spec docs/features/138-user-guide.md § 3.4):
 *
 * - Symlink escaping the repository: the file list comes from `git ls-files`,
 *   never a directory walk. A link target is resolved lexically against the
 *   repository root first, and anything outside is reported WITHOUT touching
 *   the file system. Inside, `resolveInside` walks the path one component at a
 *   time with `readdir`/`lstat` of directories inside the root only, and
 *   resolves each symlink with `readlink` plus the same lexical check. That is
 *   stricter than `realpath`, which would itself follow a link out of the root
 *   and stat what is there. Files being scanned go through the same walk.
 * - Existence probe: absolute paths, `file:` URLs, `~`, backslashes and
 *   percent-encoded `..` (decoded before the lexical check) are rejected
 *   without any fs call. Findings print the link as written, never file content.
 * - ReDoS: no regular expression with nested quantifiers. Links are found by a
 *   linear hand-written scanner over `[`, `](`, `)`, `<` and `>`; words for the
 *   wording rule by a linear character scanner; heading slugs use one
 *   character-class replace. Lines over MAX_LINE_CHARS are reported and skipped.
 * - Unbounded recursion: none. A flat loop over the `git ls-files` list, no
 *   include-following; symlink chains stop after MAX_SYMLINK_HOPS.
 * - Input size: files over MAX_FILE_BYTES are reported and skipped.
 */

import nodeFs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_LINE_CHARS = 10_000
const MAX_SYMLINK_HOPS = 40

/** Pages always in the default scope, besides `docs/user-guide/**`. */
export const SCOPE_FILES = [
  // The five user pages the guide folds in (design § What moves out of the old user docs).
  'docs/getting-started.md',
  'docs/quick-reference.md',
  'docs/keyboard-shortcuts.md',
  'docs/troubleshooting.md',
  'docs/settings.md',
  // Pages that link into the guide or name its pages.
  'docs/README.md',
  'CLAUDE.md',
  'BACKWARD_COMPATIBILITY.md',
  'docs/features/README.md'
]
const GUIDE_DIR = 'docs/user-guide/'
const DESIGN_DIR = 'docs/designs/138-user-guide/'

/**
 * Phrases that claim Erfana itself is, or contains, an AI. Erfana hosts CLI
 * agents in its terminal; it has no built-in AI (CLAUDE.md, AC7). A phrase is
 * allowed when negated (see isNegated). Lower case, split into words the same
 * way the scanner splits prose.
 */
export const WORDING_RULES = [
  // "an AI-powered editor": says the AI is part of Erfana.
  { phrase: 'AI-powered', words: ['ai-powered'] },
  // "Erfana's AI": gives Erfana an AI of its own.
  { phrase: "Erfana's AI", words: ["erfana's", 'ai'] },
  // "AI prompts": the old context-menu wording (#144); they are prompt templates sent to the agent.
  { phrase: 'AI prompts', words: ['ai', 'prompts'] },
  // "AI assistant": reads as an assistant that ships with the app.
  { phrase: 'AI assistant', words: ['ai', 'assistant'] },
  // "built-in AI": the exact claim the project rule forbids.
  { phrase: 'built-in AI', words: ['built-in', 'ai'] }
]

/** Words that negate a phrase when they sit in the window before it. */
const NEGATORS = new Set(['no', 'not', 'never', 'without', 'nor'])
/** "not just", "not only", "no longer" qualify rather than negate. */
const NOT_A_NEGATION = new Map([
  ['not', new Set(['just', 'only'])],
  ['no', new Set(['longer'])]
])
const NEGATION_WINDOW = 8
/** Characters that end the negation window: a sentence end or a table cell border. */
const WINDOW_BREAKS = new Set(['.', '!', '?', ';', ':', '|'])

// ---------------------------------------------------------------------------
// Markdown structure
// ---------------------------------------------------------------------------

/** A line that opens or closes a fenced code block: up to 3 spaces, then ``` or ~~~. */
function fenceOf(line) {
  let i = 0
  while (i < 3 && line[i] === ' ') i++
  const ch = line[i]
  if (ch !== '`' && ch !== '~') return null
  let n = 0
  while (line[i + n] === ch) n++
  return n >= 3 ? { ch, n, rest: line.slice(i + n) } : null
}

/**
 * Split Markdown into lines and mark what each one is: inside YAML frontmatter,
 * inside a fenced code block, or prose. HTML comment text is blanked out of
 * prose lines (GitHub does not render it). Over-long lines are marked and
 * blanked so no later stage reads them.
 *
 * @returns {{ lines: Array<{ text: string, code: boolean, long: boolean }> }}
 */
export function splitLines(markdown) {
  const raw = markdown.split('\n')
  const lines = []
  let fence = null
  let inComment = false
  let inFrontmatter = raw[0] !== undefined && raw[0].trimEnd() === '---'
  for (let n = 0; n < raw.length; n++) {
    let text = raw[n].endsWith('\r') ? raw[n].slice(0, -1) : raw[n]
    if (text.length > MAX_LINE_CHARS) {
      lines.push({ text: '', code: false, long: true })
      continue
    }
    if (inFrontmatter) {
      lines.push({ text: '', code: true, long: false })
      if (n > 0 && (text.trimEnd() === '---' || text.trimEnd() === '...')) inFrontmatter = false
      continue
    }
    if (fence) {
      const f = fenceOf(text)
      if (f && f.ch === fence.ch && f.n >= fence.n && f.rest.trim() === '') fence = null
      lines.push({ text, code: true, long: false })
      continue
    }
    if (!inComment) {
      const f = fenceOf(text)
      if (f && !(f.ch === '`' && f.rest.includes('`'))) {
        fence = f
        lines.push({ text, code: true, long: false })
        continue
      }
    }
    // Blank out HTML comments, which may span lines.
    let out = ''
    let i = 0
    while (i < text.length) {
      if (inComment) {
        const end = text.indexOf('-->', i)
        if (end === -1) {
          out += ' '.repeat(text.length - i)
          i = text.length
        } else {
          out += ' '.repeat(end + 3 - i)
          i = end + 3
          inComment = false
        }
      } else {
        const start = text.indexOf('<!--', i)
        if (start === -1) {
          out += text.slice(i)
          i = text.length
        } else {
          out += text.slice(i, start)
          i = start
          inComment = true
        }
      }
    }
    lines.push({ text: out, code: false, long: false })
  }
  return { lines }
}

// ---------------------------------------------------------------------------
// Heading slugs (GitHub rules)
// ---------------------------------------------------------------------------

/**
 * GitHub's heading slug (github-slugger): lower case, drop every character that
 * is not a letter, mark, number, connector punctuation (`_`), space or hyphen,
 * then turn each space into a hyphen. One character-class replace.
 */
export function githubSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .split(' ')
    .join('-')
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/**
 * The text GitHub renders for a heading's inline Markdown, which is what its
 * slug is built from: link text kept and target dropped, images dropped (an
 * image has no text content), HTML tags dropped, code-span backticks dropped,
 * common entities decoded.
 */
export function headingText(raw) {
  let out = ''
  let i = 0
  while (i < raw.length) {
    const c = raw[i]
    if (c === '\\' && i + 1 < raw.length) {
      out += raw[i + 1]
      i += 2
      continue
    }
    if (c === '<') {
      const next = raw[i + 1] ?? ''
      const close = raw.indexOf('>', i)
      if (close !== -1 && (next === '/' || next === '!' || isLetter(next))) {
        i = close + 1
        continue
      }
    }
    if (c === '&') {
      const semi = raw.indexOf(';', i)
      if (semi !== -1 && semi - i <= 6 && ENTITIES[raw.slice(i + 1, semi)] !== undefined) {
        out += ENTITIES[raw.slice(i + 1, semi)]
        i = semi + 1
        continue
      }
    }
    if (c === '`') {
      // A code span's content is literal text: `<string>` in it is not a tag.
      let k = 0
      while (raw[i + k] === '`') k++
      const closeAt = findCodeCloser(raw, i + k, k, new Map())
      if (closeAt !== -1) out += raw.slice(i + k, closeAt)
      i = closeAt === -1 ? i + k : closeAt + k
      continue
    }
    if (c === '!' && raw[i + 1] === '[') {
      const link = parseInlineLinkAt(raw, i + 1)
      if (link) {
        i = link.end + 1
        continue
      }
    }
    if (c === '[') {
      const link = parseInlineLinkAt(raw, i)
      if (link) {
        out += headingText(link.text)
        i = link.end + 1
        continue
      }
    }
    out += c
    i++
  }
  return out.trim()
}

/** `[text](dest)` starting exactly at `start`, with no nested brackets in the text. */
function parseInlineLinkAt(s, start) {
  const close = s.indexOf(']', start + 1)
  if (close === -1 || s[close + 1] !== '(') return null
  const dest = parseDestination(s, close + 2)
  return dest ? { text: s.slice(start + 1, close), end: dest.end } : null
}

function isLetter(ch) {
  return ch !== '' && ch.toLowerCase() !== ch.toUpperCase()
}

/** Text of an ATX heading line (`## Title ##`), or null when the line is not one. */
function atxHeading(line) {
  let i = 0
  while (i < 3 && line[i] === ' ') i++
  let level = 0
  while (line[i + level] === '#') level++
  if (level < 1 || level > 6) return null
  const after = line[i + level]
  if (after !== undefined && after !== ' ' && after !== '\t') return null
  let text = line.slice(i + level).trim()
  // Strip an optional closing sequence of #s (it must follow a space).
  let end = text.length
  while (end > 0 && text[end - 1] === '#') end--
  if (end === 0) return ''
  if (end < text.length && (text[end - 1] === ' ' || text[end - 1] === '\t')) text = text.slice(0, end).trim()
  return text
}

/** A setext underline (`===` or `---`), optionally indented up to 3 spaces. */
function isSetextUnderline(line) {
  const t = line.trim()
  if (t === '' || line.length - line.trimStart().length > 3) return false
  const ch = t[0]
  if (ch !== '=' && ch !== '-') return false
  for (const c of t) if (c !== ch) return false
  return true
}

/** A line that starts a block other than a plain paragraph (list, quote, table, heading). */
function startsBlock(trimmed) {
  const c = trimmed[0]
  if (c === '#' || c === '>' || c === '|') return true
  if ((c === '-' || c === '*' || c === '+') && (trimmed[1] === ' ' || trimmed[1] === undefined)) return true
  let d = 0
  while (d < trimmed.length && trimmed[d] >= '0' && trimmed[d] <= '9') d++
  return d > 0 && d <= 9 && (trimmed[d] === '.' || trimmed[d] === ')') && trimmed[d + 1] === ' '
}

/**
 * Every anchor a link can target in this Markdown: one slug per heading (with
 * GitHub's `-1`, `-2` suffixes for repeats) plus explicit `id`/`name` attributes
 * in inline HTML.
 */
export function collectAnchors(markdown) {
  const { lines } = splitLines(markdown)
  const anchors = new Set()
  const seen = new Map()
  const addSlug = (text) => {
    const base = githubSlug(headingText(text))
    let slug = base
    let n = seen.get(base) ?? 0
    while (anchors.has(slug) && n < 10_000) {
      n++
      slug = `${base}-${n}`
    }
    seen.set(base, n)
    anchors.add(slug)
  }
  for (let n = 0; n < lines.length; n++) {
    const { text, code } = lines[n]
    if (code) continue
    const atx = atxHeading(text)
    if (atx !== null) {
      addSlug(atx)
    } else if (n > 0 && isSetextUnderline(text)) {
      const prev = lines[n - 1]
      const t = prev.text.trim()
      if (!prev.code && t !== '' && !startsBlock(t) && !isSetextUnderline(prev.text)) addSlug(t)
    }
    for (const attr of ['id="', 'name="']) {
      let at = text.indexOf(attr)
      while (at !== -1) {
        const before = text[at - 1]
        const end = text.indexOf('"', at + attr.length)
        if (end === -1) break
        if (before === ' ' || before === '\t') anchors.add(text.slice(at + attr.length, end))
        at = text.indexOf(attr, end + 1)
      }
    }
  }
  return anchors
}

// ---------------------------------------------------------------------------
// Link scanner
// ---------------------------------------------------------------------------

/**
 * A link destination starting at `p` (just after `(`): `<...>` or a bare run
 * with balanced parentheses, then an optional title, then `)`.
 *
 * @returns {{ target: string, end: number } | null} `end` is the index of `)`
 */
function parseDestination(s, p) {
  while (s[p] === ' ' || s[p] === '\t') p++
  let target
  if (s[p] === '<') {
    const gt = s.indexOf('>', p + 1)
    if (gt === -1) return null
    target = s.slice(p + 1, gt)
    p = gt + 1
  } else {
    const start = p
    let depth = 0
    while (p < s.length) {
      const c = s[p]
      if (c === '\\') {
        p += 2
        continue
      }
      if (c === ' ' || c === '\t' || c === '\n') break
      if (c === '(') depth++
      if (c === ')') {
        if (depth === 0) break
        depth--
      }
      p++
    }
    target = s.slice(start, Math.min(p, s.length))
  }
  while (s[p] === ' ' || s[p] === '\t') p++
  if (s[p] === '"' || s[p] === "'" || s[p] === '(') {
    const closeCh = s[p] === '(' ? ')' : s[p]
    const closeAt = s.indexOf(closeCh, p + 1)
    if (closeAt === -1) return null
    p = closeAt + 1
    while (s[p] === ' ' || s[p] === '\t') p++
  }
  return s[p] === ')' ? { target, end: p } : null
}

/**
 * Every inline link, image and reference definition in the Markdown, found by
 * one linear pass per paragraph (so link text may wrap across lines). Code
 * spans, fenced code, frontmatter and HTML comments are skipped.
 *
 * @returns {{ links: Array<{ line: number, target: string, image: boolean }>, longLines: number[] }}
 */
export function scanLinks(markdown) {
  const { lines } = splitLines(markdown)
  const links = []
  const longLines = []
  let block = []
  const flush = () => {
    if (block.length) scanBlock(block, links)
    block = []
  }
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n]
    if (l.long) longLines.push(n + 1)
    if (l.code || l.long || l.text.trim() === '') {
      flush()
      continue
    }
    block.push({ text: l.text, line: n + 1 })
  }
  flush()
  return { links, longLines }
}

function scanBlock(block, links) {
  const s = block.map((b) => b.text).join('\n')
  const lineStarts = []
  let offset = 0
  for (const b of block) {
    lineStarts.push(offset)
    offset += b.text.length + 1
  }
  let lineIdx = 0
  const lineAt = (pos) => {
    while (lineIdx + 1 < lineStarts.length && lineStarts[lineIdx + 1] <= pos) lineIdx++
    return block[lineIdx].line
  }
  // Code-span closers that were searched for and not found, by run length:
  // a later search for the same length from further on cannot succeed either.
  const noCloserFrom = new Map()
  const opens = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') {
      let k = 0
      while (s[i + k] === '`') k++
      const closeAt = findCodeCloser(s, i + k, k, noCloserFrom)
      i = closeAt === -1 ? i + k : closeAt + k
      continue
    }
    if (c === '[') {
      opens.push(i)
      i++
      continue
    }
    if (c === ']' && opens.length) {
      const open = opens.pop()
      if (s[i + 1] === '(') {
        const dest = parseDestination(s, i + 2)
        if (dest) {
          links.push({ line: lineAt(i), target: dest.target, image: open > 0 && s[open - 1] === '!' })
          i = dest.end + 1
          continue
        }
      } else if (s[i + 1] === ':' && s[open + 1] !== '^' && isLineStart(s, open)) {
        // Reference definition: `[label]: target "title"`.
        let p = i + 2
        while (s[p] === ' ' || s[p] === '\t') p++
        let end = p
        if (s[p] === '<') {
          const gt = s.indexOf('>', p + 1)
          end = gt === -1 ? p : gt
          p++
        } else {
          while (end < s.length && s[end] !== ' ' && s[end] !== '\t' && s[end] !== '\n') end++
        }
        if (end > p) links.push({ line: lineAt(i), target: s.slice(p, end), image: false })
        i = end
        continue
      }
    }
    i++
  }
}

function findCodeCloser(s, from, k, noCloserFrom) {
  const failedAt = noCloserFrom.get(k)
  if (failedAt !== undefined && from >= failedAt) return -1
  const run = '`'.repeat(k)
  let at = s.indexOf(run, from)
  while (at !== -1) {
    let len = 0
    while (s[at + len] === '`') len++
    if (len === k) return at
    at = s.indexOf(run, at + len)
  }
  noCloserFrom.set(k, from)
  return -1
}

/** True when only up to three spaces precede `pos` on its line. */
function isLineStart(s, pos) {
  let p = pos - 1
  let spaces = 0
  while (p >= 0 && s[p] === ' ') {
    p--
    spaces++
  }
  return spaces <= 3 && (p < 0 || s[p] === '\n')
}

// ---------------------------------------------------------------------------
// Link targets: classify lexically, then resolve inside the root
// ---------------------------------------------------------------------------

/**
 * Decide what a link target is WITHOUT touching the file system.
 *
 * @param {string} fromFile - repository-relative POSIX path of the linking file
 * @param {string} target - the destination as written
 * @returns {{ kind: 'external' } | { kind: 'same-file', fragment: string }
 *   | { kind: 'rejected', reason: string } | { kind: 'relative', rel: string, fragment: string | null }}
 */
export function classifyTarget(fromFile, target) {
  const t = target.trim()
  if (t.startsWith('#')) return { kind: 'same-file', fragment: t.slice(1) }
  if (t === '') return { kind: 'rejected', reason: 'empty link target' }
  if (t.startsWith('//')) return { kind: 'external' }
  const scheme = schemeOf(t)
  if (scheme !== null) {
    if (scheme.length === 1) return { kind: 'rejected', reason: 'absolute path' }
    if (scheme === 'file') return { kind: 'rejected', reason: 'file: URL' }
    return { kind: 'external' }
  }
  let pathPart = t
  let fragment = null
  const hash = pathPart.indexOf('#')
  if (hash !== -1) {
    fragment = pathPart.slice(hash + 1)
    pathPart = pathPart.slice(0, hash)
  }
  const query = pathPart.indexOf('?')
  if (query !== -1) pathPart = pathPart.slice(0, query)
  let decoded
  try {
    decoded = decodeURIComponent(pathPart)
  } catch {
    return { kind: 'rejected', reason: 'malformed percent-encoding' }
  }
  if (decoded.includes('\0')) return { kind: 'rejected', reason: 'NUL byte in link path' }
  if (decoded.includes('\\')) return { kind: 'rejected', reason: 'backslash in link path' }
  if (decoded.startsWith('/')) return { kind: 'rejected', reason: 'absolute path' }
  if (decoded.startsWith('~')) return { kind: 'rejected', reason: 'home-relative path (~)' }
  if (schemeOf(decoded) !== null) return { kind: 'rejected', reason: 'encoded URL scheme' }
  if (decoded === '') return { kind: 'same-file', fragment: fragment ?? '' }
  const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), decoded))
  if (rel === '..' || rel.startsWith('../')) return { kind: 'rejected', reason: 'outside repository' }
  return { kind: 'relative', rel: rel === '.' ? '' : rel.replace(/\/$/, ''), fragment }
}

/** `http` for `http://…`; null when the string has no URL scheme. */
function schemeOf(s) {
  const colon = s.indexOf(':')
  if (colon < 1) return null
  for (let i = 0; i < colon; i++) {
    const c = s[i]
    const alpha = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
    if (i === 0 ? !alpha : !(alpha || (c >= '0' && c <= '9') || c === '+' || c === '.' || c === '-')) return null
  }
  return s.slice(0, colon).toLowerCase()
}

/**
 * Resolve a repository-relative path to a real entry inside the root, one
 * component at a time. Only directories inside the root are ever listed or
 * lstat'ed; a symlink is read with `readlink` and its target checked lexically,
 * so a link out of the root is refused before anything outside is touched.
 * Names must match exactly (GitHub is case-sensitive; macOS usually is not).
 *
 * @returns {{ ok: true, abs: string, rel: string, isDir: boolean, size: number }
 *   | { ok: false, reason: string }}
 */
export function resolveInside(root, rel, fsApi, dirCache = new Map(), rootAliases = [root]) {
  let pending = rel === '' ? [] : rel.split('/')
  const done = []
  let hops = 0
  while (pending.length) {
    const name = pending.shift()
    if (name === '' || name === '.') continue
    if (name === '..') {
      if (done.length === 0) return { ok: false, reason: 'resolves outside repository (symlink)' }
      done.pop()
      continue
    }
    const dirRel = done.join('/')
    const entries = listDir(root, dirRel, fsApi, dirCache)
    if (!entries) return { ok: false, reason: 'target does not exist' }
    if (!entries.has(name)) {
      const lower = name.toLowerCase()
      for (const e of entries) {
        if (e.toLowerCase() === lower) return { ok: false, reason: `case differs from the file on disk (${e})` }
      }
      return { ok: false, reason: 'target does not exist' }
    }
    const abs = path.join(root, ...done, name)
    const st = fsApi.lstatSync(abs)
    if (st.isSymbolicLink()) {
      if (++hops > MAX_SYMLINK_HOPS) return { ok: false, reason: 'too many symlinks' }
      const link = fsApi.readlinkSync(abs).split(path.sep).join('/')
      if (path.isAbsolute(link) || link.startsWith('/')) {
        // An absolute link may name the root by its real path (/tmp vs /private/tmp).
        const inside = rootAliases
          .map((r) => path.relative(r, link).split(path.sep).join('/'))
          .find((p) => !(p === '..' || p.startsWith('../') || path.isAbsolute(p)))
        if (inside === undefined) return { ok: false, reason: 'resolves outside repository (symlink)' }
        done.length = 0
        pending = [...inside.split('/'), ...pending]
      } else {
        pending = [...link.split('/'), ...pending]
      }
      continue
    }
    done.push(name)
    if (pending.length === 0) {
      return { ok: true, abs, rel: done.join('/'), isDir: st.isDirectory(), size: st.size }
    }
  }
  return { ok: true, abs: root, rel: done.join('/'), isDir: true, size: 0 }
}

function listDir(root, dirRel, fsApi, dirCache) {
  if (dirCache.has(dirRel)) return dirCache.get(dirRel)
  let entries = null
  try {
    entries = new Set(fsApi.readdirSync(dirRel === '' ? root : path.join(root, ...dirRel.split('/'))))
  } catch {
    entries = null
  }
  dirCache.set(dirRel, entries)
  return entries
}

// ---------------------------------------------------------------------------
// Wording rule
// ---------------------------------------------------------------------------

/**
 * Split prose into lower-case words and window breaks, linearly. A word is a
 * run of letters, digits, `'` and `-` (the typographic apostrophe counts as
 * `'`); leading and trailing `'`/`-` are trimmed. A break is a sentence end or
 * `|`, a blank line, or the start of a list item, heading, quote or table row.
 *
 * @returns {Array<{ word: string, line: number } | { brk: true }>}
 */
export function tokenize(markdown) {
  const { lines } = splitLines(markdown)
  const tokens = []
  const pushBreak = () => {
    if (tokens.length && !tokens[tokens.length - 1].brk) tokens.push({ brk: true })
  }
  for (let n = 0; n < lines.length; n++) {
    const text = lines[n].text
    const trimmed = text.trim()
    if (trimmed === '' || startsBlock(trimmed)) pushBreak()
    let word = ''
    const flush = () => {
      let a = 0
      let b = word.length
      while (a < b && (word[a] === "'" || word[a] === '-')) a++
      while (b > a && (word[b - 1] === "'" || word[b - 1] === '-')) b--
      if (b > a) tokens.push({ word: word.slice(a, b).toLowerCase(), line: n + 1 })
      word = ''
    }
    for (const raw of text) {
      const ch = raw === '’' ? "'" : raw
      if (ch === "'" || ch === '-' || isWordChar(ch)) {
        word += ch
        continue
      }
      flush()
      if (WINDOW_BREAKS.has(ch)) pushBreak()
    }
    flush()
  }
  return tokens
}

function isWordChar(ch) {
  return (ch >= '0' && ch <= '9') || isLetter(ch)
}

/** A negator within NEGATION_WINDOW words before `start`, not crossing a break. */
function isNegated(tokens, start) {
  for (let j = start - 1, seen = 0; j >= 0 && seen < NEGATION_WINDOW; j--, seen++) {
    const t = tokens[j]
    if (t.brk) return false
    if (NEGATORS.has(t.word) || t.word.endsWith("n't")) {
      const next = tokens[j + 1]
      const qualifiers = NOT_A_NEGATION.get(t.word)
      if (!(qualifiers && next && !next.brk && qualifiers.has(next.word))) return true
    }
  }
  return false
}

/** Phrases that claim built-in AI and are not negated. */
export function findWordingIssues(markdown) {
  const tokens = tokenize(markdown)
  const issues = []
  for (let i = 0; i < tokens.length; i++) {
    for (const rule of WORDING_RULES) {
      let match = true
      for (let k = 0; k < rule.words.length; k++) {
        const t = tokens[i + k]
        if (!t || t.brk || t.word !== rule.words[k]) {
          match = false
          break
        }
      }
      if (match && !isNegated(tokens, i)) issues.push({ line: tokens[i].line, phrase: rule.phrase })
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
// Repository check
// ---------------------------------------------------------------------------

/** The default scope's fixed part; files linking into the guide are added by checkRepository. */
export function inFixedScope(file) {
  if (file.startsWith(GUIDE_DIR)) return true
  if (file.startsWith(DESIGN_DIR) && !file.slice(DESIGN_DIR.length).includes('/')) return true
  return SCOPE_FILES.includes(file)
}

function pointsIntoGuide(rel) {
  return rel === GUIDE_DIR.slice(0, -1) || rel.startsWith(GUIDE_DIR)
}

/**
 * Check every Markdown file in `files` (repository-relative POSIX paths).
 *
 * @param {{ root: string, files: string[], all?: boolean, fsApi?: typeof nodeFs }} options
 * @returns {{ findings: Array<{ file: string, line: number, message: string }>, checked: string[] }}
 */
export function checkRepository({ root, files, all = false, fsApi = nodeFs }) {
  const dirCache = new Map()
  const anchorCache = new Map()
  const findings = []
  const checked = []
  const rootAliases = [root, fsApi.realpathSync(root)]
  const resolve = (rel) => resolveInside(root, rel, fsApi, dirCache, rootAliases)

  const readInside = (rel) => {
    const r = resolve(rel)
    if (!r.ok) return { error: r.reason }
    if (r.isDir) return { error: 'is a directory' }
    if (r.size > MAX_FILE_BYTES) return { error: 'file larger than 2 MB, skipped' }
    return { text: fsApi.readFileSync(r.abs, 'utf8') }
  }
  const anchorsOf = (rel, ownText) => {
    if (!anchorCache.has(rel)) {
      const text = ownText ?? readInside(rel).text
      anchorCache.set(rel, text === undefined ? null : collectAnchors(text))
    }
    return anchorCache.get(rel)
  }

  for (const file of files) {
    const read = readInside(file)
    if (read.error) {
      if (all || inFixedScope(file)) findings.push({ file, line: 0, message: read.error })
      continue
    }
    const { links, longLines } = scanLinks(read.text)
    const classified = links.map((l) => ({ ...l, c: classifyTarget(file, l.target) }))
    const inScope =
      all || inFixedScope(file) || classified.some((l) => l.c.kind === 'relative' && pointsIntoGuide(l.c.rel))
    if (!inScope) continue
    checked.push(file)
    const report = (line, message) => findings.push({ file, line, message })

    for (const line of longLines) report(line, `line longer than ${MAX_LINE_CHARS} characters, skipped`)

    for (const { line, target, image, c } of classified) {
      const what = image ? 'broken image' : 'broken link'
      if (c.kind === 'external') continue
      if (c.kind === 'rejected') {
        report(line, `${what}: ${c.reason} – ${target}`)
        continue
      }
      if (c.kind === 'same-file') {
        if (c.fragment !== '' && !anchorMatches(anchorsOf(file, read.text), c.fragment)) {
          report(line, `broken anchor: no heading #${c.fragment} in this file – ${target}`)
        }
        continue
      }
      const r = resolve(c.rel)
      if (!r.ok) {
        report(line, `${what}: ${r.reason} – ${target}`)
        continue
      }
      if (c.fragment && !r.isDir && r.rel.endsWith('.md')) {
        const anchors = anchorsOf(r.rel)
        if (anchors === null) report(line, `anchor not checked: target larger than 2 MB – ${target}`)
        else if (!anchorMatches(anchors, c.fragment)) report(line, `broken anchor: no heading #${c.fragment} in ${r.rel} – ${target}`)
      }
    }

    if (file.startsWith(GUIDE_DIR)) {
      for (const { line, phrase } of findWordingIssues(read.text)) {
        report(line, `wording: "${phrase}" claims built-in AI – Erfana hosts the agent (negate it or reword)`)
      }
    }
  }
  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))
  return { findings, checked }
}

function anchorMatches(anchors, fragment) {
  let decoded
  try {
    decoded = decodeURIComponent(fragment)
  } catch {
    return false
  }
  return anchors.has(decoded)
}

/** Tracked Markdown files, from git (never a directory walk). */
export function listTrackedMarkdown(root) {
  const out = execFileSync('git', ['-c', 'core.quotepath=off', 'ls-files', '-z', '--', '*.md'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  return out.split('\0').filter(Boolean)
}

/**
 * CLI entry point, injectable for tests.
 *
 * @returns {number} exit code: 0 ok (always 0 with --all), 1 findings or bad usage
 */
export function run(argv, { root, listFiles = listTrackedMarkdown, fsApi = nodeFs, log = console.log, error = console.error }) {
  const unknown = argv.filter((a) => a !== '--all')
  if (unknown.length) {
    error(`check-links: unknown option ${unknown[0]} (usage: check-links.mjs [--all])`)
    return 1
  }
  const all = argv.includes('--all')
  const files = listFiles(root)
  const { findings, checked } = checkRepository({ root, files, all, fsApi })
  const prefix = all ? 'warning: ' : ''
  // Findings echo contributor-written link text: control characters (an ESC
  // sequence could rewrite the terminal) are shown as `?`.
  const printable = (s) => {
    let out = ''
    for (const ch of s) out += ch < ' ' || ch === '\u007f' ? '?' : ch
    return out
  }
  for (const f of findings) (all ? log : error)(printable(`${prefix}${f.file}:${f.line}: ${f.message}`))
  const fileCount = new Set(findings.map((f) => f.file)).size
  const scope = all ? 'every tracked Markdown file' : 'the default scope'
  if (findings.length === 0) {
    log(`check-links: ${checked.length} files in ${scope}, no findings.`)
    return 0
  }
  const summary = `check-links: ${findings.length} finding(s) in ${fileCount} of ${checked.length} files in ${scope}.`
  if (all) {
    log(`${summary} Reported as warnings (--all never fails).`)
    return 0
  }
  error(summary)
  return 1
}

/* v8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = run(process.argv.slice(2), { root })
}
/* v8 ignore stop */
