// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview-page:commentState` for every frame of a view
 * (docs/designs/html-preview-comments.md §7.1 step 2, §8, §19 R3-3, R3-4;
 * tests M-064, SEC-19).
 *
 * A frame with a commentable file and a bound load gets the full state: the
 * mode, its pins, its child frames in `WebFrameMain.frames` order (R3-4), the
 * resolved theme. Every other frame – `srcdoc`, `about:blank`, an error page,
 * a file served raw – gets the mode alone, so clicks are swallowed everywhere
 * in comment mode (R3-3). Nothing in a state names a file, a thread or an
 * author: pins carry a key, a token, a count and a status (§4.1 B1').
 *
 * `hidden` rides on every state while the page prints to PDF (M-064); the
 * one-shot fields – `reveal`, `restore`, `focusFrame` – go only in the send
 * they were asked for. Sends are coalesced: everything one tick asks for is
 * one broadcast.
 */
import { PreviewCommentPageChannels } from '../../../../shared/ipc/preview-comment-channels'
import { stablePathDigest } from '../../../../shared/stablePathDigest'
import { logger } from '../../LoggingService'
import { COMMENT_OVERLAY_THEME } from './commentOverlayTheme'
import { isLiveFrame, type CommentFrameLike, type CommentFrames, type FrameRecord } from './commentFrames'

/** The view-wide part of every state. */
export interface CommentViewMode {
  readonly mode: boolean
  readonly showIcons: boolean
  /** The page is printing: draw nothing. */
  readonly hidden: boolean
}

/** Fields that go in one send only. */
export interface CommentStateExtras {
  readonly reveal?: string
  readonly restore?: { readonly x: number; readonly y: number }
  readonly focusFrame?: string
}

/** One pin as the overlay reads it. */
interface IconPayload {
  readonly key: string
  readonly token: string
  readonly runtime?: { readonly path: string; readonly tag: string }
  readonly count: number
  readonly status: 'open' | 'damaged'
}

/** What the broadcaster is built from. */
export interface CommentBroadcasterDeps {
  readonly panelId: string
  readonly frames: CommentFrames
  readonly mode: () => CommentViewMode
  /** Defaults to `setImmediate`; tests flush by hand. */
  readonly schedule?: (run: () => void) => void
}

/** Sends one view's frames their states. */
export interface CommentFrameBroadcaster {
  /** The state `frame` gets now, with `extras`. */
  stateFor(frame: CommentFrameLike, extras?: CommentStateExtras): Record<string, unknown>
  /** Send `frame` its state now. */
  send(frame: CommentFrameLike, extras?: CommentStateExtras): void
  /** Send every live frame its state, once, at the end of this tick. */
  broadcastSoon(): void
  /** Send every live frame its state now. */
  broadcast(): void
  dispose(): void
}

function iconsOf(record: FrameRecord): IconPayload[] {
  return [...record.pins].map(([key, pin]) => ({
    key,
    token: pin.token,
    ...(pin.runtime === undefined ? {} : { runtime: pin.runtime }),
    count: pin.count,
    status: pin.status
  }))
}

/** Build one view's broadcaster. */
export function createCommentFrameBroadcaster(deps: CommentBroadcasterDeps): CommentFrameBroadcaster {
  const schedule = deps.schedule ?? (run => void setImmediate(run))
  let queued = false
  let disposed = false
  let failures = 0

  function stateFor(frame: CommentFrameLike, extras: CommentStateExtras = {}): Record<string, unknown> {
    const { mode, showIcons, hidden } = deps.mode()
    const record = deps.frames.get(frame.frameTreeNodeId)
    const base = { mode, theme: COMMENT_OVERLAY_THEME, ...(hidden ? { hidden: true } : {}) }
    if (record === undefined || !deps.frames.isCommentable(record)) return { ...base, commentable: false }
    const childFrames = frame.frames.filter(isLiveFrame).map(child => {
      const childRecord = deps.frames.record(child.frameTreeNodeId)
      return { key: childRecord.key, commentable: deps.frames.isCommentable(childRecord) }
    })
    return { ...base, commentable: true, showIcons, icons: iconsOf(record), childFrames, ...extras }
  }

  function send(frame: CommentFrameLike, extras?: CommentStateExtras): void {
    if (disposed || !isLiveFrame(frame)) return
    try {
      frame.send(PreviewCommentPageChannels.STATE, stateFor(frame, extras))
    } catch (error) {
      // A frame torn down between the check and the send; logged once per view.
      if (failures++ === 0) {
        logger.debug('Preview comments: a frame state was not delivered', {
          panelId: stablePathDigest(deps.panelId),
          error: error instanceof Error ? error.name : typeof error
        })
      }
    }
  }

  function broadcast(): void {
    queued = false
    if (disposed) return
    deps.frames.prune()
    for (const frame of deps.frames.liveFrames()) send(frame)
  }

  return {
    stateFor,
    send,
    broadcast,
    broadcastSoon() {
      if (queued || disposed) return
      queued = true
      schedule(broadcast)
    },
    dispose() {
      disposed = true
    }
  }
}
