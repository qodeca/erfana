// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * childPath - join one entry name onto a folder that was already checked, and
 * make sure the result is exactly one level below it.
 *
 * A name is a single path segment. `.` and `..` are not names: joined onto a
 * folder they point at the folder itself or at its parent, so an operation that
 * acts on "the new entry" would act on a folder the path check never saw. On
 * Windows a name that ends in a dot or a space is trimmed by Win32 (`.. ` opens
 * as `..`), so those are refused too.
 */
import nodePath, { type PlatformPath } from 'path'

export interface ChildPathDeps {
  path: PlatformPath
  platform: NodeJS.Platform
}

const defaultDeps: ChildPathDeps = { path: nodePath, platform: process.platform }

/**
 * @param parent - A folder the path check has already accepted
 * @param name - The entry name to place inside it
 * @returns The joined path
 * @throws Error when `name` is not a plain single-level name
 */
export function childPath(
  parent: string,
  name: string,
  deps: ChildPathDeps = defaultDeps
): string {
  const { path, platform } = deps
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
    throw new Error('Invalid name')
  }
  if (platform === 'win32' && /[. ]$/.test(name)) {
    throw new Error('Invalid name')
  }
  const joined = path.join(parent, name)
  if (path.dirname(path.resolve(joined)) !== path.resolve(parent)) {
    throw new Error('Invalid name')
  }
  return joined
}
