// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The listeners one view's comments put on its `webContents`
 * (docs/designs/html-preview-comments.md §4.2, §6 "Frames", §8).
 *
 * - The page's three signals on the view's own `webContents.ipc` – the view's
 *   frames only, never global `ipcMain` – each checked in
 *   `commentPickHandler.ts` before anything else reads it.
 * - `did-frame-navigate`: a document committed in a frame, so its file and
 *   its next hello's load binding change (`commentFrames.ts`). The frame comes
 *   from the event's process and routing ids, never from anything the page
 *   sent; `pushState` and hash changes do not fire it (M-050).
 * - `frame-created`: the parents' lists of child frames are sent again.
 */
import { PreviewCommentPageChannels } from '../../../../shared/ipc/preview-comment-channels'
import type { CommentFrameLike } from './commentFrames'

type Listener = (...args: never[]) => void

/** The slice of the view's `webContents` the listeners attach to. */
export interface CommentEventContents {
  readonly ipc?: {
    on(channel: string, listener: Listener): void
    removeListener(channel: string, listener: Listener): void
  }
  on(event: string, listener: Listener): void
  removeListener(event: string, listener: Listener): void
}

/** Where each event goes. */
export interface CommentEventSinks {
  readonly hello: (event: unknown, payload: unknown) => void
  readonly pick: (event: unknown, payload: unknown) => void
  readonly anchors: (event: unknown, payload: unknown) => void
  /** A document committed in `frame`. */
  readonly navigated: (frame: CommentFrameLike, url: string, isMainFrame: boolean) => void
  /** A frame was created in the view. */
  readonly frameCreated: () => void
}

/** Resolve a frame from its process and routing ids (`webFrameMain.fromId`). */
export type FrameFromIds = (processId: number, routingId: number) => CommentFrameLike | undefined

/** Attach every listener. Returns the function that removes them all again. */
export function attachCommentServiceEvents(
  contents: CommentEventContents,
  sinks: CommentEventSinks,
  frameFromIds: FrameFromIds
): () => void {
  const undo: Array<() => void> = []
  const channels: Array<[string, (event: unknown, payload: unknown) => void]> = [
    [PreviewCommentPageChannels.HELLO, sinks.hello],
    [PreviewCommentPageChannels.PICK, sinks.pick],
    [PreviewCommentPageChannels.ANCHORS, sinks.anchors]
  ]
  for (const [channel, sink] of channels) {
    const listener = ((event: unknown, payload: unknown) => sink(event, payload)) as Listener
    contents.ipc?.on(channel, listener)
    undo.push(() => contents.ipc?.removeListener(channel, listener))
  }

  // Electron: (event, url, httpResponseCode, httpStatusText, isMainFrame, frameProcessId, frameRoutingId).
  const onNavigate = ((...args: unknown[]): void => {
    const [, url, , , isMainFrame, processId, routingId] = args
    if (typeof url !== 'string' || !Number.isInteger(processId) || !Number.isInteger(routingId)) return
    let frame: CommentFrameLike | undefined
    try {
      frame = frameFromIds(processId as number, routingId as number) ?? undefined
    } catch {
      return
    }
    if (frame !== undefined) sinks.navigated(frame, url, isMainFrame === true)
  }) as Listener
  const onFrameCreated = (() => sinks.frameCreated()) as Listener
  contents.on('did-frame-navigate', onNavigate)
  contents.on('frame-created', onFrameCreated)
  undo.push(() => contents.removeListener('did-frame-navigate', onNavigate))
  undo.push(() => contents.removeListener('frame-created', onFrameCreated))

  return () => {
    for (const step of undo.splice(0).reverse()) {
      try {
        step()
      } catch {
        // A contents already destroyed has dropped its listeners.
      }
    }
  }
}
