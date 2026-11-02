// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Proves the seam (spec 024, 024-FR-002, 024-AC-002, architecture note 001
// § 3 and § 8 C24): the commit that adds the test-only `.txt` preview plugs a
// new text-file preview in WITHOUT editing the shared comment base. For every
// path the commit touches (`git show --name-status`) one of these must hold:
//
//   * it is NEW and test-only – a `*.test.*` or `*.suite.*` file, or a file
//     under a `__conformance__`, `__test-helpers__`, `__test-utils__` or
//     `__fixtures__` folder;
//   * it is a COMPOSITION ROOT – main's file-kind registry, the parse-worker
//     entry, a preview's adapter wiring or Settings (outside the base, § 8 C24),
//     where a kind is registered; these may be edited;
//   * it is this check itself, added with the commit it checks.
//
// Anything else – an edited, deleted or renamed base file, or a new
// production module – fails, naming the path and why.
//
// Usage: node scripts/check-seam-commit.mjs <commit> [<commit> ...]
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })

/** Where a preview registers itself: outside the base, so editing one never touches it (§ 8 C24). */
export const COMPOSITION_ROOTS = [
  'src/main/services/comments/commentFileKinds.ts',
  'src/main/services/workers/comment-parse.worker.ts',
  'src/renderer/src/components/Editor/markdownComments/useMarkdownComments.tsx',
  'src/shared/ipc/global-settings-schema.ts',
  'src/renderer/src/components/Settings/sections/CommentsSection.tsx'
]

/** This check, which may land in the commit it checks. */
export const SELF = ['scripts/check-seam-commit.mjs', 'scripts/check-seam-commit.test.mjs']

const TEST_FILE = /\.(test|suite)\.[cm]?[jt]sx?$/
const TEST_FOLDER = /(^|\/)__(conformance|test-helpers|test-utils|fixtures)__\//

/** Whether `file` is test-only by its name or its folder. */
export function isTestOnly(file) {
  return TEST_FILE.test(file) || TEST_FOLDER.test(file)
}

/** `git show --name-status` rows as `{ status, paths }`; a rename or copy lists its old and new path. */
export function parseNameStatus(output) {
  return output
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(Boolean)
    .map(line => {
      const [status, ...paths] = line.split('\t')
      return { status, paths }
    })
}

/** Why `row` breaks the seam, or `null` when it keeps it. */
export function seamProblem({ status, paths }) {
  const [file] = paths
  const kind = status[0]
  if (kind === 'A') {
    if (isTestOnly(file) || SELF.includes(file)) return null
    return `${file}: a new non-test file – a new preview adds only tests and its own test-only parts`
  }
  if (kind === 'M' && COMPOSITION_ROOTS.includes(file)) return null
  if (kind === 'M') return `${file}: an edit outside the composition roots – the shared base must not change`
  if (kind === 'D') return `${file}: deleted – the shared base must not change`
  return `${paths.join(' -> ')}: ${status} – only new test files and edits to the composition roots are allowed`
}

/** Every problem in `rows`, and what kept the seam. */
export function checkRows(rows) {
  const problems = rows.map(seamProblem).filter(problem => problem !== null)
  const added = rows.filter(row => row.status === 'A').length
  const roots = rows.filter(row => row.status === 'M' && COMPOSITION_ROOTS.includes(row.paths[0])).length
  return { problems, added, roots }
}

export function checkCommit(commit) {
  return checkRows(parseNameStatus(git(['show', '--no-renames', '--name-status', '--format=', commit])))
}

function main(commits) {
  if (!commits.length) {
    console.error('usage: node scripts/check-seam-commit.mjs <commit>...')
    return 2
  }
  let failed = 0
  for (const commit of commits) {
    const subject = git(['log', '-1', '--format=%h %s', commit]).trim()
    const { problems, added, roots } = checkCommit(commit)
    if (problems.length) {
      failed++
      console.log(`FAIL ${subject}\n  ${problems.join('\n  ')}`)
    } else {
      console.log(`ok   ${subject} – ${added} new test-only files, ${roots} composition-root edits, no base file touched`)
    }
  }
  return failed ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
