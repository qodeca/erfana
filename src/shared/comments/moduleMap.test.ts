// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Every comment module is in the architecture note's module map (spec 024,
 * 024-FR-001, 024-AC-001; architecture note
 * specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md
 * § 1).
 *
 * Every source file under the comment folders is looked up in the tables of
 * § 1: a row names it by module name inside a code span (`thread`,
 * `CommentWindow`(+css), `markdownComments/{mdIndex,slots}.ts`), or covers
 * its folder with a `folder/*` span. The row must carry a mark – S (shared),
 * H (HTML-specific) or M (Markdown-specific) – and a reason when the mark
 * names a preview (`H`, `M`, `S + H`, `H / S`).
 *
 * Tests, test helpers, fixtures and conformance hosts (folders named
 * `__…__`) are not modules of the map, as in `importBoundary.test.ts`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = resolve(__dirname, '../../..')
const NOTE = 'specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md'

/** The folders that hold comment modules: the shared base, and each preview's own. */
const COMMENT_FOLDERS = [
  'src/shared/comments',
  'src/shared/htmlComments',
  'src/shared/markdownComments',
  'src/main/services/comments',
  'src/main/services/preview/comments',
  'src/main/ipc/comments',
  'src/preload/previewPageComments',
  'src/renderer/src/components/Comments',
  'src/renderer/src/components/Editor/markdownComments',
  'src/renderer/src/components/Panels/HtmlPreviewPanel/comments',
  'src/renderer/src/services/comments'
]

const SOURCE = /\.(ts|tsx)$/
const TEST = /\.test\.(ts|tsx)$/
/** A mark cell: S, H or M first (`S + H`, `H / S`, `S (for renderer-hosted previews)`). */
const MARK = /^(S|H|M)\b/
/** A mark that names a preview (`H`, `M`, `S + H`, `H / S`): its row says why. A shared mark may qualify itself. */
const PREVIEW_SPECIFIC = /\b(H|M)\b/
/** A reason cell that gives no reason. */
const NO_REASON = /^(–|-|)$/

const toRepoPath = (absolute: string): string => relative(REPO, absolute).split(sep).join('/')

/** Every non-test source file under `dir`, repo-relative; folders named `__…__` hold tests, helpers and fixtures. */
function sources(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return /^__.*__$/.test(name) ? [] : sources(path)
    return SOURCE.test(name) && !TEST.test(name) && !name.endsWith('.d.ts') ? [toRepoPath(path)] : []
  })
}

/** One table row of § 1: the module names and folders it covers, its mark and its reason. */
interface MapRow {
  readonly line: string
  readonly names: ReadonlySet<string>
  readonly folders: readonly string[]
  readonly mark: string | null
  readonly reason: string
}

/** The table rows of § 1 "Module map" (header and divider rows dropped). */
function mapRows(note: string): MapRow[] {
  const start = note.indexOf('## 1. Module map')
  const end = note.indexOf('\n## 2.', start)
  if (start === -1 || end === -1) throw new Error(`${NOTE} has no § 1 "Module map" before § 2`)
  return note
    .slice(start, end)
    .split(/\r?\n/)
    .filter(line => line.startsWith('|') && !/^\|[\s|:-]+\|$/.test(line) && !/^\|\s*Modules?\s*\|/.test(line))
    .map(line => {
      const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map(cell => cell.trim())
      const markAt = cells.findIndex((cell, index) => index > 0 && MARK.test(cell))
      // The module cells: the name, and where a split or moved module now lives ("Now", "Becomes").
      const spans = cells
        .slice(0, markAt === -1 ? cells.length : markAt)
        .flatMap(cell => [...cell.matchAll(/`([^`]+)`/g)].map(match => match[1]))
      const names = new Set(
        spans.flatMap(span => span.split(/[{},/\s()+]+/)).map(token => token.replace(SOURCE, '')).filter(Boolean)
      )
      const folders = spans.filter(span => span.endsWith('/*')).map(span => span.slice(0, -1))
      return {
        line,
        names,
        folders,
        mark: markAt === -1 ? null : cells[markAt],
        reason: markAt === -1 ? '' : (cells[markAt + 1] ?? '')
      }
    })
}

/** The row that maps `file`, or `undefined`. */
function rowOf(rows: readonly MapRow[], file: string): MapRow | undefined {
  const name = file.slice(file.lastIndexOf('/') + 1).replace(SOURCE, '')
  return rows.find(row => row.folders.some(folder => file.startsWith(folder)) || row.names.has(name))
}

describe('the module map of architecture note 001', () => {
  const rows = mapRows(readFileSync(join(REPO, NOTE), 'utf8'))
  const files = COMMENT_FOLDERS.flatMap(folder => sources(join(REPO, folder)))

  it('024-AC-001 every comment module is in the module map, marked shared or preview-specific with a reason', () => {
    const missing = files.filter(file => rowOf(rows, file) === undefined)
    expect(missing, 'add a row to § 1 for each').toEqual([])
    const unmarked = files.filter(file => rowOf(rows, file)?.mark === null)
    expect(unmarked, 'the row has no S, H or M mark').toEqual([])
    const unreasoned = files.filter(file => {
      const row = rowOf(rows, file)
      return row?.mark != null && PREVIEW_SPECIFIC.test(row.mark) && NO_REASON.test(row.reason)
    })
    expect(unreasoned, 'a row marked H or M gives its reason').toEqual([])
  })

  it('reads every comment folder', () => {
    for (const folder of COMMENT_FOLDERS) expect(files.some(file => file.startsWith(`${folder}/`)), folder).toBe(true)
  })

  it('reads names, brace lists and folder rows the way the map writes them', () => {
    const sample = [
      '## 1. Module map',
      '| Module | Mark | Reason |',
      '|---|---|---|',
      '| `CommentWindow`(+css), `markdownComments/{mdIndex,slots}.ts` | M | Markdown only |',
      '| `src/preload/previewPageComments/*` (22 modules) | H | Runs in the page |',
      '| `thread` | S | – |',
      '| `loose` | none | – |',
      '## 2. Next'
    ].join('\n')
    const parsed = mapRows(sample)
    expect(parsed).toHaveLength(4)
    expect(rowOf(parsed, 'src/renderer/src/components/Comments/CommentWindow.tsx')?.mark).toBe('M')
    expect(rowOf(parsed, 'src/shared/markdownComments/slots.ts')?.reason).toBe('Markdown only')
    expect(rowOf(parsed, 'src/preload/previewPageComments/pins.ts')?.mark).toBe('H')
    expect(rowOf(parsed, 'src/shared/comments/thread.ts')?.reason).toBe('–')
    expect(rowOf(parsed, 'src/shared/comments/loose.ts')?.mark).toBeNull()
    expect(rowOf(parsed, 'src/shared/comments/absent.ts')).toBeUndefined()
    expect(PREVIEW_SPECIFIC.test('S (for renderer-hosted previews)')).toBe(false)
    expect(['H', 'M', 'S + H', 'H / S', 'S (`htmlKind` is H)'].filter(mark => !PREVIEW_SPECIFIC.test(mark))).toEqual([])
  })
})
