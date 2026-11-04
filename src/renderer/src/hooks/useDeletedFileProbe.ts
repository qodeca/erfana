// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Looks for a deleted file until it comes back (issue #450).
 *
 * When a file open in a tab is genuinely deleted, the main process ends its
 * watch, so nothing reports the file reappearing – yet a git branch switch or a
 * merge usually puts it back within seconds. A tab in the deleted state
 * therefore asks the disk again, once per {@link DELETED_FILE_PROBE_INTERVAL_MS},
 * for as long as it stays deleted.
 *
 * Why a probe and not the project watcher's `add` events: the project watcher
 * does not see excluded, hidden or ignored folders (`dist`, `node_modules`, a
 * `files.exclude` entry) nor a file opened from outside the project, and a
 * single-file watch on a missing path is exactly what was dropped. One `stat`
 * every two seconds, only for tabs that show the deleted state, costs nothing
 * measurable and covers every path the same way.
 *
 * @module useDeletedFileProbe
 */

import { useEffect } from 'react'

import { DELETED_FILE_PROBE_INTERVAL_MS } from '../../../shared/deletedFileProbe'
import { fileGateway } from '../services/fileGateway'
import { logger } from '../utils/logger'
import { useLatestRef } from './useLatestRef'

/** True when `stat` succeeds for the path. Never throws. */
async function isOnDisk(filePath: string): Promise<boolean> {
  try {
    await fileGateway.getStats({ filePath })
    return true
  } catch {
    return false
  }
}

/**
 * While `isDeleted` is true, asks the disk for `filePath` every
 * {@link DELETED_FILE_PROBE_INTERVAL_MS} and calls `onFileBack` when it is there.
 *
 * - **No overlap.** The next ask is scheduled only after the previous one, and
 *   the `onFileBack` it triggered, have settled – a slow disk never stacks asks.
 * - **Stops on its own.** The probe ends when `isDeleted` turns false (the
 *   consumer cleared the state in `onFileBack`, or a save restored the file),
 *   when the path changes and when the tab unmounts. An answer that arrives
 *   after that is dropped.
 * - **Retries.** When `onFileBack` leaves the tab deleted (the file vanished
 *   again between the `stat` and the read, or the watch could not restart), the
 *   probe keeps going; an `onFileBack` that throws is logged and retried too.
 *
 * @param filePath - The tab's file; `null` or `''` probes nothing
 * @param isDeleted - Whether the tab shows the deleted state now
 * @param onFileBack - Called when the file is on disk again; held in a ref, so
 *   an inline function never restarts the probe
 *
 * @example
 * ```ts
 * useDeletedFileProbe(filePath, isFileDeleted, () => reloadFromDisk())
 * ```
 */
export function useDeletedFileProbe(
  filePath: string | null,
  isDeleted: boolean,
  onFileBack: () => Promise<void> | void
): void {
  const onFileBackRef = useLatestRef(onFileBack)

  useEffect(() => {
    if (!filePath || !isDeleted) return

    let isActive = true
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async (): Promise<void> => {
      timer = null
      const isBack = await isOnDisk(filePath)
      if (!isActive) return
      if (isBack) {
        logger.info('A file deleted on disk is back', { filePath })
        try {
          await onFileBackRef.current()
        } catch (error) {
          logger.error('Could not take back a file that returned', error instanceof Error ? error : undefined, {
            filePath
          })
        }
      }
      if (isActive) timer = setTimeout(() => void tick(), DELETED_FILE_PROBE_INTERVAL_MS)
    }

    timer = setTimeout(() => void tick(), DELETED_FILE_PROBE_INTERVAL_MS)

    return () => {
      isActive = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [filePath, isDeleted, onFileBackRef])
}
