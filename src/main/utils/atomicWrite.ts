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
 * @see atomicWriteBytesStrict.ts - the strict, no-fallback variant for HTML
 *   Preview comment writes, built from the helpers exported here
 */
import { writeFile, rename, unlink, lstat, open, access, constants } from 'node:fs/promises'
import { realpath as realpathCallback, type Stats } from 'node:fs'
import { dirname, join, basename } from 'node:path'
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
export const PERMISSION_BITS = 0o777
/** Owner-write bit of a mode. */
const OWNER_WRITE_BIT = 0o200

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
    // A symlink (e.g. a dotfile manager's `settings.json`) or a hard-linked
    // target must keep its link, which a rename over it would break: write in place.
    if (await isLinkedTarget(filePath)) {
      await writeFile(filePath, serialized, { encoding: 'utf8', flush: true })
      return
    }
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

/**
 * Writes raw bytes atomically (temp file, fsync, rename), owner-only (0o600).
 * Same crash-safety contract as {@link atomicWriteJSON}; the extra fsync makes
 * sure the bytes are on disk before the rename publishes them. Used for
 * encrypted secrets, where a torn file would silently lose the secret.
 *
 * @throws Error if write or rename fails (temp file is cleaned up)
 */
export async function atomicWriteBytes(filePath: string, data: Buffer): Promise<void> {
  const tempPath = join(dirname(filePath), `.${randomUUID()}.tmp`)

  try {
    const handle = await open(tempPath, 'w', 0o600)
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(tempPath, filePath)
  } catch (error) {
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

/** `fs.realpath.native`: the on-disk spelling of the name, also on case-insensitive disks. */
const realpathNative = (path: string): Promise<string> =>
  new Promise((resolve, reject) =>
    realpathCallback.native(path, (error, resolved) => (error ? reject(error) : resolve(resolved)))
  )

/** Whether `filePath` is a symlink or has other hard links (both must survive a save). */
async function isLinkedTarget(filePath: string): Promise<boolean> {
  try {
    const info = await lstat(filePath)
    return info.isSymbolicLink() || info.nlink > 1
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Temp file cannot be created here (unwritable folder around a writable file). */
const TEMP_CREATE_FALLBACK_CODES = new Set(['EACCES', 'EPERM'])
/** The file system cannot do rename/fsync (network and FUSE mounts). */
const UNSUPPORTED_FS_CODES = new Set(['EXDEV', 'ENOTSUP', 'EINVAL', 'ENOSYS'])

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code

async function writeInPlace(filePath: string, data: string): Promise<void> {
  await writeFile(filePath, data, { encoding: 'utf8', flush: true })
}

/** In-place write after the atomic route was given up, with a path-free warning. */
async function fallBackInPlace(filePath: string, data: string, step: string, error: unknown): Promise<void> {
  logger.warn('atomicWriteText: atomic route unavailable, writing in place', {
    step,
    code: errorCode(error),
    error: redactedLogError(error)?.message
  })
  await writeInPlace(filePath, data)
}

/**
 * Why replacing the existing file `filePath` (whose `lstat` is `info`) by a
 * rename would be wrong, or `null` when a rename is fine:
 *  - `link`: a symlink, or a file with other hard links – a rename would replace
 *    the link itself, or detach this name from the other names;
 *  - `not-owner`: another user's file (POSIX) – a rename would change its owner;
 *  - `read-only`: read-only for its owner, or not writable – the save must keep
 *    failing, where a rename would silently replace it (the folder is writable).
 * Checked in that order.
 */
export async function renameBlocker(
  filePath: string,
  info: Stats
): Promise<'link' | 'not-owner' | 'read-only' | null> {
  if (info.isSymbolicLink() || info.nlink > 1) return 'link'
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    return 'not-owner'
  }
  if ((info.mode & OWNER_WRITE_BIT) === 0) return 'read-only'
  try {
    await access(filePath, constants.W_OK)
  } catch {
    return 'read-only'
  }
  return null
}

/**
 * `filePath` with its last segment spelled as on disk. On a case-insensitive
 * disk `Notes.md` can name the file `notes.md`: a save must rename onto the
 * on-disk spelling, or the file would be renamed by its own save. The path is
 * returned as given when it cannot be resolved.
 */
export async function onDiskSpelling(filePath: string): Promise<string> {
  try {
    const real = await realpathNative(filePath)
    if (basename(real).toLowerCase() === basename(filePath).toLowerCase()) {
      return join(dirname(filePath), basename(real))
    }
  } catch {
    // keep the path as given
  }
  return filePath
}

/**
 * What a save of `filePath` does: write in place (`null`), or replace the
 * returned on-disk path by rename, keeping the returned mode (`undefined`
 * mode = a new file).
 */
async function planAtomicTarget(
  filePath: string
): Promise<{ target: string; mode: number | undefined } | null> {
  let info
  try {
    info = await lstat(filePath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { target: filePath, mode: undefined }
    throw error
  }
  if ((await renameBlocker(filePath, info)) !== null) return null
  return { target: await onDiskSpelling(filePath), mode: info.mode & PERMISSION_BITS }
}

/**
 * Writes text to `filePath` so a crash or power loss mid-save never truncates
 * the existing file: the data goes to a temp file in the same directory
 * (`ATOMIC_TEMP_PREFIX` + uuid), is fsynced, then renamed over the target.
 *
 * The original file's permission bits are kept (a failing chmod is not fatal).
 * The temp file is always removed on failure.
 *
 * Writes IN PLACE (non-atomic) instead, deliberately, when:
 *  - the target is a symlink: a rename would replace the link itself with a
 *    regular file instead of updating what it points to;
 *  - the target has more than one hard link (`nlink > 1`): a rename would give
 *    this name a new inode and silently detach it from the other names;
 *  - the file belongs to another user (POSIX): a rename would change its owner;
 *  - the file is read-only for its owner or not writable: the save must keep
 *    failing with EACCES, as before, instead of replacing it;
 *  - a temp file cannot be created (EACCES/EPERM: unwritable folder around a
 *    writable file), or the rename/fsync is unsupported (EXDEV, ENOTSUP,
 *    EINVAL, ENOSYS: network and FUSE mounts): a warning, then the in-place write;
 *  - on Windows the rename keeps failing with EPERM/EBUSY/EACCES after the
 *    retries (the file is open in another app): the same warning and fallback.
 *
 * Trade-off: only the mode is carried over. Extended attributes, ACLs, macOS
 * Finder tags and Windows alternate data streams live on the old inode and do
 * not follow a rename.
 *
 * On a case-insensitive disk the rename targets the on-disk spelling of the name.
 * Callers are responsible for the parent directory existing.
 */
export async function atomicWriteText(filePath: string, data: string): Promise<void> {
  const plan = await planAtomicTarget(filePath)
  if (plan === null) {
    await writeInPlace(filePath, data)
    return
  }

  const { target, mode } = plan
  const tempPath = join(dirname(target), `${ATOMIC_TEMP_PREFIX}${randomUUID()}`)
  let step = 'create'
  try {
    const handle = await open(tempPath, 'wx', mode ?? DEFAULT_NEW_FILE_MODE)
    try {
      step = 'write'
      await handle.writeFile(data, 'utf8')
      if (mode !== undefined) {
        // open()'s mode is masked by the umask; restore the original bits exactly
        await handle.chmod(mode).catch(() => undefined)
      }
      step = 'sync'
      await handle.sync()
    } finally {
      await handle.close()
    }
    step = 'rename'
    await renameWithRetry(tempPath, target)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    const code = errorCode(error)
    const giveUp =
      code !== undefined &&
      ((step === 'create' && TEMP_CREATE_FALLBACK_CODES.has(code)) ||
        ((step === 'sync' || step === 'rename') && UNSUPPORTED_FS_CODES.has(code)) ||
        (step === 'rename' && process.platform === 'win32' && RENAME_RETRYABLE.has(code)))
    if (!giveUp) throw error
    await fallBackInPlace(filePath, data, step, error)
  }
}

/**
 * `rename(from, to)`, retried after 10, 30 and 100 ms while it fails with
 * EPERM, EBUSY or EACCES – on Windows, antivirus or the search indexer can
 * hold the target for a moment (Node issue #29481). Any other error, or the
 * last retry's, is thrown.
 */
export async function renameWithRetry(from: string, to: string): Promise<void> {
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
