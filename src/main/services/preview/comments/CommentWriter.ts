// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * CommentWriter – the only page-driven disk write path
 * (docs/designs/html-preview-comments.md §4.1 B3 → B4, §7.6, §7.7; threats
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
 *     symlink, a hard link, a non-UTF-8 file, a file over 4 MB or one the
 *     parse marks read-only (a conflict hunk, an unterminated block);
 *  4. re-locates its target in that fresh parse: for an add, the draft's
 *     element (its offset while the file is unchanged, else the draft's
 *     backup anchors, which must match exactly one element); for an edit or
 *     delete, the block by id whose bytes still hash to what the window read
 *     – a damaged or newer block is never rewritten (decision 12);
 *  5. plans ONE splice on the decoded text, applies it to the original bytes,
 *     and verifies before writing: every byte outside the block identical, the
 *     new bytes decode losslessly to the spliced text, exactly one block more,
 *     the same or one fewer, the same elements, and the written block reads
 *     back with the intended data. Any failure: nothing is written;
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
import {
  addReply,
  applySplice,
  buildDraftAnchor,
  codePointLength,
  createThread,
  decodeLossless,
  deleteMessage,
  editMessage,
  findAnchorTarget,
  planDelete,
  planInsert,
  planReplace,
  setStatus,
  spliceBytes,
  verifyCommentSplice,
  verifySpliceBytes,
  type CommentAnchor,
  type CommentAuthor,
  type CommentData,
  type CommentDocument,
  type CommentView,
  type IndexedElement,
  type PlanFailure,
  type PlanResult,
  type RandomBytes,
  type SplicePlan,
  type ThreadContext
} from '../../../../shared/htmlComments'
import {
  atomicWriteBytesStrict,
  errnoOf,
  fileIdKey,
  sha256Hex
} from '../../../utils/atomicWriteBytesStrict'
import { logger } from '../../LoggingService'
import {
  confineCommentFile,
  loadCommentFile,
  writableRefusal,
  type CommentFileTarget,
  type ConfineResult,
  type LoadedCommentFile
} from './commentFileAccess'
import { commentFileLock } from './commentFileLock'
import {
  refusalCode,
  refused,
  type CommentErrorCode,
  type CommentRefusal,
  type Refused
} from './commentRefusals'

export type { CommentFileTarget } from './commentFileAccess'

/** The reviewer as Erfana's own settings hold them (decision 3). */
export interface CommentIdentity {
  readonly name: string
  readonly email?: string
}

/** What a draft recorded about its element when the pick was made (P5). */
export interface CommentDraftTarget {
  /** UTF-16 offset of the element's start tag in the decoded text the draft was made from. */
  readonly offset: number
  /** SHA-256 (hex) of the file bytes the draft was made from (`LoadedCommentFile.hash`). */
  readonly fileHash: string
  /** The draft's anchor (`buildDraftAnchor`): its backups re-locate the element, its `runtime` part is kept. */
  readonly anchor: CommentAnchor
  /** The pick's computed `white-space-collapse` of the element's parent (R3-8); missing → mid-line. */
  readonly ws?: string
}

/** Add a new thread before a picked element. */
export interface AddCommentRequest {
  readonly file: CommentFileTarget
  readonly draft: CommentDraftTarget
  readonly view: CommentView
  readonly text: string
}

/** One change to an existing thread (§7.7). Deleting the first message deletes the thread. */
export type ThreadChange =
  | { readonly op: 'reply'; readonly text: string }
  | { readonly op: 'editMessage'; readonly messageId: string; readonly text: string }
  | { readonly op: 'deleteMessage'; readonly messageId: string }
  | { readonly op: 'setStatus'; readonly status: CommentData['status'] }
  | { readonly op: 'deleteThread' }

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
  /** Random source for new thread and message ids; defaults to `crypto.getRandomValues`. */
  readonly random?: RandomBytes
  /** `process.platform`; a test sets `win32` on any host for the Windows path rules. */
  readonly platform?: NodeJS.Platform
  readonly log?: CommentWriterLog
}

/** Who acts and when, for one save. `author` is set whenever the job writes one. */
interface Act {
  readonly author: CommentAuthor | undefined
  readonly now: Date
  readonly random: RandomBytes | undefined
}

type Planned =
  | { readonly ok: true; readonly plan: SplicePlan; readonly threadId: string | null }
  | Refused

type Attempt = Extract<CommentWriteResult, { ok: true }> | Refused

interface WriteJob {
  readonly op: CommentWriteOp
  readonly file: CommentFileTarget
  /** The operation writes the acting author (add, reply, status), so an identity is required. */
  readonly needsAuthor: boolean
  readonly plan: (file: LoadedCommentFile, act: Act) => Planned
}

/** Planner refusals as save refusals. */
const PLAN_REFUSALS: Readonly<Record<PlanFailure, CommentRefusal>> = {
  'read-only': 'read-only',
  'not-eligible': 'target-moved',
  'not-found': 'block-changed',
  'not-editable': 'block-changed',
  stale: 'block-changed',
  'meta-charset': 'meta-charset',
  limit: 'limit',
  invalid: 'invalid'
}

/**
 * Code points refused in an author name or email (§5.4), by Unicode property
 * rather than by a hand list, so every invisible character is caught: controls
 * (Cc), format characters (Cf – bidi marks, embeddings, overrides and
 * isolates, zero-width characters, the BOM, the tag characters U+E0000–E007F),
 * lone surrogates (Cs), private-use (Co) and unassigned (Cn) code points, the
 * line and paragraph separators, and every default-ignorable code point
 * (U+2060 word joiner, variation selectors, Hangul fillers).
 */
const REFUSED_IN_IDENTITY =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u

/** The settings identity as a v1 author, or `undefined` when it is missing or unusable. */
async function resolveAuthor(identity: CommentWriterDeps['identity']): Promise<CommentAuthor | undefined> {
  const raw = await identity()
  const name = raw?.name.trim() ?? ''
  const email = raw?.email?.trim() ?? ''
  const nameOk =
    name !== '' &&
    codePointLength(name) <= PREVIEW_LIMITS.COMMENT_AUTHOR_NAME_MAX_CHARS &&
    !REFUSED_IN_IDENTITY.test(name)
  const emailOk =
    email.length <= PREVIEW_LIMITS.COMMENT_AUTHOR_EMAIL_MAX_CHARS && !REFUSED_IN_IDENTITY.test(email)
  if (!nameOk || !emailOk) return undefined
  return email ? { name, email, role: 'human' } : { name, role: 'human' }
}

/** The thread context of a job that writes the author; `run` refuses such a job without one. */
function contextOf(act: Act): ThreadContext {
  return { author: act.author!, now: act.now, random: act.random }
}

function fromPlan(result: PlanResult, threadId: string | null): Planned {
  return result.ok ? { ok: true, plan: result.plan, threadId } : refused(PLAN_REFUSALS[result.reason])
}

/** The element the draft's backup anchors name in a changed file, when exactly one matches. */
function relocate(doc: CommentDocument, anchor: CommentAnchor): IndexedElement | undefined {
  const found = findAnchorTarget(doc.index, anchor)
  return found.state === 'attached' ? doc.index.elementAt(found.startOffset) : undefined
}

function planAdd(request: AddCommentRequest, file: LoadedCommentFile, act: Act): Planned {
  const { doc } = file
  const { draft } = request
  const el =
    file.hash === draft.fileHash ? doc.index.elementAt(draft.offset) : relocate(doc, draft.anchor)
  if (!el || el.tag !== draft.anchor.tag) return refused('target-moved')
  // The stored anchor is rebuilt from the bytes being written; only `runtime` comes from the draft
  const anchor = buildDraftAnchor(doc.index, el, draft.anchor.runtime)
  const data = createThread({ anchor, view: request.view, text: request.text, context: contextOf(act) })
  return fromPlan(planInsert(doc, { targetStart: el.start, data, ws: draft.ws }), data.id)
}

/** The thread after `change`: `null` removes the block, `undefined` means the message is gone. */
function changedData(data: CommentData, change: ThreadChange, act: Act): CommentData | null | undefined {
  switch (change.op) {
    case 'reply':
      return addReply(data, change.text, contextOf(act))
    case 'editMessage':
      return editMessage(data, change.messageId, change.text, act.now)
    case 'deleteMessage':
      return deleteMessage(data, change.messageId)
    case 'setStatus':
      return setStatus(data, change.status, contextOf(act))
    case 'deleteThread':
      return null
  }
}

function planThreadChange(request: ThreadChangeRequest, file: LoadedCommentFile, act: Act): Planned {
  const { doc } = file
  const { threadId, rawHash } = request
  const block = doc.state.blocks.find(b => b.kind === 'ok' && b.data.id === threadId)
  if (block?.kind !== 'ok' || block.rawHash !== rawHash) return refused('block-changed')
  const next = changedData(block.data, request.change, act)
  if (next === undefined) return refused('block-changed')
  if (next === null) return fromPlan(planDelete(doc, { block: { id: threadId }, rawHash }), null)
  return fromPlan(planReplace(doc, { id: threadId, rawHash, data: next }), threadId)
}

function planDeleteDamaged(request: DeleteDamagedBlockRequest, file: LoadedCommentFile): Planned {
  const damaged = file.doc.state.blocks.filter(
    b => b.kind === 'damaged' && b.rawHash === request.rawHash
  )
  const block =
    damaged.length === 1 ? damaged[0] : damaged.find(b => b.nodeRange[0] === request.start)
  if (!block) return refused('block-changed')
  const start = block.nodeRange[0]
  return fromPlan(planDelete(file.doc, { block: { start }, rawHash: request.rawHash }), null)
}

/** §7.6 steps 7–8: the spliced bytes, when every check passes; otherwise nothing is written. */
function spliceVerified(
  file: LoadedCommentFile,
  plan: SplicePlan
): { readonly ok: true; readonly bytes: Uint8Array } | Refused {
  const { bytes, doc } = file
  const out = spliceBytes(bytes, doc.text, plan)
  if (out.length > PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES) return refused('limit')
  const text = applySplice(doc.text, plan)
  const decoded = decodeLossless(out)
  const sound =
    verifySpliceBytes(bytes, out, doc.text, plan) &&
    decoded.ok &&
    decoded.text === text &&
    verifyCommentSplice(doc, text, plan).ok
  return sound ? { ok: true, bytes: out } : refused('verify-failed')
}

/** Writes comment blocks into HTML files – see the module comment for every step. */
export class CommentWriter {
  private readonly deps: CommentWriterDeps
  private readonly platform: NodeJS.Platform
  private readonly log: CommentWriterLog
  private readonly now: () => Date

  constructor(deps: CommentWriterDeps) {
    this.deps = deps
    this.platform = deps.platform ?? process.platform
    this.log = deps.log ?? logger
    this.now = deps.now ?? (() => new Date())
  }

  /** Add a new thread before the draft's element. Requires an identity. */
  add(request: AddCommentRequest): Promise<CommentWriteResult> {
    return this.run({
      op: 'add',
      file: request.file,
      needsAuthor: true,
      plan: (file, act) => planAdd(request, file, act)
    })
  }

  /** Reply, edit or delete a message, resolve or re-open, or delete the thread. Anyone may (decision 31). */
  changeThread(request: ThreadChangeRequest): Promise<CommentWriteResult> {
    const { op } = request.change
    return this.run({
      op,
      file: request.file,
      needsAuthor: op === 'reply' || op === 'setStatus',
      plan: (file, act) => planThreadChange(request, file, act)
    })
  }

  /** Remove exactly the range of a terminated damaged block whose bytes still match. */
  deleteDamagedBlock(request: DeleteDamagedBlockRequest): Promise<CommentWriteResult> {
    return this.run({
      op: 'deleteBlock',
      file: request.file,
      needsAuthor: false,
      plan: file => planDeleteDamaged(request, file)
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
    const act: Act = { author, now: this.now(), random: this.deps.random }
    const first = await this.attempt(job, realPath, act)
    return !first.ok && first.reason === 'changed' ? this.attempt(job, realPath, act) : first
  }

  private async attempt(job: WriteJob, realPath: string, act: Act): Promise<Attempt> {
    // Confined again under the lock: the path must still resolve to the locked real path
    const loaded = await loadCommentFile(job.file, { platform: this.platform })
    if (!loaded.ok) return loaded
    if (loaded.file.realPath !== realPath) return refused('changed')
    const blocked = writableRefusal(loaded.file.doc.state)
    if (blocked) return refused(blocked)
    const planned = job.plan(loaded.file, act)
    if (!planned.ok) return planned
    const spliced = spliceVerified(loaded.file, planned.plan)
    if (!spliced.ok) return spliced
    const written = await atomicWriteBytesStrict(realPath, spliced.bytes, {
      expectedHash: loaded.file.hash,
      expectedId: loaded.file.id,
      expectedDir: dirname(realPath),
      maxBytes: PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES
    })
    if (!written.ok) return refused(written.reason === 'gone' ? 'missing' : written.reason, written.errno)
    return {
      ok: true,
      realPath: written.path,
      fileHash: sha256Hex(spliced.bytes),
      threadId: planned.threadId
    }
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
