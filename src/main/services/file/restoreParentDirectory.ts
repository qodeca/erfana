// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * restoreParentDirectory - recreate the missing folders above a file that the
 * user explicitly asked to restore.
 *
 * An editor tab whose file was deleted on disk says "Save to restore it". When
 * the file went away because its whole folder was renamed or deleted, a plain
 * write fails with ENOENT, so the restore needs the folder chain back first.
 * This runs only for that explicit restore (the tab's own Cmd/Ctrl+S of a tab in
 * the deleted state) – never for an autosave or a normal save – so the app
 * never silently re-creates a folder somebody just renamed.
 *
 * Confinement follows `resolveInsideProject`: the nearest folder that still
 * exists is checked canonically (realpath of it and of the project root), never
 * by string alone, so a path spelled through an alias (`/var` vs
 * `/private/var`) or in another letter case still restores. Every folder that
 * gets created sits below that ancestor (the walk only goes up by `dirname`),
 * so `mkdir -p` can only create folders inside the project.
 */
import { lstat, mkdir, realpath } from 'fs/promises'
import { dirname, resolve } from 'path'
import { classifyConfinement } from '../../utils/projectConfinement'

/** Refusal when the file to restore does not resolve inside the open project. */
export const RESTORE_OUTSIDE_PROJECT_MESSAGE =
  'Cannot restore a file outside the project directory'

/** Refusal when the project folder itself was renamed, moved or deleted. */
export const RESTORE_PROJECT_GONE_MESSAGE =
  'Cannot restore the file: the project folder no longer exists'

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target)
    return true
  } catch {
    return false
  }
}

/**
 * Make sure the folder that should hold `filePath` exists, creating the
 * missing part of the chain inside the project.
 *
 * @throws when no project is open, when the project folder itself is gone, or
 *         when the nearest existing ancestor does not resolve inside the project
 */
export async function restoreParentDirectory(
  filePath: string,
  projectPath: string | null
): Promise<void> {
  if (!projectPath) throw new Error('No project is open')

  const parent = dirname(resolve(filePath))
  let nearest = parent
  while (!(await exists(nearest))) {
    const up = dirname(nearest)
    if (up === nearest) break
    nearest = up
  }
  if (nearest === parent) return

  // The root itself gone is its own, honest reason - not "outside the project"
  try {
    await realpath(resolve(projectPath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(RESTORE_PROJECT_GONE_MESSAGE)
    }
    throw error
  }

  if ((await classifyConfinement(nearest, projectPath)) !== 'inside') {
    throw new Error(RESTORE_OUTSIDE_PROJECT_MESSAGE)
  }
  await mkdir(parent, { recursive: true })
}
