// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Drift check for the documentation claim ledger, docs/user-guide/claims.json.
 *
 *   npm run check:claims               # exit 1 on any drift
 *   npm run check:claims -- --update   # re-anchor entries whose proof only moved
 *
 * Each ledger entry ties one sentence fragment on a doc page (`quote`) to the
 * source line that proves it (`source` "path:line" and `match`, a substring
 * of that line). The check fails when:
 *
 * - the quote is no longer on the page – the page was rewritten, so the
 *   entry must be re-checked against the code;
 * - the source line no longer contains `match` – a label was renamed, a
 *   default changed or the line moved. When `match` now sits on exactly one
 *   other line of the same file the finding names it, and `--update` rewrites
 *   the line number. `--update` never changes `match` or `quote`: a renamed
 *   label still fails, because the page has to change with it;
 * - an `app` entry names an e2e test that does not exist.
 *
 * Entries with status "removed" record a claim taken off a page; they are kept
 * as history and not checked. The `reviewed` map names pages that were read and
 * hold no current-state claim (a proposal, an index, a dated record), each with
 * a kind and a note; a listed page that no longer exists is a finding.
 *
 * Paths come from the ledger, which is contributor-controlled: a path that is
 * absolute, uses a backslash or resolves outside the repository is reported
 * without touching the file system, and a symlink is followed only when its
 * real path stays inside the repository. The check makes no network calls.
 */

import nodeFs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const LEDGER = 'docs/user-guide/claims.json'
export const STATUSES = ['verified', 'fixed', 'removed']
export const EVIDENCE = ['source', 'app']
export const DIATAXIS = ['tutorial', 'how-to', 'reference', 'explanation', 'index']
/** Why a reviewed page has no claim entries: a plan for unshipped work, a link index, or a dated record. */
export const REVIEWED_KINDS = ['proposal', 'index', 'record']
export const MAX_FILE_BYTES = 4 * 1024 * 1024

/** Split "src/a.ts:12" into its path and 1-based line, or null when malformed. */
export function parseSource(source) {
  if (typeof source !== 'string') return null
  const at = source.lastIndexOf(':')
  if (at <= 0) return null
  const file = source.slice(0, at)
  const lineText = source.slice(at + 1)
  if (!/^[1-9][0-9]*$/.test(lineText)) return null
  return { file, line: Number(lineText) }
}

/**
 * Resolve a repository-relative path, or return null when it may not be read:
 * absolute, backslashed, escaping the root lexically, or a symlink whose real
 * path leaves the root.
 */
export function safeResolve(root, rel, fsApi = nodeFs) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\\') || rel.includes('\0')) return null
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null
  const abs = path.resolve(root, rel)
  if (abs !== root && !abs.startsWith(root + path.sep)) return null
  let real
  try {
    real = fsApi.realpathSync(abs)
  } catch {
    return { abs, exists: false }
  }
  const realRoot = fsApi.realpathSync(root)
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null
  return { abs: real, exists: true }
}

/** Read a file inside the root as lines, caching by path. Returns a string error on failure. */
function readLines(root, rel, fsApi, cache) {
  if (cache.has(rel)) return cache.get(rel)
  let result
  const resolved = safeResolve(root, rel, fsApi)
  if (!resolved) result = `path ${rel} is outside the repository or not allowed`
  else if (!resolved.exists) result = `${rel} does not exist`
  else {
    const stat = fsApi.statSync(resolved.abs)
    if (!stat.isFile()) result = `${rel} is not a file`
    else if (stat.size > MAX_FILE_BYTES) result = `${rel} is over ${MAX_FILE_BYTES} bytes`
    else result = fsApi.readFileSync(resolved.abs, 'utf8').split(/\r?\n/)
  }
  cache.set(rel, result)
  return result
}

/** The 1-based numbers of every line that contains `needle`. */
export function linesContaining(lines, needle) {
  const hits = []
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle)) hits.push(i + 1)
  return hits
}

/** Structural problems with one entry, as messages. Empty when well formed. */
export function validateEntry(entry) {
  const problems = []
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['entry is not an object']
  for (const key of ['id', 'doc', 'quote', 'status', 'evidence']) {
    if (typeof entry[key] !== 'string' || entry[key] === '') problems.push(`missing ${key}`)
  }
  if (typeof entry.status === 'string' && !STATUSES.includes(entry.status)) {
    problems.push(`status "${entry.status}" is not one of ${STATUSES.join(', ')}`)
  }
  if (typeof entry.evidence === 'string' && !EVIDENCE.includes(entry.evidence)) {
    problems.push(`evidence "${entry.evidence}" is not one of ${EVIDENCE.join(', ')}`)
  }
  if (entry.status !== 'removed') {
    if (!parseSource(entry.source)) problems.push('source must be "path:line"')
    if (typeof entry.match !== 'string' || entry.match === '') problems.push('missing match')
  }
  if ((entry.status === 'fixed' || entry.status === 'removed') && !entry.note) {
    problems.push(`a ${entry.status} entry needs a note saying what was wrong`)
  }
  return problems
}

/**
 * Check a parsed ledger against the repository. Returns the findings, the
 * re-anchored entries (`moves`, applied by --update) and per-status counts.
 */
export function checkLedger(ledger, { root, fsApi = nodeFs }) {
  const findings = []
  const moves = []
  const counts = { verified: 0, fixed: 0, removed: 0 }
  if (!ledger || typeof ledger !== 'object' || !Array.isArray(ledger.claims)) {
    return { findings: [{ id: '(ledger)', message: 'ledger has no "claims" array' }], moves, counts }
  }
  const cache = new Map()
  const seen = new Set()

  for (const [page, info] of Object.entries(ledger.pages ?? {})) {
    if (!info || !DIATAXIS.includes(info.diataxis)) {
      findings.push({ id: page, message: `page type must be one of ${DIATAXIS.join(', ')}` })
    }
    const lines = readLines(root, page, fsApi, cache)
    if (typeof lines === 'string') findings.push({ id: page, message: `listed page: ${lines}` })
  }

  for (const [page, info] of Object.entries(ledger.reviewed ?? {})) {
    if (!info || !REVIEWED_KINDS.includes(info.kind) || typeof info.note !== 'string' || info.note === '') {
      findings.push({ id: page, message: `reviewed page needs a kind (${REVIEWED_KINDS.join(', ')}) and a note` })
    }
    const lines = readLines(root, page, fsApi, cache)
    if (typeof lines === 'string') findings.push({ id: page, message: `reviewed page: ${lines}` })
  }

  ledger.claims.forEach((entry, index) => {
    const id = entry && typeof entry.id === 'string' ? entry.id : `#${index}`
    const problems = validateEntry(entry)
    if (seen.has(id)) problems.push('duplicate id')
    seen.add(id)
    if (problems.length) {
      for (const message of problems) findings.push({ id, message })
      return
    }
    counts[entry.status]++
    if (entry.status === 'removed') return

    const doc = readLines(root, entry.doc, fsApi, cache)
    if (typeof doc === 'string') findings.push({ id, message: doc })
    else if (linesContaining(doc, entry.quote).length === 0) {
      findings.push({ id, message: `quote is no longer in ${entry.doc}: "${entry.quote}"` })
    }

    const { file, line } = parseSource(entry.source)
    // Markdown under src/ is shipped code (the prompt templates the app sends to the agent), and
    // a skill under .claude/skills/ is the procedure the release agent runs; anywhere else a
    // Markdown file is another doc, which is not proof.
    if (file.endsWith('.md') && !file.startsWith('src/') && !file.startsWith('.claude/skills/')) {
      findings.push({ id, message: `source ${file} is a Markdown doc – prove claims from code, not from another doc` })
    } else {
      const lines = readLines(root, file, fsApi, cache)
      if (typeof lines === 'string') findings.push({ id, message: lines })
      else if (!(lines[line - 1] ?? '').includes(entry.match)) {
        const hits = linesContaining(lines, entry.match)
        if (hits.length === 1) {
          moves.push({ index, source: `${file}:${hits[0]}` })
          findings.push({ id, message: `${entry.source} no longer has "${entry.match}"; it moved to line ${hits[0]} (--update fixes this)` })
        } else if (hits.length > 1) {
          findings.push({ id, message: `${entry.source} no longer has "${entry.match}"; it is on lines ${hits.join(', ')} – pick one by hand` })
        } else {
          findings.push({ id, message: `${entry.source} no longer has "${entry.match}" anywhere in ${file} – re-check the claim on ${entry.doc}` })
        }
      }
    }

    if (entry.evidence === 'app' && entry.test !== undefined) {
      const test = readLines(root, entry.test, fsApi, cache)
      if (typeof test === 'string') findings.push({ id, message: `test ${test}` })
    }
  })
  return { findings, moves, counts }
}

export function run(argv, { root, fsApi = nodeFs, log = console.log, error = console.error }) {
  const unknown = argv.filter((a) => a !== '--update')
  if (unknown.length) {
    error(`check-claims: unknown option ${unknown[0]} (usage: check-claims.mjs [--update])`)
    return 1
  }
  const update = argv.includes('--update')
  const ledgerPath = path.join(root, LEDGER)
  let ledger
  try {
    ledger = JSON.parse(fsApi.readFileSync(ledgerPath, 'utf8'))
  } catch (e) {
    error(`check-claims: cannot read ${LEDGER}: ${e.message}`)
    return 1
  }
  let { findings, moves, counts } = checkLedger(ledger, { root, fsApi })
  if (update && moves.length) {
    for (const move of moves) ledger.claims[move.index].source = move.source
    fsApi.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n')
    log(`check-claims: re-anchored ${moves.length} entr${moves.length === 1 ? 'y' : 'ies'}.`)
    ;({ findings, counts } = checkLedger(ledger, { root, fsApi }))
  }
  const printable = (s) => {
    let out = ''
    for (const ch of s) out += ch < ' ' || ch === '\u007f' ? '?' : ch
    return out
  }
  for (const f of findings) error(printable(`${LEDGER}: ${f.id}: ${f.message}`))
  const tally = `${counts.verified} verified, ${counts.fixed} fixed, ${counts.removed} removed`
  if (findings.length === 0) {
    log(`check-claims: ${ledger.claims.length} claims (${tally}), no drift.`)
    return 0
  }
  error(`check-claims: ${findings.length} finding(s) in ${ledger.claims.length} claims (${tally}).`)
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = run(process.argv.slice(2), { root })
}
