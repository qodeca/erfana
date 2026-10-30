// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments in renderer-hosted previews – main's half of `file-comment:*`
 * (spec 024 architecture note 001 § 4, § 5, § 8 C6, C12, C17, C18, C20;
 * 024-FR-012, 024-FR-013, 024-FR-026).
 *
 * - **list** confines the file to the open project and to a kind of this
 *   family (`fileCommentKinds`) whose comments are on in Settings (else
 *   `comments-off`: no parse, no watch), records that the sender's panel shows it
 *   (`fileCommentPanels.ts`), watches it, and answers its comments with
 *   main-minted keys and where each attached thread's target is. The parse
 *   runs in the comment parse worker, in the file's kind's `list` job. The
 *   editor's unsaved text, when sent and different from the file, is parsed
 *   instead – for display only: nothing here writes it, and every write
 *   re-reads the disk.
 * - **openDraft** mints a single-use token tied to the window, the panel and
 *   the file (C17).
 * - **save** resolves the token or the keys against the sender's panel and
 *   runs the one shared `CommentWriter`, with this family's kinds. The writer
 *   refuses while ANY window's editor holds unsaved edits for the file, asks
 *   again right before the rename (C6), and reports a file that changed after
 *   the rename (C12).
 * - **changed** goes to the windows whose panels listed the file, and to no
 *   other (`fileCommentWatches.ts`).
 *
 * Every answer is a value, never a throw: a refusal carries its code and its
 * reason. Logs name a path by digest only and carry no comment text, words,
 * names or e-mails (C20).
 */
import { relative, resolve, sep } from 'node:path'
import { encodeText } from '../../../shared/comments/encoding'
import { ErrorCode } from '../../../shared/errors'
import type { CommentReasonedRefusal, CommentSaveResult } from '../../../shared/ipc/comment-common-schema'
import type {
  FileCommentChanged,
  FileCommentListResult,
  FileCommentOpenDraftResult,
  FileCommentSaveRequest,
  ThreadPlacement
} from '../../../shared/ipc/file-comment-schema'
import type { CommentFileKind } from '../../../shared/comments/fileKind'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { createRearmingSingleFileWatcher } from '../watcher/rearmingSingleFileWatch'
import { logger } from '../LoggingService'
import { CommentWriter, type CommentIdentity, type CommentWriteResult, type CommentWriterDeps } from './CommentWriter'
import { confineCommentFile, readConfinedCommentBytes, type CommentFileTarget } from './commentFileAccess'
import { sharedCommentParseClient } from './CommentParseWorkerAdapter'
import type { CommentFileJob, CommentFileJobRunner } from './commentFileJobs'
import type { CommentFileKindLookup } from './commentFileKinds'
import type { CommentKeyStoreDeps } from './commentKeyStore'
import { fileView, refusedView, type ListedFile } from './commentListBuilder'
import type { ListSummary } from './commentListCore'
import { refusalCode, type CommentRefusal } from './commentRefusals'
import { changeOf } from './commentSaveFlow'
import type { CommentUnsavedSources } from './commentUnsavedSources'
import { FileCommentPanels, type FileCommentPanel } from './fileCommentPanels'
import { createFileCommentWatches, type FileCommentWatchFactory, type FileCommentWatches } from './fileCommentWatches'

/** Who asks, and in which project: the sender's window, the project root as opened and as resolved. */
export interface FileCommentCaller {
  readonly windowId: number
  /** The project root as the renderer's tabs spell it: display paths are relative to it. */
  readonly root: string
  /** The project root's real path: what every file is confined to. */
  readonly realRoot: string
}

/** What the service is built from; everything but the kinds, the record and the identity has a default. */
export interface FileCommentServiceDeps {
  /** The kinds this family serves (`fileCommentKinds` in production). */
  readonly kinds: CommentFileKindLookup
  /** Every window's unsaved editor files. */
  readonly unsaved: Pick<CommentUnsavedSources, 'hasAny'>
  /** The reviewer from the app settings – never from the renderer. */
  readonly identity: () => CommentIdentity | undefined
  /** Send `file-comment:changed` to one window. */
  readonly send: (windowId: number, payload: FileCommentChanged) => void
  /** Where a kind's jobs run; the comment parse worker by default. */
  readonly jobsFor?: CommentWriterDeps['jobsFor']
  /** One runner for every kind (the suites' in-process runner). */
  readonly jobs?: CommentFileJobRunner
  /**
   * Whether comments are on in Settings for `kind`'s preview, read per call;
   * on by default. Off refuses the list, a draft and every save
   * (`comments-off`): the list parses nothing and watches nothing, as the
   * HTML family's sealed box (owner decision, 2026-10-30).
   */
  readonly isKindEnabled?: (kind: CommentFileKind) => boolean
  /** A kind's own write-job fields from the app settings (Markdown's `breaks`), read per save. */
  readonly writeOptions?: CommentWriterDeps['writeOptions']
  /** Start a watch; the atomic-save-proof single-file watcher by default. */
  readonly watch?: FileCommentWatchFactory
  readonly watchMax?: number
  readonly keys?: CommentKeyStoreDeps
  readonly now?: () => Date
  readonly platform?: NodeJS.Platform
}

/** A thread operation of `file-comment:save`. */
type ThreadOp = Exclude<FileCommentSaveRequest, { op: 'add' }>

/** A refusal with its code and reason. */
function refusal(reason: CommentRefusal): CommentReasonedRefusal {
  return { ok: false, code: refusalCode(reason), reason }
}

const NOT_OPEN = refusal('not-open')
const KEY_INVALID = refusal('key-invalid')
const COMMENTS_OFF = refusal('comments-off')

/** The production watch: one atomic-save-proof watcher per file. */
const defaultWatch: FileCommentWatchFactory = (realPath, onChange) =>
  createRearmingSingleFileWatcher(realPath, {
    onChange,
    onDeleted: onChange,
    onError: () => {},
    onWatchDead: () => {}
  })

/** The `file-comment:*` service; one per process. */
export class FileCommentService {
  private readonly panels: FileCommentPanels
  private readonly watches: FileCommentWatches
  private readonly writer: CommentWriter
  private readonly runners = new Map<string, CommentFileJobRunner>()
  private stamp = 0
  /** Grows with every project change ({@link FileCommentService.clear}). */
  private projectEpoch = 0
  /** Grows with each window's close ({@link FileCommentService.forgetWindow}), per window. */
  private readonly windowEpochs = new Map<number, number>()

  constructor(private readonly deps: FileCommentServiceDeps) {
    this.panels = new FileCommentPanels(deps.keys)
    this.watches = createFileCommentWatches({
      watch: deps.watch ?? defaultWatch,
      onChange: realPath => this.changed(realPath),
      ...(deps.watchMax === undefined ? {} : { max: deps.watchMax })
    })
    this.writer = new CommentWriter({
      identity: deps.identity,
      // C6: every window's editor, asked before the read and again right before the rename
      hasUnsavedSource: realPath => deps.unsaved.hasAny(realPath),
      kinds: deps.kinds,
      // The list and the write of one kind share one runner
      jobsFor: kind => this.jobsFor(kind),
      ...(deps.writeOptions === undefined ? {} : { writeOptions: deps.writeOptions }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
      ...(deps.platform === undefined ? {} : { platform: deps.platform })
    })
  }

  /** Watches open now (tests, the cap). */
  get watchCount(): number {
    return this.watches.size
  }

  /** `file-comment:list`. */
  async list(caller: FileCommentCaller, request: { panelId: string; filePath: string; bufferText?: string }): Promise<FileCommentListResult> {
    const opened = await this.openPanel(caller, request.panelId, request.filePath)
    if (!opened.ok) return opened
    const { panel } = opened
    const listed: ListedFile = {
      frame: false,
      file: { realPath: panel.realPath, projectPath: panel.requestedPath, displayPath: displayPathOf(caller.root, panel.requestedPath) }
    }
    const read = await readConfinedCommentBytes(panel.realPath)
    if (!read.ok) return this.refusedList(panel, listed, read.reason)
    const bytes = displayBytes(read.bytes, request.bufferText)
    const answer = await this.jobsFor(panel.kind).runJob(bytes, { kind: 'list', placements: true })
    if (answer.kind === 'failed') {
      logger.warn('File comments: a file could not be parsed for its list', { failure: answer.failure, file: stablePathDigest(panel.realPath) })
      return refusal('parse-failed')
    }
    if (!answer.ok) return this.refusedList(panel, listed, answer.refusal)
    panel.keys.beginGeneration()
    return { ok: true, file: fileView(panel, listed, answer.summary), placements: this.placementsOf(panel, answer.summary) }
  }

  /** `file-comment:openDraft`: a single-use token for one new comment on this panel's file. */
  async openDraft(caller: FileCommentCaller, request: { panelId: string; filePath: string }): Promise<FileCommentOpenDraftResult> {
    const panel = await this.openFor(caller, request.panelId, request.filePath)
    if (!('binding' in panel)) return panel
    if (!this.enabled(panel)) return COMMENTS_OFF
    return { ok: true, draftToken: panel.keys.mintDraft(panel.binding, { realPath: panel.realPath }) }
  }

  /** `file-comment:save`. */
  async save(caller: FileCommentCaller, request: FileCommentSaveRequest): Promise<CommentSaveResult> {
    if (request.op === 'add') return this.add(caller, request)
    const panel = this.panels.get(caller.windowId, request.panelId)
    if (panel === undefined) return NOT_OPEN
    if (!this.enabled(panel)) return COMMENTS_OFF
    const file = panel.keys.resolve(panel.binding, request.fileKey, 'file')
    if (!file.ok || file.value.realPath !== panel.realPath) return KEY_INVALID
    return this.changeExisting(caller, panel, request)
  }

  /** The window closed: forget its panels and release their watches; a list still running for it records nothing. */
  forgetWindow(windowId: number): void {
    this.windowEpochs.set(windowId, (this.windowEpochs.get(windowId) ?? 0) + 1)
    this.release(this.panels.forgetWindow(windowId))
  }

  /** The project changed: forget every panel and close every watch; a list still running records nothing. */
  async clear(): Promise<void> {
    this.projectEpoch += 1
    this.panels.clear()
    await this.watches.closeAll()
  }

  private async add(caller: FileCommentCaller, request: Extract<FileCommentSaveRequest, { op: 'add' }>): Promise<CommentSaveResult> {
    const panel = await this.openFor(caller, request.panelId, request.filePath)
    if (!('binding' in panel)) return panel
    if (!this.enabled(panel)) return COMMENTS_OFF
    const claimed = panel.keys.claimDraft(request.draftToken, panel.binding)
    if (!claimed.ok) return claimed.code === ErrorCode.COMMENT_DRAFT_EXPIRED ? refusal('draft-expired') : KEY_INVALID
    if (claimed.value.realPath !== panel.realPath) {
      panel.keys.settleDraft(request.draftToken, false)
      return KEY_INVALID
    }
    const result = await this.writer.addPicked({
      file: writeTargetOf(caller, panel),
      pick: request.target,
      ...(request.sel === undefined ? {} : { sel: request.sel }),
      view: request.view,
      text: request.text
    })
    // A write consumes the draft – also one whose bytes changed right after the rename
    // (`changed-during-save`): its thread landed, so a retry would add a second. Any
    // other refusal wrote nothing and leaves the draft, with the window's text, for the next try.
    panel.keys.settleDraft(request.draftToken, result.ok || result.reason === 'changed-during-save')
    return this.answer(panel, result)
  }

  private async changeExisting(caller: FileCommentCaller, panel: FileCommentPanel, request: ThreadOp): Promise<CommentSaveResult> {
    const file = writeTargetOf(caller, panel)
    if (request.op === 'deleteBlock') {
      const block = panel.keys.resolve(panel.binding, request.blockKey, 'block')
      if (!block.ok || block.value.realPath !== panel.realPath) return KEY_INVALID
      return this.answer(panel, await this.writer.deleteDamagedBlock({ file, rawHash: request.rawHash, start: block.value.start }))
    }
    const thread = panel.keys.resolve(panel.binding, request.threadKey, 'thread')
    if (!thread.ok || thread.value.realPath !== panel.realPath) return KEY_INVALID
    const result = await this.writer.changeThread({ file, threadId: thread.value.threadId, rawHash: request.rawHash, change: changeOf(request) })
    return this.answer(panel, result)
  }

  /** Comments are on in Settings for the panel's kind. */
  private enabled(panel: Pick<FileCommentPanel, 'kind'>): boolean {
    return this.deps.isKindEnabled?.(panel.kind) ?? true
  }

  /** The writer's result as the renderer reads it: the thread's key, or the code and the reason. */
  private answer(panel: FileCommentPanel, result: CommentWriteResult): CommentSaveResult {
    if (!result.ok) return { ok: false, code: result.code, reason: result.reason }
    const threadKey =
      result.threadId === null ? null : panel.keys.keyFor(panel.binding, { kind: 'thread', realPath: panel.realPath, threadId: result.threadId })
    return { ok: true, threadKey }
  }

  /** The sender's panel showing exactly `filePath`, or why not (C17). */
  private async openFor(caller: FileCommentCaller, panelId: string, filePath: string): Promise<FileCommentPanel | CommentReasonedRefusal> {
    const panel = this.panels.get(caller.windowId, panelId)
    if (panel === undefined) return NOT_OPEN
    const confined = await this.confine(caller, filePath)
    if (!confined.ok) return confined
    return confined.realPath === panel.realPath ? panel : NOT_OPEN
  }

  /**
   * Confine `filePath` and record that the sender's panel shows it; watch it.
   * Refused – recording and watching nothing – when the window closed or the
   * project changed while the path was confined (the cleanup already ran, so
   * a record made now would never be released), and when comments are off
   * for the file's kind: then the panel's earlier record is dropped too.
   */
  private async openPanel(
    caller: FileCommentCaller,
    panelId: string,
    filePath: string
  ): Promise<{ readonly ok: true; readonly panel: FileCommentPanel } | CommentReasonedRefusal> {
    const projectEpoch = this.projectEpoch
    const windowEpoch = this.windowEpochs.get(caller.windowId)
    const confined = await this.confine(caller, filePath)
    if (projectEpoch !== this.projectEpoch || windowEpoch !== this.windowEpochs.get(caller.windowId)) return NOT_OPEN
    if (!confined.ok) return confined
    const kind = this.deps.kinds.kindOfName(confined.realPath)
    if (kind === undefined) return refusal('not-html')
    if (!this.enabled({ kind })) {
      const dropped = this.panels.forget(caller.windowId, panelId)
      if (dropped !== undefined) this.release([dropped])
      return COMMENTS_OFF
    }
    const { panel, released } = this.panels.open(caller.windowId, panelId, { realPath: confined.realPath, requestedPath: resolve(filePath), kind })
    this.release(released)
    this.watches.subscribe(panel.realPath, subscriberOf(panel))
    return { ok: true, panel }
  }

  private async confine(
    caller: FileCommentCaller,
    filePath: string
  ): Promise<{ readonly ok: true; readonly realPath: string } | CommentReasonedRefusal> {
    try {
      const confined = await confineCommentFile(
        { realRoot: caller.realRoot, filePath },
        { kinds: this.deps.kinds, ...(this.deps.platform === undefined ? {} : { platform: this.deps.platform }) }
      )
      return confined.ok ? { ok: true, realPath: confined.realPath } : refusal(confined.reason)
    } catch {
      return refusal('io')
    }
  }

  /** A file the list cannot read: read-only and empty when the drawer can name why, else the refusal. */
  private refusedList(panel: FileCommentPanel, listed: ListedFile, reason: CommentRefusal): FileCommentListResult {
    const view = refusedView(panel, listed, reason)
    return view === undefined ? refusal(reason) : { ok: true, file: view, placements: [] }
  }

  private placementsOf(panel: FileCommentPanel, summary: ListSummary): ThreadPlacement[] {
    return (summary.placements ?? []).map(placement => ({
      threadKey: panel.keys.keyFor(panel.binding, { kind: 'thread', realPath: panel.realPath, threadId: placement.threadId }),
      line: placement.line,
      tag: placement.tag,
      ...(placement.sel === undefined ? {} : { sel: { exact: placement.sel.exact, prefix: placement.sel.prefix, suffix: placement.sel.suffix } })
    }))
  }

  /** Where `kind`'s jobs run: the suite's runner, the injected one, or the parse worker's for that kind. */
  private jobsFor(kind: CommentFileKind): CommentFileJobRunner {
    if (this.deps.jobs !== undefined) return this.deps.jobs
    let runner = this.runners.get(kind.id)
    if (runner === undefined) {
      runner = this.deps.jobsFor?.(kind) ?? sharedCommentParseClient().runnerFor<CommentFileJob>(kind.id)
      this.runners.set(kind.id, runner)
    }
    return runner
  }

  /** Panels that no longer show their file: their watch subscriptions end. */
  private release(panels: readonly FileCommentPanel[]): void {
    for (const panel of panels) this.watches.unsubscribe(panel.realPath, subscriberOf(panel))
  }

  /** A watched file changed: tell each window whose panel shows it, and only those. */
  private changed(realPath: string): void {
    for (const panel of this.panels.showing(realPath)) {
      this.stamp += 1
      this.deps.send(panel.binding.windowId, { panelId: panel.binding.panelId, filePath: panel.requestedPath, stamp: this.stamp })
    }
  }
}

/**
 * What the writer is given for the panel's file: the path as the panel names
 * it, and the real path it was listed at, which the writer's fresh
 * confinement must reach again (a swapped folder is refused, not followed).
 */
function writeTargetOf(caller: FileCommentCaller, panel: FileCommentPanel): CommentFileTarget {
  return { realRoot: caller.realRoot, filePath: panel.requestedPath, expectedRealPath: panel.realPath }
}

/** A panel as a watch subscriber. */
function subscriberOf(panel: FileCommentPanel): string {
  return `${panel.binding.windowId}\u0000${panel.binding.panelId}`
}

/** Project-relative and `/`-separated, for "Saved inside {file}". */
function displayPathOf(root: string, requestedPath: string): string {
  return relative(root, requestedPath).split(sep).join('/')
}

/**
 * The bytes a list parses: the editor's unsaved text when it was sent and
 * differs from the file (C-09), else the file. Display only – never written.
 */
function displayBytes(disk: Buffer, bufferText: string | undefined): Uint8Array {
  if (bufferText === undefined) return disk
  const buffer = encodeText(bufferText)
  return disk.equals(buffer) ? disk : buffer
}
