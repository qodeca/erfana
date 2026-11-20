// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project tree's Delete, from the first question to the second (#486).
 *
 * 1. Ask to move the item to the Recycle Bin (Windows), the Trash (macOS) or the
 *    trash (Linux) – the main process trashes it, so the delete can be undone.
 * 2. When main answers `TRASH_UNAVAILABLE` (a network drive, a WSL path, no
 *    trash), nothing was removed. Ask again, saying the item will be deleted
 *    permanently; only that answer sends `permanent: true`.
 * 3. When main answers `IN_USE` (another program, a terminal's working folder,
 *    a missing permission) – to either request – nothing was removed and no
 *    permanent delete is offered: {@link TreeItemInUseError} asks the person
 *    to close what holds the item.
 *
 * Both questions are danger prompts, so Cancel holds the focus and a stray
 * Enter cannot delete; the second one also ignores clicks for
 * {@link PERMANENT_CONFIRM_ARM_DELAY_MS}, so a double-click on the first
 * cannot land on it. The second question is asked outside the watcher pause:
 * the tree keeps following the disk while the person decides.
 */
import { IN_USE, TRASH_UNAVAILABLE, type DeleteEntryResult } from '../../../../../shared/ipc/file-schema'
import { isMacOS, isWindows } from '../../../utils/platform'
import type { Dialogs } from './types'

/** How this platform names its trash, in a sentence and on a button. */
export interface TrashCopy {
  /** Inside a sentence: "moved to the Recycle Bin" */
  place: string
  /** The confirming button */
  moveLabel: string
}

/** The trash's name on this platform (`isWindows()` / `isMacOS()`). */
export function trashCopy(): TrashCopy {
  if (isWindows()) return { place: 'the Recycle Bin', moveLabel: 'Move to Recycle Bin' }
  if (isMacOS()) return { place: 'the Trash', moveLabel: 'Move to Trash' }
  return { place: 'the trash', moveLabel: 'Move to trash' }
}

export type TreeDeleteKind = 'file' | 'folder'

/** The confirming button of the second question. */
export const DELETE_PERMANENTLY_LABEL = 'Delete permanently'

/** How long the second question's confirm button ignores clicks after it opens. */
export const PERMANENT_CONFIRM_ARM_DELAY_MS = 500

/** The delete was refused because the item is in use; its message is for the person. */
export class TreeItemInUseError extends Error {
  constructor(name: string) {
    super(inUseMessage(name))
    this.name = 'TreeItemInUseError'
  }
}

/** The item as a sentence names it: a folder takes its contents with it. */
function subject(kind: TreeDeleteKind, name: string): string {
  return kind === 'folder' ? `“${name}” and everything in it` : `“${name}”`
}

/** The first question's message. */
export function trashConfirmMessage(kind: TreeDeleteKind, name: string, copy = trashCopy()): string {
  return `${subject(kind, name)} will be moved to ${copy.place}. You can restore it from there.`
}

/** The error shown when the item is in use; no permanent delete is offered. */
export function inUseMessage(name: string): string {
  return `“${name}” is in use – close the programs or terminals using it, then try again.`
}

/** The second question's message, asked when the trash refused the item. */
export function permanentConfirmMessage(kind: TreeDeleteKind, name: string, copy = trashCopy()): string {
  return `${subject(kind, name)} cannot be moved to ${copy.place}. Delete it permanently instead? You cannot undo this.`
}

/** What the flow needs from its caller. */
export interface TreeDeleteDeps {
  showConfirm: Dialogs['showConfirm']
  /** Runs `op` with the directory watcher paused (the tree's own change is not echoed). */
  withWatcherPause: <T>(op: () => Promise<T>) => Promise<T>
  /** Sends the delete; `permanent` only after the second question. */
  remove: (permanent: boolean) => Promise<DeleteEntryResult>
  refreshProjectTree: () => Promise<void>
}

/**
 * Asks, deletes, and asks again if the trash refused the item.
 *
 * @param title - The first question's title ("Delete File" / "Delete Folder")
 * @returns `true` when the item was removed (trashed or permanently), `false`
 *   when the person cancelled either question
 * @throws TreeItemInUseError when the item is in use; rejects when the delete failed
 */
export async function confirmAndDeleteTreeItem(
  deps: TreeDeleteDeps,
  kind: TreeDeleteKind,
  name: string,
  title: string
): Promise<boolean> {
  const copy = trashCopy()
  const toTrash = await deps.showConfirm({
    title,
    message: trashConfirmMessage(kind, name, copy),
    confirmLabel: copy.moveLabel,
    danger: true
  })
  if (!toTrash) return false

  const trashed = await removeAndRefresh(deps, false, name)
  if (trashed) return true

  const permanently = await deps.showConfirm({
    title: 'Delete permanently?',
    message: permanentConfirmMessage(kind, name, copy),
    confirmLabel: DELETE_PERMANENTLY_LABEL,
    danger: true,
    confirmArmDelayMs: PERMANENT_CONFIRM_ARM_DELAY_MS
  })
  if (!permanently) return false
  return removeAndRefresh(deps, true, name)
}

/**
 * One delete under the watcher pause; `false` when the trash refused it
 * (nothing changed).
 *
 * @throws TreeItemInUseError when main answered `IN_USE` (nothing changed)
 */
async function removeAndRefresh(deps: TreeDeleteDeps, permanent: boolean, name: string): Promise<boolean> {
  return deps.withWatcherPause(async () => {
    const result = await deps.remove(permanent)
    if (!result.ok && result.code === IN_USE) throw new TreeItemInUseError(name)
    if (!result.ok && result.code === TRASH_UNAVAILABLE) return false
    await deps.refreshProjectTree()
    return true
  })
}
