// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * CommentWriter – the only page-driven disk write path
 * (docs/designs/comments/html-preview-comments.md §4.1 B3 → B4, §7.6, §7.7; threats
 * S10, S11, S13, S21, S23).
 *
 * Every save, whatever the operation:
 *  1. confines the file (`commentFileAccess`, §7.6 step 1) and takes the lock
 *     for its real path and its dev/ino (`commentFileLock`), so two saves on
 *     one file run one after the other;
 *  2. refuses when an editor holds unsaved changes for the file (decision 13),
 *     and reads the author from Erfana's own settings when the operation
 *     writes one – a request never carries an author (§7.5 step 2);
 *  3. RE-READS the file from disk – never a copy read earlier – and refuses a
 *     symlink, a hard link, a non-UTF-8 file, a file over
 *     `COMMENT_FILE_MAX_BYTES` (25 MB) or one the parse marks read-only (a
 *     conflict hunk, an unterminated block);
 *  4. re-locates its target in a fresh parse of those bytes: for an add, the
 *     draft's element (its offset while the file is unchanged, else the
 *     draft's backup anchors, which must match exactly one element); for an
 *     edit or delete, the block by id whose bytes still hash to what the
 *     window read – a damaged or newer block is never rewritten (decision 12);
 *  5. plans ONE splice on the decoded text, applies it to the original bytes,
 *     and verifies before writing: every byte outside the block identical, the
 *     new bytes decode losslessly to the spliced text, exactly one block more,
 *     the same or one fewer, the same elements, and the written block reads
 *     back with the intended data. Any failure: nothing is written.
 *     Step 3's decode and parse, and steps 4 and 5, run in the comment parse
 *     worker as the `write` job (`commentWriteCore.ts`, §19 R3-12) – the file
 *     and the spliced file are both parsed there, never on the main thread.
 *     Main gets back the splice as a byte range and the block's bytes, and
 *     rebuilds the file from the bytes read, so every byte outside the block
 *     is the byte it read whatever the worker answered. The bytes are lent
 *     to the worker, not copied (§19 Rev 4), and come back as the answer's
 *     `raw`; step 6 compares them byte for byte with the file on disk, so
 *     bytes the worker changed could only refuse the write, never land;
 *  6. writes with `atomicWriteBytesStrict`, which refuses when the path no
 *     longer names the file read in 3 (dev/ino), the file no longer holds the
 *     bytes read, or its folder no longer resolves where it did. Then the
 *     save runs once more from 3 –
 *     the outside edit is kept and the target re-located (M-002, M-004) – and
 *     after that fails cleanly.
 *
 * Results are returned, never thrown. Log lines carry the operation, the
 * refusal reason, an errno code and a digest of the path – never comment
 * text, an author, an email or a file name (§7.6 step 10, M-016).
 *
 * One instance is enough per process; the lock is process-wide either way.
 */
import { dirname } from 'node:path'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import { stablePathDigest } from '../../../../shared/stablePathDigest'
import { codePointLength, type CommentAuthor, type CommentView } from '../../../../shared/htmlComments'
import { hasRefusedIdentityChar } from '../../../../shared/htmlComments/identity'
import { atomicWriteBytesStrict, errnoOf, fileIdKey } from '../../../utils/atomicWriteBytesStrict'
import { logger } from '../../LoggingService'
import { sharedCommentParseClient } from './CommentParseWorkerAdapter'
import {
  confineCommentFile,
  loadCommentBytes,
  type CommentFileTarget,
  type ConfineResult
} from './commentFileAccess'
import type { CommentFileJobRunner } from './commentFileJobs'
import { commentFileLock } from './commentFileLock'
import {
  jobFailureRefusal,
  refusalCode,
  refused,
  type CommentErrorCode,
  type CommentRefusal,
  type Refused
} from './commentRefusals'
import {
  assembleSplice,
  isSafeInsert,
  isSpliceWithin,
  type CommentDraftTarget,
  type ThreadChange,
  type WriteAct,
  type WritePlanRequest
} from './commentWriteCore'

export type { CommentFileTarget } from './commentFileAccess'
export type { CommentDraftTarget, ThreadChange } from './commentWriteCore'

/** The reviewer as Erfana's own settings hold them (decision 3). */
export interface CommentIdentity {
  readonly name: string
  readonly email?: string
}

/** Add a new thread before a picked element. */
export interface AddCommentRequest {
  readonly file: CommentFileTarget
  readonly draft: CommentDraftTarget
  readonly view: CommentView
  readonly text: string
}

/** Change the thread `threadId`, whose block hashed to `rawHash` when the window read it. */
export interface ThreadChangeRequest {
  readonly file: CommentFileTarget
  readonly threadId: string
  readonly rawHash: string
  readonly change: ThreadChange
}

/** Remove a damaged block whose bytes still hash to `rawHash` ("Delete block…", §7.6 step 6). */
export interface DeleteDamagedBlockRequest {
  readonly file: CommentFileTarget
  readonly rawHash: string
  /** The block's start offset when it was read; picks one of several identical damaged blocks. */
  readonly start?: number
}

/** The operation a save performed, as logged. */
export type CommentWriteOp = 'add' | ThreadChange['op'] | 'deleteBlock'

export type CommentWriteResult =
  | {
      readonly ok: true
      /** The real path written (on-disk spelling). */
      readonly realPath: string
      /** SHA-256 (hex) of the bytes now on disk – for the own-write echo filter (§7.5). */
      readonly fileHash: string
      /** The thread written; `null` when the operation removed its block. */
      readonly threadId: string | null
    }
  | { readonly ok: false; readonly code: CommentErrorCode; readonly reason: CommentRefusal }

/** The two log levels the writer uses. */
export type CommentWriterLog = Pick<typeof logger, 'info' | 'warn'>

/** Collaborators; everything but `identity` has a production default. */
export interface CommentWriterDeps {
  /** The reviewer's identity from the app-level settings – never from the renderer. */
  readonly identity: () => CommentIdentity | undefined | Promise<CommentIdentity | undefined>
  /** True when an editor tab holds unsaved changes for this real path (decision 13). */
  readonly hasUnsavedSource?: (realPath: string) => boolean | Promise<boolean>
  readonly now?: () => Date
  /**
   * Where the parse, the plan and the verification run: the process-wide
   * comment parse worker by default. A suite passes the in-process runner
   * (`createInProcessCommentFileJobs`), with a seeded id source.
   */
  readonly jobs?: CommentFileJobRunner
  /** `process.platform`; a test sets `win32` on any host for the Windows path rules. */
  readonly platform?: NodeJS.Platform
  readonly log?: CommentWriterLog
}

type Attempt = Extract<CommentWriteResult, { ok: true }> | Refused

interface WriteJob {
  readonly op: CommentWriteOp
  readonly file: CommentFileTarget
  /** The operation writes the acting author (add, reply, status), so an identity is required. */
  readonly needsAuthor: boolean
  readonly request: WritePlanRequest
}

/**
 * The settings identity as a v1 author, or `undefined` when it is missing or
 * unusable: empty, over its cap, or carrying a control or invisible character
 * (`identity.ts` – the settings refuse to store such a value too).
 */
async function resolveAuthor(identity: CommentWriterDeps['identity']): Promise<CommentAuthor | undefined> {
  const raw = await identity()
  const name = raw?.name.trim() ?? ''
  const email = raw?.email?.trim() ?? ''
  const nameOk =
    name !== '' &&
    codePointLength(name) <= PREVIEW_LIMITS.COMMENT_AUTHOR_NAME_MAX_CHARS &&
    !hasRefusedIdentityChar(name)
  const emailOk =
    email.length <= PREVIEW_LIMITS.COMMENT_AUTHOR_EMAIL_MAX_CHARS && !hasRefusedIdentityChar(email)
  if (!nameOk || !emailOk) return undefined
  return email ? { name, email, role: 'human' } : { name, role: 'human' }
}

/** Writes comment blocks into HTML files – see the module comment for every step. */
export class CommentWriter {
  private readonly deps: CommentWriterDeps
  private readonly platform: NodeJS.Platform
  private readonly log: CommentWriterLog
  private readonly now: () => Date
  private readonly jobs: CommentFileJobRunner

  constructor(deps: CommentWriterDeps) {
    this.deps = deps
    this.platform = deps.platform ?? process.platform
    this.log = deps.log ?? logger
    this.now = deps.now ?? (() => new Date())
    this.jobs = deps.jobs ?? sharedCommentParseClient()
  }

  /** Add a new thread before the draft's element. Requires an identity. */
  add(request: AddCommentRequest): Promise<CommentWriteResult> {
    return this.run({
      op: 'add',
      file: request.file,
      needsAuthor: true,
      request: { op: 'add', draft: request.draft, view: request.view, text: request.text }
    })
  }

  /** Reply, edit or delete a message, resolve or re-open, or delete the thread. Anyone may (decision 31). */
  changeThread(request: ThreadChangeRequest): Promise<CommentWriteResult> {
    const { op } = request.change
    return this.run({
      op,
      file: request.file,
      needsAuthor: op === 'reply' || op === 'setStatus',
      request: { op: 'thread', threadId: request.threadId, rawHash: request.rawHash, change: request.change }
    })
  }

  /** Remove exactly the range of a terminated damaged block whose bytes still match. */
  deleteDamagedBlock(request: DeleteDamagedBlockRequest): Promise<CommentWriteResult> {
    return this.run({
      op: 'deleteBlock',
      file: request.file,
      needsAuthor: false,
      request: { op: 'deleteBlock', rawHash: request.rawHash, ...(request.start === undefined ? {} : { start: request.start }) }
    })
  }

  private async run(job: WriteJob): Promise<CommentWriteResult> {
    const confined = await this.confine(job)
    if (!confined.ok) return this.refuse(job, job.file.filePath, confined)
    const { realPath } = confined
    return commentFileLock.runAll([realPath, fileIdKey(confined.id)], async () => {
      let outcome: Attempt
      try {
        outcome = await this.attemptTwice(job, realPath)
      } catch (error) {
        outcome = refused('io', errnoOf(error))
      }
      return outcome.ok ? this.succeed(job, outcome) : this.refuse(job, realPath, outcome)
    })
  }

  /** Step 1, with a throw – a path no file-system call accepts – as an I/O refusal. */
  private async confine(job: WriteJob): Promise<ConfineResult> {
    try {
      return await confineCommentFile(job.file, { platform: this.platform })
    } catch (error) {
      return refused('io', errnoOf(error))
    }
  }

  /** Steps 2–6, run again once when the file changed under the write. */
  private async attemptTwice(job: WriteJob, realPath: string): Promise<Attempt> {
    if (await this.deps.hasUnsavedSource?.(realPath)) return refused('unsaved-source')
    const author = job.needsAuthor ? await resolveAuthor(this.deps.identity) : undefined
    if (job.needsAuthor && !author) return refused('identity')
    const act: WriteAct = { ...(author === undefined ? {} : { author }), nowMs: this.now().getTime() }
    const first = await this.attempt(job, realPath, act)
    return !first.ok && first.reason === 'changed' ? this.attempt(job, realPath, act) : first
  }

  private async attempt(job: WriteJob, realPath: string, act: WriteAct): Promise<Attempt> {
    // Confined again under the lock: the path must still resolve to the locked real path
    const loaded = await loadCommentBytes(job.file, { platform: this.platform })
    if (!loaded.ok) return loaded
    if (loaded.realPath !== realPath) return refused('changed')
    const planned = await this.jobs.runJob(loaded.bytes, { kind: 'write', request: job.request, act })
    if (planned.kind === 'failed') return jobFailureRefusal(planned.failure)
    if (!planned.ok) return refused(planned.refusal)
    // The bytes read: handed back when they were lent, main's own view when they were copied.
    const read = planned.raw ?? loaded.bytes
    // Main's own checks of the worker's answer: a range inside the bytes read, and an
    // insert that is one comment and nothing more (S-L-C).
    if (!isSpliceWithin(planned, read.length) || !isSafeInsert(planned.insert)) return refused('verify-failed')
    // Rebuilt from the bytes read – and the strict write below re-reads the file and
    // requires these very bytes on disk: outside the block, the bytes written are the bytes read.
    const out = assembleSplice(read, planned)
    if (out.length > PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES) return refused('limit')
    const written = await atomicWriteBytesStrict(realPath, out, {
      expectedHash: planned.inputHash,
      expectedBytes: read,
      expectedId: loaded.id,
      expectedDir: dirname(realPath),
      maxBytes: PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES
    })
    if (!written.ok) return refused(written.reason === 'gone' ? 'missing' : written.reason, written.errno)
    return { ok: true, realPath: written.path, fileHash: planned.outputHash, threadId: planned.threadId }
  }

  private succeed(job: WriteJob, done: Extract<CommentWriteResult, { ok: true }>): CommentWriteResult {
    this.log.info('htmlComments: comment written', {
      op: job.op,
      file: stablePathDigest(done.realPath)
    })
    return done
  }

  private refuse(job: WriteJob, path: string, refusal: Refused): CommentWriteResult {
    const code = refusalCode(refusal.reason)
    this.log.warn('htmlComments: comment write refused', {
      op: job.op,
      code,
      reason: refusal.reason,
      ...(refusal.errno ? { errno: refusal.errno } : {}),
      file: stablePathDigest(path)
    })
    return { ok: false, code, reason: refusal.reason }
  }
}
