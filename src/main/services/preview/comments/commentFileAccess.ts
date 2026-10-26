// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Finding and reading an HTML file for comments, with every check a comment
 * write needs before it splices (docs/designs/html-preview-comments.md §7.6
 * steps 1–5; threats S8, S11, S12, S22). Reading never writes (M-014).
 *
 * Step 1 – where the file is, in this order, cheapest first, and before any
 * file-system access where the rule allows it (so an out-of-project or UNC
 * path is never touched):
 *  1. a fully qualified absolute path (a Windows path rooted without a drive,
 *     `\proj\a.html`, would resolve against the current drive), lexically
 *     inside the project root – an early reject only, see 4;
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
 * Steps 2–5 – what the file is: a regular file with one link, read with
 * `O_NOFOLLOW` + a dev/ino compare, at most 4 MB; decoded only when the
 * decode is byte-identical (UTF-8 ± BOM); parsed once. The comment state says
 * whether it may be written (a complete conflict hunk, an unterminated block
 * and too many blocks make it read-only); {@link writableRefusal} turns that
 * into a refusal for the writer.
 */
import type { BigIntStats } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { basename, isAbsolute, normalize, relative, resolve } from 'node:path'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import {
  parseCommentFile,
  type CommentDocument,
  type FileCommentState
} from '../../../../shared/htmlComments'
import {
  errnoOf,
  fileIdOf,
  readFileNoFollow,
  sha256Hex,
  type FileId
} from '../../../utils/atomicWriteBytesStrict'
import { isInsideRoot } from '../../../utils/pathCompare'
import { namesAlternateDataStream } from '../../browserLaunch/BrowserLaunchService'
import { hasDotSegment, hasShortNameAlias, isInExcludedDirectory } from '../previewExclusion'
import { confinePath, realPathWithin } from '../previewPathResolve'
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

/** A file read for comments: its real path, its exact bytes, their hash and the shared parse. */
export interface LoadedCommentFile {
  /** The confined real path – the path that is written. */
  readonly realPath: string
  /** The file the bytes were read from; the write requires it to still be in place. */
  readonly id: FileId
  readonly bytes: Buffer
  /** SHA-256 (hex) of {@link bytes}; drafts and the write's compare-and-swap use it. */
  readonly hash: string
  readonly doc: CommentDocument
}

export type ConfineResult =
  | { readonly ok: true; readonly realPath: string; readonly id: FileId }
  | Refused

export type LoadResult = { readonly ok: true; readonly file: LoadedCommentFile } | Refused

/** Options for the loader; the platform is injectable so the Windows rules run on every host. */
export interface CommentFileAccessOptions {
  readonly platform?: NodeJS.Platform
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
  const resolved = resolve(filePath)
  if (!isInsideRoot(resolved, realRoot, isCaseSensitive(platform))) return 'outside-project'
  const byName = nameRefusal(filePath, platform)
  if (byName) return byName
  const rel = relative(realRoot, resolved)
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
 * Steps 2–4 on an already confined real path: a regular file with one link,
 * read without following a link, at most 4 MB, decoded losslessly and parsed.
 */
export async function readConfinedCommentFile(realPath: string): Promise<LoadResult> {
  const read = await readFileNoFollow(realPath, PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES)
  if (!read.ok) {
    const reason: CommentRefusal = read.reason === 'gone' ? 'missing' : read.reason
    return refused(reason, read.errno)
  }
  const parsed = parseCommentFile(read.bytes)
  if (!parsed.ok) return refused(readOnlyRefusal(parsed.state))
  return {
    ok: true,
    file: { realPath, id: read.id, bytes: read.bytes, hash: sha256Hex(read.bytes), doc: parsed.doc }
  }
}

/** Steps 1–4: confine, then read and parse. Never writes. */
export async function loadCommentFile(
  target: CommentFileTarget,
  options: CommentFileAccessOptions = {}
): Promise<LoadResult> {
  const confined = await confineCommentFile(target, options)
  return confined.ok ? readConfinedCommentFile(confined.realPath) : confined
}

/**
 * Why a read-only comment state may not be written. Every read-only reason of
 * the parse (`conflict-markers`, `unterminated-block`, `too-many-blocks`,
 * `too-large`, `encoding`) is a refusal of the same name.
 */
function readOnlyRefusal(state: FileCommentState): CommentRefusal {
  return state.readOnlyReason ?? 'read-only'
}

/** Step 5: why a parsed file may not be written, or `null` when it may. */
export function writableRefusal(state: FileCommentState): CommentRefusal | null {
  return state.writable ? null : readOnlyRefusal(state)
}
