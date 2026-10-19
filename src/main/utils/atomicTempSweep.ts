// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Removes temp files that `atomicWriteText` left behind when the app was killed
 * between writing the temp file and renaming it. Run once, in the background,
 * when a project opens. Best effort: it never throws and never blocks the open.
 */
import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { logger } from '../services/LoggingService'
import { isAtomicTempName } from './atomicWrite'
import { redactedLogError } from './redactUserInput'

/** A temp file younger than this may belong to a save that is still running. */
export const STALE_TEMP_AGE_MS = 10 * 60 * 1000
/** Folder budget of one sweep, so a huge project costs a bounded amount of reading. */
export const MAX_SWEEP_DIRS = 2000
/** Folders never entered: large, tool-owned, and never written by a document save. */
const SKIPPED_DIRS = new Set(['node_modules', '.git'])

export async function sweepStaleAtomicTemps(
  projectPath: string,
  now: number = Date.now()
): Promise<number> {
  let removed = 0
  let visited = 0
  const queue: string[] = [projectPath]
  try {
    while (queue.length > 0 && visited < MAX_SWEEP_DIRS) {
      const dir = queue.shift() as string
      visited++
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue // unreadable or gone: skip this folder
      }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRS.has(entry.name)) queue.push(full)
        } else if (entry.isFile() && isAtomicTempName(entry.name)) {
          try {
            const info = await stat(full)
            if (now - info.mtimeMs > STALE_TEMP_AGE_MS) {
              await unlink(full)
              removed++
            }
          } catch {
            // vanished or not removable: leave it
          }
        }
      }
    }
  } catch (error) {
    logger.debug('atomicTempSweep: stopped early', { error: redactedLogError(error)?.message })
  }
  if (removed > 0) logger.info('atomicTempSweep: removed stale temp files', { removed })
  return removed
}
