// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the renderer's one door to
 * `window.api.previewComments` (docs/designs/comments/html-preview-comments.md §4.2, §8).
 *
 * Two jobs on top of the raw bridge (`previewCommentsGateway` in
 * `../previewGateway.ts`, the only file that reads it off `window.api`):
 *
 * - **No bridge is not a crash.** Panel tests install only the preview
 *   bridge, and a window whose preload predates comments has none; every
 *   subscription then returns a no-op and every request answers "refused".
 * - **A rejected invoke is an answer.** Main's handlers return
 *   `{ ok: false, code }` for every refusal, but an invoke can still reject
 *   (a handler not registered yet, the window closing). The comment window
 *   must keep the reviewer's text in that case too, so a rejection becomes
 *   `{ ok: false, code: UNKNOWN_ERROR }` – the generic "Couldn't save" path.
 *
 * Nothing here carries an author: main reads it from its own settings (§7.5).
 *
 * @module services/preview/commentGateway
 */
import { ErrorCode } from '../../../../shared/errors'
import type {
  CommentAck,
  CommentAnchorStatus,
  CommentDraftOpened,
  CommentListResult,
  CommentModeChanged,
  CommentSaveRequest,
  CommentSaveResult,
  CommentSaveSettled,
  CommentSetModeRequest,
  CommentSetModeResult,
  CommentsChanged
} from '../../../../shared/ipc/preview-comment-schema'
import { hasBridge } from '../bridgePresence'
import { previewCommentsGateway } from '../previewGateway'

/** The refusal every request answers with when there is no bridge or the invoke rejects. */
const UNAVAILABLE = { ok: false as const, code: ErrorCode.UNKNOWN_ERROR }

const noop = (): void => {}

/** Runs `request` when the bridge is there, folding a rejection into the refusal. */
async function ask<T>(request: () => Promise<T>, refused: T): Promise<T> {
  if (!hasBridge('previewComments')) return refused
  try {
    return await request()
  } catch {
    return refused
  }
}

/** Subscribes when the bridge is there; a no-op unsubscribe otherwise. */
function listen<T>(
  subscribe: (callback: (payload: T) => void) => () => void,
  callback: (payload: T) => void
): () => void {
  if (!hasBridge('previewComments')) return noop
  try {
    return subscribe(callback)
  } catch {
    return noop
  }
}

/**
 * The comments API the panel, the drawer and the Settings section use.
 *
 * @example
 * ```ts
 * const off = commentGateway.onCommentsChanged((p) => store.applyChanged(p))
 * const result = await commentGateway.save({ panelId, op: 'add', draftToken, text })
 * if (!result.ok) showBanner(result.code)
 * ```
 */
export const commentGateway = {
  /** Whether this window can comment at all. */
  available: (): boolean => hasBridge('previewComments'),
  setMode: (request: CommentSetModeRequest): Promise<CommentSetModeResult> =>
    ask(() => previewCommentsGateway.setMode(request), UNAVAILABLE),
  list: (panelId: string): Promise<CommentListResult> =>
    ask(() => previewCommentsGateway.list(panelId), UNAVAILABLE),
  reveal: (panelId: string, threadKey: string): Promise<CommentAck> =>
    ask(() => previewCommentsGateway.reveal(panelId, threadKey), UNAVAILABLE),
  save: (request: CommentSaveRequest): Promise<CommentSaveResult> =>
    ask(() => previewCommentsGateway.save(request), UNAVAILABLE),
  setUnsavedSources: (paths: readonly string[]): Promise<CommentAck> =>
    ask(() => previewCommentsGateway.setUnsavedSources(paths), UNAVAILABLE),
  onDraftOpened: (callback: (payload: CommentDraftOpened) => void): (() => void) =>
    listen(cb => previewCommentsGateway.onDraftOpened(cb), callback),
  onCommentsChanged: (callback: (payload: CommentsChanged) => void): (() => void) =>
    listen(cb => previewCommentsGateway.onCommentsChanged(cb), callback),
  onAnchorStatus: (callback: (payload: CommentAnchorStatus) => void): (() => void) =>
    listen(cb => previewCommentsGateway.onAnchorStatus(cb), callback),
  onModeChanged: (callback: (payload: CommentModeChanged) => void): (() => void) =>
    listen(cb => previewCommentsGateway.onModeChanged(cb), callback),
  onSaveSettled: (callback: (payload: CommentSaveSettled) => void): (() => void) =>
    listen(cb => previewCommentsGateway.onSaveSettled(cb), callback)
}
