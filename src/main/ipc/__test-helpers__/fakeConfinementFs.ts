// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A small in-memory file system for the path checker's tests, so the Windows
 * rows run on every host. It answers `lstat`, `stat` and `realpath` the way
 * the output recorded on a Windows 11 host did:
 *
 * - `realpath` returns the on-disk spelling of every folder and file, with a
 *   capital drive letter, but keeps a UNC host and share as typed;
 * - a link (a `subst` drive, a mapped drive, a junction, a short 8.3 name) is
 *   followed by `realpath` and by every `lstat` except on its own last segment;
 * - a missing path is `ENOENT`, a path below a file is `ENOTDIR`.
 *
 * Test support only; nothing in the app imports it.
 */
import type { PlatformPath } from 'path'
import type { ConfinementFs, ConfinementStats } from '../confinement/resolveConfinedPath'

export type FakeEntry = 'dir' | 'file' | { link: string }

const MAX_LINK_DEPTH = 20

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

function statsOf(entry: FakeEntry): ConfinementStats {
  return {
    isDirectory: () => entry === 'dir',
    isFile: () => entry === 'file',
    isSymbolicLink: () => typeof entry === 'object'
  }
}

/**
 * @param flavour - `path.win32` or `path.posix`
 * @param entries - Every existing path, in its on-disk spelling (roots included)
 * @param foldCase - Names compare case-insensitively (Windows, default macOS)
 */
export function createFakeConfinementFs(
  flavour: PlatformPath,
  entries: Record<string, FakeEntry>,
  foldCase: boolean
): ConfinementFs {
  const keyOf = (value: string): string => (foldCase ? value.toLowerCase() : value)
  const trim = (value: string): string => {
    const { root } = flavour.parse(value)
    return value.length > root.length && value.endsWith(flavour.sep) ? value.slice(0, -1) : value
  }
  const table = new Map<string, { name: string; entry: FakeEntry }>()
  for (const [name, entry] of Object.entries(entries)) {
    table.set(keyOf(trim(name)), { name: trim(name), entry })
  }

  /** The canonical path and the entry it names, following every link. */
  const resolveFull = (input: string, depth = 0): { real: string; entry: FakeEntry } => {
    if (depth > MAX_LINK_DEPTH) throw errno('ELOOP')
    const abs = flavour.resolve(input)
    const { root } = flavour.parse(abs)

    const rootHit = table.get(keyOf(trim(root)))
    if (!rootHit) throw errno('ENOENT')
    let cur: string
    let curEntry: FakeEntry
    if (typeof rootHit.entry === 'object') {
      const target = resolveFull(rootHit.entry.link, depth + 1)
      cur = target.real
      curEntry = target.entry
    } else {
      // A drive letter takes the table's spelling; a UNC host and share stay as typed
      cur = /^[A-Za-z]:/.test(root) ? rootHit.name : root
      curEntry = rootHit.entry
    }

    for (const segment of abs.slice(root.length).split(flavour.sep).filter(Boolean)) {
      if (curEntry === 'file') throw errno('ENOTDIR')
      const hit = table.get(keyOf(flavour.join(cur, segment)))
      if (!hit) throw errno('ENOENT')
      if (typeof hit.entry === 'object') {
        const target = resolveFull(hit.entry.link, depth + 1)
        cur = target.real
        curEntry = target.entry
      } else {
        cur = flavour.join(cur, flavour.basename(hit.name))
        curEntry = hit.entry
      }
    }
    return { real: cur, entry: curEntry }
  }

  const lstat = async (target: string): Promise<ConfinementStats> => {
    const abs = flavour.resolve(target)
    const parent = flavour.dirname(abs)
    if (parent === abs) {
      const hit = table.get(keyOf(trim(abs)))
      if (!hit) throw errno('ENOENT')
      return statsOf(hit.entry)
    }
    const parentResolved = resolveFull(parent)
    if (parentResolved.entry === 'file') throw errno('ENOTDIR')
    const hit = table.get(keyOf(flavour.join(parentResolved.real, flavour.basename(abs))))
    if (!hit) throw errno('ENOENT')
    return statsOf(hit.entry)
  }

  return {
    lstat,
    stat: async (target) => statsOf(resolveFull(target).entry),
    realpath: async (target) => resolveFull(target).real
  }
}
