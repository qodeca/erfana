// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// The max-lines ratchet (docs/technical-debt.md #26): a source file may shrink, never grow.
//
// ESLint enforces the size (eslint.config.mjs): `max-lines` at the baseline's
// `limit` for every non-test `src/**/*.{ts,tsx}`, and at its own size for each
// file listed in scripts/max-lines-baseline.json – the files that were already
// over the limit. ESLint cannot keep that list honest, so this check does. It
// fails when
//
//   * an allowance is above its file's current size (the file shrank, so the
//     allowance must come down with it, or the room would be regrown later);
//   * an entry is at or under the limit, or names a file the limit no longer
//     applies to (deleted, renamed or excluded);
//   * a source the limit applies to turns the rule off with an inline ESLint
//     directive (an `eslint-disable…` naming max-lines or naming no rule at all,
//     or an inline `/* eslint max-lines: … */` config);
//   * the baseline is not in its canonical form (sorted, one entry per line).
//
// It only checks. `--update` lowers and removes entries and rewrites the file
// canonically; it never raises or adds one, so the only way past the limit is a
// reviewed edit to the baseline. CI runs `npm run lint` with --fix, which is
// why the normal mode must never write.
//
// Lines are counted the way ESLint's max-lines counts them: every line, split on
// ESLint's own line breaks (CRLF is one break, so a Windows checkout counts the
// same), with the empty line after a final line break not counted. Like
// check-shebangs.mjs it reads only git-tracked paths and never follows a symlink.
// The regexes below have no nested quantifiers, so a hostile file cannot make
// them backtrack.
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const BASELINE_PATH = 'scripts/max-lines-baseline.json'
export const UPDATE_COMMAND = 'npm run lint:max-lines -- --update'

const ROOT_DIR = 'src'
const EXTS = new Set(['.ts', '.tsx'])
// Test-support folders; keep in step with MAX_LINES_IGNORES in eslint.config.mjs
// (scripts/eslint-max-lines.test.mjs proves the two agree on every tracked file).
const TEST_SEGMENTS = new Set([
  '__test__',
  '__tests__',
  '__test-helpers__',
  '__test-utils__',
  'test-utils'
])
// ESLint's line-break pattern (eslint/lib/shared/ast-utils.js)
const LINE_BREAK = /\r\n|[\r\n\u2028\u2029]/u
// A baseline key becomes an ESLint `files` pattern, so it may hold no glob syntax
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/
// The start of a comment ESLint reads as a directive, and the ` -- ` that ends its rule list
const DIRECTIVE = /^(eslint-disable(?:-next-line|-line)?|eslint)(?:\s|$)/
const DESCRIPTION = /\s-{2,}\s/
const RULE_SEPARATOR = /[\s,:"'[\]{}]+/

/** True when the ratchet applies to `rel`, a repository-relative path with `/`. */
export function isCovered(rel) {
  if (!rel.startsWith(`${ROOT_DIR}/`)) return false
  const ext = path.posix.extname(rel)
  if (!EXTS.has(ext)) return false
  const base = path.posix.basename(rel)
  if (base.endsWith('.d.ts') || base.endsWith(`.test${ext}`)) return false
  return !rel.split('/').some((segment) => TEST_SEGMENTS.has(segment))
}

/** The line count ESLint's max-lines reports for `text`. */
export function countLines(text) {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = body.split(LINE_BREAK)
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return lines.length
}

/** True when one comment body is a directive that switches max-lines off or reconfigures it. */
export function touchesMaxLines(body) {
  const match = DIRECTIVE.exec(body)
  if (!match) return false
  const [ruleText] = body.slice(match[1].length).split(DESCRIPTION)
  const rules = ruleText.split(RULE_SEPARATOR).filter(Boolean)
  // A disable that names no rule turns every rule off, max-lines included
  if (match[1] !== 'eslint' && rules.length === 0) return true
  return rules.includes('max-lines')
}

// What ESLint may read as a directive on one line: the text after each `//` and
// `/*`, and the line itself (a line inside a multi-line block comment).
function commentBodies(line) {
  const bodies = [line]
  for (const opener of ['//', '/*']) {
    for (let at = line.indexOf(opener); at !== -1; at = line.indexOf(opener, at + opener.length)) {
      bodies.push(line.slice(at + opener.length))
    }
  }
  return bodies.map((body) => {
    const end = body.indexOf('*/')
    return (end === -1 ? body : body.slice(0, end)).trim()
  })
}

/** 1-based line numbers of every directive in `text` that switches max-lines off. */
export function findMaxLinesDirectives(text) {
  const found = []
  text.split(LINE_BREAK).forEach((line, index) => {
    if (line.includes('eslint') && commentBodies(line).some(touchesMaxLines)) found.push(index + 1)
  })
  return found
}

/** Parse and validate the baseline JSON; throws on a malformed file. */
export function parseBaseline(raw) {
  const data = JSON.parse(raw)
  const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!isRecord(data) || !isRecord(data.files)) throw new Error('expected { "limit", "files" }')
  if (!Number.isInteger(data.limit) || data.limit < 1) {
    throw new Error('"limit" must be a positive integer')
  }
  for (const [file, allowance] of Object.entries(data.files)) {
    const parts = file.split('/')
    if (!SAFE_PATH.test(file) || parts.some((p) => p === '' || p === '.' || p === '..')) {
      throw new Error(`"${printable(file)}" is not a plain repository-relative path`)
    }
    if (!Number.isInteger(allowance) || allowance < 1) {
      throw new Error(`"${file}" must map to a positive integer line count`)
    }
  }
  return { limit: data.limit, files: { ...data.files } }
}

/** The canonical text of a baseline: sorted entries, one per line, LF, final newline. */
export function formatBaseline({ limit, files }) {
  const sorted = Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  )
  return `${JSON.stringify({ limit, files: sorted }, null, 2)}\n`
}

/** Git-tracked files the ratchet applies to, repository-relative with `/`. */
export function trackedSources(root) {
  return execFileSync('git', ['ls-files', '-z', '--', ROOT_DIR], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter(isCovered)
}

// The file's text, or null when it is gone from the working tree or is not a regular file
function readSource(root, rel) {
  const abs = path.join(root, rel)
  try {
    if (!lstatSync(abs).isFile()) return null // a symlink is never followed
  } catch {
    return null // tracked but deleted in the working tree
  }
  return readFileSync(abs, 'utf8')
}

/**
 * The verdict on one baseline entry. `value` is the allowance the entry should
 * hold (undefined: remove it); `reason` is null when the entry is current. A
 * file that grew past its allowance keeps it: ESLint reports the growth.
 */
export function judgeEntry({ allowance, lines, limit }) {
  const remove = (why) => ({ value: undefined, reason: `${why}; remove the entry` })
  if (allowance <= limit) {
    return remove(`allowance ${allowance} is not above the ${limit}-line limit`)
  }
  if (lines === null) {
    return remove('not a tracked source the limit applies to (deleted, renamed or excluded)')
  }
  if (lines <= limit) return remove(`the file is ${lines} lines, within the ${limit}-line limit`)
  if (allowance > lines) {
    return {
      value: lines,
      reason: `allowance ${allowance} is above the file's ${lines} lines; lower it to ${lines}`
    }
  }
  return { value: allowance, reason: null }
}

/**
 * Compare the baseline with the tracked sources.
 * @returns {{ stale: {file: string, reason: string}[], next: object, directives: string[] }}
 */
export function audit(root, baseline, sources) {
  const covered = new Set(sources)
  const stale = []
  const next = { limit: baseline.limit, files: {} }
  for (const [file, allowance] of Object.entries(baseline.files)) {
    const text = covered.has(file) ? readSource(root, file) : null
    const lines = text === null ? null : countLines(text)
    const { value, reason } = judgeEntry({ allowance, lines, limit: baseline.limit })
    if (reason) stale.push({ file, reason })
    if (value !== undefined) next.files[file] = value
  }
  const directives = []
  for (const file of sources) {
    const text = readSource(root, file)
    if (text === null) continue
    for (const line of findMaxLinesDirectives(text)) directives.push(`${printable(file)}:${line}`)
  }
  return { stale, next, directives }
}

// Paths are contributor-controlled: a control character (an ESC sequence could
// rewrite the terminal) is shown as `?`.
function printable(text) {
  let out = ''
  for (const ch of text) out += ch < ' ' || ch === '\u007f' ? '?' : ch
  return out
}

function reportDirectives(directives, log) {
  log.error(`max-lines: ${directives.length} inline ESLint directive(s) switch the rule off:`)
  for (const where of directives) log.error(`  ${where}`)
  log.error(
    'Delete the directive and shrink the file instead. A bare eslint-disable switches every ' +
      'rule off, max-lines included, so name the rules it is for (docs/technical-debt.md #26).'
  )
}

// A CRLF checkout of the baseline is still canonical: git restores LF on commit
const isCanonical = (raw, baseline) => formatBaseline(baseline) === raw.replace(/\r\n/g, '\n')

// Write the lowered baseline and say what changed
function applyUpdate(root, raw, next, stale, log) {
  if (isCanonical(raw, next)) {
    log.log(`max-lines: ${BASELINE_PATH} is already current.`)
    return
  }
  writeFileSync(path.join(root, BASELINE_PATH), formatBaseline(next))
  for (const { file, reason } of stale) log.log(`  ${file}: ${reason}`)
  log.log(`max-lines: rewrote ${BASELINE_PATH} (${Object.keys(next.files).length} entries).`)
}

// Report stale entries and a non-canonical file; true when there was anything to report
function reportStale(raw, next, stale, log) {
  if (stale.length === 0 && isCanonical(raw, next)) return false
  log.error(`max-lines: ${BASELINE_PATH} is out of date:`)
  for (const { file, reason } of stale) log.error(`  ${file}: ${reason}`)
  if (stale.length === 0) {
    log.error('  the file is not in canonical form (sorted, one entry per line)')
  }
  log.error(`Run \`${UPDATE_COMMAND}\` to lower or remove entries; it never raises or adds one.`)
  return true
}

/**
 * CLI entry point, injectable for tests.
 * @returns {number} exit code: 0 current, 1 findings, a malformed baseline or bad usage
 */
export function main(root = process.cwd(), argv = [], log = console) {
  const unknown = argv.filter((a) => a !== '--update')
  if (unknown.length) {
    log.error(`check-max-lines: unknown option ${printable(unknown[0])} (usage: [--update])`)
    return 1
  }
  let raw
  let baseline
  try {
    raw = readFileSync(path.join(root, BASELINE_PATH), 'utf8')
    baseline = parseBaseline(raw)
  } catch (err) {
    log.error(`max-lines: cannot read ${BASELINE_PATH}: ${err.message}. Fix it by hand.`)
    return 1
  }
  const sources = trackedSources(root)
  const { stale, next, directives } = audit(root, baseline, sources)
  let staleFound = false
  if (argv.includes('--update')) applyUpdate(root, raw, next, stale, log)
  else staleFound = reportStale(raw, next, stale, log)
  if (directives.length) reportDirectives(directives, log)
  if (staleFound || directives.length) return 1
  log.log(
    `max-lines: the baseline is current (${Object.keys(next.files).length} files over the ` +
      `${baseline.limit}-line limit) and none of ${sources.length} source files switches the rule off.`
  )
  return 0
}

/* v8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = main(root, process.argv.slice(2))
}
