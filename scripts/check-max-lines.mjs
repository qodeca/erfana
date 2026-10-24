// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// The max-lines ratchet (docs/technical-debt.md #26): a source file may shrink, never grow.
//
// Every non-test `src/**/*.{ts,tsx}` may have LIMIT (500) lines, and each file
// listed in scripts/max-lines-baseline.json – the files that were already over
// the limit – may have its listed size. ESLint's `max-lines` enforces that
// (eslint.config.mjs), and this check enforces it again by counting every
// covered file itself: an inline directive can switch the ESLint rule off, but
// not this count. This check also keeps the baseline honest. It fails when
//
//   * a file has more lines than its allowance (its entry, or LIMIT);
//   * an allowance is above its file's current size (the file shrank, so the
//     allowance must come down with it, or the room would be regrown later);
//   * an entry is at or under the limit, or names a file the limit no longer
//     applies to (deleted, renamed or excluded);
//   * a source the limit applies to turns the ESLint rule off with an inline
//     directive (an `eslint-disable…` naming max-lines or naming no rule at all,
//     or an inline `/* eslint max-lines: … */` config), on one line or spread
//     over several, or has a directive the scan cannot read with certainty
//     (scripts/lib/max-lines-directives.mjs);
//   * the baseline's `limit` is not LIMIT, or the baseline is not in its
//     canonical form (sorted, one entry per line) – the format and its
//     validation live in scripts/lib/max-lines-baseline.mjs.
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
import {
  BASELINE_PATH,
  formatBaseline,
  parseBaseline,
  printable
} from './lib/max-lines-baseline.mjs'
import {
  findMaxLinesDirectives,
  LINE_BREAK,
  MAX_DIRECTIVE_CHARS
} from './lib/max-lines-directives.mjs'

export const UPDATE_COMMAND = 'npm run lint:max-lines -- --update'

const ROOT_DIR = 'src'
const EXTS = new Set(['.ts', '.tsx'])
// Test-support folders, test fixtures included; keep in step with
// MAX_LINES_IGNORES in eslint.config.mjs (scripts/eslint-max-lines.test.mjs
// proves the two agree on every tracked file).
const TEST_SEGMENTS = new Set([
  '__test__',
  '__tests__',
  '__test-helpers__',
  '__test-utils__',
  'test-utils',
  '__fixtures__'
])

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
 * file that grew past its allowance keeps it: nothing here raises an entry,
 * and the size check in audit() reports the growth.
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

// The allowance a covered file is held to: its baseline entry, or the limit
const allowanceOf = (baseline, file) =>
  Object.hasOwn(baseline.files, file) ? baseline.files[file] : baseline.limit

/**
 * Read every covered source once: its line count, whether that is over its
 * allowance, and the directives in it that switch max-lines off.
 */
function measureSources(root, baseline, sources) {
  const sizes = new Map()
  const oversize = []
  const directives = []
  for (const file of sources) {
    const text = readSource(root, file)
    if (text === null) continue
    const lines = countLines(text)
    sizes.set(file, lines)
    const allowance = allowanceOf(baseline, file)
    if (lines > allowance) oversize.push({ file: printable(file), lines, allowance })
    for (const line of findMaxLinesDirectives(text)) directives.push(`${printable(file)}:${line}`)
  }
  return { sizes, oversize, directives }
}

/**
 * Compare the baseline with the tracked sources.
 * @returns {{ oversize: {file: string, lines: number, allowance: number}[],
 *   stale: {file: string, reason: string}[], next: object, directives: string[] }}
 */
export function audit(root, baseline, sources) {
  const { sizes, oversize, directives } = measureSources(root, baseline, sources)
  const stale = []
  const next = { limit: baseline.limit, files: {} }
  for (const [file, allowance] of Object.entries(baseline.files)) {
    const lines = sizes.get(file) ?? null
    const { value, reason } = judgeEntry({ allowance, lines, limit: baseline.limit })
    if (reason) stale.push({ file, reason })
    if (value !== undefined) next.files[file] = value
  }
  return { oversize, stale, next, directives }
}

function reportOversize(oversize, log) {
  log.error(`max-lines: ${oversize.length} file(s) have more lines than their allowance:`)
  for (const { file, lines, allowance } of oversize) {
    log.error(`  ${file} has ${lines} lines; its allowance is ${allowance} – split it`)
  }
  log.error(
    `The allowance is a file's entry in ${BASELINE_PATH}, or the limit for any other file. ` +
      'Nothing raises an entry automatically; a raise is a hand edit that review must accept ' +
      '(docs/technical-debt.md #26).'
  )
}

function reportDirectives(directives, log) {
  log.error(`max-lines: ${directives.length} inline ESLint directive(s) switch the rule off:`)
  for (const where of directives) log.error(`  ${where}`)
  log.error(
    'Delete the directive and shrink the file instead. A bare eslint-disable switches every ' +
      'rule off, max-lines included, so name the rules it is for. A directive over ' +
      `${MAX_DIRECTIVE_CHARS} characters, or an eslint config with a backslash in it, is ` +
      'reported because it cannot be read with certainty (docs/technical-debt.md #26).'
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
  const { oversize, stale, next, directives } = audit(root, baseline, sources)
  if (oversize.length) reportOversize(oversize, log)
  let staleFound = false
  if (argv.includes('--update')) applyUpdate(root, raw, next, stale, log)
  else staleFound = reportStale(raw, next, stale, log)
  if (directives.length) reportDirectives(directives, log)
  if (oversize.length || staleFound || directives.length) return 1
  log.log(
    `max-lines: all ${sources.length} source files are within their allowance ` +
      `(${Object.keys(next.files).length} baselined over the ${baseline.limit}-line limit), ` +
      'the baseline is current, and no file switches the rule off.'
  )
  return 0
}

/* v8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = main(root, process.argv.slice(2))
}
