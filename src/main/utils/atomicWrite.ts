// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Atomic file write utilities
 *
 * Provides crash-safe file writing using write-to-temp-then-rename pattern.
 * Used by ProjectLockService to ensure lock file integrity.
 *
 * @see ProjectLockService.ts - uses atomic writes for lock files
 * @see Spec #010 - Multi-instance support specification
 */
import { writeFile, rename, unlink, lstat, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../services/LoggingService'
import { redactedLogError } from './redactUserInput'

/**
 * Fixed prefix of the temp file `atomicWriteText` writes next to its target.
 * The directory watcher drops any path whose last segment starts with it, so
 * the temp file never shows in the tree or triggers a reload.
 */
export const ATOMIC_TEMP_PREFIX = '.erfana-tmp-'

/** Whether the last segment of a path (either separator) is an `atomicWriteText` temp file. */
export function isAtomicTempName(path: string): boolean {
  const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return path.startsWith(ATOMIC_TEMP_PREFIX, lastSep + 1)
}

/** Mode a new file gets – the same as `fs.writeFile` (umask applies). */
const DEFAULT_NEW_FILE_MODE = 0o666
/** Permission bits kept from the original file (setuid etc. are not copied). */
const PERMISSION_BITS = 0o777

/**
 * Writes JSON content atomically using write-to-temp-then-rename pattern.
 * This ensures crash safety - file is either fully written or not at all.
 *
 * Security: Uses restrictive permissions (0o600 for files).
 * Callers are responsible for ensuring the target directory exists before
 * calling this function (e.g. via `mkdir(dir, { recursive: true, mode: 0o700 })`).
 *
 * @param filePath - Absolute path to the target file
 * @param content - Content to serialize and write
 * @param space - Optional `JSON.stringify` indent. When provided the output is
 *   pretty-printed with this indent AND a trailing newline is appended, so a
 *   hand-edited, git-tracked file (e.g. `.erfana/settings.json`, Issue #74) is
 *   not collapsed to one line. Omitting it preserves the compact,
 *   newline-free output existing callers (`ProjectLockService`) rely on.
 * @throws Error if write or rename fails (temp file is cleaned up)
 */
export async function atomicWriteJSON<T>(
  filePath: string,
  content: T,
  space?: number
): Promise<void> {
  const dir = dirname(filePath)
  const tempPath = join(dir, `.${randomUUID()}.tmp`)

  try {
    const serialized =
      space === undefined
        ? JSON.stringify(content)
        : `${JSON.stringify(content, null, space)}\n`
    // Write to temp file with owner-only permissions
    await writeFile(tempPath, serialized, {
      encoding: 'utf8',
      mode: 0o600, // Owner read/write only
      flush: true // fsync before the rename, so a power loss cannot leave an empty file
    })

    // Atomic rename (POSIX guarantees atomicity for rename within same filesystem)
    // On Windows, MoveFileEx(MOVEFILE_REPLACE_EXISTING) can fail with EPERM/EBUSY when
    // antivirus or Windows Search transiently locks the target (Node issue #29481).
    await renameWithRetry(tempPath, filePath)
  } catch (error) {
    // Clean up temp file if rename failed
    try {
      await unlink(tempPath)
    } catch {
      // Ignore cleanup errors - temp file may not exist
    }
    throw error
  }
}

const RENAME_RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_BACKOFFS_MS = [10, 30, 100]

/**
 * Writes text to `filePath` so a crash or power loss mid-save never truncates
 * the existing file: the data goes to a temp file in the same directory
 * (`ATOMIC_TEMP_PREFIX` + uuid), is fsynced, then renamed over the target.
 *
 * The original file's permission bits are kept. The temp file is always
 * removed on failure.
 *
 * Writes IN PLACE (non-atomic) instead, deliberately, when:
 *  - the target is a symlink: a rename would replace the link itself with a
 *    regular file instead of updating what it points to;
 *  - the target has more than one hard link (`nlink > 1`): a rename would give
 *    this name a new inode and silently detach it from the other names;
 *  - on Windows the rename keeps failing with EPERM/EBUSY/EACCES after the
 *    retries (the file is open in another app): a logged warning, then the
 *    in-place write, so a save still succeeds.
 *
 * Callers are responsible for the parent directory existing.
 */
export async function atomicWriteText(filePath: string, data: string): Promise<void> {
  let existingMode: number | undefined
  try {
    const info = await lstat(filePath)
    if (info.isSymbolicLink() || info.nlink > 1) {
      await writeFile(filePath, data, { encoding: 'utf8', flush: true })
      return
    }
    existingMode = info.mode & PERMISSION_BITS
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const tempPath = join(dirname(filePath), `${ATOMIC_TEMP_PREFIX}${randomUUID()}`)
  try {
    const handle = await open(tempPath, 'wx', existingMode ?? DEFAULT_NEW_FILE_MODE)
    try {
      await handle.writeFile(data, 'utf8')
      // open()'s mode is masked by the umask; restore the original bits exactly
      if (existingMode !== undefined) await handle.chmod(existingMode)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(tempPath, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform === 'win32' && code && RENAME_RETRYABLE.has(code)) {
      logger.warn('atomicWriteText: rename kept failing, writing in place', {
        code,
        error: redactedLogError(error)?.message
      })
      await writeFile(filePath, data, { encoding: 'utf8', flush: true })
      return
    }
    throw error
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt <= RENAME_BACKOFFS_MS.length; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!code || !RENAME_RETRYABLE.has(code) || attempt === RENAME_BACKOFFS_MS.length) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_BACKOFFS_MS[attempt]))
    }
  }
  throw new Error('renameWithRetry: unreachable')
}

/**
 * Removes a file if it exists, ignoring ENOENT errors.
 *
 * @param filePath - Absolute path to the file to remove
 * @returns true if file was removed, false if it didn't exist
 * @throws Error if unlink fails for reasons other than ENOENT
 */
export async function removeIfExists(filePath: string): Promise<boolean> {
  try {
    await unlink(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}
