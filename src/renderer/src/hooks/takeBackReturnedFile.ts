// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * What the Markdown editor does when the file of a tab in the deleted state is
 * on disk again (issue #450) – a branch switch or a merge put it back.
 *
 * `takeBackReturnedFile` is the decision, a plain function over the editor's
 * state so each branch is testable without a renderer; `useTakeBackReturnedFile`
 * wires it to {@link useDeletedFileProbe} for `useFileWatcher`.
 *
 * @module takeBackReturnedFile
 */

import { useCallback, type MutableRefObject } from 'react'

import { fileGateway } from '../services/fileGateway'
import { normalizeLF } from '../utils/lineEndings'
import { logger } from '../utils/logger'
import { useDeletedFileProbe } from './useDeletedFileProbe'

/** The editor state and actions {@link takeBackReturnedFile} needs. */
export interface ReturnedFileDeps {
  /** The tab's file */
  filePath: string
  /** A save is in flight */
  isSaving: () => boolean
  /** The tab still shows the deleted state */
  isDeleted: () => boolean
  /** The tab has edits not on disk */
  hasLocalChanges: () => boolean
  /** The editor's text now; `undefined` when no editor is mounted */
  bufferNow: () => string | undefined
  /** Read the file; rejects when it is gone */
  readFile: (filePath: string) => Promise<string>
  /** Take the given text as the file's content and clear the deleted state */
  reload: (content: string) => Promise<void>
  /** Clear the deleted state and watch the file again */
  clearDeletedState: () => void
  /** Show the "file changed on disk" choice */
  showConflict: () => void
}

/** What {@link takeBackReturnedFile} did, for logs and tests. */
export type ReturnedFileOutcome = 'skipped' | 'still-gone' | 'reloaded' | 'conflict' | 'same-text'

/**
 * Takes a returned file back into its tab without losing a keystroke.
 *
 * - An unedited tab reloads the file as it is now, like an external change.
 * - A tab the user typed in while it was deleted keeps its text and gets the
 *   conflict choice – unless the file already holds the buffer's text, when
 *   there is nothing to choose.
 * - A save in flight wins: it is what put the file back, and it clears the
 *   deleted state itself when it lands. The same holds for a save or reload
 *   that settled the tab while the file was being read.
 * - A file gone again by the time it is read leaves the tab deleted; the
 *   probe asks again.
 *
 * @param deps - The editor state and actions
 * @returns What was done
 */
export async function takeBackReturnedFile(deps: ReturnedFileDeps): Promise<ReturnedFileOutcome> {
  const isSettled = (): boolean => deps.isSaving() || !deps.isDeleted()
  if (isSettled()) return 'skipped'

  let diskContent: string
  try {
    diskContent = await deps.readFile(deps.filePath)
  } catch {
    return 'still-gone'
  }
  if (isSettled()) return 'skipped'

  if (!deps.hasLocalChanges()) {
    await deps.reload(diskContent)
    return 'reloaded'
  }

  deps.clearDeletedState()
  const buffer = deps.bufferNow()
  if (buffer !== undefined && normalizeLF(buffer) === normalizeLF(diskContent)) return 'same-text'
  deps.showConflict()
  return 'conflict'
}

/** The editor refs {@link useTakeBackReturnedFile} reads; always current, never stale. */
export interface ReturnedFileRefs {
  isSavingRef: MutableRefObject<boolean>
  isFileDeletedRef: MutableRefObject<boolean>
  hasLocalChangesRef: MutableRefObject<boolean>
  bufferNowRef: MutableRefObject<(() => string | undefined) | undefined>
}

/** The editor actions {@link useTakeBackReturnedFile} calls. */
export interface ReturnedFileActions {
  reload: (content: string) => Promise<void>
  clearDeletedState: () => void
  setConflict: (detected: boolean) => void
}

/**
 * While the tab shows the deleted state, looks for its file and takes it back
 * with {@link takeBackReturnedFile} once it is on disk again.
 *
 * @param filePath - The tab's file; `null` looks for nothing
 * @param isDeleted - Whether the tab shows the deleted state now
 * @param refs - The editor's live state
 * @param actions - The editor's reload, clear and conflict actions
 */
export function useTakeBackReturnedFile(
  filePath: string | null,
  isDeleted: boolean,
  refs: ReturnedFileRefs,
  actions: ReturnedFileActions
): void {
  const { isSavingRef, isFileDeletedRef, hasLocalChangesRef, bufferNowRef } = refs
  const { reload, clearDeletedState, setConflict } = actions

  const onFileBack = useCallback(async () => {
    if (!filePath) return
    const outcome = await takeBackReturnedFile({
      filePath,
      isSaving: () => isSavingRef.current,
      isDeleted: () => isFileDeletedRef.current,
      hasLocalChanges: () => hasLocalChangesRef.current,
      bufferNow: () => bufferNowRef.current?.(),
      readFile: (path) => fileGateway.readFile({ filePath: path }),
      reload,
      clearDeletedState,
      showConflict: () => setConflict(true)
    })
    logger.info('Deleted file is back', { filePath, outcome })
  }, [filePath, isSavingRef, isFileDeletedRef, hasLocalChangesRef, bufferNowRef, reload, clearDeletedState, setConflict])

  useDeletedFileProbe(filePath, isDeleted, onFileBack)
}
