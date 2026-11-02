// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure thread operations on `@data` (docs/designs/html-preview-comments.md
 * §7.7): create, reply, edit, delete a message, resolve and re-open.
 *
 * Each returns a NEW object and keeps every field it does not own – fields a
 * later format version added included (decision 22, U-016) – and never
 * touches the anchor, so a JS-built element's snapshot stays exactly as it
 * was captured (decisions 16–17, U-086). The clock and the random source are
 * passed in, so the output is the same in every time zone (U-018) and tests
 * are deterministic.
 */
import {
  formatTimestamp,
  mintCommentId,
  mintMessageId,
  type CommentAnchor,
  type CommentAuthor,
  type CommentData,
  type CommentMessage,
  type CommentView,
  type RandomBytes
} from './format'

/** Who acts, and when. */
export interface ThreadContext {
  readonly author: CommentAuthor
  readonly now: Date
  /** Defaults to `crypto.getRandomValues`. */
  readonly random?: RandomBytes
}

/** Input for {@link createThread}. */
export interface NewThread {
  readonly anchor: CommentAnchor
  readonly view: CommentView
  readonly text: string
  readonly context: ThreadContext
}

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'v',
  'id',
  'status',
  'resolved',
  'anchor',
  'view',
  'msgs'
])

function newMessage(text: string, context: ThreadContext): CommentMessage {
  return {
    id: mintMessageId(context.random),
    by: context.author,
    at: formatTimestamp(context.now),
    text
  }
}

/**
 * Rebuild `data` with new status fields and messages, keys in the §5.3 order
 * and unknown fields after them, unchanged.
 */
function rebuild(
  data: CommentData,
  changes: Pick<CommentData, 'status' | 'resolved' | 'msgs'>
): CommentData {
  const next: Record<string, unknown> = {
    v: data.v,
    id: data.id,
    status: changes.status,
    ...(changes.resolved ? { resolved: changes.resolved } : {}),
    anchor: data.anchor,
    view: data.view,
    msgs: changes.msgs
  }
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) next[key] = value
  }
  return next as CommentData
}

/** A new open thread with one comment. */
export function createThread(input: NewThread): CommentData {
  return {
    v: 1,
    id: mintCommentId(input.context.random),
    status: 'open',
    anchor: input.anchor,
    view: input.view,
    msgs: [newMessage(input.text, input.context)]
  }
}

/** The thread with one more reply at the end. */
export function addReply(data: CommentData, text: string, context: ThreadContext): CommentData {
  return rebuild(data, { ...data, msgs: [...data.msgs, newMessage(text, context)] })
}

/** The thread with one message's text replaced and marked edited; `undefined` if no such message. */
export function editMessage(
  data: CommentData,
  messageId: string,
  text: string,
  now: Date
): CommentData | undefined {
  if (!data.msgs.some(msg => msg.id === messageId)) return undefined
  const msgs = data.msgs.map(msg =>
    msg.id === messageId ? { ...msg, text, edited: formatTimestamp(now) } : msg
  )
  return rebuild(data, { ...data, msgs })
}

/**
 * The thread without one message. Deleting the first message deletes the
 * thread (§7.7), shown as `null`; `undefined` when there is no such message.
 */
export function deleteMessage(
  data: CommentData,
  messageId: string
): CommentData | null | undefined {
  const index = data.msgs.findIndex(msg => msg.id === messageId)
  if (index < 0) return undefined
  if (index === 0) return null
  return rebuild(data, { ...data, msgs: data.msgs.filter(msg => msg.id !== messageId) })
}

/** The thread resolved by the acting author, or re-opened (which drops `resolved`). */
export function setStatus(
  data: CommentData,
  status: CommentData['status'],
  context: ThreadContext
): CommentData {
  const resolved =
    status === 'resolved' ? { by: context.author, at: formatTimestamp(context.now) } : undefined
  return rebuild(data, { status, resolved, msgs: data.msgs })
}
