/**
 * Atomic file write utilities
 *
 * Provides crash-safe file writing using write-to-temp-then-rename pattern.
 * Used by ProjectLockService to ensure lock file integrity.
 *
 * @see ProjectLockService.ts - uses atomic writes for lock files
 * @see Spec #010 - Multi-instance support specification
 */
import { writeFile, rename, unlink, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Writes JSON content atomically using write-to-temp-then-rename pattern.
 * This ensures crash safety - file is either fully written or not at all.
 *
 * Security: Uses restrictive permissions (0o700 for dirs, 0o600 for files)
 *
 * @param filePath - Absolute path to the target file
 * @param content - Content to serialize and write
 * @throws Error if write or rename fails (temp file is cleaned up)
 */
export async function atomicWriteJSON<T>(filePath: string, content: T): Promise<void> {
  const dir = dirname(filePath)
  const tempPath = join(dir, `.${randomUUID()}.tmp`)

  // Ensure directory exists with restrictive permissions
  await mkdir(dir, { recursive: true, mode: 0o700 })

  try {
    // Write to temp file with owner-only permissions
    await writeFile(tempPath, JSON.stringify(content, null, 2), {
      encoding: 'utf8',
      mode: 0o600 // Owner read/write only
    })

    // Atomic rename (POSIX guarantees atomicity for rename within same filesystem)
    await rename(tempPath, filePath)
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
