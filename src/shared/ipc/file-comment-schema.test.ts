// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `file-comment:*` payload schemas (spec 024 architecture note 001 § 4, § 8
 * C17, C18): strict objects, a named cap on every new field, thread
 * operations by keys only, and the answers' shapes.
 */
import { describe, expect, it } from 'vitest'
import { SEL_CONTEXT_MAX_CHARS, SEL_EXACT_MAX_CHARS } from '../comments/anchorSel'
import { ANCHOR_ID_MAX_CHARS, ANCHOR_PATH_MAX_CHARS, TAG_MAX_CHARS } from '../comments/format'
import { ErrorCode } from '../errors'
import { PREVIEW_LIMITS } from '../preview-limits'
import { COMMENT_PATH_MAX_CHARS, CommentSaveResultSchema } from './comment-common-schema'
import {
  FILE_COMMENT_BUFFER_MAX_CHARS,
  FILE_COMMENT_LINE_MAX,
  FILE_COMMENT_ORDINAL_MAX,
  FileCommentChangedSchema,
  FileCommentListRequestSchema,
  FileCommentListResultSchema,
  FileCommentOpenDraftRequestSchema,
  FileCommentSaveRequestSchema,
  PickedTargetSchema
} from './file-comment-schema'
import { CommentSaveRequestSchema } from './preview-comment-schema'

const TARGET = { lineStart: 3, lineEnd: 4, tag: 'p', ordinal: 0 }
const VIEW = { w: 800, h: 600, dpr: 1, x: 0, y: 0 }
const ADD = { panelId: 'p', filePath: '/proj/a.md', op: 'add', draftToken: 'a'.repeat(32), target: TARGET, text: 'Hi', view: VIEW }
const REPLY = { panelId: 'p', op: 'reply', fileKey: 'f1', threadKey: 't1', rawHash: 'b'.repeat(64), text: 'Hi' }
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): boolean => schema.safeParse(value).success

describe('024-AC-028 item 5: every new field has a named cap', () => {
  it('filePath: COMMENT_PATH_MAX_CHARS, shared with the HTML schemas', () => {
    expect(ok(FileCommentOpenDraftRequestSchema, { panelId: 'p', filePath: 'x'.repeat(COMMENT_PATH_MAX_CHARS) })).toBe(true)
    expect(ok(FileCommentOpenDraftRequestSchema, { panelId: 'p', filePath: 'x'.repeat(COMMENT_PATH_MAX_CHARS + 1) })).toBe(false)
    expect(ok(FileCommentOpenDraftRequestSchema, { panelId: 'p', filePath: '' })).toBe(false)
  })

  it('bufferText: the comment file limit, in characters and in UTF-8 bytes', () => {
    expect(FILE_COMMENT_BUFFER_MAX_CHARS).toBe(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES)
    const request = (bufferText: string) => ({ panelId: 'p', filePath: '/a.md', bufferText })
    expect(ok(FileCommentListRequestSchema, request('a'.repeat(FILE_COMMENT_BUFFER_MAX_CHARS)))).toBe(true)
    expect(ok(FileCommentListRequestSchema, request('a'.repeat(FILE_COMMENT_BUFFER_MAX_CHARS + 1)))).toBe(false)
    // Fewer characters than the cap, more bytes than the file limit
    expect(ok(FileCommentListRequestSchema, request('é'.repeat(FILE_COMMENT_BUFFER_MAX_CHARS / 2 + 1)))).toBe(false)
  })

  it('target: lines, ordinal, tag, id, path and quote are each capped', () => {
    expect(ok(PickedTargetSchema, TARGET)).toBe(true)
    expect(ok(PickedTargetSchema, { ...TARGET, lineStart: 0 })).toBe(false)
    expect(ok(PickedTargetSchema, { ...TARGET, lineEnd: FILE_COMMENT_LINE_MAX + 1 })).toBe(false)
    expect(ok(PickedTargetSchema, { ...TARGET, ordinal: FILE_COMMENT_ORDINAL_MAX + 1 })).toBe(false)
    expect(ok(PickedTargetSchema, { ...TARGET, ordinal: 1.5 })).toBe(false)
    expect(ok(PickedTargetSchema, { ...TARGET, tag: 'p'.repeat(TAG_MAX_CHARS + 1) })).toBe(false)
    expect(ok(PickedTargetSchema, { ...TARGET, id: 'i'.repeat(ANCHOR_ID_MAX_CHARS + 1) })).toBe(false)
    expect(ok(PickedTargetSchema, { ...TARGET, path: 'x'.repeat(ANCHOR_PATH_MAX_CHARS + 1) })).toBe(false)
    expect(ok(PickedTargetSchema, { ...TARGET, baseHash: 'not-a-hash' })).toBe(false)
    const quote = (exact: string) => ({ ...TARGET, quote: { exact, prefix: '', suffix: '' } })
    expect(ok(PickedTargetSchema, quote('q'.repeat(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS)))).toBe(true)
    expect(ok(PickedTargetSchema, quote('q'.repeat(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS + 1)))).toBe(false)
    expect(ok(PickedTargetSchema, { ...TARGET, lineStart: 5, lineEnd: 4 })).toBe(false)
  })

  it('sel: anchor.sel\'s caps, in code points', () => {
    const add = (sel: unknown) => ({ ...ADD, sel })
    expect(ok(FileCommentSaveRequestSchema, add({ exact: '😀'.repeat(SEL_EXACT_MAX_CHARS), prefix: '', suffix: '' }))).toBe(true)
    expect(ok(FileCommentSaveRequestSchema, add({ exact: 'w'.repeat(SEL_EXACT_MAX_CHARS + 1), prefix: '', suffix: '' }))).toBe(false)
    expect(ok(FileCommentSaveRequestSchema, add({ exact: 'w', prefix: 'p'.repeat(SEL_CONTEXT_MAX_CHARS + 1), suffix: '' }))).toBe(false)
    expect(ok(FileCommentSaveRequestSchema, add({ exact: '', prefix: '', suffix: '' }))).toBe(false)
  })

  it('stamp: a safe whole number', () => {
    expect(ok(FileCommentChangedSchema, { panelId: 'p', filePath: '/a.md', stamp: 1 })).toBe(true)
    expect(ok(FileCommentChangedSchema, { panelId: 'p', filePath: '/a.md', stamp: -1 })).toBe(false)
    expect(ok(FileCommentChangedSchema, { panelId: 'p', filePath: '/a.md', stamp: Number.MAX_SAFE_INTEGER + 2 })).toBe(false)
  })
})

describe('024-AC-028 item 4: an add names a draft token; thread operations name keys only', () => {
  it('accepts an add and a reply', () => {
    expect(ok(FileCommentSaveRequestSchema, ADD)).toBe(true)
    expect(ok(FileCommentSaveRequestSchema, REPLY)).toBe(true)
  })

  it.each([
    ['an add without a draft token', { ...ADD, draftToken: undefined }],
    ['an add with an author', { ...ADD, author: 'Eve' }],
    ['a thread op with a path', { ...REPLY, filePath: '/proj/a.md' }],
    ['a thread op with an offset', { ...REPLY, offset: 10 }],
    ['a thread op with a draft token', { ...REPLY, draftToken: 'a'.repeat(32) }]
  ])('refuses %s', (_name, value) => {
    expect(ok(FileCommentSaveRequestSchema, value)).toBe(false)
  })

  it('shares the thread operations with the HTML family', () => {
    expect(ok(CommentSaveRequestSchema, REPLY)).toBe(true)
  })
})

describe('answers', () => {
  it('a save answer may carry a reason next to its code (C-19), never an unknown one', () => {
    expect(ok(CommentSaveResultSchema, { ok: false, code: ErrorCode.COMMENT_RENDER_CHANGED, reason: 'render-changed' })).toBe(true)
    expect(ok(CommentSaveResultSchema, { ok: false, code: ErrorCode.COMMENT_WRITE_FAILED })).toBe(true)
    expect(ok(CommentSaveResultSchema, { ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'C:\\secret' })).toBe(false)
  })

  it('a list answer is strict, with placements by key', () => {
    const file = { fileKey: 'f1', displayPath: 'a.md', filePath: '/a.md', frame: false, writable: true, threads: [], damaged: [], newer: [] }
    expect(ok(FileCommentListResultSchema, { ok: true, file, placements: [{ threadKey: 't1', line: 3, tag: 'p' }] })).toBe(true)
    expect(ok(FileCommentListResultSchema, { ok: true, file, placements: [{ threadKey: 't1', line: 0, tag: 'p' }] })).toBe(false)
    expect(ok(FileCommentListResultSchema, { ok: true, file, placements: [], text: 'x' })).toBe(false)
  })
})
