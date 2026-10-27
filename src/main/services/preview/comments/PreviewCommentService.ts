// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments for one live preview view – the façade
 * (docs/designs/html-preview-comments.md §4.1, §4.2 "PreviewCommentService",
 * §7, §8).
 *
 * Built by `previewLiveComments.ts` beside the view's other collaborators,
 * and disposed with them. It owns the view's comment mode, its "show comment
 * icons" toggle (per tab, not persisted) and the print hide, and wires:
 * - the page's three signals and the frame events (`commentServiceEvents.ts`),
 *   checked in `commentPickHandler.ts`, kept in `commentFrames.ts`;
 * - the states sent back to every frame (`commentFrameBroadcaster.ts`);
 * - drafts, keys and the one write path (`commentDraftOpener.ts`,
 *   `commentSaveFlow.ts`, `CommentWriter.ts`), and the reload and restore
 *   after a write (`commentReloadCoordinator.ts`);
 * - what the renderer is told (`commentPanelStatus.ts`), only ever the window
 *   that owns the view.
 *
 * Comment mode on over a page served without tokens – a file with no comments
 * yet is served raw while the mode is off – reloads the view once, keeping the
 * reader's place, so its elements can be picked.
 *
 * Nothing the page sends writes, and nothing sent to the page carries a path,
 * a comment's text or an author.
 */
import { webFrameMain } from 'electron'
import { ErrorCode } from '../../../../shared/errors'
import type {
  CommentAck,
  CommentAnchors,
  CommentListResult,
  CommentModeChanged,
  CommentSaveRequest,
  CommentSaveResult,
  CommentSetModeResult
} from '../../../../shared/ipc/preview-comment-schema'
import { logger } from '../../LoggingService'
import type { PreviewCommentServing } from './commentInstrumentation'
import type { CommentFileJobRunner } from './commentFileJobs'
import { sharedCommentParseClient } from './CommentParseWorkerAdapter'
import { CommentWriter, type CommentWriterDeps } from './CommentWriter'
import { registerCommentE2eSource } from './commentE2eHook'
import { CommentFrames, type CommentFrameLike, type FrameRecord } from './commentFrames'
import { createCommentFrameBroadcaster, type CommentFrameBroadcaster } from './commentFrameBroadcaster'
import { CommentKeyStore, type CommentBinding } from './commentKeyStore'
import { createCommentPickHandler, type CommentPickHandler, type PageSignalEvent } from './commentPickHandler'
import { pickerStepOf, type PickerStepInput } from './commentPickerStep'
import { createCommentDraftOpener, type CommentDraftOpener, type DraftOpenerGeometry } from './commentDraftOpener'
import type { CommentDraft } from './commentDraftBuilder'
import { buildCommentList } from './commentListBuilder'
import { accentRgb } from './commentOverlayTheme'
import { createCommentPanelStatus, type CommentPanelStatus } from './commentPanelStatus'
import { createCommentReloadCoordinator, type CommentReloadCoordinator } from './commentReloadCoordinator'
import { createCommentSaveFlow, type LateSettle } from './commentSaveFlow'
import { attachCommentServiceEvents, type CommentEventContents, type FrameFromIds } from './commentServiceEvents'
import { waitForPaint, type FreshStillDeps } from './commentStillCapture'
import type { CommentE2ePanelState, CommentServiceApi, PreviewCommentShared } from './commentServiceTypes'
import { samePathKey } from './commentUnsavedSources'
import { createFrameFileMap } from './frameFileMap'

/** The slice of the view's `webContents` comments use. */
export type CommentServiceContents = FreshStillDeps['contents'] &
  CommentEventContents & {
    readonly mainFrame?: unknown
    getZoomLevel(): number
  }

/** What one view's comments are built from. */
export interface PreviewCommentServiceDeps {
  readonly panelId: string
  readonly windowId: number
  /** Unique per live view: a new view is a new binding for drafts and keys. */
  readonly session: number
  readonly contents: CommentServiceContents
  readonly serving: PreviewCommentServing
  readonly token: string
  readonly realRoot: string
  readonly projectPath: string
  readonly shared: PreviewCommentShared
  readonly still: Omit<FreshStillDeps, 'panelId' | 'contents'>
  readonly geometry: Omit<DraftOpenerGeometry, 'cursor' | 'pageZoom'>
  /** The page on screen (`page.currentPage()`). */
  readonly currentPage: () => string
  /** Reload the view (`pipeline.reload(false)`). */
  readonly reload: () => void
  readonly now: () => number
  readonly platform?: NodeJS.Platform
  /** Resolve a frame from its process and routing ids; `webFrameMain.fromId` by default. */
  readonly frameFromIds?: FrameFromIds
  /** The writer; a real `CommentWriter` by default. */
  readonly createWriter?: (deps: CommentWriterDeps) => Pick<CommentWriter, 'add' | 'changeThread' | 'deleteDamagedBlock'>
}

const electronFrameFromIds: FrameFromIds = (processId, routingId) =>
  (webFrameMain.fromId(processId, routingId) ?? undefined) as unknown as CommentFrameLike | undefined

/** HTML Preview comments for one view. */
export class PreviewCommentService implements CommentServiceApi {
  readonly panelId: string
  readonly windowId: number
  private mode = false
  private showIcons = true
  private hidden = false
  /** One reload over a raw page per mode-on, so a page that never gets tokens cannot loop. */
  private rawReloadLeft = false
  private lastChanged = ''
  private lastNotVisible = ''
  private disposed = false
  private readonly binding: CommentBinding
  private readonly jobs: CommentFileJobRunner
  private readonly frames: CommentFrames
  private readonly keys = new CommentKeyStore<CommentDraft>()
  private readonly status: CommentPanelStatus
  private readonly broadcaster: CommentFrameBroadcaster
  private readonly coordinator: CommentReloadCoordinator
  private readonly signals: CommentPickHandler
  private readonly opener: CommentDraftOpener
  private readonly saveFlow: (request: CommentSaveRequest) => Promise<CommentSaveResult>
  private readonly detach: Array<() => void> = []

  constructor(private readonly deps: PreviewCommentServiceDeps) {
    this.panelId = deps.panelId
    this.windowId = deps.windowId
    this.binding = { windowId: deps.windowId, panelId: deps.panelId, session: deps.session }
    this.jobs = deps.shared.jobs ?? sharedCommentParseClient()
    const { tokens } = deps.serving
    const mainFrame = (): CommentFrameLike | undefined => deps.contents.mainFrame as CommentFrameLike | undefined
    const files = createFrameFileMap({ token: deps.token, realRoot: deps.realRoot, projectPath: deps.projectPath, platform: deps.platform })
    this.frames = new CommentFrames({ tokens, files, mainFrame })
    this.status = createCommentPanelStatus({
      panelId: deps.panelId,
      frames: this.frames,
      keys: this.keys,
      binding: this.binding,
      serving: deps.serving,
      mainFrame,
      enabled: () => this.enabled(),
      platform: deps.platform
    })
    this.broadcaster = createCommentFrameBroadcaster({
      panelId: deps.panelId,
      frames: this.frames,
      mode: () => ({ mode: this.mode, showIcons: this.showIcons, hidden: this.hidden })
    })
    this.coordinator = createCommentReloadCoordinator({
      contents: deps.contents,
      currentPage: deps.currentPage,
      reload: deps.reload,
      now: deps.now,
      platform: deps.platform
    })
    this.opener = this.buildOpener(tokens, mainFrame)
    this.saveFlow = this.buildSaveFlow()
    this.signals = createCommentPickHandler({
      panelId: deps.panelId,
      frames: this.frames,
      tokens,
      now: deps.now,
      mode: () => this.mode,
      platform: deps.platform,
      sinks: {
        hello: frame => this.guard(this.onHello(frame)),
        exit: () => this.changeMode(false, 'escape'),
        parent: frame => this.onParent(frame),
        step: step => this.onStep(step),
        icon: (frame, record, key, pick) => this.guard(this.opener.icon(frame, record, key, pick)),
        element: (frame, record, entry, pick) => this.guard(this.opener.element(frame, record, entry, pick)),
        anchors: (_frame, record, anchors) => this.onAnchors(record, anchors)
      }
    })
    this.detach.push(
      attachCommentServiceEvents(
        deps.contents,
        {
          hello: (event, payload) => this.signals.hello(event as PageSignalEvent, payload),
          pick: (event, payload) => this.signals.pick(event as PageSignalEvent, payload),
          anchors: (event, payload) => this.signals.anchors(event as PageSignalEvent, payload),
          navigated: (frame, url, isMainFrame) => {
            this.frames.navigated(frame.frameTreeNodeId, url, isMainFrame)
            this.broadcaster.broadcastSoon()
          },
          frameCreated: () => this.broadcaster.broadcastSoon()
        },
        deps.frameFromIds ?? electronFrameFromIds
      )
    )
    this.detach.push(deps.shared.registry.add(this))
    this.detach.push(registerCommentE2eSource({ panel: () => this.e2eState() }))
  }

  /** Turn comment mode on or off with the tab's pins toggle (`preview:commentSetMode`). */
  async setMode(on: boolean, showIcons: boolean): Promise<CommentSetModeResult> {
    this.showIcons = showIcons
    this.applyMode(on && this.enabled())
    this.publishChanged()
    return { ok: true, on: this.mode, showIcons: this.showIcons }
  }

  /** Whether comment mode is on: Esc then stays with the page, whose preload leaves the mode. */
  isModeOn(): boolean {
    return this.mode
  }

  /** Whether the comment-mode shortcut is the view's to take (the feature is on). */
  acceptsToggle(): boolean {
    return this.enabled()
  }

  /** The comment-mode shortcut reached the page (Ctrl+Alt+M / Cmd+Option+M). */
  toggleMode(): void {
    this.changeMode(!this.mode, 'shortcut')
  }

  /** Every comment of the page on screen and its same-project frames (`preview:commentList`). */
  async list(): Promise<CommentListResult> {
    const unavailable = this.status.unavailable()
    this.keys.beginGeneration()
    const { files, unread } = await buildCommentList({
      binding: this.binding,
      keys: this.keys,
      realRoot: this.deps.realRoot,
      files: await this.status.listedFiles(),
      notVisible: (realPath, threadId) => this.status.isNotVisible(realPath, threadId),
      jobs: this.jobs,
      platform: this.deps.platform
    })
    return { ok: true, files, ...(unread > 0 ? { unread } : {}), ...(unavailable === undefined ? {} : { unavailable }) }
  }

  /** "Show on page" (`preview:commentCommand`): scroll the thread's pin into view in its frame. */
  reveal(threadKey: string): CommentAck {
    const thread = this.keys.resolve(this.binding, threadKey, 'thread')
    if (!thread.ok) return { ok: false, code: ErrorCode.COMMENT_KEY_INVALID }
    const wanted = samePathKey(thread.value.realPath, this.deps.platform)
    for (const frame of this.frames.liveFrames()) {
      const record = this.frames.get(frame.frameTreeNodeId)
      if (record?.file === undefined || samePathKey(record.file.realPath, this.deps.platform) !== wanted) continue
      for (const [pinKey, pin] of record.pins) {
        if (!pin.threadIds.includes(thread.value.threadId)) continue
        this.broadcaster.send(frame, { reveal: pinKey })
        return { ok: true }
      }
    }
    // Resolved, orphaned or not on screen: there is no pin to scroll to.
    return { ok: false, code: ErrorCode.COMMENT_TARGET_MOVED }
  }

  /** One write (`preview:commentSave`). */
  save(request: CommentSaveRequest): Promise<CommentSaveResult> {
    return this.saveFlow(request)
  }

  /**
   * Print with the overlay hidden in every frame, and show it again after
   * (M-064). Every live frame is sent `hidden` first, then two animation
   * frames are waited out in the top frame: the commentable frames are
   * same-origin, so they share the top frame's renderer and compositor, and
   * their states are sent before the wait script is. The overlay's
   * own `@media print` rule (`overlayStyles.ts`) hides it in every frame at
   * print time whatever arrived when – the wait keeps the screen and the PDF
   * in step, it does not decide what prints.
   */
  async aroundPrint<T>(print: () => Promise<T>): Promise<T> {
    this.hidden = true
    this.broadcaster.broadcast()
    await waitForPaint(this.deps.contents, { childIndex: -1, nested: false })
    try {
      return await print()
    } finally {
      this.hidden = false
      this.broadcaster.broadcast()
    }
  }

  /** The view is starting a reload (the wiring's `reloadPage`). */
  reloadStarting(): void {
    this.coordinator.reloadStarting()
  }

  /** A load of the view ended. */
  pageLoadEnded(end: { readonly reason: string; readonly load: { readonly filePath: string } }): void {
    this.coordinator.pageLoadEnded(end)
  }

  /** The page fired `did-finish-load`. */
  didFinishLoad(): void {
    this.coordinator.didFinishLoad()
  }

  /** A watcher change to `path`, recorded unless it is this view's own write echoing. */
  filterChange(path: string, record: () => void): void {
    this.coordinator.filterChange(path, record)
  }

  e2eState(): CommentE2ePanelState {
    const stats = this.coordinator.stats()
    const records = this.frames.all()
    return {
      panelId: this.panelId,
      windowId: this.windowId,
      mode: this.mode,
      showIcons: this.showIcons,
      hidden: this.hidden,
      reloads: stats.reloads,
      echoes: stats.echoes,
      ...(stats.lastRestore === undefined ? {} : { lastRestore: stats.lastRestore }),
      drafts: this.keys.size.drafts,
      keys: this.keys.size.keys,
      frames: records.length,
      commentableFrames: records.filter(record => this.frames.isCommentable(record)).length
    }
  }

  /** The view is going: every listener, draft, key and record with it. */
  dispose(): void {
    this.disposed = true
    for (const undo of this.detach.splice(0).reverse()) {
      try {
        undo()
      } catch {
        // Nothing useful to do while already tearing down.
      }
    }
    this.broadcaster.dispose()
    this.coordinator.dispose()
    this.keys.clear()
    this.frames.clear()
  }

  private buildOpener(tokens: PreviewCommentServing['tokens'], mainFrame: () => CommentFrameLike | undefined): CommentDraftOpener {
    const { deps } = this
    return createCommentDraftOpener({
      panelId: deps.panelId,
      binding: this.binding,
      realRoot: deps.realRoot,
      keys: this.keys,
      tokens,
      mainFrame,
      still: { ...deps.still, panelId: deps.panelId, contents: deps.contents },
      geometry: {
        ...deps.geometry,
        pageZoom: () => Math.pow(1.2, deps.contents.getZoomLevel()),
        cursor: deps.shared.cursor ?? (() => ({ x: 0, y: 0 }))
      },
      accent: accentRgb(),
      currentPage: deps.currentPage,
      emit: payload => deps.shared.emit.draftOpened(deps.windowId, payload),
      jobs: this.jobs,
      isCurrent: record => !this.disposed && this.frames.get(record.ftn) === record,
      platform: deps.platform
    })
  }

  private buildSaveFlow(): (request: CommentSaveRequest) => Promise<CommentSaveResult> {
    const { deps } = this
    const writerDeps: CommentWriterDeps = {
      identity: deps.shared.identity,
      hasUnsavedSource: realPath => deps.shared.unsaved.has(deps.windowId, realPath),
      jobs: this.jobs,
      platform: deps.platform
    }
    return createCommentSaveFlow({
      binding: this.binding,
      realRoot: deps.realRoot,
      keys: this.keys,
      writer: deps.createWriter?.(writerDeps) ?? new CommentWriter(writerDeps),
      captureScroll: () => this.coordinator.captureScroll(),
      currentPage: deps.currentPage,
      landed: write => this.coordinator.arm(write),
      lateSettled: settled => this.onLateSettled(settled),
      platform: deps.platform
    })
  }

  /** A page signal's async work: a rejection is logged by its name, never left unhandled. */
  private guard(work: Promise<void>): void {
    work.catch((error: unknown) => {
      logger.error('Preview comments: a page signal failed', undefined, {
        error: error instanceof Error ? error.name : typeof error
      })
    })
  }

  private enabled(): boolean {
    try {
      return this.deps.shared.isEnabled()
    } catch {
      return false
    }
  }

  private applyMode(on: boolean): void {
    const turnedOn = on && !this.mode
    this.mode = on
    this.deps.serving.setCommentMode(on)
    this.broadcaster.broadcast()
    if (!turnedOn) return
    this.rawReloadLeft = true
    if (this.frames.liveFrames().some(frame => this.servedRaw(this.frames.get(frame.frameTreeNodeId)))) this.reloadRaw()
  }

  private changeMode(on: boolean, reason: CommentModeChanged['reason']): void {
    if (on && !this.enabled()) return
    this.applyMode(on)
    this.deps.shared.emit.modeChanged(this.windowId, { panelId: this.panelId, on: this.mode, reason })
  }

  /** A commentable file served without tokens, for no reason instrumentation gave. */
  private servedRaw(record: FrameRecord | undefined): boolean {
    const file = record?.file
    return file?.commentable === true && !this.frames.isCommentable(record) && this.status.reasonFor(file.realPath) === undefined
  }

  private reloadRaw(): void {
    if (!this.rawReloadLeft) return
    this.rawReloadLeft = false
    void this.coordinator.reloadKeepingPlace()
  }

  private async onHello(frame: CommentFrameLike): Promise<void> {
    const record = await this.frames.hello(frame)
    const realPath = record.file?.realPath
    const restore = frame.parent !== null && realPath !== undefined ? this.coordinator.frameRestoreFor(realPath) : undefined
    this.broadcaster.send(frame, restore === undefined ? undefined : { restore })
    // The parent's list of child frames now says whether this one is commentable.
    if (frame.parent !== null) this.broadcaster.send(frame.parent)
    // A load that started before the mode came on was served without tokens.
    if (this.mode && this.servedRaw(record)) this.reloadRaw()
    this.publishChanged()
  }

  private onParent(frame: CommentFrameLike): void {
    if (frame.parent === null) return
    this.broadcaster.send(frame.parent, { focusFrame: this.frames.record(frame.frameTreeNodeId).key })
  }

  /** The keyboard picker moved: the window's live region says where, in main's words (S-L-A). */
  private onStep(step: PickerStepInput): void {
    this.deps.shared.emit.modeChanged(this.windowId, { panelId: this.panelId, on: this.mode, reason: 'picker', ...pickerStepOf(step) })
  }

  private onAnchors(record: FrameRecord, anchors: CommentAnchors): void {
    record.hidden = new Set(anchors.hidden.filter(key => record.pins.has(key)))
    if (anchors.overlay === 'unavailable' && record.loss === undefined) record.loss = anchors.reason ?? 'overlay-removed'
    const notVisible = this.status.notVisibleThreadKeys()
    const text = JSON.stringify(notVisible)
    if (text !== this.lastNotVisible) {
      this.lastNotVisible = text
      this.deps.shared.emit.anchorStatus(this.windowId, { panelId: this.panelId, notVisible })
    }
    this.publishChanged()
  }

  /**
   * A save that outlasted its answer settled. A landed one re-sends the
   * counts even unchanged, so the window re-lists. The window is told how it
   * ended even once the view is gone – a suspended tab is still on screen,
   * and its comment window holds the editor's autosave until it hears.
   */
  private onLateSettled(settled: LateSettle): void {
    if (settled.ok) this.publishChanged(true)
    this.deps.shared.emit.saveSettled(this.windowId, { panelId: this.panelId, ...settled })
  }

  /**
   * Tell the renderer the tab's counts or availability, when they changed –
   * or, `force`d, in any case: a save that outlasted its answer landed, and
   * the window re-lists.
   */
  private publishChanged(force = false): void {
    if (this.disposed) return
    const payload = this.status.changed()
    const text = JSON.stringify(payload)
    if (text === this.lastChanged && !force) return
    this.lastChanged = text
    this.deps.shared.emit.commentsChanged(this.windowId, payload)
  }
}
