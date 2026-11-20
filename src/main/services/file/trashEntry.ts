// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Moves an entry to the operating system's trash – the Recycle Bin on Windows,
 * the Trash on macOS, the freedesktop trash on Linux (#486).
 *
 * `shell.trashItem` rejects when the item cannot be trashed; on Windows
 * Electron aborts rather than fall back to a permanent delete, so nothing here
 * ever deletes. A refusal is sorted into one of three errors, because only one
 * of them may lead to the "Delete permanently?" question:
 *
 * - {@link EntryGoneError} – the item is no longer there (already in the bin);
 * - {@link EntryInUseError} – another program, a terminal's working folder or a
 *   missing permission holds it: a permanent delete would fail the same way,
 *   and on a folder could remove the unlocked part first;
 * - {@link TrashUnavailableError} – the item is free, the trash is not (a
 *   network drive or WSL path with no Recycle Bin, a desktop without a trash).
 *
 * The refusal carries no error code from Electron (see `entryProbe.ts`), so
 * unless it does, the entry is probed on disk to tell the three apart.
 */
import path from 'path'
import { shell } from 'electron'
import type { EntryRemover } from './entryRemoval'
import {
  EntryGoneError,
  EntryInUseError,
  GONE_CODES,
  IN_USE_CODES,
  errorCode,
  probeEntryAccess,
  type EntryAccess
} from './entryProbe'

/** The entry is free but could not be moved to the trash; it is still on disk. */
export class TrashUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('The item could not be moved to the trash', options)
    this.name = 'TrashUnavailableError'
  }
}

// Windows' trash does not accept `/` as a separator, so the path is made native first
let trashImpl: EntryRemover = (entryPath) => shell.trashItem(path.resolve(entryPath))

/**
 * Puts `impl` in force behind {@link trashEntry}. Called by the e2e test hooks
 * only (`src/main/testHooks/trashHook.ts`), so a test run never fills the real
 * Recycle Bin.
 *
 * @throws Error outside an e2e build, so production can never swap the trash
 */
export function replaceTrash(impl: EntryRemover): void {
  if (!__ERFANA_TEST_HOOKS__) throw new Error('replaceTrash is available in e2e builds only')
  trashImpl = impl
}

/**
 * Moves `entryPath` to the trash.
 *
 * @throws EntryGoneError | EntryInUseError | TrashUnavailableError when the
 *   trash refused it, with the trash's error as `cause`; ProbeRestoreError, or
 *   the file system's own error, when the probe after the refusal failed
 */
export const trashEntry: EntryRemover = async (entryPath) => {
  try {
    await trashImpl(entryPath)
  } catch (error) {
    throw await classifyRefusal(entryPath, error)
  }
}

/** Sorts a refusal by its code when it has one, otherwise by probing the entry. */
async function classifyRefusal(entryPath: string, refusal: unknown): Promise<Error> {
  const access = accessFromCode(errorCode(refusal)) ?? (await probeEntryAccess(entryPath))
  if (access === 'gone') return new EntryGoneError({ cause: refusal })
  if (access === 'in-use') return new EntryInUseError({ cause: refusal })
  return new TrashUnavailableError({ cause: refusal })
}

/** What an error code alone says about the entry; `null` when it says nothing. */
function accessFromCode(code: string | undefined): EntryAccess | null {
  if (code && GONE_CODES.has(code)) return 'gone'
  if (code && IN_USE_CODES.has(code)) return 'in-use'
  return null
}
