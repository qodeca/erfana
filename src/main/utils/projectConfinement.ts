// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * projectConfinement - keeping renderer-supplied paths inside the open project.
 *
 * `path.resolve` only normalises the path *string*: it collapses `..` segments
 * but does not resolve symlinks. A link created inside the project that points
 * outside it therefore passes a lexical check, and whatever it points at is
 * read anyway (issue #70, security MEDIUM-2). Confinement here is two stages:
 *
 * 1. **lexical** - no filesystem access, rejects the obvious traversal and
 *    never discloses whether an out-of-project path exists;
 * 2. **canonical** - `fs.realpath` both ends and compare again, so an
 *    in-project symlink cannot smuggle an out-of-project target through
 *    stage 1. Both sides come from `realpath`, so platform canonicalisation
 *    (Windows casing, `/tmp` -> `/private/tmp` on macOS) applies to each.
 *
 * Stage 2 needs the path to exist. A path that does not is reported as
 * `missing` rather than `outside`, so the caller's own operation raises the
 * authentic ENOENT instead of this module claiming the file left the project.
 *
 * This generalises the check `file:revealInFileManager` already ships in
 * `src/main/ipc/file-handlers.ts` so the read handlers and the file watcher can
 * share it. That handler deliberately keeps its own copy: it needs the
 * canonical path itself to hand to `shell.showItemInFolder`, and it answers
 * with per-verdict user-facing strings instead of throwing.
 */
import path from 'path'
import { realpath } from 'fs/promises'

/** Refusal message for a path that leaves the project. */
export const OUTSIDE_PROJECT_MESSAGE = 'Cannot read files outside the project directory'

/** Refusal message for a path whose confinement could not be established. */
export const UNVERIFIABLE_PATH_MESSAGE = 'Cannot verify this path is inside the project directory'

/**
 * What a confinement check concluded.
 *
 * - `inside` - lexically and canonically within the project root
 * - `outside` - escapes the project, lexically or through a symlink
 * - `missing` - inside lexically, but the path (or the root) does not exist,
 *   so the canonical stage could not run
 * - `unverifiable` - the canonical stage failed for a reason other than
 *   ENOENT (EACCES, ELOOP, ENOTDIR)
 */
export type ConfinementVerdict = 'inside' | 'outside' | 'missing' | 'unverifiable'

/**
 * Stage 1: string-level containment. The root itself counts as inside, so a
 * caller may stat or reveal the project folder.
 */
export function isLexicallyInside(filePath: string, projectPath: string): boolean {
  const resolved = path.resolve(filePath)
  const resolvedRoot = path.resolve(projectPath)
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
}

/**
 * Run both stages and report what they concluded.
 *
 * The canonical stage runs even when the lexical one already said "outside":
 * `/tmp` and `/private/tmp` name the same macOS directory, so a root and a file
 * recorded through different aliases must not be called an escape. What the
 * lexical result then decides is how an *unresolvable* path is treated - inside
 * lexically it is `missing`/`unverifiable` (the caller's own ENOENT is the
 * honest error), outside lexically it stays `outside`, so this never becomes an
 * existence oracle for arbitrary filesystem paths.
 */
export async function classifyConfinement(
  filePath: string,
  projectPath: string
): Promise<ConfinementVerdict> {
  const lexicallyInside = isLexicallyInside(filePath, projectPath)

  let realRoot: string
  let realTarget: string
  try {
    realRoot = await realpath(path.resolve(projectPath))
    realTarget = await realpath(path.resolve(filePath))
  } catch (error) {
    if (!lexicallyInside) {
      return 'outside'
    }
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unverifiable'
  }

  return realTarget === realRoot || realTarget.startsWith(realRoot + path.sep)
    ? 'inside'
    : 'outside'
}

/**
 * Guard for handlers that read file **content**: the path must be inside the
 * open project, and there must be an open project at all.
 *
 * A `missing` verdict is allowed through on purpose - the read that follows
 * fails with its own ENOENT, which is the honest error for the caller.
 *
 * @throws Error when there is no project, the input is not a path, or the path
 *         escapes (or cannot be proven not to escape) the project
 */
export async function assertInsideProject(
  filePath: string,
  projectPath: string | null
): Promise<void> {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path')
  }
  if (!projectPath) {
    throw new Error('No project is open')
  }

  const verdict = await classifyConfinement(filePath, projectPath)
  if (verdict === 'outside') {
    throw new Error(OUTSIDE_PROJECT_MESSAGE)
  }
  if (verdict === 'unverifiable') {
    throw new Error(UNVERIFIABLE_PATH_MESSAGE)
  }
}

/**
 * Weaker guard for handlers that must keep serving paths the user picked
 * outside the project (see `file:getStats`): a path that was never in the
 * project is left alone, but one that *looks* in-project may not canonically
 * escape it through a symlink.
 *
 * @throws Error when an in-project path canonically resolves outside
 */
export async function assertNoConfinementEscape(
  filePath: string,
  projectPath: string | null
): Promise<void> {
  if (!projectPath || !filePath || typeof filePath !== 'string') {
    return
  }
  if (!isLexicallyInside(filePath, projectPath)) {
    return
  }
  if ((await classifyConfinement(filePath, projectPath)) === 'outside') {
    throw new Error(OUTSIDE_PROJECT_MESSAGE)
  }
}
