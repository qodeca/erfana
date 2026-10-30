// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the writes still waiting for main to say how they
 * ended (docs/designs/comments/html-preview-comments.md §8 Rev 3 note, §19 "Save
 * pending settles").
 *
 * A save past main's 15 s answer limit is answered `COMMENT_SAVE_PENDING`:
 * still being written, not failed. Main reports how it ended later with
 * `preview:commentSaveSettled`, naming the write by the request's own key.
 * Until then:
 *
 * - the write is **outstanding** for its draft, its element and its thread:
 *   Save and Reply are off, so the same text cannot be written twice
 *   ({@link useCommentWritePending});
 * - the editor's **autosave stays held** for the file – the hold is released
 *   on the settle event, not at the answer, because the write has not reached
 *   the disk yet;
 * - a write that lands **clears its session draft**, also with the window
 *   closed, so the next window on that element does not offer it again.
 *
 * Module state, not component state: "Close" is the pending banner's only
 * action, and the hold and the draft outlive the window. The registry listens
 * to the gateway only while a write is tracked. A settle that never comes
 * ends the wait after {@link PENDING_WRITE_MAX_MS}: the hold is let go –
 * main's re-hash before its rename still refuses a stale overwrite (§7.8) –
 * and Save is offered again.
 *
 * @module HtmlPreviewPanel/comments/commentPendingWrites
 */
import { useSyncExternalStore } from 'react'
import { ErrorCode } from '../../../../shared/errors'
import type {
  CommentSaveRequest,
  CommentSaveResult,
  CommentSaveSettled
} from '../../../../shared/ipc/preview-comment-schema'
import { commentGateway } from '../../services/preview/commentGateway'
import { commentDrafts } from '../../stores/usePreviewCommentStore'

/**
 * How long a write answered "pending" is waited for. Main's own limits are far
 * shorter – a 25 MB file's write job answers within 35 s, and a save queued
 * behind a full 64 MB list waits about 15 s more – so this is a safety net for
 * a settle that cannot come, not a deadline a real write meets.
 */
export const PENDING_WRITE_MAX_MS = 120_000

/** A write that settled after its answer, with what the window needs to word it. */
export interface SettledCommentWrite {
  readonly event: CommentSaveSettled
  readonly request: CommentSaveRequest
  /** The file as the reader knows it. */
  readonly file: string
  /** The session draft the write was typed in, if any. */
  readonly draftKey?: string
}

/** What a tracked write knows besides its request. */
export interface TrackCommentWriteOptions {
  /** The file as the reader knows it, for the sentence that reports the outcome. */
  readonly file: string
  /** The session draft the text was typed in: cleared when the write lands. */
  readonly draftKey?: string
  /** Runs once when the write ends: the autosave hold. */
  readonly release?: () => void
}

/** A tracked write, until main's answer comes. */
export interface TrackedCommentWrite {
  /** Main answered. Anything but `COMMENT_SAVE_PENDING` ends the write; that one waits for the settle event. */
  answered: (result: CommentSaveResult) => void
}

interface Entry {
  readonly request: CommentSaveRequest
  readonly key: string
  readonly options: TrackCommentWriteOptions
  awaiting: boolean
  timer?: ReturnType<typeof setTimeout>
}

const entries = new Set<Entry>()
const changeListeners = new Set<() => void>()
const settledListeners = new Set<(settled: SettledCommentWrite) => void>()
let unlisten: (() => void) | null = null

/**
 * The key main names a write by: the draft token of an add, the block key of
 * a block delete, the thread key of every other operation.
 *
 * @param request - A save request.
 * @returns Its key.
 */
export function writeKeyOf(request: CommentSaveRequest): string {
  if (request.op === 'add') return request.draftToken
  if (request.op === 'deleteBlock' || request.op === 'rebuildBlock') return request.blockKey
  return request.threadKey
}

function changed(): void {
  for (const listener of [...changeListeners]) listener()
}

function end(entry: Entry): void {
  if (!entries.delete(entry)) return
  clearTimeout(entry.timer)
  entry.options.release?.()
  if (entries.size === 0 && unlisten !== null) {
    unlisten()
    unlisten = null
  }
  changed()
}

function onSettled(event: CommentSaveSettled): void {
  const key = event.draftToken ?? event.blockKey ?? event.threadKey
  const entry = [...entries].find(
    candidate =>
      candidate.awaiting &&
      candidate.request.panelId === event.panelId &&
      candidate.request.op === event.op &&
      candidate.key === key
  )
  if (entry === undefined) return
  end(entry)
  const { file, draftKey } = entry.options
  if (event.ok && draftKey !== undefined) commentDrafts.clear(draftKey)
  const settled: SettledCommentWrite = {
    event,
    request: entry.request,
    file,
    ...(draftKey === undefined ? {} : { draftKey })
  }
  for (const listener of [...settledListeners]) listener(settled)
}

/**
 * Track a write from the moment it is sent. The handle's `answered` takes
 * main's answer.
 *
 * @param request - The save request about to be sent.
 * @param options - {@link TrackCommentWriteOptions}
 * @returns The handle.
 *
 * @example
 * ```ts
 * const write = trackCommentWrite(request, { file, draftKey, release: guard.holdForWrite() })
 * write.answered(await commentGateway.save(request))
 * ```
 */
export function trackCommentWrite(
  request: CommentSaveRequest,
  options: TrackCommentWriteOptions
): TrackedCommentWrite {
  const entry: Entry = { request, key: writeKeyOf(request), options, awaiting: false }
  entries.add(entry)
  // Listening from the send on: the settle event cannot overtake the answer.
  unlisten ??= commentGateway.onSaveSettled(onSettled)
  changed()
  return {
    answered: result => {
      if (!entries.has(entry) || entry.awaiting) return
      if (result.ok || result.code !== ErrorCode.COMMENT_SAVE_PENDING) {
        end(entry)
        return
      }
      entry.awaiting = true
      entry.timer = setTimeout(() => end(entry), PENDING_WRITE_MAX_MS)
      changed()
    }
  }
}

/**
 * Whether a write for `key` – a draft token, a thread or block key, or a
 * session draft key – is in flight or waiting to settle.
 *
 * @param panelId - The preview panel.
 * @param key - The key.
 * @param awaitingOnly - Only writes answered "pending".
 * @returns Whether one is.
 */
export function isCommentWritePending(panelId: string, key: string, awaitingOnly = false): boolean {
  for (const entry of entries) {
    if (entry.request.panelId !== panelId || (awaitingOnly && !entry.awaiting)) continue
    if (entry.key === key || entry.options.draftKey === key) return true
  }
  return false
}

/**
 * Hear every write that settled after its answer – after its hold was
 * released and, if it landed, its draft cleared.
 *
 * @param listener - Called once per settled write.
 * @returns The unsubscribe.
 */
export function onCommentWriteSettled(listener: (settled: SettledCommentWrite) => void): () => void {
  settledListeners.add(listener)
  return () => settledListeners.delete(listener)
}

function subscribe(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

/**
 * Whether a write for `key` is outstanding (see {@link isCommentWritePending}),
 * kept current while the component is mounted.
 *
 * @param panelId - The preview panel.
 * @param key - The key; `undefined` is never pending.
 * @returns Whether a write is outstanding.
 */
export function useCommentWritePending(panelId: string, key: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => key !== undefined && isCommentWritePending(panelId, key))
}

/** Test helper: forget every tracked write and listener, releasing nothing. */
export function resetCommentPendingWrites(): void {
  for (const entry of entries) clearTimeout(entry.timer)
  entries.clear()
  settledListeners.clear()
  unlisten?.()
  unlisten = null
  changed()
}
