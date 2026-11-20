// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * How `FileService.deleteFile` / `deleteFolder` remove an entry once their own
 * checks (entry type, project root) have passed (#486).
 *
 * The defaults remove permanently, which is what every internal caller wants.
 * The project tree's Delete passes the trash remover (`trashEntry.ts`) instead,
 * so a person's delete can be undone from the Recycle Bin / Trash; its
 * confirmed "Delete permanently" passes {@link removeUnlessInUse}.
 */
import { rm } from 'fs/promises'
import { EntryGoneError, EntryInUseError, probeEntryAccess } from './entryProbe'

/** Removes one already-checked entry. A link is removed as a link. */
export type EntryRemover = (entryPath: string) => Promise<void>

/** Permanently removes a file (or a link to one). */
export const removeFilePermanently: EntryRemover = (filePath) => rm(filePath)

/** Permanently removes a folder and everything in it. */
export const removeTreePermanently: EntryRemover = (folderPath) =>
  rm(folderPath, { recursive: true, force: true })

/**
 * `remove`, after an in-use probe (`entryProbe.ts`). A recursive delete of a
 * folder that a lock blocks halfway (a terminal's working folder inside it, a
 * file another program holds) removes every unlocked file before it fails;
 * refusing first leaves the folder whole.
 *
 * @throws EntryInUseError | EntryGoneError instead of removing anything
 */
export function removeUnlessInUse(remove: EntryRemover, probe = probeEntryAccess): EntryRemover {
  return async (entryPath) => {
    const access = await probe(entryPath)
    if (access === 'in-use') throw new EntryInUseError()
    if (access === 'gone') throw new EntryGoneError()
    await remove(entryPath)
  }
}
