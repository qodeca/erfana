// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Follow the active tab in the project tree (#453): which folders a reveal
 * opens, and which of them it may close again.
 *
 * Pure set arithmetic, kept apart from React so each rule is tested on its
 * own (`revealActiveFile.test.ts`); `useRevealActiveFile` applies it.
 *
 * The rules, from the issue and the owner's answers (design note
 * docs/designs/project-tree/453-follow-active-tab.md):
 * - a file the tree's filter hides, or one outside the project, is not
 *   revealed – nothing opens and no row is marked;
 * - on the next tab switch the folders the reveal opened close again – even
 *   when the new tab cannot be revealed – except the ones the new file needs;
 * - a folder the person opened is never closed by the reveal, and neither is
 *   one they worked inside: opening or closing any folder inside a
 *   reveal-opened folder makes that folder theirs.
 */
import type { FileNode } from '../../../../shared/ipc/file-schema'
import type { FilterMode } from '../../types/filters'
import { getBasename, getDirname, isStrictDescendant, pathsEqual } from '../../utils/fileUtils'
import { isMacOS } from '../../utils/platform'
import { isMarkdownFileName } from './markdownFilter'

/**
 * Whether the reveal treats `a` and `b` as one path: by `pathsEqual`, and on
 * macOS also when they differ only in letter case or in Unicode form (NFC vs
 * NFD). The default macOS disk (APFS) ignores both, so a preview or terminal
 * link spelled `Docs/readme.md` opens the row `docs/README.md`. Main's
 * `pathCompare.ts` folds the same way. Callers try the exact spelling first,
 * so on a case-sensitive Mac volume the exact row still wins.
 *
 * @example
 * ```ts
 * revealPathsEqual('/p/Docs', '/p/docs', 'darwin') // true
 * revealPathsEqual('/p/Docs', '/p/docs', 'linux')  // false
 * ```
 */
export function revealPathsEqual(a: string, b: string, platform?: NodeJS.Platform): boolean {
  if (pathsEqual(a, b, platform)) return true
  if (!a || !b || !isMacOS(platform)) return false
  const fold = (p: string) => p.normalize('NFC').toLowerCase()
  return pathsEqual(fold(a), fold(b), platform)
}

/** What a reveal changes: the tree's open folders, and the ones the reveal owns. */
export interface RevealPlan {
  /** The open folders after the reveal; the same object when nothing changed. */
  readonly expanded: ReadonlySet<string>
  /** Folders open only because a reveal opened them – closed on the next switch. */
  readonly owned: ReadonlySet<string>
}

/** Where a reveal lands, in the tree's own spelling of each path. */
export interface RevealTarget {
  /** The folders to open, root first */
  readonly folders: string[]
  /** The file's path as the tree's row carries it (the active tab's spelling when unknown) */
  readonly file: string
}

/**
 * Where to reveal `filePath` in the tree – or `null` when the tree must not
 * reveal it.
 *
 * Paths are compared with {@link revealPathsEqual}: either separator, and on
 * Windows and macOS any case (macOS also any Unicode form), so
 * `c:/proj/src/toast.md` from one source finds the row `C:\Proj\src\Toast.md`. Each folder and the file are then named the way
 * the tree names them, read off `root`; below a folder the tree has not read
 * (a lazy folder), the active tab's own spelling is used.
 *
 * @param projectPath - The open project, or `null`
 * @param filePath - The active tab's file, or `null` (a tab with no file)
 * @param filterMode - The tree's filter: `markdown` hides every other file
 * @param root - The tree's root row, whose children are walked to spell paths
 * @param platform - Whose case rule applies; defaults to the renderer's own
 * @returns The folders and file, or `null` when the file is outside the
 *   project, hidden by the filter, or absent
 *
 * @example
 * ```ts
 * resolveReveal('/p', '/p/src/a/b.md', 'all', null)
 * // { folders: ['/p', '/p/src', '/p/src/a'], file: '/p/src/a/b.md' }
 * resolveReveal('/p', '/p/logo.png', 'markdown', null) // null – filtered out
 * resolveReveal('/p', '/elsewhere/x.md', 'all', null)  // null – outside the project
 * ```
 */
export function resolveReveal(
  projectPath: string | null,
  filePath: string | null,
  filterMode: FilterMode,
  root: FileNode | null,
  platform?: NodeJS.Platform
): RevealTarget | null {
  if (!projectPath || !filePath) return null
  if (filterMode === 'markdown' && !isMarkdownFileName(getBasename(filePath))) return null
  // The file's own folders, nearest first, up to (not including) the project
  const below: string[] = []
  let dir = getDirname(filePath)
  while (dir !== '' && !revealPathsEqual(dir, projectPath, platform)) {
    below.push(dir)
    dir = getDirname(dir)
  }
  if (dir === '') return null
  below.reverse()

  const folders = [projectPath]
  let level: readonly FileNode[] | undefined = root?.children
  for (const ownSpelling of below) {
    const node = findChild(level, ownSpelling, 'directory', platform)
    folders.push(node?.path ?? ownSpelling)
    level = node?.children
  }
  return { folders, file: findChild(level, filePath, 'file', platform)?.path ?? filePath }
}

/**
 * The child of `level` with the same name as `path`'s last segment: the exact
 * spelling (by `pathsEqual`) first, then by {@link revealPathsEqual} rules.
 */
function findChild(
  level: readonly FileNode[] | undefined,
  path: string,
  type: FileNode['type'],
  platform: NodeJS.Platform | undefined
): FileNode | undefined {
  const name = getBasename(path)
  const ofType = level?.filter((node) => node.type === type)
  return (
    ofType?.find((node) => pathsEqual(node.name, name, platform)) ??
    ofType?.find((node) => revealPathsEqual(node.name, name, platform))
  )
}

/**
 * Apply one tab switch: close what the last reveal opened and the new file
 * does not need, then open what the new file needs.
 *
 * A folder the last reveal opened that the new file also needs stays open and
 * stays owned. A folder that is already open and not owned is the person's,
 * and is never closed.
 *
 * @param expanded - The tree's open folders now
 * @param owned - The folders the last reveal opened and still owns
 * @param ancestors - The folders from {@link resolveReveal}; `null` reveals nothing
 * @returns The new open folders and the new owned set
 */
export function planReveal(
  expanded: ReadonlySet<string>,
  owned: ReadonlySet<string>,
  ancestors: readonly string[] | null
): RevealPlan {
  const needed = new Set(ancestors ?? [])
  const next = new Set(expanded)
  const nextOwned = new Set<string>()
  for (const folder of owned) {
    if (needed.has(folder) && expanded.has(folder)) nextOwned.add(folder)
    else next.delete(folder)
  }
  for (const folder of needed) {
    if (!expanded.has(folder)) {
      next.add(folder)
      nextOwned.add(folder)
    }
  }
  return { expanded: sameMembers(next, expanded) ? expanded : next, owned: nextOwned }
}

/**
 * Hand folders to the person after they opened or closed folders themselves.
 *
 * Every folder whose state changed is no longer the reveal's (opened: it is
 * theirs; closed: there is nothing left to close). Every owned folder that
 * holds a changed folder was worked inside, so it is theirs too.
 *
 * @param owned - The folders the reveal owns
 * @param previous - The open folders before the person's change
 * @param next - The open folders after it
 * @returns The owned set; the same object when nothing was handed over
 */
export function claimForUser(
  owned: ReadonlySet<string>,
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>
): ReadonlySet<string> {
  if (owned.size === 0) return owned
  const changed = [...next].filter((p) => !previous.has(p)).concat([...previous].filter((p) => !next.has(p)))
  const kept = new Set(owned)
  for (const path of changed) {
    kept.delete(path)
    for (const folder of owned) if (isStrictDescendant(folder, path)) kept.delete(folder)
  }
  return kept.size === owned.size ? owned : kept
}

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) if (!b.has(item)) return false
  return true
}
