// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Release-time check: the versions the docs state as current match package.json.
//
// Several docs carry a copy of the app version or the Electron version, and
// nothing failed when one was left behind: SDLC.md still named Electron 39
// after the move to Electron 44 (lens review of v0.21.0, finding [40]).
// Each copy is listed in CLAIMS with the phrase that holds it, and is compared
// with the package manifests:
//
//   app       – `version` in package.json
//   electron  – the Electron major, from the `electron` range in package.json
//   range     – that range exactly as declared (`^44.9.0`), so a move to `~`
//               or to an exact pin is caught too
//   locked    – the Electron version resolved in package-lock.json
//
// Each phrase must match exactly once in its file. One that is no longer there
// fails, because a reworded line would otherwise pass unchecked; one that
// matches twice fails too, because only one of the two would be checked.
// Either way, update the doc or CLAIMS in the same change.
// Historical lines ("measured on Electron 39") are deliberately not listed.
// The Windows status-snapshot anchor has its own gate (`windows_snapshot` in
// .claude/agents/release-quality-runner.md) and is not repeated here.
//
// Run by the releasing-erfana pre-flight (`npm run check:version-drift`), after
// the version bump, so package.json already carries the version being tagged.
// Read-only. Exit 0 when every claim matches, 1 otherwise.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Every doc line that states a current version. `pattern` has exactly one
 * capture group, the claimed value; `source` names the manifest value it must
 * equal. The patterns are fixed phrases with no nested quantifiers, so a
 * hostile doc cannot make them backtrack.
 */
export const CLAIMS = [
  { file: 'CLAUDE.md', source: 'app', pattern: /^- \*\*Current version\*\*: v(\d+\.\d+\.\d+)\b/m },
  { file: 'CLAUDE.md', source: 'electron', pattern: /Electron (\d+) bundles Node\.js/ },
  { file: 'SDLC.md', source: 'electron', pattern: /^\| Stack \| Electron (\d+)\b/m },
  { file: 'CONTRIBUTING.md', source: 'electron', pattern: /\(Electron (\d+) bundles Node\.js/ },
  { file: 'docs/getting-started.md', source: 'locked', pattern: /\(Electron (\d+\.\d+\.\d+) bundles Node\.js/ },
  { file: 'docs/security.md', source: 'electron', pattern: /^\*\*Last Updated\*\*: [^\n(]*\(Electron (\d+)\)/m },
  { file: 'docs/security.md', source: 'electron', pattern: /the app now runs Electron (\d+)\b/ },
  { file: 'docs/security.md', source: 'electron', pattern: /Full support for Electron (\d+)\.x/ },
  { file: 'docs/security.md', source: 'range', pattern: /\(`([\^~]?\d+\.\d+\.\d+)` in `package\.json`/ },
  { file: 'docs/security.md', source: 'locked', pattern: /, (\d+\.\d+\.\d+) in the lockfile\)/ },
  { file: 'docs/ui-style-guide.md', source: 'electron', pattern: /via Electron (\d+)\.x\b/ },
  { file: 'docs/terminal/flickering-prevention.md', source: 'electron', pattern: /The app now runs Electron (\d+)\b/ },
]

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
/** `^X.Y.Z`, `~X.Y.Z` or an exact `X.Y.Z` pin; the group is the major. */
const DECLARED_RANGE = /^[\^~]?(\d+)\.\d+\.\d+$/

function readJson(root, rel) {
  return JSON.parse(readFileSync(path.join(root, rel), 'utf8'))
}

/**
 * The values every claim is compared with, read from package.json and
 * package-lock.json. Throws with a readable message when a manifest does not
 * carry what the check needs, rather than comparing against `undefined`.
 */
export function readManifestVersions(root) {
  const pkg = readJson(root, 'package.json')
  const lock = readJson(root, 'package-lock.json')
  if (typeof pkg.version !== 'string' || !SEMVER.test(pkg.version)) {
    throw new Error(`package.json "version" is not X.Y.Z: ${JSON.stringify(pkg.version)}`)
  }
  const declared = pkg.devDependencies?.electron ?? pkg.dependencies?.electron
  const rangeParts = typeof declared === 'string' ? DECLARED_RANGE.exec(declared) : null
  if (!rangeParts) {
    throw new Error(`package.json "electron" is not ^X.Y.Z, ~X.Y.Z or X.Y.Z: ${JSON.stringify(declared)}`)
  }
  const locked = lock.packages?.['node_modules/electron']?.version
  if (typeof locked !== 'string' || !SEMVER.test(locked)) {
    throw new Error(`package-lock.json has no resolved electron version: ${JSON.stringify(locked)}`)
  }
  return { app: pkg.version, electron: rangeParts[1], range: declared, locked }
}

/** Every match of a claim's phrase; the pattern gains the global flag here. */
function allMatches(pattern, text) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return [...text.matchAll(new RegExp(pattern.source, flags))]
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

/**
 * Compares each claim with the manifest values. `readText(rel)` returns a
 * file's content, or null when the file is missing. Returns one result per
 * claim: `{ claim, line, found, expected, ok, reason }`.
 */
export function checkClaims(claims, versions, readText) {
  return claims.map((claim) => {
    const expected = versions[claim.source]
    const text = readText(claim.file)
    if (text === null) {
      return { claim, line: 0, found: null, expected, ok: false, reason: 'file not found' }
    }
    const matches = allMatches(claim.pattern, text)
    if (matches.length !== 1) {
      const line = matches.length > 0 ? lineOf(text, matches[0].index) : 0
      const reason = `phrase matched ${matches.length} times`
      return { claim, line, found: null, expected, ok: false, reason }
    }
    const [match] = matches
    const found = match[1]
    const ok = found === expected
    return { claim, line: lineOf(text, match.index), found, expected, ok, reason: ok ? '' : 'drift' }
  })
}

function fileReader(root) {
  return (rel) => {
    try {
      return readFileSync(path.join(root, rel), 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }
}

function describe(result) {
  const { claim, line, found, expected, reason } = result
  const where = line ? `${claim.file}:${line}` : claim.file
  if (reason === 'drift') return `${where} says ${found}; expected ${expected} (${claim.source})`
  return `${where}: ${reason} – ${claim.pattern} (expected ${expected}, ${claim.source})`
}

export function main(root = process.cwd(), claims = CLAIMS, log = console) {
  let versions
  try {
    versions = readManifestVersions(root)
  } catch (error) {
    log.error(`Version drift check could not read the manifests: ${error.message}`)
    return 1
  }
  const results = checkClaims(claims, versions, fileReader(root))
  const bad = results.filter((r) => !r.ok)
  if (bad.length) {
    log.error(`Version drift in ${bad.length} of ${results.length} documented version(s):`)
    for (const r of bad) log.error(`  ${describe(r)}`)
    log.error(
      'Update each line to match package.json, or – when a line was reworded or moved on ' +
        'purpose – update CLAIMS in scripts/check-version-drift.mjs in the same change.',
    )
    return 1
  }
  log.log(
    `All ${results.length} documented versions match package.json ` +
      `(app ${versions.app}, Electron ${versions.locked}).`,
  )
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = main(root)
}
