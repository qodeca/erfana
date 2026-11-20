// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The trash test hook (#486): in an e2e build the project tree's Delete must
 * not fill the real Recycle Bin / Trash with test files, and a test needs a
 * way to see the "cannot move to the Recycle Bin" path without a network drive.
 *
 * Installing the hook puts a stub behind `trashEntry`: it removes the entry
 * from disk (so the tree and the disk agree, as after a real trash) and records
 * the path. `failNext` makes the next calls refuse, as a drive without a trash
 * would, so the app's second, permanent-delete question appears. `inUseNext`
 * makes them refuse with `EBUSY`, as a locked item would, so the app's in-use
 * error appears and no permanent delete is offered.
 *
 * The stub removes with `rm`, which Erfana's own watch handles do not block,
 * so it also records how many of those handles were still open under each
 * entry when the trash was asked (`handlesAtTrash`): 0 proves the delete
 * released them, as the real Recycle Bin move on Windows needs.
 *
 * Test builds only – reached through `./index`, never from production code.
 */
import { rm } from 'fs/promises'
import { replaceTrash } from '../services/file/trashEntry'
import type { EntryRemover } from '../services/file/entryRemoval'

/** What a test reaches as `__erfanaTestHooks.trash`. */
export interface TrashTestHook {
  /** The paths the stub moved "to the trash", oldest first. */
  trashed(): string[]
  /** For each of those, Erfana's watch handles open under it when the trash was asked. */
  handlesAtTrash(): number[]
  /** The next `count` trash calls fail and remove nothing. */
  failNext(count?: number): void
  /** The next `count` trash calls fail with `EBUSY` (the item is in use) and remove nothing. */
  inUseNext(count?: number): void
  /** Forget the record and any pending failures. */
  reset(): void
}

const stubRemove: EntryRemover = (entryPath) => rm(entryPath, { recursive: true })

/**
 * Installs the stub and returns its hook.
 *
 * @param install - Puts the stub in force (`replaceTrash`; tests pass their own)
 * @param remove - What the stub does to a trashed entry
 * @param openHandlesUnder - Erfana's watch handles open under a path now
 */
export function createTrashTestHook(
  install: (impl: EntryRemover) => void = replaceTrash,
  remove: EntryRemover = stubRemove,
  openHandlesUnder: (entryPath: string) => number = () => 0
): TrashTestHook {
  const record: string[] = []
  const handles: number[] = []
  let failures = 0
  let inUse = 0
  install(async (entryPath) => {
    if (inUse > 0) {
      inUse -= 1
      throw Object.assign(new Error('Test hook: the item is in use'), { code: 'EBUSY' })
    }
    if (failures > 0) {
      failures -= 1
      throw new Error('Test hook: the trash is unavailable')
    }
    const open = openHandlesUnder(entryPath)
    await remove(entryPath)
    record.push(entryPath)
    handles.push(open)
  })
  return {
    trashed: () => [...record],
    handlesAtTrash: () => [...handles],
    failNext: (count = 1) => {
      failures += count
    },
    inUseNext: (count = 1) => {
      inUse += count
    },
    reset: () => {
      record.length = 0
      handles.length = 0
      failures = 0
      inUse = 0
    }
  }
}
