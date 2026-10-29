// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A checked pick, turned into `preview:commentDraftOpened`
 * (docs/designs/comments/html-preview-comments.md §7.3 steps 3–5, §7.4, §7.7, §19
 * R3-5, R3-6; tests M-033, M-054, E-011).
 *
 * For an element: the draft is built from disk (`commentDraftBuilder.ts`)
 * while the top frame paints the selected outline twice over; then the fresh
 * still is captured and the renderer told – the menu's point, the file it
 * would be saved into, and a single-use draft token with its element key, or
 * no token (the menu's disabled "Can't comment here"). For a pin: the threads
 * and blocks standing on it, as keys, and a draft token for the window's "New
 * comment" on the same element – the blocks and the draft from ONE read and
 * one worker job (M4). The draft itself – real path, offset, hash, anchor –
 * never leaves main.
 *
 * Whether an editor tab holds unsaved changes for the file is NOT sent: the
 * comment window's own guard (`useCommentDirtyGuard`) shows that banner and
 * follows the tab live, and main refuses the write anyway
 * (`COMMENT_UNSAVED_SOURCE`, §19 "Draft event fields").
 *
 * The file a pick is about is the frame's file WHEN THE PICK ARRIVED. A frame
 * that commits another document while the draft is built would otherwise get
 * a menu labelled with the new file over a draft that writes into the old
 * one; such a pick opens nothing. Nothing is minted or sent once the view is
 * gone or the frame's record left it (`isCurrent`).
 */
import { CommentPickRuntimeSchema, type CommentDraftOpened, type CommentPick } from '../../../../shared/ipc/preview-comment-schema'
import type { PreviewBounds } from '../../../../shared/ipc/preview-types'
import type { CommentFileJobRunner } from '../../comments/commentFileJobs'
import type { CommentBinding, CommentKeyStore } from '../../comments/commentKeyStore'
import type { CommentFrameLike, FrameRecord } from './commentFrames'
import { buildDraft, buildPin, draftKeyOf, type BuiltDraft, type BuiltPin, type CommentDraft } from './commentDraftBuilder'
import { menuPoint } from './commentMenuPoint'
import type { PinGroup } from './commentPins'
import { captureFreshStill, waitForPaint, type FreshStillDeps, type PickFramePlace } from './commentStillCapture'
import type { FrameOffset } from './commentScripts'
import { samePathKey } from '../../comments/commentUnsavedSources'
import type { ElementTokenEntry, ElementTokenTable } from './ElementTokenTable'
import type { FrameFile } from './frameFileMap'

/** Where the menu point and the still come from. */
export interface DraftOpenerGeometry {
  readonly viewRect: () => PreviewBounds | null
  readonly contentBounds: () => { readonly x: number; readonly y: number }
  readonly hostZoom: () => number
  readonly pageZoom: () => number
  readonly cursor: () => { readonly x: number; readonly y: number }
}

/** What the opener is built from. */
export interface DraftOpenerDeps {
  readonly panelId: string
  readonly binding: CommentBinding
  readonly realRoot: string
  readonly keys: CommentKeyStore<CommentDraft>
  readonly tokens: ElementTokenTable
  readonly mainFrame: () => CommentFrameLike | undefined
  readonly still: FreshStillDeps
  readonly geometry: DraftOpenerGeometry
  readonly accent: readonly [number, number, number]
  /** The page on screen (`page.currentPage()`): a save restores only onto it. */
  readonly currentPage: () => string
  readonly emit: (payload: CommentDraftOpened) => void
  /** Where the parse runs: the comment parse worker in the app. */
  readonly jobs: CommentFileJobRunner
  /** False once the view is disposed or `record` is no longer its frame's: nothing is minted or sent then. */
  readonly isCurrent: (record: FrameRecord) => boolean
  readonly platform?: NodeJS.Platform
}

/** Opens drafts and pin threads for one view. */
export interface CommentDraftOpener {
  element(frame: CommentFrameLike, record: FrameRecord, entry: ElementTokenEntry | undefined, pick: CommentPick): Promise<void>
  icon(frame: CommentFrameLike, record: FrameRecord, pinKey: string, pick: CommentPick): Promise<void>
}

/** Where `frame` sits below the top frame (S8: `frames` order is `window[i]` order). */
export function placeOf(frame: CommentFrameLike, main: CommentFrameLike | undefined): PickFramePlace {
  if (frame.parent === null || main === undefined) return { childIndex: -1, nested: false }
  let ancestor = frame
  while (ancestor.parent !== null && ancestor.parent.parent !== null) ancestor = ancestor.parent
  const childIndex = main.frames.findIndex(child => child.frameTreeNodeId === ancestor.frameTreeNodeId)
  return { childIndex, nested: frame.parent.parent !== null }
}

/**
 * The pick a pin's "New comment" is built from: the icon pick's view, and the
 * element the pin stands on as the file names it – never a runtime element
 * the page describes. `undefined` when that element is not one a pick could
 * name (a stored runtime tag or path the pick schema refuses).
 */
export function pinPickOf(pin: PinGroup, pick: CommentPick): CommentPick | undefined {
  const base: CommentPick = { kind: pick.kind, via: pick.via, view: pick.view }
  if (pin.runtime === undefined) return base
  const runtime = CommentPickRuntimeSchema.safeParse({ path: pin.runtime.path, tag: pin.runtime.tag })
  return runtime.success ? { ...base, runtime: runtime.data } : undefined
}

/** Build one view's opener. */
export function createCommentDraftOpener(deps: DraftOpenerDeps): CommentDraftOpener {
  const { geometry } = deps

  function pointOf(pick: CommentPick, offset: FrameOffset | null): { x: number; y: number } {
    return menuPoint({
      pick,
      frameOffset: offset,
      viewRect: geometry.viewRect(),
      contentBounds: geometry.contentBounds(),
      hostZoom: geometry.hostZoom(),
      pageZoom: geometry.pageZoom(),
      cursor: geometry.cursor
    })
  }

  function display(file: FrameFile, frame: CommentFrameLike) {
    return {
      displayPath: file.displayPath,
      filePath: file.projectPath,
      frame: frame.parent !== null,
      fileKey: deps.keys.keyFor(deps.binding, { kind: 'file', realPath: file.realPath })
    }
  }

  /** Paint, then capture the still the popup sits over; resolves the frame's offset. */
  async function paintAndCapture(place: PickFramePlace, pick: CommentPick): Promise<FrameOffset | null> {
    const offset = await waitForPaint(deps.still.contents, place)
    const ring =
      pick.box === undefined || offset === null
        ? undefined
        : { box: pick.box, offset, pageZoom: geometry.pageZoom(), accent: deps.accent }
    await captureFreshStill(deps.still, { place, ...(ring === undefined ? {} : { ring }) })
    return offset
  }

  async function element(
    frame: CommentFrameLike,
    record: FrameRecord,
    entry: ElementTokenEntry | undefined,
    pick: CommentPick
  ): Promise<void> {
    const file = record.file!
    const place = placeOf(frame, deps.mainFrame())
    const painted = paintAndCapture(place, pick)
    const built =
      entry === undefined
        ? ({ ok: false } as const)
        : await buildDraft({
            realRoot: deps.realRoot,
            file,
            entry,
            pick,
            frame: frame.parent !== null,
            pageRealPath: deps.currentPage(),
            jobs: deps.jobs,
            platform: deps.platform
          })
    const offset = await painted
    if (!stillCurrent(record, file)) return
    deps.emit({
      panelId: deps.panelId,
      kind: pick.kind as 'menu' | 'open',
      point: pointOf(pick, offset),
      ...display(file, frame),
      ...minted(built)
    })
  }

  /** A built draft's token, element key and target for the event; nothing for none. */
  function minted(built: BuiltDraft): Pick<CommentDraftOpened, 'draftToken' | 'draftKey' | 'target'> {
    if (!built.ok) return {}
    return { draftToken: deps.keys.mintDraft(deps.binding, built.draft), draftKey: draftKeyOf(built.draft), target: built.target }
  }

  /**
   * The view is still there and the frame still shows `file`. A frame that
   * committed another document meanwhile gets no menu for the old one.
   */
  function stillCurrent(record: FrameRecord, file: FrameFile): boolean {
    const now = record.file?.realPath
    return deps.isCurrent(record) && now !== undefined && samePathKey(now, deps.platform) === samePathKey(file.realPath, deps.platform)
  }

  /**
   * The pin's damaged and newer blocks and a draft on its element for the
   * window's "New comment" – built from disk as a menu's is, on the JS-built
   * element when the pin stands on one – from one read and one worker job.
   */
  function pinOf(frame: CommentFrameLike, file: FrameFile, entry: ElementTokenEntry | undefined, pin: PinGroup, pick: CommentPick): Promise<BuiltPin> {
    if (entry === undefined) return Promise.resolve({ draft: { ok: false }, blocks: [] })
    const onPin = pinPickOf(pin, pick)
    return buildPin({
      realRoot: deps.realRoot,
      file,
      entry,
      ...(onPin === undefined ? {} : { pick: onPin }),
      blocks: pin.attention > 0,
      frame: frame.parent !== null,
      pageRealPath: deps.currentPage(),
      jobs: deps.jobs,
      platform: deps.platform
    })
  }

  async function icon(frame: CommentFrameLike, record: FrameRecord, pinKey: string, pick: CommentPick): Promise<void> {
    const pin = record.pins.get(pinKey)
    const file = record.file
    if (pin === undefined || file === undefined) return
    const { realPath } = file
    const entry = record.loadId === undefined ? undefined : deps.tokens.lookup(record.loadId, pin.token)
    const painted = paintAndCapture(placeOf(frame, deps.mainFrame()), pick)
    const built = await pinOf(frame, file, entry, pin, pick)
    const offset = await painted
    if (!stillCurrent(record, file)) return
    deps.emit({
      panelId: deps.panelId,
      kind: 'icon',
      point: pointOf(pick, offset),
      ...display(file, frame),
      threadKeys: pin.threadIds.map(threadId => deps.keys.keyFor(deps.binding, { kind: 'thread', realPath, threadId })),
      blockKeys: built.blocks.map(({ rawHash, start }) => deps.keys.keyFor(deps.binding, { kind: 'block', realPath, rawHash, start })),
      ...minted(built.draft)
    })
  }

  return { element, icon }
}
