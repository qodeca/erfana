// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The frames of one preview view, as comments see them
 * (docs/designs/html-preview-comments.md §4.2, §6 "Frames", §8, §19 R3-3,
 * R3-4, R3-13; tests M-050, M-059, SEC-09).
 *
 * One record per frame, keyed by `frameTreeNodeId`, holding:
 * - the page-visible opaque key the frame's parent pairs with its `<iframe>`
 *   (R3-4) – never the id itself;
 * - the instrumented load bound to the frame. A document commits
 *   (`did-frame-navigate`), the frame's file is recorded (`frameFileMap`), and
 *   at that document's first `commentHello` the newest unbound load of the
 *   same file and scope is bound to it (R3-13) – once: a repeated hello of the
 *   same document only asks for the state again;
 * - its pins, keyed by opaque keys (never reused), and which of them the frame last
 *   reported hidden;
 * - why its overlay gave up, when it did.
 *
 * A frame that left the tree takes its record and its token tables with it;
 * so does every child frame when the page itself commits a new document
 * (child frames get new ids on every load, S2).
 */
import type { CommentOverlayLoss } from '../../../../shared/ipc/preview-comment-schema'
import type { CommentLoadView, ElementTokenTable } from './ElementTokenTable'
import type { FrameFile, FrameFileMap } from './frameFileMap'
import { groupPins, type PinGroup } from './commentPins'

/** The slice of a `WebFrameMain` comments use. */
export interface CommentFrameLike {
  readonly frameTreeNodeId: number
  readonly parent: CommentFrameLike | null
  /** Direct children, in `WebFrameMain.frames` order = `window[i]` order (S8). */
  readonly frames: readonly CommentFrameLike[]
  readonly framesInSubtree: readonly CommentFrameLike[]
  readonly detached?: boolean
  isDestroyed?(): boolean
  send(channel: string, payload: unknown): void
}

/** One frame's comment record. */
export interface FrameRecord {
  readonly ftn: number
  /** The opaque key the parent pairs with its `<iframe>` (`commentState.childFrames`). */
  readonly key: string
  /** The token table's frame key. */
  readonly bindKey: string
  file?: FrameFile
  loadId?: string
  /** A document committed and has not said hello yet. */
  needsBind: boolean
  /** Pins of the bound load, by key. */
  readonly pins: Map<string, PinGroup>
  /** Pin keys by pin group id; a group keeps its key while the frame lives, and no key is reused. */
  readonly pinKeys: Map<string, string>
  /** Pin keys the frame last reported not rendered. */
  hidden: ReadonlySet<string>
  loss?: CommentOverlayLoss
}

/** What the registry is built from. */
export interface CommentFramesDeps {
  readonly tokens: ElementTokenTable
  readonly files: FrameFileMap
  readonly mainFrame: () => CommentFrameLike | undefined
}

/** Whether a frame is still in the tree and can be sent to. */
export function isLiveFrame(frame: CommentFrameLike): boolean {
  try {
    return frame.detached !== true && frame.isDestroyed?.() !== true
  } catch {
    return false
  }
}

/** The frames of one view. */
export class CommentFrames {
  private readonly records = new Map<number, FrameRecord>()
  private nextKey = 1

  constructor(private readonly deps: CommentFramesDeps) {}

  /** The frame's record, created on first use. */
  record(ftn: number): FrameRecord {
    let record = this.records.get(ftn)
    if (record === undefined) {
      record = {
        ftn,
        key: `fr${this.nextKey++}`,
        bindKey: `ftn:${ftn}`,
        needsBind: false,
        pins: new Map(),
        pinKeys: new Map(),
        hidden: new Set()
      }
      this.records.set(ftn, record)
    }
    return record
  }

  /** The record of `ftn`, if any. */
  get(ftn: number): FrameRecord | undefined {
    return this.records.get(ftn)
  }

  /** Every record. */
  all(): FrameRecord[] {
    return [...this.records.values()]
  }

  /** The live frames of the view, the page first. */
  liveFrames(): CommentFrameLike[] {
    const main = this.deps.mainFrame()
    if (main === undefined) return []
    try {
      return main.framesInSubtree.filter(isLiveFrame)
    } catch {
      return []
    }
  }

  /** The live frame with `ftn`, if any. */
  frameOf(ftn: number): CommentFrameLike | undefined {
    return this.liveFrames().find(frame => frame.frameTreeNodeId === ftn)
  }

  /**
   * A document committed in frame `ftn` (`did-frame-navigate`). Its file is
   * recorded and the next hello binds a load; a new page document drops every
   * child frame's record and tables.
   */
  navigated(ftn: number, url: string, isMainFrame: boolean): void {
    if (isMainFrame) {
      for (const record of this.all()) if (record.ftn !== ftn) this.drop(record)
      this.deps.files.retain(new Set([ftn]))
    }
    this.deps.files.navigated(ftn, url)
    const record = this.record(ftn)
    record.needsBind = true
    record.loadId = undefined
    record.file = undefined
    record.loss = undefined
    record.hidden = new Set()
    record.pins.clear()
  }

  /**
   * A frame said hello: its file, and – for a document's first hello – the
   * newest unbound load of that file in the frame's scope, bound to it.
   */
  async hello(frame: CommentFrameLike): Promise<FrameRecord> {
    const record = this.record(frame.frameTreeNodeId)
    const file = await this.deps.files.fileOf(record.ftn)
    record.file = file
    if (!record.needsBind) return record
    record.needsBind = false
    if (file?.commentable === true) {
      const scope = frame.parent === null ? 'page' : 'frame'
      const candidate = this.deps.tokens
        .views()
        .filter(view => view.frameKey === undefined && view.scope === scope && view.realPath === file.realPath)
        .at(-1)
      if (candidate !== undefined && this.deps.tokens.bind(candidate.loadId, record.bindKey) === 'bound') {
        record.loadId = candidate.loadId
      }
    }
    this.refreshPins(record)
    return record
  }

  /** The bound load's view, while the token table still holds it. */
  viewOf(record: FrameRecord): CommentLoadView | undefined {
    return record.loadId === undefined ? undefined : this.deps.tokens.view(record.loadId)
  }

  /** A frame with a commentable file and a live bound load: full state; anything else: mode only (R3-3). */
  isCommentable(record: FrameRecord | undefined): boolean {
    return record !== undefined && record.file?.commentable === true && this.viewOf(record) !== undefined
  }

  /** Rebuild a record's pins from its bound load, keeping each group's key. */
  refreshPins(record: FrameRecord): void {
    record.pins.clear()
    const view = this.viewOf(record)
    if (view === undefined) return
    for (const group of groupPins(view)) {
      let key = record.pinKeys.get(group.id)
      if (key === undefined) {
        key = `p${this.nextKey++}`
        record.pinKeys.set(group.id, key)
      }
      record.pins.set(key, group)
    }
  }

  /** Drop every record whose frame left the tree, with its token tables. */
  prune(): void {
    const live = new Set(this.liveFrames().map(frame => frame.frameTreeNodeId))
    if (live.size === 0) return
    for (const record of this.all()) if (!live.has(record.ftn)) this.drop(record)
    this.deps.files.retain(live)
  }

  /** Forget everything (the view is gone). */
  clear(): void {
    this.records.clear()
    this.deps.files.clear()
  }

  private drop(record: FrameRecord): void {
    this.records.delete(record.ftn)
    this.deps.tokens.evictFrame(record.bindKey)
  }
}
