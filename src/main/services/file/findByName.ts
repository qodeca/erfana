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
 * Bounded so a link can never cost an unbounded walk:
 *
 * - at most {@link FIND_BY_NAME_MAX_RESULTS} results and
 *   {@link FIND_BY_NAME_MAX_FOLDERS} folders. A folder joins the list of
 *   folders to read only while the list is under that bound, so the list
 *   itself – the search's memory – is bounded too;
 * - a fixed pool of {@link FIND_BY_NAME_CONCURRENCY} reads in flight, which
 *   take folders from that list in O(1);
 * - a hard deadline of {@link FIND_BY_NAME_TIME_LIMIT_MS}: the search answers
 *   then with what it found, even while a read still hangs (a stale network
 *   mount), and a read that settles later is dropped;
 * - `isCurrent`: a project switch ends it at the next read.
 *
 * Past any bound it answers `truncated`. It never follows a link or a junction
 * and never answers with one (a link's entry is a link, not a folder or a
 * file, to `readdir`), so it cannot leave the folder it was given – which the
 * IPC handler has already confined to the project root. Names are compared
 * case-insensitively, as the renderer's index does.
 *
 * Known limit (Windows, inferred from libuv): libuv reports every reparse
 * point as a link, and OneDrive "online-only" files and folders are reparse
 * points, so a file that is not downloaded – or anything in such a folder –
 * is not found.
 *
 * {@link createFindByNameGate} bounds the searches across calls.
 */
import { readdir as fsReaddir } from 'fs/promises'
import type { Dirent } from 'fs'
import { join } from 'path'
import { createConcurrencyLimit } from '../../utils/concurrencyLimit'

export const FIND_BY_NAME_MAX_RESULTS = 20
export const FIND_BY_NAME_MAX_FOLDERS = 20_000
export const FIND_BY_NAME_TIME_LIMIT_MS = 1_500
/** Folder reads in flight; the same order as the tree walk's */
export const FIND_BY_NAME_CONCURRENCY = 16
/** Searches in flight in the whole process ({@link createFindByNameGate}) */
export const FIND_BY_NAME_MAX_SEARCHES = 2
/** Searches waiting for a slot; past this a call answers `truncated` at once */
export const FIND_BY_NAME_MAX_WAITING = 8

type ReadFolder = (path: string) => Promise<Dirent[]>

export interface FindByNameOptions {
  /**
   * Whether to leave an entry out (and, for a folder, not to enter it):
   * hidden names, the exclude list and ignored folders. `rel` is
   * `/`-separated below `base`'s project-relative path, or null when no
   * project filter applies.
   */
  readonly skip: (name: string, rel: string | null, isDirectory: boolean) => boolean
  /** `base`'s project-relative path (`''` for the root), or null */
  readonly baseRel: string | null
  /** Where `base` is read, when that differs from `base` (its real path); results are built from `base` */
  readonly readBase?: string
  /** False once the project the search was asked under has changed: the search ends */
  readonly isCurrent?: () => boolean
  /** Clock, for tests */
  readonly now?: () => number
  /** Folder listing, for tests */
  readonly readdir?: ReadFolder
}

export interface FindByNameResult {
  /** Absolute paths, built from `base` as given */
  readonly paths: string[]
  /** A bound stopped the search early: the list may be incomplete */
  readonly truncated: boolean
}

interface Folder {
  /** Where it is read */
  readonly read: string
  /** Where its results are said to be */
  readonly shown: string
  readonly rel: string | null
}

const defaultReaddir: ReadFolder = (path) => fsReaddir(path, { withFileTypes: true })

/**
 * @param base - The folder to search below, already confined by the caller
 * @param name - A plain file name (no separators)
 */
export async function findByName(base: string, name: string, options: FindByNameOptions): Promise<FindByNameResult> {
  const now = options.now ?? (() => performance.now())
  const read = options.readdir ?? defaultReaddir
  const deadline = now() + FIND_BY_NAME_TIME_LIMIT_MS
  const wanted = name.toLowerCase()
  const paths: string[] = []
  // Every folder ever listed for reading; `head` is the next one to read
  const folders: Array<Folder | undefined> = [{ read: options.readBase ?? base, shown: base, rel: options.baseRel }]
  let head = 0
  let active = 0
  let truncated = false
  let stopped = false
  let finish!: () => void
  const finished = new Promise<void>((resolve) => (finish = resolve))

  const end = (cut: boolean): void => {
    if (stopped) return
    stopped = true
    if (cut) truncated = true
    finish()
  }

  const overBound = (): boolean =>
    paths.length >= FIND_BY_NAME_MAX_RESULTS || now() > deadline || options.isCurrent?.() === false

  const take = (folder: Folder, entries: Dirent[]): void => {
    for (const entry of entries) {
      const childRel = folder.rel === null ? null : folder.rel === '' ? entry.name : `${folder.rel}/${entry.name}`
      const isDirectory = entry.isDirectory()
      if (options.skip(entry.name, childRel, isDirectory)) continue
      if (isDirectory) {
        // Listed only while the list is under the folder bound
        if (folders.length >= FIND_BY_NAME_MAX_FOLDERS) truncated = true
        else folders.push({ read: join(folder.read, entry.name), shown: join(folder.shown, entry.name), rel: childRel })
      } else if (entry.isFile() && entry.name.toLowerCase() === wanted) {
        if (paths.length < FIND_BY_NAME_MAX_RESULTS) paths.push(join(folder.shown, entry.name))
        else truncated = true
      }
    }
  }

  const pump = (): void => {
    while (!stopped && active < FIND_BY_NAME_CONCURRENCY && head < folders.length) {
      if (overBound()) return end(true)
      const folder = folders[head]!
      // Read once: drop it from the list so its memory goes
      folders[head++] = undefined
      active++
      read(folder.read).then(
        (entries) => {
          active--
          if (stopped) return
          if (options.isCurrent?.() === false) return end(true)
          take(folder, entries)
          pump()
        },
        () => {
          // An unreadable folder is skipped
          active--
          pump()
        }
      )
    }
    if (!stopped && active === 0 && head >= folders.length) end(false)
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, deadline - now()))
  })
  pump()
  await Promise.race([finished, expired])
  clearTimeout(timer)
  // The deadline came first: answer with what was found, drop late reads
  end(true)
  if (paths.length >= FIND_BY_NAME_MAX_RESULTS) truncated = true
  return { paths: [...paths].sort(), truncated }
}

export interface FindByNameGate {
  /**
   * Run `search` for `key` once a slot is free. A call whose key is already
   * searched for (waiting or running) shares that search; a call that finds
   * {@link FIND_BY_NAME_MAX_WAITING} searches waiting answers `truncated`
   * with nothing, at once.
   */
  run(key: string, search: () => Promise<FindByNameResult>): Promise<FindByNameResult>
}

/**
 * One per process: at most {@link FIND_BY_NAME_MAX_SEARCHES} searches in
 * flight, whatever the number of windows, terminals or hovered lines.
 */
export function createFindByNameGate(
  maxSearches = FIND_BY_NAME_MAX_SEARCHES,
  maxWaiting = FIND_BY_NAME_MAX_WAITING
): FindByNameGate {
  const slots = createConcurrencyLimit(maxSearches)
  const pending = new Map<string, Promise<FindByNameResult>>()
  let waiting = 0
  return {
    run(key, search) {
      const shared = pending.get(key)
      if (shared) return shared
      if (waiting >= maxWaiting) return Promise.resolve({ paths: [], truncated: true })
      waiting++
      const result = slots
        .run(() => {
          waiting--
          return search()
        })
        .finally(() => pending.delete(key))
      pending.set(key, result)
      return result
    }
  }
}
