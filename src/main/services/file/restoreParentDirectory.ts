// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * restoreParentDirectory - recreate the missing folders above a file that the
 * user explicitly asked to restore.
 *
 * An editor tab whose file was deleted on disk says "Save to restore it". When
 * the file went away because its whole folder was renamed or deleted, a plain
 * write fails with ENOENT, so the restore needs the folder chain back first.
 * This runs only for that explicit restore (a manual save of a tab already in
 * the deleted state) – never for an autosave or a normal save – so the app
 * never silently re-creates a folder somebody just renamed.
 *
 * Confinement: the nearest ancestor that still exists must resolve (symlinks
 * included) inside the open project, and the target must be lexically inside
 * it, so `mkdir -p` can only create folders inside the project.
 */
import { lstat, mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'
import { classifyConfinement, isLexicallyInside } from '../../utils/projectConfinement'

/** Refusal when the file to restore does not resolve inside the open project. */
export const RESTORE_OUTSIDE_PROJECT_MESSAGE =
  'Cannot restore a file outside the project directory'

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
 * @throws when no project is open, or when the path (or its nearest existing
 *         ancestor) does not resolve inside the project
 */
export async function restoreParentDirectory(
  filePath: string,
  projectPath: string | null
): Promise<void> {
  if (!projectPath) throw new Error('No project is open')
  const target = resolve(filePath)
  if (!isLexicallyInside(target, projectPath)) throw new Error(RESTORE_OUTSIDE_PROJECT_MESSAGE)

  const parent = dirname(target)
  let nearest = parent
  while (!(await exists(nearest))) {
    const up = dirname(nearest)
    if (up === nearest) break
    nearest = up
  }
  if (nearest === parent) return

  if ((await classifyConfinement(nearest, projectPath)) !== 'inside') {
    throw new Error(RESTORE_OUTSIDE_PROJECT_MESSAGE)
  }
  await mkdir(parent, { recursive: true })
}
