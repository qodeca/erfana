// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Thread operations (docs/designs/html-preview-comments.md §7.7): each returns
 * a new object, keeps fields it does not own and never touches the anchor.
 */
import { describe, expect, it } from 'vitest'
import {
  ADA,
  FIXED_NOW,
  GRACE,
  LATER,
  VIEW,
  BUTTON_ANCHOR,
  makeComment,
  makeReply,
  seededRandom
} from './__fixtures__/commentTestData'
import { CommentDataSchema, type CommentData } from './format'
import {
  addReply,
  createThread,
  deleteMessage,
  editMessage,
  setStatus,
  type ThreadContext
} from './thread'

const ada: ThreadContext = { author: ADA, now: FIXED_NOW, random: seededRandom(3) }
const grace = (): ThreadContext => ({ author: GRACE, now: LATER, random: seededRandom(4) })

/** A thread with two replies and a field from a later format version. */
function threadWithReplies(): CommentData {
  return {
    ...makeComment({ msgs: [makeComment().msgs[0], makeReply(1, 'one'), makeReply(2, 'two')] }),
    future: { kept: true }
  } as CommentData
}

describe('thread operations', () => {
  it('creates an open thread with one message, deterministic for a given clock and random source', () => {
    const input = { anchor: BUTTON_ANCHOR, view: VIEW, text: 'Make it blue.' }
    const a = createThread({ ...input, context: { ...ada, random: seededRandom(3) } })
    const b = createThread({ ...input, context: { ...ada, random: seededRandom(3) } })
    expect(a).toEqual(b)
    expect(a).toMatchObject({ v: 1, status: 'open', anchor: BUTTON_ANCHOR, view: VIEW })
    expect(a.id).toMatch(/^c-[a-z2-7]{16}$/)
    expect(a.msgs).toEqual([
      {
        id: expect.stringMatching(/^m-[a-z2-7]{16}$/),
        by: ADA,
        at: '2026-10-25T14:03:00Z',
        text: 'Make it blue.'
      }
    ])
    expect(CommentDataSchema.safeParse(a).success).toBe(true)
  })

  it('U-018 writes UTC timestamps whatever the input offset', () => {
    const local = new Date('2026-10-25T16:03:00+02:00')
    const data = createThread({
      anchor: BUTTON_ANCHOR,
      view: VIEW,
      text: 'x',
      context: { author: ADA, now: local }
    })
    expect(data.msgs[0].at).toBe('2026-10-25T14:03:00Z')
  })

  it('adds a reply at the end and keeps unknown fields after the known ones', () => {
    const data = threadWithReplies()
    const before = structuredClone(data)
    const next = addReply(data, 'three', grace())
    expect(data).toEqual(before)
    expect(next.msgs.map(msg => msg.text)).toEqual([
      'Make this button blue and bigger.',
      'one',
      'two',
      'three'
    ])
    expect(next.msgs[3]).toMatchObject({ by: GRACE, at: '2026-10-26T09:12:00Z' })
    expect(Object.keys(next)).toEqual(['v', 'id', 'status', 'anchor', 'view', 'msgs', 'future'])
    expect(next.anchor).toBe(data.anchor)
  })

  it('edits one message, marking it edited; an unknown id is undefined', () => {
    const data = threadWithReplies()
    const next = editMessage(data, data.msgs[1].id, 'one, edited', LATER)!
    expect(next.msgs[1]).toEqual({
      ...data.msgs[1],
      text: 'one, edited',
      edited: '2026-10-26T09:12:00Z'
    })
    expect(next.msgs[0]).toBe(data.msgs[0])
    expect((next as unknown as { future: unknown }).future).toEqual({ kept: true })
    expect(editMessage(data, 'm-nosuchmessageid', 'x', LATER)).toBeUndefined()
  })

  it('deletes a reply; deleting the first message deletes the thread', () => {
    const data = threadWithReplies()
    expect(deleteMessage(data, data.msgs[2].id)?.msgs.map(msg => msg.text)).toEqual([
      'Make this button blue and bigger.',
      'one'
    ])
    expect(deleteMessage(data, data.msgs[0].id)).toBeNull()
    expect(deleteMessage(data, 'm-nosuchmessageid')).toBeUndefined()
  })

  it('resolves with the acting author and re-opens without a resolved field, in §5.3 key order', () => {
    const resolved = setStatus(threadWithReplies(), 'resolved', grace())
    expect(resolved.status).toBe('resolved')
    expect(resolved.resolved).toEqual({ by: GRACE, at: '2026-10-26T09:12:00Z' })
    expect(Object.keys(resolved)).toEqual([
      'v',
      'id',
      'status',
      'resolved',
      'anchor',
      'view',
      'msgs',
      'future'
    ])
    const reopened = setStatus(resolved, 'open', ada)
    expect(reopened).not.toHaveProperty('resolved')
    expect(Object.keys(reopened)).toEqual(['v', 'id', 'status', 'anchor', 'view', 'msgs', 'future'])
    expect(CommentDataSchema.safeParse(reopened).success).toBe(true)
  })
})
