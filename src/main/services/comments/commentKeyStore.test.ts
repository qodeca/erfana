// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Draft tokens and opaque keys (docs/designs/comments/html-preview-comments.md §7.5
 * step 1, §8; M-051, M-053, M-057, SEC-08).
 */
import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { COMMENT_DRAFT_TOKEN_PATTERN } from '../../../shared/ipc/preview-comment-schema'
import { CommentKeyStore, DRAFT_TTL_MS, MAX_DRAFTS, MAX_KEYS, MAX_KEYS_HARD, type CommentBinding } from './commentKeyStore'

const BINDING: CommentBinding = { windowId: 1, panelId: 'html-preview-a', session: 7 }
const OTHER_WINDOW: CommentBinding = { ...BINDING, windowId: 2 }
const OTHER_PANEL: CommentBinding = { ...BINDING, panelId: 'html-preview-b' }
const OTHER_SESSION: CommentBinding = { ...BINDING, session: 8 }
const KEY_INVALID = { ok: false, code: ErrorCode.COMMENT_KEY_INVALID }

function clock(start = 1_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

/** A counter as the random source, so every token and key is distinct and predictable. */
function counterRandom() {
  let n = 0
  return (bytes: number): Uint8Array => {
    n += 1
    const out = new Uint8Array(bytes)
    out[bytes - 1] = n & 0xff
    out[bytes - 2] = (n >> 8) & 0xff
    return out
  }
}

describe('CommentKeyStore drafts', () => {
  it('M-051 a draft token is 128 random bits in lower-case hex', () => {
    const store = new CommentKeyStore<string>()
    const token = store.mintDraft(BINDING, 'draft')
    expect(token).toMatch(COMMENT_DRAFT_TOKEN_PATTERN)
    expect(store.mintDraft(BINDING, 'draft')).not.toBe(token)
  })

  it('M-051 a draft is single use: a claim puts it in flight, a write consumes it', () => {
    const store = new CommentKeyStore<string>()
    const token = store.mintDraft(BINDING, 'draft')
    expect(store.claimDraft(token, BINDING)).toEqual({ ok: true, value: 'draft' })
    // A second save of the same draft while the first runs.
    expect(store.claimDraft(token, BINDING)).toEqual(KEY_INVALID)
    store.settleDraft(token, true)
    expect(store.claimDraft(token, BINDING)).toEqual(KEY_INVALID)
    expect(store.size.drafts).toBe(0)
  })

  it('M-057 a refused save hands the draft back for the next try', () => {
    const store = new CommentKeyStore<string>()
    const token = store.mintDraft(BINDING, 'draft')
    store.claimDraft(token, BINDING)
    store.settleDraft(token, false)
    expect(store.claimDraft(token, BINDING)).toEqual({ ok: true, value: 'draft' })
    // Settling an unknown token is a no-op.
    expect(() => store.settleDraft('f'.repeat(32), true)).not.toThrow()
  })

  it('M-051 a draft lives ten minutes, then reads as expired', () => {
    const time = clock()
    const store = new CommentKeyStore<string>({ now: time.now })
    const token = store.mintDraft(BINDING, 'draft')
    time.advance(DRAFT_TTL_MS)
    const fresh = store.mintDraft(BINDING, 'fresh')
    time.advance(1)
    expect(store.claimDraft(token, BINDING)).toEqual({ ok: false, code: ErrorCode.COMMENT_DRAFT_EXPIRED })
    expect(store.claimDraft(fresh, BINDING).ok).toBe(true)
  })

  it('M-051 SEC-08 a draft of another window, panel or view session is invalid, without saying which', () => {
    const store = new CommentKeyStore<string>()
    const token = store.mintDraft(BINDING, 'draft')
    for (const foreign of [OTHER_WINDOW, OTHER_PANEL, OTHER_SESSION]) {
      expect(store.claimDraft(token, foreign)).toEqual(KEY_INVALID)
    }
    expect(store.claimDraft('0'.repeat(32), BINDING)).toEqual(KEY_INVALID)
    // The foreign attempts did not spend it.
    expect(store.claimDraft(token, BINDING).ok).toBe(true)
  })

  it('holds at most MAX_DRAFTS drafts, forgetting the oldest', () => {
    const store = new CommentKeyStore<number>({ random: counterRandom() })
    const first = store.mintDraft(BINDING, 0)
    for (let i = 1; i <= MAX_DRAFTS; i++) store.mintDraft(BINDING, i)
    expect(store.size.drafts).toBe(MAX_DRAFTS)
    expect(store.claimDraft(first, BINDING)).toEqual(KEY_INVALID)
  })

  it('L5 a draft whose save is running is never forgotten: its write still settles it', () => {
    const store = new CommentKeyStore<number>({ random: counterRandom() })
    const saving = store.mintDraft(BINDING, 0)
    expect(store.claimDraft(saving, BINDING).ok).toBe(true)
    const idle = store.mintDraft(BINDING, 1)
    for (let i = 2; i <= MAX_DRAFTS; i++) store.mintDraft(BINDING, i)
    expect(store.claimDraft(idle, BINDING)).toEqual(KEY_INVALID)
    store.settleDraft(saving, false)
    expect(store.claimDraft(saving, BINDING).ok).toBe(true)
  })
})

describe('CommentKeyStore keys', () => {
  const thread = { kind: 'thread', realPath: '/p/index.html', threadId: 'c-1' } as const

  it('M-053 a key is stable for the same target in the same binding, and fits the wire', () => {
    const store = new CommentKeyStore<never>()
    const key = store.keyFor(BINDING, thread)
    expect(store.keyFor(BINDING, { ...thread })).toBe(key)
    expect(key).toMatch(/^t[0-9a-f]{24}$/)
    expect(store.keyFor(BINDING, { kind: 'file', realPath: '/p/index.html' })).toMatch(/^f[0-9a-f]{24}$/)
    expect(store.keyFor(BINDING, { kind: 'block', realPath: '/p/index.html', rawHash: 'a'.repeat(64), start: 3 })).toMatch(
      /^b[0-9a-f]{24}$/
    )
    expect(store.resolve(BINDING, key, 'thread')).toEqual({ ok: true, value: thread })
  })

  it('M-053 two threads, two files and two identical damaged blocks at different starts get different keys', () => {
    const store = new CommentKeyStore<never>()
    const block = { kind: 'block', realPath: '/p/a.html', rawHash: 'a'.repeat(64) } as const
    const keys = [
      store.keyFor(BINDING, thread),
      store.keyFor(BINDING, { ...thread, threadId: 'c-2' }),
      store.keyFor(BINDING, { ...thread, realPath: '/p/b.html' }),
      store.keyFor(BINDING, { ...block, start: 1 }),
      store.keyFor(BINDING, { ...block, start: 2 })
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('M-053 SEC-08 a key of another binding or kind, or an unknown one, is invalid', () => {
    const store = new CommentKeyStore<never>()
    const key = store.keyFor(BINDING, thread)
    for (const foreign of [OTHER_WINDOW, OTHER_PANEL, OTHER_SESSION]) {
      expect(store.resolve(foreign, key, 'thread')).toEqual(KEY_INVALID)
    }
    expect(store.resolve(BINDING, key, 'file')).toEqual(KEY_INVALID)
    expect(store.resolve(BINDING, 'tdeadbeef', 'thread')).toEqual(KEY_INVALID)
    // Another binding's key for the same thread is a different key.
    expect(store.keyFor(OTHER_SESSION, thread)).not.toBe(key)
  })

  it('SEC-08 clear ends the view session: every draft and key is gone', () => {
    const store = new CommentKeyStore<string>()
    const token = store.mintDraft(BINDING, 'draft')
    const key = store.keyFor(BINDING, thread)
    store.clear()
    expect(store.size).toEqual({ drafts: 0, keys: 0 })
    expect(store.claimDraft(token, BINDING)).toEqual(KEY_INVALID)
    expect(store.resolve(BINDING, key, 'thread')).toEqual(KEY_INVALID)
    expect(store.keyFor(BINDING, thread)).not.toBe(key)
  })

  it('holds at most MAX_KEYS keys from earlier lists; a forgotten target gets a fresh key', () => {
    const store = new CommentKeyStore<never>({ random: counterRandom() })
    const first = store.keyFor(BINDING, { ...thread, threadId: 'first' })
    store.beginGeneration()
    for (let i = 0; i < MAX_KEYS; i++) store.keyFor(BINDING, { ...thread, threadId: `c-${i}` })
    expect(store.size.keys).toBe(MAX_KEYS)
    expect(store.resolve(BINDING, first, 'thread')).toEqual(KEY_INVALID)
    expect(store.keyFor(BINDING, { ...thread, threadId: 'first' })).not.toBe(first)
  })

  it('L5 every key of the current list stays valid, however long it is, up to MAX_KEYS_HARD', () => {
    const store = new CommentKeyStore<never>({ random: counterRandom() })
    store.beginGeneration()
    const first = store.keyFor(BINDING, { ...thread, threadId: 'first' })
    for (let i = 0; i < MAX_KEYS + 10; i++) store.keyFor(BINDING, { ...thread, threadId: `c-${i}` })
    expect(store.resolve(BINDING, first, 'thread').ok).toBe(true)
    for (let i = MAX_KEYS + 10; i < MAX_KEYS_HARD; i++) store.keyFor(BINDING, { ...thread, threadId: `c-${i}` })
    expect(store.size.keys).toBe(MAX_KEYS_HARD)
  })

  it('L5 a key the renderer used since the list began is spared; an unused one of an earlier list goes first', () => {
    const store = new CommentKeyStore<never>({ random: counterRandom() })
    const used = store.keyFor(BINDING, { ...thread, threadId: 'used' })
    const unused = store.keyFor(BINDING, { ...thread, threadId: 'unused' })
    store.beginGeneration()
    expect(store.resolve(BINDING, used, 'thread').ok).toBe(true)
    for (let i = 0; i < MAX_KEYS - 1; i++) store.keyFor(BINDING, { ...thread, threadId: `c-${i}` })
    expect(store.resolve(BINDING, used, 'thread').ok).toBe(true)
    expect(store.resolve(BINDING, unused, 'thread')).toEqual(KEY_INVALID)
  })
})
