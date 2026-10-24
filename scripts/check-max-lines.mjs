// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// The max-lines ratchet (docs/technical-debt.md #26): a source file may shrink, never grow.
//
// ESLint enforces the size (eslint.config.mjs): `max-lines` at LIMIT (500) for every
// non-test `src/**/*.{ts,tsx}`, and at its own size for each file listed in
// scripts/max-lines-baseline.json – the files that were already over the
// limit. ESLint cannot keep that list honest, so this check does. It fails when
//
//   * an allowance is above its file's current size (the file shrank, so the
//     allowance must come down with it, or the room would be regrown later);
//   * an entry is at or under the limit, or names a file the limit no longer
//     applies to (deleted, renamed or excluded);
//   * a source the limit applies to turns the rule off with an inline ESLint
//     directive (an `eslint-disable…` naming max-lines or naming no rule at all,
//     or an inline `/* eslint max-lines: … */` config), on one line or spread
//     over several (scripts/lib/max-lines-directives.mjs);
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
import { findMaxLinesDirectives, LINE_BREAK } from './lib/max-lines-directives.mjs'

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
