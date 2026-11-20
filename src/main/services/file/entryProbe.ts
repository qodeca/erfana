// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Why a delete could not go ahead: is the entry gone, in use, or free (#486)?
 *
 * Electron's `shell.trashItem` rejects with free text and no error code – on
 * Windows one of a few fixed strings ("Failed to perform delete operation",
 * "Operation was aborted") with the HRESULT dropped; on macOS the system's
 * localized description – so the refusal itself cannot say whether the Recycle
 * Bin is missing or the item is locked. The probe asks the file system
 * instead, the way the trash itself moves an item: by renaming it.
 *
 * 1. `lstat` – missing means gone (a second Delete of an item already in the bin).
 * 2. Rename the entry to a unique hidden sibling and straight back. On Windows
 *    a rename fails with EBUSY / EPERM / EACCES while another program holds the
 *    file without delete sharing, while a process (a terminal) has its working
 *    folder inside the folder, or while the person lacks permission – exactly
 *    what also stops the move to the Recycle Bin, and what would let a
 *    recursive permanent delete remove the unlocked part of a folder before
 *    failing on the locked one.
 *
 * A probe that renamed the entry always tries to rename it back – retrying
 * for about two seconds while the new name is held, never over something that
 * took the original name meanwhile; if that fails it throws
 * {@link ProbeRestoreError}, naming the temporary name, so the person is told
 * where the item is.
 */
import { randomUUID } from 'crypto'
import { lstat, rename } from 'fs/promises'
import path from 'path'
import { logger } from '../LoggingService'
import { redactPath } from '../../utils/redactUserInput'

/** What the probe found. */
export type EntryAccess = 'free' | 'gone' | 'in-use'

/** Codes that mean the entry is held by another program, a process's working folder, or protected. */
export const IN_USE_CODES: ReadonlySet<string> = new Set(['EBUSY', 'EPERM', 'EACCES', 'ETXTBSY'])

/** Codes that mean the entry is no longer there. */
export const GONE_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])

/** The entry is in use, locked or protected; nothing was removed. */
export class EntryInUseError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('The item is in use', options)
    this.name = 'EntryInUseError'
  }
}

/**
 * The entry is no longer there. Carries `ENOENT` in its code and message, so
 * the renderer's error mapping reads it as "not found".
 */
export class EntryGoneError extends Error {
  readonly code = 'ENOENT'
  constructor(options?: { cause?: unknown }) {
    super('ENOENT: the item is no longer there', options)
    this.name = 'EntryGoneError'
  }
}

/** The probe renamed the entry and could not rename it back. */
export class ProbeRestoreError extends Error {
  /** The entry's temporary name, in the same folder. */
  readonly probeName: string
  constructor(probeName: string, options?: { cause?: unknown }) {
    super(
      `Erfana could not finish checking whether the item is in use. It is now named “${probeName}” ` +
        'in the same folder – rename it back.',
      options
    )
    this.name = 'ProbeRestoreError'
    this.probeName = probeName
  }
}

/** The file-system calls the probe makes; tests pass their own. */
export interface ProbeFs {
  lstat: (entryPath: string) => Promise<unknown>
  rename: (from: string, to: string) => Promise<void>
}

/**
 * The pauses before each further rename-back attempt, in ms (~1.9 s in all): a
 * virus scanner, indexer or sync client may hold the new name for a moment.
 * Only an in-use failure is retried.
 */
export const RESTORE_RETRY_DELAYS_MS: readonly number[] = [50, 100, 250, 500, 1000]

/** The start of the probe's temporary name; the directory watcher drops any path through one. */
export const PROBE_NAME_PREFIX = '.erfana-check-'

/** Whether any segment of a path (either separator) is a probe's temporary name. */
export function isProbeName(relPath: string): boolean {
  return relPath.split(/[\\/]/).some((segment) => segment.startsWith(PROBE_NAME_PREFIX))
}

// Looked up per call, not at import, so a suite that mocks fs/promises without them still loads
const realFs: ProbeFs = { lstat: (entryPath) => lstat(entryPath), rename: (from, to) => rename(from, to) }
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The `code` of an error-like value, or `undefined`. */
export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/**
 * Finds out whether `entryPath` could be moved or removed right now.
 *
 * @param entryPath - An entry already checked by the caller's guards
 * @throws ProbeRestoreError when the entry was renamed and could not be renamed back
 * @throws the file system's error for any other failure (not in use, not gone)
 */
export async function probeEntryAccess(
  entryPath: string,
  fs: ProbeFs = realFs,
  retryDelaysMs: readonly number[] = RESTORE_RETRY_DELAYS_MS
): Promise<EntryAccess> {
  const before = await accessOf(() => fs.lstat(entryPath))
  if (before !== 'free') return before

  // Short and fixed-length, so a long name cannot push the probe past the name limit
  const probeName = `${PROBE_NAME_PREFIX}${randomUUID()}`
  const probePath = path.join(path.dirname(entryPath), probeName)
  const moved = await accessOf(() => fs.rename(entryPath, probePath))
  if (moved !== 'free') return moved

  await renameBack(fs, probePath, entryPath, probeName, retryDelaysMs)
  return 'free'
}

/** Runs one call: `free` when it succeeds, `gone` / `in-use` by its code; rethrows anything else. */
async function accessOf(call: () => Promise<unknown>): Promise<EntryAccess> {
  try {
    await call()
    return 'free'
  } catch (error) {
    const code = errorCode(error)
    if (code && GONE_CODES.has(code)) return 'gone'
    if (code && IN_USE_CODES.has(code)) return 'in-use'
    throw error
  }
}

/**
 * Renames the probed entry back, retrying while the failure says "in use".
 *
 * Node has no rename that refuses to replace, and `rename` replaces a file
 * already at the target: an agent's atomic save landing on the original name
 * meanwhile would be overwritten with the old content. So each attempt first
 * checks that the name is still free and gives up rather than overwrite. That
 * narrows the race to the gap between the check and the rename; it does not
 * close it.
 *
 * @throws ProbeRestoreError when the name was taken, the failure was not an
 *   in-use one, or the retries ran out
 */
async function renameBack(
  fs: ProbeFs,
  probePath: string,
  entryPath: string,
  probeName: string,
  retryDelaysMs: readonly number[]
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) await sleep(retryDelaysMs[attempt - 1]!)
    try {
      if (await isNameTaken(fs, entryPath)) throw stranded(entryPath, probeName, 'name-taken')
      await fs.rename(probePath, entryPath)
      return
    } catch (error) {
      if (error instanceof ProbeRestoreError) throw error
      lastError = error
      const code = errorCode(error)
      if (!code || !IN_USE_CODES.has(code)) break
    }
  }
  throw stranded(entryPath, probeName, errorCode(lastError) ?? 'none', lastError)
}

/** Whether something now has the entry's name; a lookup that fails other than "gone" is thrown. */
async function isNameTaken(fs: ProbeFs, entryPath: string): Promise<boolean> {
  try {
    await fs.lstat(entryPath)
    return true
  } catch (error) {
    const code = errorCode(error)
    if (code && GONE_CODES.has(code)) return false
    throw error
  }
}

/** Logs the item left under its temporary name and returns the error that says where it is. */
function stranded(entryPath: string, probeName: string, code: string, cause?: unknown): ProbeRestoreError {
  // The temporary name is Erfana's own; the entry's path goes through redactPath
  logger.error('In-use check left an item renamed', undefined, {
    entry: redactPath(entryPath),
    probeName,
    code
  })
  return new ProbeRestoreError(probeName, cause === undefined ? undefined : { cause })
}
