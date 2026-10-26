// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Why a comment read or write was refused, and the `ErrorCode` each reason
 * reaches the renderer as (docs/designs/html-preview-comments.md §8).
 *
 * The reason is finer than the code: it goes to the log (with a path digest,
 * never a path, a name or any comment text – §7.6 step 10) and lets a caller
 * word a refusal precisely, while the code family stays small.
 *
 * | Code | Meaning |
 * |---|---|
 * | `COMMENT_PATH_REFUSED` | not a file comments may be written to: not absolute, outside the project, a never-served path (`node_modules`, `dist`, `out`, `coverage`, `.git`, dot-folders), not `.html`/`.htm`, an NTFS stream name, an 8.3 short name |
 * | `COMMENT_FILE_GONE` | the file, or a folder on its path, no longer exists |
 * | `COMMENT_WRITE_REFUSED_LINK` | the file is a symlink or has other hard links |
 * | `COMMENT_FILE_TOO_LARGE` | over 4 MB |
 * | `COMMENT_ENCODING_UNSUPPORTED` | not UTF-8 (± BOM) with a byte-identical round trip |
 * | `COMMENT_FILE_CONFLICTED` | a complete git conflict hunk in the file |
 * | `COMMENT_FILE_READ_ONLY` | read-only on disk, another user's file, an unwritable folder, or an unterminated block (read-only for comments) |
 * | `COMMENT_LIMIT` | the write would break a §5.8 limit (message, replies, block bytes, blocks per file, file size) or push a `<meta charset>` out of the prescan |
 * | `COMMENT_UNSAVED_SOURCE` | an editor holds unsaved changes for the file (decision 13) |
 * | `COMMENT_IDENTITY_REQUIRED` | no usable author name in the app settings |
 * | `COMMENT_TARGET_MOVED` | the picked element is no longer in the file, or not uniquely |
 * | `COMMENT_BLOCK_CHANGED` | the block changed, turned damaged or is gone since the window read it |
 * | `COMMENT_WRITE_UNSUPPORTED_FS` | the drive cannot rename or fsync (network and FUSE mounts) |
 * | `COMMENT_WRITE_FAILED` | anything else, including a file that kept changing during the save, a held file, a splice that failed its verification (fail closed), and a parse the comment parse worker could not run (`busy`, `parse-failed`) |
 *
 * `COMMENT_DRAFT_EXPIRED` and `COMMENT_KEY_INVALID` belong to the draft and
 * key layer (P5), which runs before a write is attempted. `COMMENT_SAVE_PENDING`
 * is no refusal: the save outlasted its answer and is still being written
 * (`commentSaveFlow.ts`).
 */
import { ErrorCode } from '../../../../shared/errors'

/** The `ErrorCode`s of the HTML Preview comment family. */
export type CommentErrorCode =
  | ErrorCode.COMMENT_TARGET_MOVED
  | ErrorCode.COMMENT_BLOCK_CHANGED
  | ErrorCode.COMMENT_ENCODING_UNSUPPORTED
  | ErrorCode.COMMENT_FILE_CONFLICTED
  | ErrorCode.COMMENT_DRAFT_EXPIRED
  | ErrorCode.COMMENT_KEY_INVALID
  | ErrorCode.COMMENT_IDENTITY_REQUIRED
  | ErrorCode.COMMENT_LIMIT
  | ErrorCode.COMMENT_FILE_TOO_LARGE
  | ErrorCode.COMMENT_WRITE_REFUSED_LINK
  | ErrorCode.COMMENT_WRITE_UNSUPPORTED_FS
  | ErrorCode.COMMENT_UNSAVED_SOURCE
  | ErrorCode.COMMENT_FILE_GONE
  | ErrorCode.COMMENT_PATH_REFUSED
  | ErrorCode.COMMENT_FILE_READ_ONLY
  | ErrorCode.COMMENT_WRITE_FAILED

/** Why a comment read or write did nothing. */
export type CommentRefusal =
  // Where the file is (§7.6 step 1)
  | 'not-absolute'
  | 'outside-project'
  | 'excluded'
  | 'not-html'
  | 'alternate-stream'
  | 'short-name'
  // What the file is (steps 2–5)
  | 'missing'
  | 'link'
  | 'too-large'
  | 'encoding'
  | 'conflict-markers'
  | 'unterminated-block'
  | 'too-many-blocks'
  | 'read-only'
  | 'not-owner'
  // The write (steps 6–9)
  | 'unsaved-source'
  | 'identity'
  | 'target-moved'
  | 'block-changed'
  | 'limit'
  | 'meta-charset'
  | 'invalid'
  | 'verify-failed'
  | 'changed'
  | 'unsupported-fs'
  | 'busy'
  | 'parse-failed'
  | 'io'

const CODES: Readonly<Record<CommentRefusal, CommentErrorCode>> = {
  'not-absolute': ErrorCode.COMMENT_PATH_REFUSED,
  'outside-project': ErrorCode.COMMENT_PATH_REFUSED,
  excluded: ErrorCode.COMMENT_PATH_REFUSED,
  'not-html': ErrorCode.COMMENT_PATH_REFUSED,
  'alternate-stream': ErrorCode.COMMENT_PATH_REFUSED,
  'short-name': ErrorCode.COMMENT_PATH_REFUSED,
  missing: ErrorCode.COMMENT_FILE_GONE,
  link: ErrorCode.COMMENT_WRITE_REFUSED_LINK,
  'too-large': ErrorCode.COMMENT_FILE_TOO_LARGE,
  encoding: ErrorCode.COMMENT_ENCODING_UNSUPPORTED,
  'conflict-markers': ErrorCode.COMMENT_FILE_CONFLICTED,
  'unterminated-block': ErrorCode.COMMENT_FILE_READ_ONLY,
  'too-many-blocks': ErrorCode.COMMENT_LIMIT,
  'read-only': ErrorCode.COMMENT_FILE_READ_ONLY,
  'not-owner': ErrorCode.COMMENT_FILE_READ_ONLY,
  'unsaved-source': ErrorCode.COMMENT_UNSAVED_SOURCE,
  identity: ErrorCode.COMMENT_IDENTITY_REQUIRED,
  'target-moved': ErrorCode.COMMENT_TARGET_MOVED,
  'block-changed': ErrorCode.COMMENT_BLOCK_CHANGED,
  limit: ErrorCode.COMMENT_LIMIT,
  'meta-charset': ErrorCode.COMMENT_LIMIT,
  invalid: ErrorCode.COMMENT_WRITE_FAILED,
  'verify-failed': ErrorCode.COMMENT_WRITE_FAILED,
  changed: ErrorCode.COMMENT_WRITE_FAILED,
  'unsupported-fs': ErrorCode.COMMENT_WRITE_UNSUPPORTED_FS,
  busy: ErrorCode.COMMENT_WRITE_FAILED,
  'parse-failed': ErrorCode.COMMENT_WRITE_FAILED,
  io: ErrorCode.COMMENT_WRITE_FAILED
}

/** The `ErrorCode` a refusal reaches the renderer as. */
export function refusalCode(reason: CommentRefusal): CommentErrorCode {
  return CODES[reason]
}

/** A refusal, with the errno code of a file-system failure when there was one. */
export interface Refused {
  readonly ok: false
  readonly reason: CommentRefusal
  readonly errno?: string
}

/** Build a {@link Refused}; `errno` is kept only when present. */
export function refused(reason: CommentRefusal, errno?: string): Refused {
  return errno === undefined ? { ok: false, reason } : { ok: false, reason, errno }
}

/**
 * A parse the comment parse worker did not answer, as a refusal: a full queue
 * is `busy`; a timeout, a crash, a bad answer or no worker is `parse-failed`.
 */
export function jobFailureRefusal(failure: 'busy' | 'timeout' | 'crashed' | 'error' | 'unavailable'): Refused {
  return refused(failure === 'busy' ? 'busy' : 'parse-failed')
}
