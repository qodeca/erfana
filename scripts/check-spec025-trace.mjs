// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Spec 025 traceability (issue #448, definition of done § 3). Every
// `### 025-AC-NNN` heading in the spec's 04-acceptance.md must be covered in
// EVERY lane its row in the Test checklist names (the Lane column):
//   - `unit`: a unit test (`*.test.*`) whose title starts with the ID –
//     `it('025-AC-002 …')`, never a skipped one;
//   - `e2e`: an e2e test (`*.e2e.*` or `*.spec.*`) titled the same way – a unit
//     test never stands in for an e2e lane;
//   - `packaged`, `bench`, `manual`, `review` and `all`: a row in
//     verification/manual-evidence.md whose first cell is the ID, whose Lane
//     cell names that lane, and whose Evidence cell names files that exist.
// Prints each uncovered ID with its missing lanes and exits 1 when any is
// left; prints "025 trace: all N acceptance IDs covered" and exits 0 otherwise.
//
// Usage: node scripts/check-spec025-trace.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SPEC = 'specs/spec-t4-025-built-in-browser'
export const ACCEPTANCE = `${SPEC}/requirements/04-acceptance.md`
export const MANUAL_EVIDENCE = `${SPEC}/verification/manual-evidence.md`

const ID = String.raw`025-AC-\d{3}`
// it / test, optionally .only/.concurrent/.each(...) – never .skip/.todo/.fixme, nor an expected failure
// (Playwright test.fail('…'), Vitest it.fails('…')): a test that is meant to fail covers nothing.
const TITLE = new RegExp(String.raw`\b(?:it|test)(?:\.(?!skip|todo|fixme|fail)\w+)*\(\s*(['"\x60])(${ID}(?:[ ,/]+${ID})*)\b`, 'g')

/** The tracer's own unit test holds sample titles that are fixtures, not coverage. */
export const SELF_TESTS = ['scripts/check-spec025-trace.test.mjs']

/** Every acceptance ID the spec defines, in file order. */
export function requiredIds(text) {
  return [...text.matchAll(new RegExp(String.raw`^### (${ID}):`, 'gm'))].map(m => m[1])
}

/** The lanes each ID must pass, from the Lane column of the Test checklist table. */
export function lanesById(text) {
  const lanes = new Map()
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length < 5 || !new RegExp(`^${ID}$`).test(cells[0])) continue
    // "review (after release)" is the review lane; "all" stays its own lane.
    lanes.set(cells[0], cells[3].replace(/\(.*?\)/g, '').split(',').map(l => l.trim()).filter(Boolean))
  }
  return lanes
}

/** Test files tracked or new in git (unit and e2e), the tracer's own test left out. */
export function testFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'e2e', 'scripts'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  return out.split('\n').filter(f => /\.(test|e2e|spec)\.(m?[jt]sx?)$/.test(f) && !SELF_TESTS.includes(f))
}

/** Which automated lane a test file belongs to. */
export const laneOfFile = f => (/\.(e2e|spec)\.(m?[jt]sx?)$/.test(f) ? 'e2e' : 'unit')

/** lane → set of IDs named at the start of a test title in that lane's files. */
export function testedIds(files, read) {
  const byLane = { unit: new Set(), e2e: new Set() }
  for (const file of files) {
    const set = byLane[laneOfFile(file)]
    for (const m of read(file).matchAll(TITLE)) for (const id of m[2].split(/[ ,/]+/)) set.add(id)
  }
  return byLane
}

/**
 * lane → set of IDs with a manual-evidence row: a Markdown table row whose
 * first cell is the ID, whose Lane cell (second) names the lane, and whose
 * last cell names existing files in backticks.
 */
export function evidencedIds(text, exists) {
  const byLane = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) continue
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (!new RegExp(`^${ID}$`).test(cells[0] ?? '')) continue
    const evidence = [...(cells.at(-1) ?? '').matchAll(/`([^`]+)`/g)].map(m => m[1])
    if (evidence.length === 0 || !evidence.every(exists)) continue
    for (const lane of (cells[1] ?? '').split(',').map(l => l.trim()).filter(Boolean)) {
      if (!byLane.has(lane)) byLane.set(lane, new Set())
      byLane.get(lane).add(cells[0])
    }
  }
  return byLane
}

/** [{ id, missing: [lane…] }] for every ID with a lane not yet covered, in spec order. */
export function uncovered({ required, lanes, tested, evidenced }) {
  const covered = (id, lane) =>
    lane === 'unit' || lane === 'e2e' ? tested[lane].has(id) : (evidenced.get(lane)?.has(id) ?? false)
  return required
    .map(id => ({ id, missing: (lanes.get(id) ?? ['unknown lane']).filter(lane => !covered(id, lane)) }))
    .filter(r => r.missing.length > 0)
}

export function main() {
  const read = f => readFileSync(path.join(ROOT, f), 'utf8')
  const exists = f => existsSync(path.join(ROOT, f))
  const acceptance = read(ACCEPTANCE)
  const required = requiredIds(acceptance)
  const lanes = lanesById(acceptance)
  const tested = testedIds(testFiles(), read)
  const evidenced = exists(MANUAL_EVIDENCE) ? evidencedIds(read(MANUAL_EVIDENCE), exists) : new Map()
  const missing = uncovered({ required, lanes, tested, evidenced })
  for (const { id, missing: lanesLeft } of missing) console.log(`uncovered: ${id} (${lanesLeft.join(', ')})`)
  if (missing.length > 0) {
    console.log(`025 trace: ${missing.length} of ${required.length} acceptance IDs uncovered`)
    return 1
  }
  console.log(`025 trace: all ${required.length} acceptance IDs covered`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
