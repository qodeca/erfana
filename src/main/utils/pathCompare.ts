// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * pathCompare - pure helpers for comparing canonical paths.
 *
 * Shared by the IPC path checker (`ipc/confinement`), the project session and
 * `FileService`. The `path` flavour and the platform are injectable so the
 * Windows rules run on every host.
 */
import nodePath, { type PlatformPath } from 'path'

export interface PathFlavour {
  path: PlatformPath
  platform: NodeJS.Platform
}

export const hostPathFlavour: PathFlavour = { path: nodePath, platform: process.platform }

const WIN_EXTENDED_UNC_PREFIX = '\\\\?\\UNC\\'
const WIN_EXTENDED_PREFIX = '\\\\?\\'

/**
 * Strip a Windows extended-length prefix from `realpath` output and the
 * trailing separators past the root. Defensive: libuv does not emit the prefix.
 */
export function normaliseResolved(real: string, flavour: PathFlavour = hostPathFlavour): string {
  let n = real
  if (n.startsWith(WIN_EXTENDED_UNC_PREFIX)) {
    n = `\\\\${n.slice(WIN_EXTENDED_UNC_PREFIX.length)}`
  } else if (n.startsWith(WIN_EXTENDED_PREFIX)) {
    n = n.slice(WIN_EXTENDED_PREFIX.length)
  }
  const root = flavour.path.parse(n).root
  while (n.length > root.length && (n.endsWith(flavour.path.sep) || n.endsWith('/'))) {
    n = n.slice(0, -1)
  }
  return n
}

/** The comparison form of a path under the session's case rule. */
function comparisonKey(value: string, caseSensitive: boolean, flavour: PathFlavour): string {
  const composed = flavour.platform === 'darwin' ? value.normalize('NFC') : value
  return caseSensitive ? composed : composed.toLowerCase()
}

/**
 * `candidate` is `root` or lies below it. A segment boundary is required, so a
 * sibling that merely starts with the root's name is not inside; a root that
 * already ends in a separator (`C:\`, `\\srv\share\`) gets none added.
 */
export function isInsideRoot(
  candidate: string,
  root: string,
  caseSensitive: boolean,
  flavour: PathFlavour = hostPathFlavour
): boolean {
  const key = comparisonKey(candidate, caseSensitive, flavour)
  const rootKey = comparisonKey(root, caseSensitive, flavour)
  if (key === rootKey) return true
  const boundary = rootKey.endsWith(flavour.path.sep) ? rootKey : rootKey + flavour.path.sep
  return key.startsWith(boundary)
}

/** Two paths name the same place under the session's case rule. */
export function isSamePath(
  a: string,
  b: string,
  caseSensitive: boolean,
  flavour: PathFlavour = hostPathFlavour
): boolean {
  return comparisonKey(a, caseSensitive, flavour) === comparisonKey(b, caseSensitive, flavour)
}
