// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `file:deleteFile` and `file:deleteFolder` – the project tree's Delete (#486).
 *
 * The item goes to the Recycle Bin / Trash, so a delete can be undone. When the
 * trash refuses it nothing is removed, and the refusal is sorted
 * (`services/file/trashEntry.ts`): an item that is in use, locked or protected
 * answers `IN_USE`; one that is no longer there rejects with `ENOENT`; a free
 * item on a drive without a trash answers `TRASH_UNAVAILABLE`, the renderer
 * asks the person, and only a request with `permanent: true` removes the item
 * for good – after the same in-use probe, so a lock never leaves a folder
 * half-deleted.
 *
 * The confinement check runs first, then `FileService`'s own checks (entry
 * type, project root), and only then the probe and the removal. The entry
 * itself is checked, not what it points at: a link inside the project is
 * removed as a link.
 *
 * The trash, the probe and the permanent removal run with Erfana's own watch
 * handles under the item let go (`services/file/releaseWatchesAround.ts`):
 * on Windows they would block the move, so `IN_USE` is left for handles other
 * programs hold. The watches are armed again afterwards; an open file that is
 * gone then shows the deleted notice, as after any delete.
 */
import { fileService } from '../services/FileService'
import { directoryWatcherService } from '../services/DirectoryWatcherService'
import { fileWatcherService } from '../services/FileWatcherService'
import {
  removeFilePermanently,
  removeTreePermanently,
  removeUnlessInUse,
  type EntryRemover
} from '../services/file/entryRemoval'
import { EntryGoneError, EntryInUseError, errorCode } from '../services/file/entryProbe'
import { TrashUnavailableError, trashEntry } from '../services/file/trashEntry'
import { releasingWatches, type WatchHandleOwner } from '../services/file/releaseWatchesAround'
import type { ProjectSession } from '../services/session/ProjectSession'
import { logger } from '../services/LoggingService'
import { redactPath, redactedLogError } from '../utils/redactUserInput'
import {
  DeleteEntryRequestSchema,
  IN_USE,
  TRASH_UNAVAILABLE,
  payloadArgs,
  type DeleteEntryResult
} from '../../shared/ipc/file-schema'
import { FILE_CHANNELS } from '../../shared/ipc/file-channels'
import { registerConfinedHandle } from './confinement/registerConfinedHandle'

type EntryKind = 'file' | 'folder'

/** Why a delete did not happen, as logged: a fixed word, never the platform's text. */
type RefusalCategory = 'trash-unavailable' | 'in-use' | 'gone'

const PERMANENT_REMOVERS: Record<EntryKind, EntryRemover> = {
  file: removeUnlessInUse(removeFilePermanently),
  folder: removeUnlessInUse(removeTreePermanently)
}

/** Erfana's own watchers, whose handles under the item are let go while it is deleted. */
const WATCH_OWNERS: readonly WatchHandleOwner[] = [fileWatcherService, directoryWatcherService]

/** The category of a refusal, or `null` for any other failure. */
function refusalCategory(error: unknown): RefusalCategory | null {
  if (error instanceof TrashUnavailableError) return 'trash-unavailable'
  if (error instanceof EntryInUseError) return 'in-use'
  if (error instanceof EntryGoneError) return 'gone'
  return null
}

/**
 * Logs a refusal by category plus the cause's name and code. The cause's
 * message is never logged: Electron passes the platform's text through, and
 * macOS quotes the item's name in it.
 */
function logRefusal(kind: EntryKind, entry: string, category: RefusalCategory, error: Error): void {
  const cause = error.cause
  logger.warn(`Could not delete ${kind}`, {
    entry: redactPath(entry),
    category,
    cause: cause instanceof Error ? cause.name : typeof cause,
    code: errorCode(cause) ?? 'none'
  })
}

/**
 * Deletes one checked entry: to the trash, or permanently when asked.
 *
 * @param remove - The service method for the entry's kind
 * @returns `TRASH_UNAVAILABLE` or `IN_USE` when nothing was removed; rejects on
 *   any other failure, with an `ENOENT` error when the entry is gone
 */
async function deleteEntry(
  kind: EntryKind,
  entry: { real: string; requested: string },
  permanent: boolean,
  remove: (entryPath: string, remover: EntryRemover) => Promise<void>
): Promise<DeleteEntryResult> {
  try {
    await remove(entry.real, releasingWatches(permanent ? PERMANENT_REMOVERS[kind] : trashEntry, WATCH_OWNERS))
  } catch (error) {
    const category = refusalCategory(error)
    if (category === null) {
      logger.error(`Error deleting ${kind}`, redactedLogError(error))
      throw error
    }
    logRefusal(kind, entry.requested, category, error as Error)
    if (category === 'gone') throw error
    return { ok: false, code: category === 'in-use' ? IN_USE : TRASH_UNAVAILABLE }
  }
  directoryWatcherService.noteInternalChange({ path: entry.requested, kind: 'removed', subtree: true })
  if (permanent) logger.info(`Deleted ${kind} permanently`, { entry: redactPath(entry.requested) })
  return { ok: true, trashed: !permanent }
}

/** Registers both delete channels against the open project's session. */
export function registerDeleteHandlers(session: ProjectSession): void {
  registerConfinedHandle(
    FILE_CHANNELS.deleteFile,
    {
      schema: payloadArgs(DeleteEntryRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'project-entry', access: 'change' } },
      handler: async (_ctx, [{ permanent }], { filePath }) =>
        deleteEntry('file', filePath, permanent === true, (p, r) => fileService.deleteFile(p, r))
    },
    session
  )

  registerConfinedHandle(
    FILE_CHANNELS.deleteFolder,
    {
      schema: payloadArgs(DeleteEntryRequestSchema),
      paths: { folderPath: { arg: 0, key: 'filePath', mode: 'project-entry', access: 'change' } },
      handler: async (_ctx, [{ permanent }], { folderPath }) =>
        deleteEntry('folder', folderPath, permanent === true, (p, r) => fileService.deleteFolder(p, r))
    },
    session
  )
}
