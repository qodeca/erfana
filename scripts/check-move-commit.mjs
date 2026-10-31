// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Proves a "pure move" commit moves files and changes nothing but paths
// (spec 024, 024-FR-021, architecture note § 8 C29). For every file the commit
// touches it compares the removed and added lines after masking each quoted
// path – an import specifier such as '../htmlComments/format', or a repo path
// such as 'src/shared/htmlComments/format.ts' in a coverage-floor or max-lines
// key, or a folder built with join(__dirname, …). The masked lines must be the same multiset, so the only differences are
// paths. A file that is added or deleted without a matching rename fails.
//
// Usage: node scripts/check-move-commit.mjs <commit> [<commit> ...]
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })

/** A quoted string that is a relative specifier or a repo path. */
const PATH_LITERAL = /(['"`])(?:\.{1,2}\/|src\/|e2e\/|scripts\/)[^'"`\s]*\1/g

/** A path built from the test file's own folder: `join(__dirname, '..', '__fixtures__')`. */
const DIRNAME_PATH = /\b(?:join|resolve)\(__dirname(?:,\s*(['"])[^'"]*\1)*\)/g

/** A repo path inside longer text, such as an npm script: `esbuild src/shared/x.ts --bundle`. */
const REPO_PATH = /\b(?:src|e2e|scripts)\/(?:<wbr>|[\w./-])+/g

export function maskPaths(line) {
  return line
    .replace(DIRNAME_PATH, '<path>')
    .replace(PATH_LITERAL, '<path>')
    .replace(REPO_PATH, '<path>')
    .replace(/\s+$/, '')
}

/** Removed and added lines per file of a unified diff (`git show -M --format= -U0`). */
export function changedLines(diff) {
  const files = new Map()
  let current = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { removed: [], added: [], header: line }
      files.set(line, current)
    } else if (!current || line.startsWith('+++') || line.startsWith('---')) {
      continue
    } else if (line.startsWith('-')) current.removed.push(line.slice(1))
    else if (line.startsWith('+')) current.added.push(line.slice(1))
  }
  return files
}

/** Masked lines that are not matched one for one between removed and added. */
export function unmatched(removed, added) {
  const counts = new Map()
  for (const l of removed) counts.set(maskPaths(l), (counts.get(maskPaths(l)) ?? 0) + 1)
  for (const l of added) counts.set(maskPaths(l), (counts.get(maskPaths(l)) ?? 0) - 1)
  return [...counts].filter(([, n]) => n !== 0).map(([l, n]) => `${n > 0 ? '-' : '+'} ${l}`)
}

export function checkCommit(commit) {
  const problems = []
  const status = git(['show', '-M', '--name-status', '--format=', commit]).trim().split('\n').filter(Boolean)
  let renames = 0
  for (const row of status) {
    const [kind, ...paths] = row.split('\t')
    if (kind.startsWith('R')) renames++
    else if (kind !== 'M') problems.push(`${row}: only renames and edits are allowed in a move commit`)
    void paths
  }
  const diff = git(['show', '-M', '--format=', '-U0', '--no-color', commit])
  for (const [header, { removed, added }] of changedLines(diff)) {
    const left = unmatched(removed, added)
    if (left.length) problems.push(`${header}\n    ${left.slice(0, 8).join('\n    ')}`)
  }
  return { renames, problems }
}

function main(commits) {
  if (!commits.length) {
    console.error('usage: node scripts/check-move-commit.mjs <commit>...')
    return 2
  }
  let failed = 0
  for (const commit of commits) {
    const subject = git(['log', '-1', '--format=%h %s', commit]).trim()
    const { renames, problems } = checkCommit(commit)
    if (problems.length) {
      failed++
      console.log(`FAIL ${subject}\n  ${problems.join('\n  ')}`)
    } else {
      console.log(`ok   ${subject} – ${renames} renames, every other change is a path`)
    }
  }
  return failed ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
