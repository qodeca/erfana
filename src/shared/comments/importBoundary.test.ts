// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared comment base never depends on an HTML-only folder
 * (spec 024, 024-FR-001, 024-AC-001; architecture note 001 § 1, § 8 C22).
 *
 * Every source file under the three shared comment folders is read, its
 * imports listed by TypeScript's own pre-processor (static imports,
 * re-exports, `import()` and `require`, type-only ones included), each
 * specifier resolved to a path (relative, or through the `@main`, `@shared`,
 * `@preload` and `@renderer` aliases), and the path checked against the
 * HTML-only folders.
 *
 * Tests, test helpers and fixtures are not part of the base and are not
 * scanned: a shared module's test may drive it through the HTML kind.
 *
 * PENDING lists the imports the parse-worker split of C22 ("a shared runner
 * plus per-kind jobs") will remove. It may only shrink: a listed import that
 * is gone fails the test, so the entry must be deleted with it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const REPO = resolve(__dirname, '../../..')

/** The shared base (024-FR-001). */
const SHARED_FOLDERS = [
  'src/shared/comments',
  'src/main/services/comments',
  'src/renderer/src/components/Comments'
]

/** Folders only the HTML Preview uses. */
const HTML_ONLY_FOLDERS = [
  'src/main/services/preview/comments',
  'src/renderer/src/components/Panels/HtmlPreviewPanel/comments',
  'src/preload/previewPageComments'
]

const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['@main/', 'src/main/'],
  ['@shared/', 'src/shared/'],
  ['@preload/', 'src/preload/'],
  ['@renderer/', 'src/renderer/src/']
]

/**
 * `importing file → imported HTML-only module` (repo-relative, `/`-separated,
 * no extension), waiting for the C22 parse-worker split: the worker, its
 * protocol, its client and its job dispatcher still carry the HTML
 * instrumentation and the draft and pin jobs.
 */
const PENDING: ReadonlySet<string> = new Set([
  'src/main/services/comments/CommentParseWorkerAdapter.ts → src/main/services/preview/comments/commentParseCore',
  'src/main/services/comments/commentFileJobs.ts → src/main/services/preview/comments/commentDraftCore',
  'src/main/services/comments/commentParseProtocol.ts → src/main/services/preview/comments/commentParseCore',
  'src/main/services/comments/commentParseWorker.ts → src/main/services/preview/comments/commentParseCore'
])

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs)$/
const TEST = /\.test\.(ts|tsx|mts|cts|js|mjs)$/

const toRepoPath = (absolute: string): string => relative(REPO, absolute).split(sep).join('/')

/** Every non-test source file under `dir`; folders named `__…__` hold tests, helpers and fixtures. */
function sources(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return /^__.*__$/.test(name) ? [] : sources(path)
    return SOURCE.test(name) && !TEST.test(name) && !name.endsWith('.d.ts') ? [path] : []
  })
}

/** Where an import specifier points, repo-relative; `undefined` for a package. */
function resolveSpecifier(from: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) return toRepoPath(resolve(dirname(from), specifier))
  const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix))
  return alias ? alias[1] + specifier.slice(alias[0].length) : undefined
}

function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

/** `file → module` for every import of `file` that lands in an HTML-only folder. */
function htmlOnlyImports(file: string): string[] {
  const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true)
  return importedFiles.flatMap(({ fileName }) => {
    const target = resolveSpecifier(file, fileName)
    if (target === undefined || !HTML_ONLY_FOLDERS.some(folder => isInside(target, folder))) return []
    return [`${toRepoPath(file)} → ${target.replace(SOURCE, '')}`]
  })
}

describe('shared comment import boundary', () => {
  const files = SHARED_FOLDERS.flatMap(folder => sources(join(REPO, folder)))
  const found = files.flatMap(htmlOnlyImports)

  it('024-AC-001 shared comment folders never import an HTML-only folder', () => {
    expect(found.filter(edge => !PENDING.has(edge))).toEqual([])
  })

  it('lists no pending import that is already gone', () => {
    expect([...PENDING].filter(edge => !found.includes(edge))).toEqual([])
  })

  it('reads every shared folder', () => {
    for (const folder of SHARED_FOLDERS) {
      expect(files.some(file => isInside(toRepoPath(file), folder))).toBe(true)
    }
  })

  it('resolves relative, aliased and package specifiers', () => {
    const from = join(REPO, 'src/main/services/comments/x.ts')
    expect(resolveSpecifier(from, '../preview/comments/a')).toBe('src/main/services/preview/comments/a')
    expect(resolveSpecifier(from, '@preload/previewPageComments/b')).toBe('src/preload/previewPageComments/b')
    expect(resolveSpecifier(from, 'parse5')).toBeUndefined()
  })
})
