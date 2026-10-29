// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Finding and reading an HTML file for comments, with every check a comment
 * write needs before it splices (docs/designs/comments/html-preview-comments.md §7.6
 * steps 1–5; threats S8, S11, S12, S22). Reading never writes (M-014).
 *
 * Step 1 – where the file is, in this order, cheapest first, and before any
 * file-system access where the rule allows it (so an out-of-project or UNC
 * path is never touched):
 *  1. a fully qualified absolute path (a Windows path rooted without a drive,
 *     `\proj\a.html`, would resolve against the current drive), lexically
 *     inside the project root – an early reject only, see 4. The part below
 *     the root, which rules 2–3 classify, is cut at the root's end under the
 *     same case rule (`pathBelowRoot`), never by `path.relative`, which
 *     compares by the host's rule: on macOS a path naming the root in another
 *     letter case passed this check and then came back from `relative` as
 *     `../proj/…`, refused as excluded (§19 Rev 4 "case-only path
 *     differences on macOS");
 *  2. a `.html`/`.htm` name; on Windows no NTFS alternate-stream name
 *     (`index.html:x.html`, `index.html::$DATA`) and no 8.3 short-name
 *     segment below the root;
 *  3. no never-served segment (`node_modules`, `dist`, `out`, `coverage`,
 *     `.git`, any dot-folder) – the same rules the protocol layer serves by,
 *     so a page the preview cannot show is never written;
 *  4. `confinePath` without `allowBuildDirs` against the root's own
 *     `fs.promises.realpath`: the parent and then the full path resolved, and
 *     every rule re-run on the resolved path. The DECIDING containment check
 *     is then made here as well, exactly: the two realpaths compared code unit
 *     for code unit with a segment boundary (`realPathWithin`). The lexical
 *     check folds case on Windows and macOS, and JavaScript's folding is not
 *     the file system's – `toLowerCase` maps the Kelvin sign U+212A to `k`, so
 *     a sibling folder `proj` + U+212A would pass for the root `projk`;
 *  5. the REAL name passes rule 2 too (a link `a.html` → `x.sh` is refused as
 *     not HTML), and the requested name is not itself a symlink (a link
 *     `a.html` → `b.html` is refused as a link). Its dev/ino is returned for
 *     the write lock.
 *
 * Gitignore is NOT a rule here (decision 35): a page the preview serves –
 * gitignored pages shown in frames included – is commentable.
 *
 * Steps 2–3 – what the file is: a regular file with one link, read with
 * `O_NOFOLLOW` + a dev/ino compare, at most `COMMENT_FILE_MAX_BYTES` (25 MB,
 * §19 Rev 4). Main stops at the bytes: the lossless decode and the parse –
 * about 380 ms at 4 MB and 5 s at 25 MB on the slowest box measured – run
 * in the comment parse worker (`commentFileJobs.ts`, §19 R3-12), whose
 * `writableRefusal` (`commentJobDocs.ts`) says whether the parsed state may be
 * written (a complete conflict hunk, an unterminated block and too many
 * blocks make it read-only).
 */
import type { BigIntStats } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { basename, isAbsolute, normalize, resolve } from 'node:path'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import {
  errnoOf,
  fileIdOf,
  readFileNoFollow,
  type FileId
} from '../../utils/atomicWriteBytesStrict'
import { hostPathFlavour, pathBelowRoot, type PathFlavour } from '../../utils/pathCompare'
import { namesAlternateDataStream } from '../browserLaunch/BrowserLaunchService'
import { hasDotSegment, hasShortNameAlias, isInExcludedDirectory } from '../preview/previewExclusion'
import { confinePath, realPathWithin } from '../preview/previewPathResolve'
import { refused, type CommentRefusal, type Refused } from './commentRefusals'

/** The file a comment operation is about. */
export interface CommentFileTarget {
  /** The project root; resolved again with `fs.promises.realpath` before it decides anything. */
  readonly realRoot: string
  /**
   * Absolute path of the HTML file, as main recorded it for the page or frame
   * (never a URL or a path from the page).
   */
  readonly filePath: string
}

/** A file read for comments: its real path and its exact bytes, not yet decoded. */
export interface LoadedCommentBytes {
  /** The confined real path – the path that is written. */
  readonly realPath: string
  /** The file the bytes were read from; the write requires it to still be in place. */
  readonly id: FileId
  readonly bytes: Buffer
}

export type ConfineResult =
  | { readonly ok: true; readonly realPath: string; readonly id: FileId }
  | Refused

export type LoadResult = ({ readonly ok: true } & LoadedCommentBytes) | Refused

/** Options for the loader; the platform is injectable so the Windows rules run on every host. */
export interface CommentFileAccessOptions {
  readonly platform?: NodeJS.Platform
  /**
   * Read at most this many bytes, when it is below `COMMENT_FILE_MAX_BYTES`:
   * the comment list's remaining budget (`commentListBuilder.ts`). A longer
   * file is refused as `too-large`.
   */
  readonly maxBytes?: number
}

/** `.html` or `.htm` at the very end of the name, any case. */
const HTML_NAME = /\.html?$/i

/** Windows and macOS disks are case-insensitive by default; everything else compares exactly. */
function isCaseSensitive(platform: NodeJS.Platform): boolean {
  return platform !== 'win32' && platform !== 'darwin'
}

/** A failed file-system call as a refusal: gone is `missing`, anything else `io`. */
function fsRefusal(error: unknown): Refused {
  const errno = errnoOf(error)
  return refused(errno === 'ENOENT' || errno === 'ENOTDIR' ? 'missing' : 'io', errno)
}

/** Why a file NAME may not take comments, or `null` (rule 2). */
function nameRefusal(filePath: string, platform: NodeJS.Platform): CommentRefusal | null {
  if (platform === 'win32' && namesAlternateDataStream(filePath)) return 'alternate-stream'
  if (!HTML_NAME.test(basename(filePath))) return 'not-html'
  return null
}

/**
 * Rule 1's "fully qualified": absolute, and resolving to itself. A Windows
 * path rooted without a drive (`\proj\a.html`) is absolute to Node but
 * resolves against the current drive, so it is refused as not absolute.
 */
function isFullyQualified(filePath: string): boolean {
  return isAbsolute(filePath) && resolve(filePath) === normalize(filePath)
}

/** Rules 1–3: no file-system access. */
function lexicalRefusal(target: CommentFileTarget, platform: NodeJS.Platform): CommentRefusal | null {
  const { realRoot, filePath } = target
  if (!isFullyQualified(filePath)) return 'not-absolute'
  // The host's path syntax with the platform's case rules – production passes its own platform
  const flavour: PathFlavour = { path: hostPathFlavour.path, platform }
  const rel = pathBelowRoot(resolve(filePath), realRoot, isCaseSensitive(platform), flavour)
  if (rel === undefined) return 'outside-project'
  const byName = nameRefusal(filePath, platform)
  if (byName) return byName
  if (hasShortNameAlias(rel, platform)) return 'short-name'
  if (hasDotSegment(rel) || isInExcludedDirectory(rel)) return 'excluded'
  return null
}

/** Rule 5, second half: the requested name is not a link. Its dev/ino keys the write lock. */
async function requestedFileId(filePath: string): Promise<{ readonly ok: true; readonly id: FileId } | Refused> {
  let info: BigIntStats
  try {
    info = await lstat(filePath, { bigint: true })
  } catch (error) {
    return fsRefusal(error)
  }
  return info.isSymbolicLink() ? refused('link') : { ok: true, id: fileIdOf(info) }
}

/**
 * Step 1: where the file is. Resolves to the confined real path, the only
 * path the caller may read or write from here on, and the file's dev/ino.
 */
export async function confineCommentFile(
  target: CommentFileTarget,
  options: CommentFileAccessOptions = {}
): Promise<ConfineResult> {
  const platform = options.platform ?? process.platform
  const lexical = lexicalRefusal(target, platform)
  if (lexical) return refused(lexical)
  let root: string
  try {
    root = await realpath(target.realRoot)
  } catch (error) {
    return fsRefusal(error)
  }
  const verdict = await confinePath(root, target.filePath)
  if (!verdict.ok) {
    return refused(verdict.reason === 'escape' ? 'outside-project' : verdict.reason)
  }
  // Rule 4's deciding check, here and not only inside confinePath (see the module comment)
  if (realPathWithin(root, verdict.realTarget) === undefined) return refused('outside-project')
  const byRealName = nameRefusal(verdict.realTarget, platform)
  if (byRealName) return refused(byRealName)
  const requested = await requestedFileId(target.filePath)
  if (!requested.ok) return requested
  return { ok: true, realPath: verdict.realTarget, id: requested.id }
}

/**
 * Steps 2–3 on an already confined real path: a regular file with one link,
 * read without following a link, at most `COMMENT_FILE_MAX_BYTES` – or
 * `maxBytes`, when that is lower.
 */
export async function readConfinedCommentBytes(
  realPath: string,
  maxBytes: number = PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES
): Promise<LoadResult> {
  const read = await readFileNoFollow(realPath, Math.min(maxBytes, PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES))
  if (!read.ok) {
    const reason: CommentRefusal = read.reason === 'gone' ? 'missing' : read.reason
    return refused(reason, read.errno)
  }
  return { ok: true, realPath, id: read.id, bytes: read.bytes }
}

/** Steps 1–3: confine, then read the bytes. Never writes, never parses. */
export async function loadCommentBytes(
  target: CommentFileTarget,
  options: CommentFileAccessOptions = {}
): Promise<LoadResult> {
  const confined = await confineCommentFile(target, options)
  return confined.ok ? readConfinedCommentBytes(confined.realPath, options.maxBytes) : confined
}
