// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The strict, no-fallback atomic write for HTML Preview comments
 * (docs/designs/html-preview-comments.md §4.2 `atomicWrite.ts` row, §7.6
 * step 9, threats S10 and S11).
 *
 * `atomicWriteText` keeps an editor save working wherever it can: through a
 * link, or in place when a rename is impossible. A comment write is driven by
 * a page the user is previewing, so it makes the opposite trade – it replaces
 * exactly the bytes its caller read, or it writes nothing:
 *
 * 1. `lstat` the target: a symlink or a file with other hard links is refused
 *    (`link`); so is another user's file or a read-only one (`read-only`) –
 *    the same checks as `atomicWriteText` (`renameBlocker`), but a refusal,
 *    never an in-place write. On Windows the file is also opened for writing
 *    once and closed: a deny-write ACL leaves the read-only attribute clear,
 *    so the mode check passes, yet the rename would still replace the file.
 * 2. Write the bytes – bytes in, bytes out, no re-encoding – to a
 *    `.erfana-tmp-` file in the same directory (the watchers, the tree and the
 *    temp sweep ignore that prefix), with the original mode bits, and fsync.
 *    On Windows the target's `Zone.Identifier` stream (the mark of the web)
 *    is copied onto it, best effort, so a downloaded page keeps its mark.
 * 3. Re-read the target – `O_NOFOLLOW` open, regular file, the opened inode
 *    equal to the name's, no other hard links – and require the very file the
 *    caller read (its dev/ino) holding the very bytes (SHA-256). Anything else
 *    is `changed`: the caller re-reads and decides again.
 * 4. Check that the target's folder still resolves where the caller confined
 *    it (a folder swapped for a link since is `changed`), then
 *    `renameWithRetry` the temp file onto the target's on-disk spelling
 *    (Windows `EPERM`/`EBUSY` backoff). A rename that keeps failing is
 *    `busy`; a file system that cannot rename or fsync (`EXDEV`, `ENOTSUP`,
 *    `EINVAL`, `ENOSYS` – network and FUSE mounts) is `unsupported-fs`.
 *
 * The temp file is removed on every failure. The window between the re-hash
 * and the rename is narrowed, not closed (design §9.3, risk 23): an outside
 * write landing inside it is replaced. Windows has no `O_NOFOLLOW`, so there
 * the link refusal rests on `lstat` and the dev/ino compare.
 *
 * Trade-off, as with `atomicWriteText`: the rename puts a NEW file in place,
 * so only the mode bits and the Windows `Zone.Identifier` mark are carried
 * over. The new file takes the folder's inherited permissions – an explicit
 * ACL on the old file, a grant or a deny, is gone after a comment save – and
 * extended attributes, macOS Finder tags and quarantine, and any other
 * alternate data stream stay with the old file.
 *
 * Expected failures are returned, never thrown, and carry only an errno code –
 * no message, which would quote the path.
 */
import { constants as fsConstants, type BigIntStats, type Stats } from 'node:fs'
import { lstat, open, realpath, unlink, type FileHandle } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import {
  ATOMIC_TEMP_PREFIX,
  PERMISSION_BITS,
  onDiskSpelling,
  renameBlocker,
  renameWithRetry
} from './atomicWrite'

/** Why a strict write wrote nothing. */
export type StrictWriteFailure =
  /** The target (or its folder) no longer exists, or is not a regular file. */
  | 'gone'
  /** The target is a symlink or has other hard links. */
  | 'link'
  /** Read-only, write-denied, another user's file, or a folder that cannot take the temp file. */
  | 'read-only'
  /** The target is no longer the file, or no longer holds the bytes, the caller read. */
  | 'changed'
  /** The file system cannot fsync or rename here. */
  | 'unsupported-fs'
  /** The rename kept failing with EPERM/EBUSY/EACCES (the file is held open). */
  | 'busy'
  /** Any other I/O error. */
  | 'io'

/** A strict write that wrote nothing, and why. */
export interface StrictWriteRefusal {
  readonly ok: false
  readonly reason: StrictWriteFailure
  readonly errno?: string
}

export type StrictWriteResult = { readonly ok: true; readonly path: string } | StrictWriteRefusal

/**
 * Which file a path named when it was read: device and inode (on NTFS the
 * volume serial number and the 64-bit file id), as bigints so no bit is lost.
 */
export interface FileId {
  readonly dev: bigint
  readonly ino: bigint
}

export interface StrictWriteOptions {
  /** SHA-256 (hex, {@link sha256Hex}) of the bytes the caller read; the target must still hold them. */
  readonly expectedHash: string
  /**
   * The bytes the caller read themselves, whose hash is `expectedHash`. When
   * given, the re-read is compared with them byte for byte instead of being
   * hashed – the stricter check, and a 4 MB SHA-256 is about 7 ms of the main
   * thread on the slowest box measured.
   */
  readonly expectedBytes?: Uint8Array
  /** The file the caller read ({@link readFileNoFollow}); the target must still be that very file. */
  readonly expectedId: FileId
  /**
   * `fs.promises.realpath` of the target's folder when the caller confined
   * it; checked again just before the rename. When omitted, the folder is
   * not re-checked.
   */
  readonly expectedDir?: string
  /** Bound for the re-read; a longer target cannot match and counts as `changed`. */
  readonly maxBytes: number
  /** `process.platform`; a test sets `win32` to run the Windows steps on any host. */
  readonly platform?: NodeJS.Platform
}

/** Why a no-follow read returned no bytes. */
export type NoFollowReadFailure = 'gone' | 'link' | 'changed' | 'too-large' | 'io'

export type NoFollowRead =
  | { readonly ok: true; readonly bytes: Buffer; readonly id: FileId }
  | { readonly ok: false; readonly reason: NoFollowReadFailure; readonly errno?: string }

/** `O_NOFOLLOW` is POSIX only; on Windows it is `undefined`, so fall back to `0` (no-op). */
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const READ_FLAGS = fsConstants.O_RDONLY | O_NOFOLLOW
/** Chunk size of the bounded read once the size the file reported has been read. */
const READ_CHUNK_BYTES = 64 * 1024

/** The file system cannot do rename/fsync (network and FUSE mounts) – as `atomicWriteText`. */
const UNSUPPORTED_FS_CODES: ReadonlySet<string> = new Set(['EXDEV', 'ENOTSUP', 'EINVAL', 'ENOSYS'])
/** Codes `renameWithRetry` retries; still failing after the retries means the file is held. */
const RENAME_HELD_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES'])
/** The temp file cannot be created: the folder is not writable. */
const TEMP_DENIED_CODES: ReadonlySet<string> = new Set(['EACCES', 'EPERM'])
/** The path, or a folder on it, is gone – or names a folder (Windows cannot open one). */
const GONE_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR', 'EISDIR'])
/** Opening the target for writing was refused: an ACL denies the write. */
const WRITE_DENIED_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES'])

/** The Windows mark-of-the-web stream; it lives on the old file and does not follow a rename. */
const ZONE_STREAM = ':Zone.Identifier'
/** A real Zone.Identifier is a few short lines; a bigger stream is not one and is not copied. */
const ZONE_STREAM_MAX_BYTES = 4 * 1024

type WriteStep = 'create' | 'write' | 'sync' | 'verify' | 'rename'

/** The errno code (`ENOENT`, …) of a caught value, or `undefined`. Never its message, which may quote a path. */
export function errnoOf(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : undefined
}

/** For a clean-up whose own failure changes nothing: a close, a chmod, removing a temp file. */
function ignoreFailure(): undefined {
  return undefined
}

/** SHA-256 of `bytes`, lowercase hex – the compare-and-swap key of a comment write. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The {@link FileId} of bigint stats. */
export function fileIdOf(stats: Pick<BigIntStats, 'dev' | 'ino'>): FileId {
  return { dev: stats.dev, ino: stats.ino }
}

/** `dev:ino` in decimal – one string per file, for a lock key. */
export function fileIdKey(id: FileId): string {
  return `${id.dev}:${id.ino}`
}

function sameFile(a: FileId, b: FileId): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

/**
 * Read at most `maxBytes`; `undefined` when the file holds more. The size the
 * file reported only sizes the FIRST read – one byte over it, so a file read
 * whole ends on the next, empty read – and is never trusted: reads go on to
 * the end of the file whatever it said. A file that kept its size is read in
 * one call into one buffer, with no copy: each chunk costs the main thread a
 * thread-pool round trip, about 0.2 ms on the slowest box measured, 64 of
 * them for 4 MB.
 */
async function readBounded(handle: FileHandle, maxBytes: number, sizeHint = 0): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let total = 0
  let want = Math.min(Math.max(sizeHint + 1, READ_CHUNK_BYTES), maxBytes + 1)
  for (;;) {
    // Zero-filled: a short read leaves no stale memory behind the bytes returned.
    const chunk = Buffer.alloc(want)
    const { bytesRead } = await handle.read(chunk, 0, want, total)
    if (bytesRead === 0) break
    chunks.push(chunk.subarray(0, bytesRead))
    total += bytesRead
    if (total > maxBytes) return undefined
    want = Math.min(READ_CHUNK_BYTES, maxBytes + 1 - total)
  }
  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total)
}

/** The failure for an open that threw. */
function openFailure(error: unknown): NoFollowRead {
  const errno = errnoOf(error)
  if (errno !== undefined && GONE_CODES.has(errno)) return { ok: false, reason: 'gone', errno }
  // ELOOP: O_NOFOLLOW refused a final-component symlink
  if (errno === 'ELOOP') return { ok: false, reason: 'link', errno }
  return { ok: false, reason: 'io', errno }
}

/**
 * Why the opened handle is not the plain file named `filePath`, or `null` when
 * it is. Compared as bigints: an NTFS file id is 64 bits, which a JavaScript
 * number cannot hold exactly, so two ids could compare equal as numbers.
 */
function identityFailure(opened: BigIntStats, named: BigIntStats): NoFollowReadFailure | null {
  if (!opened.isFile()) return 'gone'
  if (named.isSymbolicLink()) return 'link'
  if (named.dev !== opened.dev || named.ino !== opened.ino) return 'changed'
  return opened.nlink > 1n ? 'link' : null
}

/**
 * Read a regular file without following a link (design §7.6 step 3; pattern
 * `previewPathResolve.ts` steps 8e–8g): `O_NOFOLLOW` open, the opened inode
 * must be the name's (a swap between open and read is `changed`), a symlink
 * or a second hard link is `link`, and at most `maxBytes` are read. Returns
 * the bytes and the {@link FileId} they were read from. The descriptor is
 * closed on every path.
 */
export async function readFileNoFollow(filePath: string, maxBytes: number): Promise<NoFollowRead> {
  let handle: FileHandle
  try {
    handle = await open(filePath, READ_FLAGS)
  } catch (error) {
    return openFailure(error)
  }
  try {
    const opened = await handle.stat({ bigint: true })
    const failure = identityFailure(opened, await lstat(filePath, { bigint: true }))
    if (failure) return { ok: false, reason: failure }
    const bytes = await readBounded(handle, maxBytes, Number(opened.size))
    return bytes ? { ok: true, bytes, id: fileIdOf(opened) } : { ok: false, reason: 'too-large' }
  } catch (error) {
    const errno = errnoOf(error)
    return { ok: false, reason: errno !== undefined && GONE_CODES.has(errno) ? 'gone' : 'io', errno }
  } finally {
    await handle.close().catch(ignoreFailure)
  }
}

/** The failure a write step that threw stands for. */
function stepFailure(step: WriteStep, error: unknown): StrictWriteRefusal {
  const errno = errnoOf(error)
  const has = (codes: ReadonlySet<string>): boolean => errno !== undefined && codes.has(errno)
  let reason: StrictWriteFailure = 'io'
  if (has(GONE_CODES)) reason = 'gone'
  else if ((step === 'sync' || step === 'rename') && has(UNSUPPORTED_FS_CODES)) reason = 'unsupported-fs'
  else if (step === 'create' && has(TEMP_DENIED_CODES)) reason = 'read-only'
  else if (step === 'rename' && has(RENAME_HELD_CODES)) reason = 'busy'
  return { ok: false, reason, errno }
}

/**
 * Windows: open the target for writing once, and close it. `EPERM`/`EACCES`
 * means an ACL denies the write, which the mode bits do not show. Any other
 * failure (a sharing violation, a vanished file) is left to the later steps.
 */
async function writeDenied(filePath: string): Promise<StrictWriteRefusal | null> {
  try {
    await (await open(filePath, 'r+')).close()
    return null
  } catch (error) {
    const errno = errnoOf(error)
    if (errno === undefined || !WRITE_DENIED_CODES.has(errno)) return null
    return { ok: false, reason: 'read-only', errno }
  }
}

/** What the target is now, or why it must not be replaced (step 1). */
async function checkTarget(
  filePath: string,
  platform: NodeJS.Platform
): Promise<{ readonly ok: true; readonly mode: number } | StrictWriteRefusal> {
  let info: Stats
  try {
    info = await lstat(filePath)
  } catch (error) {
    const errno = errnoOf(error)
    return { ok: false, reason: errno !== undefined && GONE_CODES.has(errno) ? 'gone' : 'io', errno }
  }
  if (!info.isFile() && !info.isSymbolicLink()) return { ok: false, reason: 'gone' }
  const blocker = await renameBlocker(filePath, info)
  if (blocker === 'link') return { ok: false, reason: 'link' }
  if (blocker !== null) return { ok: false, reason: 'read-only' }
  const denied = platform === 'win32' ? await writeDenied(filePath) : null
  return denied ?? { ok: true, mode: info.mode & PERMISSION_BITS }
}

/**
 * Windows, best effort: copy the target's `Zone.Identifier` stream onto the
 * temp file, so the mark of the web survives the rename. No stream, an
 * oversized one or any failure: nothing is copied and the write goes on.
 */
async function copyZoneIdentifier(target: string, tempPath: string): Promise<void> {
  try {
    const source = await open(`${target}${ZONE_STREAM}`, 'r')
    let mark: Buffer | undefined
    try {
      mark = await readBounded(source, ZONE_STREAM_MAX_BYTES)
    } finally {
      await source.close().catch(ignoreFailure)
    }
    if (!mark) return
    const copy = await open(`${tempPath}${ZONE_STREAM}`, 'wx')
    try {
      await copy.writeFile(mark)
    } finally {
      await copy.close().catch(ignoreFailure)
    }
  } catch {
    // no mark to keep, or it could not be kept: the comment write goes on
  }
}

/** The re-read of step 3 as a write failure, or `null` when the target is still the file and bytes read. */
async function verifyUnchanged(
  target: string,
  options: StrictWriteOptions
): Promise<StrictWriteRefusal | null> {
  const current = await readFileNoFollow(target, options.maxBytes)
  if (!current.ok) {
    const reason = current.reason === 'too-large' ? 'changed' : current.reason
    return { ok: false, reason, ...(current.errno ? { errno: current.errno } : {}) }
  }
  const { expectedBytes } = options
  const sameBytes =
    expectedBytes === undefined
      ? sha256Hex(current.bytes) === options.expectedHash
      : current.bytes.equals(expectedBytes)
  return sameFile(current.id, options.expectedId) && sameBytes ? null : { ok: false, reason: 'changed' }
}

/** Step 4's folder check: `changed` when the target's folder no longer resolves to `expectedDir`. */
async function folderMoved(
  target: string,
  expectedDir: string | undefined
): Promise<StrictWriteRefusal | null> {
  if (expectedDir === undefined) return null
  return (await realpath(dirname(target))) === expectedDir ? null : { ok: false, reason: 'changed' }
}

/**
 * Replace the existing file `filePath` with `data`, atomically, only if it is
 * still the file `options.expectedId` and holds the bytes whose hash is
 * `options.expectedHash`. Never writes in place and never creates a missing
 * file. See the module comment for the steps and the failures.
 *
 * @returns `{ ok: true, path }` with the on-disk spelling written to, or the reason nothing was written
 */
export async function atomicWriteBytesStrict(
  filePath: string,
  data: Uint8Array,
  options: StrictWriteOptions
): Promise<StrictWriteResult> {
  const platform = options.platform ?? process.platform
  const checked = await checkTarget(filePath, platform)
  if (!checked.ok) return checked
  const target = await onDiskSpelling(filePath)
  const tempPath = join(dirname(target), `${ATOMIC_TEMP_PREFIX}${randomUUID()}`)
  let step: WriteStep = 'create'
  let refusal: StrictWriteRefusal
  try {
    const handle = await open(tempPath, 'wx', checked.mode)
    try {
      step = 'write'
      await handle.writeFile(data)
      // open()'s mode is masked by the umask; restore the original bits exactly
      await handle.chmod(checked.mode).catch(ignoreFailure)
      step = 'sync'
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (platform === 'win32') await copyZoneIdentifier(target, tempPath)
    step = 'verify'
    const changed =
      (await verifyUnchanged(target, options)) ?? (await folderMoved(target, options.expectedDir))
    if (changed === null) {
      step = 'rename'
      await renameWithRetry(tempPath, target)
      return { ok: true, path: target }
    }
    refusal = changed
  } catch (error) {
    refusal = stepFailure(step, error)
  }
  // The temp file never outlives a failed write; it may not exist (create failed)
  await unlink(tempPath).catch(ignoreFailure)
  return refusal
}
