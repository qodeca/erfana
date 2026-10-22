// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * findByName – a bounded search for files of one name below a folder
 * (review finding [32], PR #320 review item 2).
 *
 * The terminal's file links resolve a bare name (`Button.tsx:42`) against the
 * project tree. When the tree is incomplete – the walk's entry cap left
 * folders unread – a name that is not in it may still be on disk, so the
 * renderer asks for this search instead of giving up.
 *
 * Bounded three ways, so a link can never cost an unbounded walk: at most
 * {@link FIND_BY_NAME_MAX_RESULTS} results, {@link FIND_BY_NAME_MAX_FOLDERS}
 * folders listed, and {@link FIND_BY_NAME_TIME_LIMIT_MS} of wall time; past any
 * of them it answers with what it found. It never follows a link or a junction
 * and never answers with one (a link's entry is a link, not a folder or a
 * file, to `readdir`), so it cannot leave the folder it was given – which the
 * IPC handler has already confined to the project. Names are compared
 * case-insensitively, as the renderer's index does.
 */
import { readdir } from 'fs/promises'
import { join } from 'path'
import { createConcurrencyLimit } from '../../utils/concurrencyLimit'

export const FIND_BY_NAME_MAX_RESULTS = 20
export const FIND_BY_NAME_MAX_FOLDERS = 20_000
export const FIND_BY_NAME_TIME_LIMIT_MS = 1_500
/** Folder reads in flight; the same order as the tree walk's */
const FIND_BY_NAME_CONCURRENCY = 16

export interface FindByNameOptions {
  /**
   * Whether to leave an entry out (and, for a folder, not to enter it):
   * hidden names and the exclude list. `rel` is `/`-separated below `base`'s
   * project-relative path, or null when no project filter applies.
   */
  readonly skip: (name: string, rel: string | null, isDirectory: boolean) => boolean
  /** `base`'s project-relative path (`''` for the root), or null */
  readonly baseRel: string | null
  /** Clock, for tests */
  readonly now?: () => number
}

export interface FindByNameResult {
  /** Absolute paths, built from `base` as given */
  readonly paths: string[]
  /** A bound stopped the search early: the list may be incomplete */
  readonly truncated: boolean
}

/**
 * @param base - The folder to search below, already confined by the caller
 * @param name - A plain file name (no separators)
 */
export async function findByName(base: string, name: string, options: FindByNameOptions): Promise<FindByNameResult> {
  const now = options.now ?? (() => performance.now())
  const deadline = now() + FIND_BY_NAME_TIME_LIMIT_MS
  const wanted = name.toLowerCase()
  const reads = createConcurrencyLimit(FIND_BY_NAME_CONCURRENCY)
  const paths: string[] = []
  let folders = 0
  let truncated = false

  const stop = (): boolean => {
    if (paths.length >= FIND_BY_NAME_MAX_RESULTS || folders >= FIND_BY_NAME_MAX_FOLDERS || now() > deadline) {
      truncated = true
      return true
    }
    return false
  }

  const visit = async (dir: string, rel: string | null): Promise<void> => {
    const entries = await reads.run(async () => {
      if (stop()) return null
      folders++
      try {
        return await readdir(dir, { withFileTypes: true })
      } catch {
        return null
      }
    })
    if (entries === null) return
    const below: Promise<void>[] = []
    for (const entry of entries) {
      const childRel = rel === null ? null : rel === '' ? entry.name : `${rel}/${entry.name}`
      const isDirectory = entry.isDirectory()
      if (options.skip(entry.name, childRel, isDirectory)) continue
      if (isDirectory) {
        below.push(visit(join(dir, entry.name), childRel))
      } else if (entry.isFile() && entry.name.toLowerCase() === wanted) {
        if (paths.length < FIND_BY_NAME_MAX_RESULTS) paths.push(join(dir, entry.name))
        else truncated = true
      }
    }
    await Promise.all(below)
  }

  await visit(base, options.baseRel)
  return { paths: paths.sort(), truncated }
}
