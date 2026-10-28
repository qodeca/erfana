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
 * The path comes from `resolveConfinedPath`, which has already shown that the
 * nearest folder that still exists is inside the project (by its canonical
 * path, never by string alone) and that the project folder itself is present.
 * Every folder created here sits below that ancestor, so `mkdir -p` can only
 * create folders inside the project.
 */
import { mkdir } from 'fs/promises'
import { dirname } from 'path'
import type { ResolvedPath } from '../../ipc/confinement/resolveConfinedPath'

/**
 * Make sure the folder that should hold the file exists.
 *
 * @param resolved - The file's path, as checked for the project
 */
export async function restoreParentDirectory(resolved: ResolvedPath): Promise<void> {
  // `tail` holds the file name plus every folder missing above it
  if (resolved.tail.length <= 1) return
  await mkdir(dirname(resolved.real), { recursive: true })
}
