// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments' IPC schemas and channel names
 * (docs/designs/comments/html-preview-comments.md §8; I-001 – I-005).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../errors'
import { PREVIEW_LIMITS } from '../preview-limits'
import { PreviewChannels, PreviewEvents } from './preview-channels'
import {
  PreviewCommentChannels,
  PreviewCommentEvents,
  PreviewCommentPageChannels
} from './preview-comment-channels'
import {
  CommentAckSchema,
  CommentAnchorsSchema,
  CommentAnchorStatusSchema,
  CommentCommandRequestSchema,
  CommentDraftOpenedSchema,
  CommentFileViewSchema,
  CommentHelloSchema,
  CommentListResultSchema,
  CommentModeChangedSchema,
  CommentPanelRequestSchema,
  CommentPickSchema,
  CommentSaveRequestSchema,
  CommentSaveResultSchema,
  CommentSaveSettledSchema,
  CommentSetModeRequestSchema,
  CommentSetModeResultSchema,
  CommentsChangedSchema,
  CommentUnsavedSourcesRequestSchema,
  COMMENT_ANCHOR_KEYS_MAX,
  COMMENT_KEY_MAX_CHARS,
  COMMENT_UNSAVED_SOURCES_MAX
} from './preview-comment-schema'

const PANEL = 'html-preview-/p/index.html'
const DRAFT = 'a'.repeat(32)
const HASH = 'b'.repeat(64)
const KEY = 't0123456789abcdef01234567'
const MESSAGE = 'm-abcdefghijklmnop'
const VIEW = { w: 800, h: 600, dpr: 2, x: 0, y: 120 }

const thread = { panelId: PANEL, fileKey: 'f1', threadKey: KEY, rawHash: HASH }

const VALID_SAVES = [
  { panelId: PANEL, op: 'add', draftToken: DRAFT, text: 'Make this bigger' },
  { ...thread, op: 'reply', text: 'Done' },
  { ...thread, op: 'editMessage', messageId: MESSAGE, text: 'Edited' },
  { ...thread, op: 'deleteMessage', messageId: MESSAGE },
  { ...thread, op: 'setStatus', status: 'resolved' },
  { ...thread, op: 'deleteThread' },
  { panelId: PANEL, op: 'deleteBlock', fileKey: 'f1', blockKey: 'b1', rawHash: HASH }
]

function fileView() {
  return {
    fileKey: 'f1',
    displayPath: 'index.html',
    filePath: '/p/index.html',
    frame: false,
    writable: true,
    threads: [
      {
        threadKey: KEY,
        rawHash: HASH,
        status: 'open',
        line: 3,
        tag: 'button',
        classes: ['cta'],
        attached: true,
        notVisible: false,
        messages: [{ id: MESSAGE, by: { name: 'Ada', email: 'ada@example.com' }, at: '2026-10-26T06:00:00Z', text: 'Hi' }]
      }
    ],
    damaged: [{ blockKey: 'b1', rawHash: HASH, reason: 'bad-json', line: 9, raw: '<!-- erfana:comment … -->' }],
    newer: [{ blockKey: 'b2', version: 2, line: 12 }]
  }
}

describe('I-001 valid requests parse', () => {
  it('every renderer request', () => {
    expect(CommentSetModeRequestSchema.safeParse({ panelId: PANEL, on: true, showIcons: false }).success).toBe(true)
    expect(CommentPanelRequestSchema.safeParse({ panelId: PANEL }).success).toBe(true)
    expect(CommentCommandRequestSchema.safeParse({ panelId: PANEL, command: 'reveal', threadKey: KEY }).success).toBe(true)
    expect(CommentUnsavedSourcesRequestSchema.safeParse({ paths: ['/p/index.html'] }).success).toBe(true)
    for (const save of VALID_SAVES) expect(CommentSaveRequestSchema.safeParse(save).success, save.op).toBe(true)
  })

  it('every page signal', () => {
    expect(CommentHelloSchema.safeParse({}).success).toBe(true)
    expect(CommentPickSchema.safeParse({ kind: 'menu', via: 'pointer', token: 'abcdefghijk2', tag: 'button', screen: { x: 10, y: 20 }, view: VIEW }).success).toBe(true)
    expect(CommentPickSchema.safeParse({ kind: 'icon', via: 'pointer', key: 'p1', view: VIEW }).success).toBe(true)
    expect(CommentPickSchema.safeParse({ kind: 'exit', via: 'keyboard', view: VIEW }).success).toBe(true)
    expect(
      CommentPickSchema.safeParse({
        kind: 'open',
        via: 'keyboard',
        token: 'abcdefghijk2',
        tag: 'ul',
        point: { x: 4, y: 4 },
        box: { x: 0, y: 0, w: 100, h: 20 },
        ws: 'preserve',
        runtime: { path: 'li:nth-of-type(2) > a:nth-of-type(1)', tag: 'a', quote: { exact: 'Buy', prefix: '', suffix: '' }, snapshot: '<a>Buy</a>' },
        view: { ...VIEW, hash: '#top' }
      }).success
    ).toBe(true)
    expect(CommentAnchorsSchema.safeParse({ visible: ['p1'], hidden: [], overlay: 'unavailable', reason: 'overlay-removed' }).success).toBe(true)
  })
})

describe('I-002 strict objects, capped text, no author and no path in a save', () => {
  it('refuses unknown keys everywhere – an author or a path rides nowhere', () => {
    expect(CommentSaveRequestSchema.safeParse({ ...VALID_SAVES[0], author: { name: 'Mallory' } }).success).toBe(false)
    expect(CommentSaveRequestSchema.safeParse({ ...VALID_SAVES[1], filePath: '/etc/passwd' }).success).toBe(false)
    expect(CommentSetModeRequestSchema.safeParse({ panelId: PANEL, on: true, showIcons: true, extra: 1 }).success).toBe(false)
    expect(CommentPanelRequestSchema.safeParse({ panelId: PANEL, windowId: 2 }).success).toBe(false)
    expect(CommentHelloSchema.safeParse({ url: 'x' }).success).toBe(false)
  })

  it('caps text, keys, ids and lists', () => {
    const max = PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS
    const add = (text: string) => CommentSaveRequestSchema.safeParse({ ...VALID_SAVES[0], text }).success
    expect(add('x'.repeat(max))).toBe(true)
    expect(add('x'.repeat(max + 1))).toBe(false)
    // Counted in code points: an astral character is one, not two.
    expect(add('😀'.repeat(max))).toBe(true)
    expect(add('   ')).toBe(false)
    expect(add('')).toBe(false)
    expect(CommentSaveRequestSchema.safeParse({ ...VALID_SAVES[0], draftToken: 'A'.repeat(32) }).success).toBe(false)
    expect(CommentSaveRequestSchema.safeParse({ ...VALID_SAVES[1], threadKey: 'x'.repeat(COMMENT_KEY_MAX_CHARS + 1) }).success).toBe(false)
    expect(CommentSaveRequestSchema.safeParse({ ...VALID_SAVES[1], threadKey: '../t1' }).success).toBe(false)
    expect(CommentSaveRequestSchema.safeParse({ ...VALID_SAVES[2], messageId: 'm-1' }).success).toBe(false)
    expect(CommentSaveRequestSchema.safeParse({ ...VALID_SAVES[1], rawHash: 'B'.repeat(64) }).success).toBe(false)
    expect(CommentSaveRequestSchema.safeParse({ ...VALID_SAVES[4], status: 'wontfix' }).success).toBe(false)
    expect(CommentSaveRequestSchema.safeParse({ ...VALID_SAVES[0], op: 'rename' }).success).toBe(false)
    const paths = Array.from({ length: COMMENT_UNSAVED_SOURCES_MAX + 1 }, (_, i) => `/p/${i}.html`)
    expect(CommentUnsavedSourcesRequestSchema.safeParse({ paths }).success).toBe(false)
    expect(CommentUnsavedSourcesRequestSchema.safeParse({ paths: ['/p/'.padEnd(5_000, 'x')] }).success).toBe(false)
    expect(CommentPanelRequestSchema.safeParse({ panelId: 'p'.repeat(257) }).success).toBe(false)
  })
})

describe('I-003 page signals: enums and bounded finite numbers only', () => {
  const pick = (patch: Record<string, unknown>) =>
    CommentPickSchema.safeParse({ kind: 'menu', via: 'pointer', token: 'abcdefghijk2', view: VIEW, ...patch }).success

  it('refuses NaN, Infinity, negatives where none fit, 1e308 and long strings', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e308]) {
      expect(pick({ screen: { x: bad, y: 0 } }), String(bad)).toBe(false)
      expect(pick({ view: { ...VIEW, y: bad } }), String(bad)).toBe(false)
    }
    expect(pick({ view: { ...VIEW, w: -1 } })).toBe(false)
    expect(pick({ view: { ...VIEW, w: 1.5 } })).toBe(false)
    expect(pick({ view: { ...VIEW, dpr: 0 } })).toBe(false)
    expect(pick({ box: { x: 0, y: 0, w: -1, h: 1 } })).toBe(false)
    expect(pick({ view: { ...VIEW, hash: 'top' } })).toBe(false)
    expect(pick({ view: { ...VIEW, hash: '#'.padEnd(5_000, 'x') } })).toBe(false)
  })

  it('refuses a bad enum, token, tag, runtime path or snapshot', () => {
    expect(pick({ kind: 'write' })).toBe(false)
    expect(pick({ via: 'script' })).toBe(false)
    expect(pick({ token: 'ABCDEFGHIJKL' })).toBe(false)
    expect(pick({ tag: '<img onerror>' })).toBe(false)
    expect(pick({ tag: 'x'.repeat(200) })).toBe(false)
    expect(pick({ runtime: { path: 'div > script', tag: 'div' } })).toBe(false)
    expect(pick({ runtime: { path: '', tag: 'div', snapshot: 'é'.repeat(PREVIEW_LIMITS.COMMENT_SNAPSHOT_MAX_BYTES) } })).toBe(false)
    expect(pick({ token: undefined, runtime: { path: '', tag: 'div' } })).toBe(false)
    expect(CommentPickSchema.safeParse({ kind: 'icon', via: 'pointer', view: VIEW }).success).toBe(false)
    expect(CommentPickSchema.safeParse({ kind: 'menu', via: 'pointer', view: VIEW, filePath: '/etc/passwd' }).success).toBe(false)
  })

  it('E-022 S-L-A a keyboard-picker step says what it reached – an element by token, never by text – and only a step says anything', () => {
    const step = (patch: Record<string, unknown>) => CommentPickSchema.safeParse({ kind: 'step', via: 'keyboard', view: VIEW, ...patch }).success
    const token = 'abcdefghijkl'
    expect(step({ say: 'showing', token })).toBe(true)
    expect(step({ say: 'showing', token, added: true })).toBe(true)
    expect(step({ say: 'top' })).toBe(true)
    expect(step({ say: 'no-child' })).toBe(true)
    expect(step({})).toBe(false)
    expect(step({ say: 'showing' })).toBe(false)
    expect(step({ say: 'showing', token, label: 'p#team-copy' })).toBe(false)
    expect(step({ say: 'top', token })).toBe(false)
    expect(step({ say: 'top', added: true })).toBe(false)
    expect(step({ say: 'showing', token, added: false })).toBe(false)
    expect(step({ say: 'Showing anything a page likes.' })).toBe(false)
    expect(pick({ say: 'top' })).toBe(false)
    expect(pick({ added: true })).toBe(false)
    expect(pick({ label: 'p' })).toBe(false)
  })

  it('caps an anchors report', () => {
    const keys = Array.from({ length: COMMENT_ANCHOR_KEYS_MAX + 1 }, (_, i) => `p${i}`)
    expect(CommentAnchorsSchema.safeParse({ visible: keys, hidden: [] }).success).toBe(false)
    expect(CommentAnchorsSchema.safeParse({ visible: [], hidden: [], overlay: 'gone' }).success).toBe(false)
    expect(CommentAnchorsSchema.safeParse({ visible: [], hidden: [], reason: 'other' }).success).toBe(false)
  })
})

describe('I-004 event and answer schemas', () => {
  it('the list, file and thread views', () => {
    expect(CommentFileViewSchema.safeParse(fileView()).success).toBe(true)
    expect(CommentListResultSchema.safeParse({ ok: true, files: [fileView()], unavailable: 'page-too-large' }).success).toBe(true)
    expect(CommentListResultSchema.safeParse({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID }).success).toBe(true)
    expect(CommentListResultSchema.safeParse({ ok: true, files: [{ ...fileView(), threads: [{ ...fileView().threads[0], messages: [] }] }] }).success).toBe(false)
    expect(CommentListResultSchema.safeParse({ ok: false, code: 'NOT_A_CODE' }).success).toBe(false)
  })

  it('§19 Rev 4 a list may say how many files it left out: a whole number, at least one', () => {
    expect(CommentListResultSchema.safeParse({ ok: true, files: [fileView()], unread: 2 }).success).toBe(true)
    for (const unread of [0, -1, 1.5, '2', null]) {
      expect(CommentListResultSchema.safeParse({ ok: true, files: [], unread }).success).toBe(false)
    }
  })

  it('a thread\'s stored quote: one bounded line, its invisible and bidi characters escaped, never raw', () => {
    const withQuote = (quote: string) => ({ ...fileView(), threads: [{ ...fileView().threads[0], quote }] })
    expect(CommentFileViewSchema.safeParse(withQuote('Buy now \\u202e')).success).toBe(true)
    expect(CommentFileViewSchema.safeParse(withQuote('x'.repeat(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS))).success).toBe(true)
    for (const refused of [
      '',
      'x'.repeat(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS + 1),
      `Buy ${String.fromCodePoint(0x202e)}now`,
      `zero${String.fromCodePoint(0x200b)}width`,
      'two\nlines',
      `bell${String.fromCodePoint(0x07)}`
    ]) {
      expect(CommentFileViewSchema.safeParse(withQuote(refused)).success, JSON.stringify(refused)).toBe(false)
    }
  })

  it('draft-opened, both shapes, and nothing a page could name', () => {
    const base = { panelId: PANEL, point: { x: 10, y: 20 }, displayPath: 'index.html', filePath: '/p/index.html', frame: false, fileKey: 'f1' }
    const target = { tag: 'button', classes: [], line: 7, excerpt: '<button id="buy">' }
    const ELEMENT = 'c'.repeat(32)
    const draft = { draftToken: DRAFT, draftKey: ELEMENT, target }
    expect(CommentDraftOpenedSchema.safeParse({ ...base, kind: 'menu', ...draft }).success).toBe(true)
    // No draft: no token, no key, no target – and no reason (L3).
    expect(CommentDraftOpenedSchema.safeParse({ ...base, kind: 'open' }).success).toBe(true)
    expect(CommentDraftOpenedSchema.safeParse({ ...base, kind: 'open', code: ErrorCode.COMMENT_TARGET_MOVED }).success).toBe(false)
    const icon = { ...base, kind: 'icon', threadKeys: [KEY], blockKeys: [] }
    expect(CommentDraftOpenedSchema.safeParse(icon).success).toBe(true)
    // "New comment" from a pin: a draft as a menu carries one, with its element key and its target.
    expect(CommentDraftOpenedSchema.safeParse({ ...icon, ...draft }).success).toBe(true)
    expect(CommentDraftOpenedSchema.safeParse({ ...icon, ...draft, draftToken: DRAFT.toUpperCase() }).success).toBe(false)
    expect(CommentDraftOpenedSchema.safeParse({ ...icon, ...draft, draftToken: 'a'.repeat(31) }).success).toBe(false)
    expect(CommentDraftOpenedSchema.safeParse({ ...icon, code: ErrorCode.COMMENT_TARGET_MOVED }).success).toBe(false)
    expect(CommentDraftOpenedSchema.safeParse({ ...base, kind: 'menu', realPath: '/real' }).success).toBe(false)
    // L3: the unsaved-source flag is gone from both shapes.
    expect(CommentDraftOpenedSchema.safeParse({ ...base, kind: 'menu', ...draft, unsavedSource: false }).success).toBe(false)
    expect(CommentDraftOpenedSchema.safeParse({ ...icon, ...draft, unsavedSource: true }).success).toBe(false)
  })

  it('M1 a draft comes with its opaque element key and its target, all three or none', () => {
    const base = { panelId: PANEL, point: { x: 10, y: 20 }, displayPath: 'index.html', filePath: '/p/index.html', frame: false, fileKey: 'f1', kind: 'menu' }
    const target = { tag: 'div', classes: [], line: 2, excerpt: '<div>' }
    const ELEMENT = 'c'.repeat(32)
    expect(CommentDraftOpenedSchema.safeParse({ ...base, draftToken: DRAFT, target }).success).toBe(false)
    expect(CommentDraftOpenedSchema.safeParse({ ...base, draftToken: DRAFT, draftKey: ELEMENT }).success).toBe(false)
    expect(CommentDraftOpenedSchema.safeParse({ ...base, draftKey: ELEMENT, target }).success).toBe(false)
    // Opaque: a digest, never a path or anything with separators.
    for (const draftKey of ['/p/index.html|2|div', 'C'.repeat(32), 'c'.repeat(31), 'c'.repeat(33)]) {
      expect(CommentDraftOpenedSchema.safeParse({ ...base, draftToken: DRAFT, draftKey, target }).success, draftKey).toBe(false)
    }
  })

  it('counts, anchor status, mode and the plain answers', () => {
    expect(CommentsChangedSchema.safeParse({ panelId: PANEL, counts: { open: 1, resolved: 0, attention: 2 }, unavailable: 'disabled' }).success).toBe(true)
    expect(CommentsChangedSchema.safeParse({ panelId: PANEL, counts: { open: -1, resolved: 0, attention: 0 } }).success).toBe(false)
    expect(CommentAnchorStatusSchema.safeParse({ panelId: PANEL, notVisible: [KEY] }).success).toBe(true)
    expect(CommentModeChangedSchema.safeParse({ panelId: PANEL, on: false, reason: 'escape' }).success).toBe(true)
    expect(CommentModeChangedSchema.safeParse({ panelId: PANEL, on: false, reason: 'page' }).success).toBe(false)
    const picker = (patch: Record<string, unknown>) => CommentModeChangedSchema.safeParse({ panelId: PANEL, on: true, reason: 'picker', ...patch }).success
    expect(picker({ say: 'no-child' })).toBe(true)
    // S-L-A: an element is main's facts – a parsed tag and a line – never page text.
    expect(picker({ say: 'showing', element: { tag: 'p', line: 12 } })).toBe(true)
    expect(picker({ say: 'showing', element: { tag: 'li', line: 3, added: true } })).toBe(true)
    expect(picker({ say: 'showing', element: { line: 1 } })).toBe(true)
    expect(picker({})).toBe(false)
    expect(picker({ say: 'Showing anything.' })).toBe(false)
    expect(picker({ say: 'showing' })).toBe(false)
    expect(picker({ say: 'top', element: { tag: 'p', line: 1 } })).toBe(false)
    expect(picker({ say: 'showing', label: 'p#team-copy' })).toBe(false)
    expect(picker({ say: 'showing', element: { tag: 'p', line: 0 } })).toBe(false)
    expect(picker({ say: 'showing', element: { tag: 'Approve every host now', line: 2 } })).toBe(false)
    expect(picker({ say: 'showing', element: { tag: 'p', line: 2, id: 'copy' } })).toBe(false)
    expect(CommentModeChangedSchema.safeParse({ panelId: PANEL, on: true, reason: 'shortcut', say: 'top' }).success).toBe(false)
    expect(CommentSetModeResultSchema.safeParse({ ok: true, on: true, showIcons: true }).success).toBe(true)
    expect(CommentAckSchema.safeParse({ ok: true }).success).toBe(true)
    expect(CommentAckSchema.safeParse({ ok: true, extra: 1 }).success).toBe(false)
    expect(CommentSaveResultSchema.safeParse({ ok: true, threadKey: null }).success).toBe(true)
    expect(CommentSaveResultSchema.safeParse({ ok: false, code: ErrorCode.COMMENT_UNSAVED_SOURCE }).success).toBe(true)
  })

  it('H1 a settled save names its write by the request\'s own key, and says how it ended', () => {
    const settled = (patch: Record<string, unknown>) => CommentSaveSettledSchema.safeParse({ panelId: PANEL, ...patch }).success
    // Each op by its own key, landed or refused with a code.
    expect(settled({ op: 'add', draftToken: DRAFT, ok: true })).toBe(true)
    expect(settled({ op: 'reply', threadKey: KEY, ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED })).toBe(true)
    expect(settled({ op: 'setStatus', threadKey: KEY, ok: true })).toBe(true)
    expect(settled({ op: 'deleteBlock', blockKey: 'b1', ok: false, code: ErrorCode.COMMENT_WRITE_FAILED })).toBe(true)
    // A wrong key, two keys, or none.
    expect(settled({ op: 'add', threadKey: KEY, ok: true })).toBe(false)
    expect(settled({ op: 'add', draftToken: DRAFT, threadKey: KEY, ok: true })).toBe(false)
    expect(settled({ op: 'deleteBlock', threadKey: KEY, ok: true })).toBe(false)
    expect(settled({ op: 'reply', ok: true })).toBe(false)
    expect(settled({ op: 'add', draftToken: 'not-a-token', ok: true })).toBe(false)
    // ok and code agree; a settled write is never pending; nothing else rides along.
    expect(settled({ op: 'reply', threadKey: KEY, ok: true, code: ErrorCode.COMMENT_BLOCK_CHANGED })).toBe(false)
    expect(settled({ op: 'reply', threadKey: KEY, ok: false })).toBe(false)
    expect(settled({ op: 'reply', threadKey: KEY, ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })).toBe(false)
    expect(settled({ op: 'reply', threadKey: KEY, ok: true, text: 'Done' })).toBe(false)
    expect(settled({ op: 'publish', threadKey: KEY, ok: true })).toBe(false)
  })
})

describe('I-005 channel names', () => {
  const comment = [
    ...Object.values(PreviewCommentChannels),
    ...Object.values(PreviewCommentEvents),
    ...Object.values(PreviewCommentPageChannels)
  ]

  it('are unique, and none is one of the preview channels', () => {
    expect(new Set(comment).size).toBe(comment.length)
    const preview = new Set<string>([...Object.values(PreviewChannels), ...Object.values(PreviewEvents)])
    for (const name of comment) expect(preview.has(name), name).toBe(false)
  })

  it('renderer channels are preview:, page channels preview-page:', () => {
    for (const name of [...Object.values(PreviewCommentChannels), ...Object.values(PreviewCommentEvents)]) {
      expect(name).toMatch(/^preview:comments?[A-Z]\w+$/)
    }
    for (const name of Object.values(PreviewCommentPageChannels)) expect(name).toMatch(/^preview-page:comment[A-Z]\w+$/)
  })

  it('docs/ipc-patterns.md lists every one of them', () => {
    const doc = readFileSync(join(__dirname, '../../../docs/ipc-patterns.md'), 'utf8')
    for (const name of comment) expect(doc, name).toContain(`\`${name}\``)
  })
})
