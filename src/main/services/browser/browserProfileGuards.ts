// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guards for `<project>/.erfana/browser/` (spec 025, 025-FR-016; ADR 0009
 * decisions 2 and 11; panel findings S4, S18/S-20).
 *
 * The folder lives in the project, where the agent, scripts and a cloned
 * repository can plant anything. Before the browser session exists, before a
 * capture is written and before ANY delete, every level is checked again:
 *
 * - the project path is canonical (`fs.promises.realpath`, libuv's native
 *   real-path call), so `C:\Proj` and `c:\proj` are one project;
 * - each level (`.erfana`, `browser`, `.gitignore`, `profile`,
 *   `profile/Erfana`, `captures`, and every level of a delete target) is
 *   `lstat`ed without following links: a symlink or junction is refused
 *   (Node reports a Windows junction as a symbolic link);
 * - each level's real path must be exactly `<canonical>/<the level>`, so
 *   nothing reached through it can leave the project;
 * - folders are created one level at a time, never recursively, so a link
 *   planted between the check and the create fails with `EEXIST` instead of
 *   being followed;
 * - files are created with exclusive, no-follow flags (Windows has no
 *   `O_NOFOLLOW`: exclusive create, then `fstat` and the real-path re-check).
 *
 * The rule for `.erfana` is the one `preview/erfanaDirGate.ts` applies (lstat,
 * non-recursive create, exact real-path name), applied here to every level so
 * one error type can name the level that failed.
 */
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, unlink, type FileHandle } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, sep } from 'node:path'
import type { Stats } from 'node:fs'
import { normaliseResolved, isSamePath } from '../../utils/pathCompare'
import { realPathWithin } from '../preview/previewPathResolve'
import {
  BROWSER_DIR_SEGMENTS,
  BROWSER_GITIGNORE_CONTENT,
  BROWSER_GITIGNORE_NAME,
  CAPTURES_DIR_NAME,
  PROFILE_DIR_NAME,
  PROFILE_ERFANA_DIR_NAME
} from './browserProfilePaths'

/** Why a browser folder was refused; the toast names {@link BrowserProfileError.relPath}. */
export type BrowserProfileErrorCode =
  /** A level is a symlink or junction. */
  | 'link'
  /** A level's real path is not where it should be (it leaves the project). */
  | 'outside'
  /** A file where a folder belongs, or the reverse. */
  | 'wrong-type'
  /** Creating, writing or renaming failed (read-only folder, full disk, …). */
  | 'write-failed'
  /** A delete failed. */
  | 'delete-failed'
  /** A path that is not under `.erfana/browser`, or has an unsafe segment. */
  | 'invalid-path'
  /** No project is open, or it moved since it was opened. */
  | 'no-project'
  /** Another Erfana process holds the project lock (ADR 0009 decision 4). */
  | 'locked-elsewhere'

export class BrowserProfileError extends Error {
  /**
   * @param relPath project-relative, `/`-separated path of the level that
   *   failed – the user's own folder name, shown in the toast; logs redact it
   */
  constructor(
    readonly code: BrowserProfileErrorCode,
    readonly relPath: string,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'BrowserProfileError'
  }
}

const FOLDER_MODE = 0o700
const FILE_MODE = 0o600
/** `O_NOFOLLOW` is undefined on Windows; the real-path re-check covers it there. */
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const CREATE_EXCLUSIVE = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | O_NOFOLLOW
const READ_NO_FOLLOW = fsConstants.O_RDONLY | O_NOFOLLOW
/** Case rule for the real-path comparison: realpath spells case as on disk where it folds. */
const CASE_SENSITIVE_FS = process.platform === 'linux'

const errnoCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code

const relOf = (segments: readonly string[]): string => segments.join('/')

/** Wrap an unexpected file-system error as a refusal naming the level. */
function asWriteFailure(error: unknown, segments: readonly string[], what: string): BrowserProfileError {
  if (error instanceof BrowserProfileError) return error
  const reason = errnoCode(error) ?? (error instanceof Error ? error.message : String(error))
  return new BrowserProfileError('write-failed', relOf(segments), `${what} failed (${reason})`, { cause: error })
}

/**
 * The project's canonical path: the native real path, normalised.
 *
 * @throws BrowserProfileError('no-project') when the folder cannot be resolved
 */
export async function canonicalProjectPath(projectRoot: string): Promise<string> {
  try {
    return normaliseResolved(await realpath(projectRoot))
  } catch (error) {
    throw new BrowserProfileError('no-project', '', 'The project folder cannot be resolved', { cause: error })
  }
}

async function lstatOrNull(abs: string): Promise<Stats | null> {
  try {
    return await lstat(abs)
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null
    throw error
  }
}

function refuseLink(stats: Stats, segments: readonly string[]): void {
  if (stats.isSymbolicLink()) {
    throw new BrowserProfileError('link', relOf(segments), 'A symlink or junction is not allowed here')
  }
}

function requireKind(stats: Stats, kind: 'dir' | 'file', segments: readonly string[]): void {
  const ok = kind === 'dir' ? stats.isDirectory() : stats.isFile()
  if (!ok) {
    const expected = kind === 'dir' ? 'a folder' : 'a file'
    throw new BrowserProfileError('wrong-type', relOf(segments), `Expected ${expected}`)
  }
}

/**
 * Require the real path of `<canonical>/<segments>` to be exactly that path.
 *
 * @throws BrowserProfileError('outside') otherwise
 */
export async function assertRealPathAt(canonical: string, segments: readonly string[]): Promise<void> {
  const real = normaliseResolved(await realpath(join(canonical, ...segments)))
  const below = realPathWithin(canonical, real)
  if (below === undefined || !isSamePath(below, segments.join(sep), CASE_SENSITIVE_FS)) {
    throw new BrowserProfileError('outside', relOf(segments), 'The folder leads outside the project')
  }
}

/**
 * Check one existing level: present, not a link, of the right kind, and at
 * its own real path. Returns false when the level does not exist.
 */
export async function checkExistingLevel(
  canonical: string,
  segments: readonly string[],
  kind: 'dir' | 'file' | 'any'
): Promise<boolean> {
  const stats = await lstatOrNull(join(canonical, ...segments))
  if (stats === null) return false
  refuseLink(stats, segments)
  if (kind !== 'any') requireKind(stats, kind, segments)
  await assertRealPathAt(canonical, segments)
  return true
}

/** Ensure one folder level exists, guarded; never creates more than this level. */
async function ensureFolderLevel(canonical: string, segments: readonly string[]): Promise<void> {
  if (await checkExistingLevel(canonical, segments, 'dir')) return
  try {
    await mkdir(join(canonical, ...segments), { mode: FOLDER_MODE })
  } catch (error) {
    // Lost a race: whatever is there now is checked like any existing level
    if (errnoCode(error) !== 'EEXIST') throw asWriteFailure(error, segments, 'Creating the folder')
  }
  if (!(await checkExistingLevel(canonical, segments, 'dir'))) {
    throw new BrowserProfileError('write-failed', relOf(segments), 'The folder disappeared after it was created')
  }
}

/**
 * Create `<canonical>/<segments>` holding `data`, exclusively and without
 * following a link; never replaces anything.
 *
 * @throws BrowserProfileError('write-failed') with reason `EEXIST` when the
 *   name is taken (by a file, a folder or a link)
 */
export async function createFileExclusive(
  canonical: string,
  segments: readonly string[],
  data: string
): Promise<void> {
  let handle: FileHandle | undefined
  try {
    handle = await open(join(canonical, ...segments), CREATE_EXCLUSIVE, FILE_MODE)
    if (!(await handle.stat()).isFile()) {
      throw new BrowserProfileError('wrong-type', relOf(segments), 'Expected a file')
    }
    await handle.writeFile(data, 'utf8')
    await handle.sync()
  } catch (error) {
    throw asWriteFailure(error, segments, 'Writing the file')
  } finally {
    await handle?.close()
  }
  await assertRealPathAt(canonical, segments)
}

/**
 * Read a small file under the project without following a link at its name.
 * Returns null when it does not exist.
 *
 * @throws BrowserProfileError('link') for a link, ('wrong-type') for a folder,
 *   and the file-system error for anything else
 */
export async function readFileNoFollow(
  canonical: string,
  segments: readonly string[],
  maxBytes: number
): Promise<string | null> {
  if (!(await checkExistingLevel(canonical, segments, 'file'))) return null
  const handle = await open(join(canonical, ...segments), READ_NO_FOLLOW)
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) throw new BrowserProfileError('wrong-type', relOf(segments), 'Expected a file')
    if (stats.size > maxBytes) return null
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}

/**
 * `.erfana/browser/.gitignore` holds exactly `*` (spec change S-20): created
 * exclusively when missing; any other content is replaced whole by a fresh
 * file renamed over it (a rename replaces a link planted in between, it never
 * writes through one).
 */
async function ensureGitignore(canonical: string): Promise<void> {
  const segments = [...BROWSER_DIR_SEGMENTS, BROWSER_GITIGNORE_NAME]
  const current = await readFileNoFollow(canonical, segments, 64 * 1024).catch((error: unknown) => {
    throw asWriteFailure(error, segments, 'Reading the file')
  })
  if (current === BROWSER_GITIGNORE_CONTENT) return
  if (current === null && !(await checkExistingLevel(canonical, segments, 'file'))) {
    await createFileExclusive(canonical, segments, BROWSER_GITIGNORE_CONTENT)
    return
  }
  // Present with other content (or too large to read): replace it whole
  const tempSegments = [...BROWSER_DIR_SEGMENTS, `${BROWSER_GITIGNORE_NAME}.${randomUUID()}.tmp`]
  await createFileExclusive(canonical, tempSegments, BROWSER_GITIGNORE_CONTENT)
  try {
    await rename(join(canonical, ...tempSegments), join(canonical, ...segments))
  } catch (error) {
    await unlink(join(canonical, ...tempSegments)).catch(() => undefined)
    throw asWriteFailure(error, segments, 'Replacing the file')
  }
  await checkExistingLevel(canonical, segments, 'file')
}

/**
 * First half of the folder setup, before anything else exists in
 * `.erfana/browser`: `.erfana`, `.erfana/browser`, then the self-ignore file
 * (025-AC-016: it is written before any other file in the folder).
 *
 * @throws BrowserProfileError naming the level that failed
 */
export async function ensureBrowserFolder(canonical: string): Promise<void> {
  for (let depth = 1; depth <= BROWSER_DIR_SEGMENTS.length; depth++) {
    await ensureFolderLevel(canonical, BROWSER_DIR_SEGMENTS.slice(0, depth))
  }
  await ensureGitignore(canonical)
}

/** `profile`, `profile/Erfana` and `captures` below `.erfana/browser`, in order. */
export const PROFILE_TREE: readonly (readonly string[])[] = Object.freeze([
  [...BROWSER_DIR_SEGMENTS, PROFILE_DIR_NAME],
  [...BROWSER_DIR_SEGMENTS, PROFILE_DIR_NAME, PROFILE_ERFANA_DIR_NAME],
  [...BROWSER_DIR_SEGMENTS, CAPTURES_DIR_NAME]
])

/**
 * Second half: the profile and captures folders. Run after
 * {@link ensureBrowserFolder} and after a distrusted profile was set aside.
 *
 * @throws BrowserProfileError naming the level that failed
 */
export async function ensureProfileTree(canonical: string): Promise<void> {
  for (const segments of PROFILE_TREE) {
    await ensureFolderLevel(canonical, segments)
  }
}

/** A path segment that cannot step out of, or alias, its folder. */
function isSafeSegment(segment: string): boolean {
  return (
    segment !== '' &&
    segment !== '.' &&
    segment !== '..' &&
    !/[\\/\0:]/.test(segment) &&
    !/[. ]$/.test(segment)
  )
}

/**
 * Re-guard an existing delete target (ADR 0009 decision 11): `segments` must
 * name `.erfana/browser` or a path below it; every level from `.erfana` down
 * to the target itself is checked again (present, not a link, at its own real
 * path). The target itself may be a file or a folder, never a link – a link
 * is left alone (025-FR-039).
 *
 * @returns the absolute path to delete, or null when the target is gone
 * @throws BrowserProfileError('invalid-path' | 'link' | 'outside' | 'wrong-type')
 */
export async function guardDeleteTarget(canonical: string, segments: readonly string[]): Promise<string | null> {
  const underBrowser =
    segments.length >= BROWSER_DIR_SEGMENTS.length &&
    BROWSER_DIR_SEGMENTS.every((name, index) => segments[index] === name) &&
    segments.every(isSafeSegment)
  if (!underBrowser) {
    throw new BrowserProfileError('invalid-path', relOf(segments), 'Only paths under .erfana/browser are deleted')
  }
  for (let depth = 1; depth <= segments.length; depth++) {
    const level = segments.slice(0, depth)
    const kind = depth === segments.length ? 'any' : 'dir'
    if (!(await checkExistingLevel(canonical, level, kind))) return null
  }
  return join(canonical, ...segments)
}
