// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The C-07 and C-03 wire fields, in both channel families (spec 024
 * 024-NFR-005; comments-v2 C-07 "Narrow to words" on Edit, C-03 kind nouns):
 * the edit's optional `sel`, a thread's words and place, a placement's place.
 * Every field is optional and strict – an unknown key or an out-of-range
 * value is refused.
 */
import { describe, expect, it } from 'vitest'
import { COMMENT_PLACE_INDEX_MAX, COMMENT_WORDS_TEXT_MAX_CHARS, CommentThreadViewSchema, CommentTargetPlaceSchema } from './comment-common-schema'
import { FileCommentSaveRequestSchema, ThreadPlacementSchema } from './file-comment-schema'
import { CommentSaveRequestSchema } from './preview-comment-schema'

const KEY = 'k'.repeat(32)
const HASH = 'a'.repeat(64)
const EDIT = { panelId: 'preview-1', fileKey: KEY, threadKey: KEY, rawHash: HASH, op: 'editMessage', messageId: 'm-aaaaaaaaaaaaaaaa', text: 'Edited.' }
const SEL = { exact: 'ten customers', prefix: 'beta to ', suffix: ' by' }
const THREAD = {
  threadKey: KEY,
  rawHash: HASH,
  status: 'open',
  line: 3,
  tag: 'p',
  classes: [],
  attached: true,
  notVisible: false,
  messages: [{ id: 'm-aaaaaaaaaaaaaaaa', by: { name: 'Ada' }, at: '2026-10-25T14:03:00Z', text: 'Please look.' }]
}

describe('024-AC-028 C-07 editMessage carries optional words in both families', () => {
  it.each([
    ['the HTML Preview', CommentSaveRequestSchema],
    ['a renderer-hosted preview', FileCommentSaveRequestSchema]
  ])('024-AC-028 C-07 %s: absent, words or null (the whole target) are accepted', (_name, schema) => {
    expect(schema.safeParse(EDIT).success).toBe(true)
    expect(schema.safeParse({ ...EDIT, sel: SEL }).success).toBe(true)
    expect(schema.safeParse({ ...EDIT, sel: null }).success).toBe(true)
  })

  it.each([
    ['an unknown key in sel', { ...SEL, start: 3 }],
    ['empty words', { ...SEL, exact: '' }],
    ['words past 200 code points', { ...SEL, exact: 'x'.repeat(201) }],
    ['a context past 32 code points', { ...SEL, prefix: 'x'.repeat(33) }],
    ['a string', 'ten customers']
  ])('024-AC-028 C-07 refuses %s', (_name, sel) => {
    expect(CommentSaveRequestSchema.safeParse({ ...EDIT, sel }).success).toBe(false)
    expect(FileCommentSaveRequestSchema.safeParse({ ...EDIT, sel }).success).toBe(false)
  })

  it('024-AC-028 C-07 words stay on editMessage: a reply naming sel is refused', () => {
    const reply = { panelId: 'preview-1', fileKey: KEY, threadKey: KEY, rawHash: HASH, op: 'reply', text: 'x', sel: SEL }
    expect(CommentSaveRequestSchema.safeParse(reply).success).toBe(false)
  })
})

describe('024-AC-028 C-07 C-03 a thread view carries its words and its place', () => {
  it('024-AC-028 C-07 the words are a range inside a capped text', () => {
    expect(CommentThreadViewSchema.safeParse({ ...THREAD, words: { text: 'abc', start: 0, end: 2, cut: false } }).success).toBe(true)
    expect(CommentThreadViewSchema.safeParse({ ...THREAD, words: { text: 'abc', start: 2, end: 9, cut: false } }).success).toBe(false)
    const long = 'x'.repeat(COMMENT_WORDS_TEXT_MAX_CHARS + 1)
    expect(CommentThreadViewSchema.safeParse({ ...THREAD, words: { text: long, start: 0, end: 0, cut: false } }).success).toBe(false)
  })

  it.each([
    [{ kind: 'row', row: 2 }],
    [{ kind: 'header-row' }],
    [{ kind: 'cell', row: 2, column: 3 }],
    [{ kind: 'header-cell', column: 1 }],
    [{ kind: 'diagram' }]
  ])('024-AC-028 C-03 accepts the place %j on a thread and on a placement', place => {
    expect(CommentThreadViewSchema.safeParse({ ...THREAD, place }).success).toBe(true)
    expect(ThreadPlacementSchema.safeParse({ threadKey: KEY, line: 3, tag: 'tr', place }).success).toBe(true)
  })

  it.each([
    ['row 0', { kind: 'row', row: 0 }],
    ['a row past the cap', { kind: 'row', row: COMMENT_PLACE_INDEX_MAX + 1 }],
    ['a cell without its column', { kind: 'cell', row: 2 }],
    ['a header row with a number', { kind: 'header-row', row: 1 }],
    ['an unknown kind', { kind: 'column', column: 2 }],
    ['a fraction', { kind: 'row', row: 1.5 }]
  ])('024-AC-028 C-03 refuses %s', (_name, place) => {
    expect(CommentTargetPlaceSchema.safeParse(place).success).toBe(false)
    expect(CommentThreadViewSchema.safeParse({ ...THREAD, place }).success).toBe(false)
  })
})
