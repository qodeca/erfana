// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:commentSave` for one view (docs/designs/comments/html-preview-comments.md
 * §7.5, §7.6; M-051, M-053, M-056, M-057, SEC-08).
 */
import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import type { CommentSaveRequest } from '../../../shared/ipc/preview-comment-schema'
import type { CommentWriteResult } from './CommentWriter'
import type { CommentDraft } from '../preview/comments/commentDraftBuilder'
import { CommentKeyStore, type CommentBinding } from './commentKeyStore'
import { createCommentSaveFlow } from './commentSaveFlow'
import { frameFile } from '../preview/comments/__test-helpers__/commentServiceHarness'

vi.mock('../LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const BINDING: CommentBinding = { windowId: 1, panelId: 'panel', session: 1 }
const PAGE = '/p/index.html'
const HASH = 'a'.repeat(64)
const SCROLL = { x: 0, y: 10, hash: '' }

const draft = (overrides: Partial<CommentDraft> = {}): CommentDraft => ({
  realRoot: '/p',
  realPath: PAGE,
  file: frameFile(PAGE),
  frame: false,
  offset: 10,
  fileHash: 'h0',
  anchor: { tag: 'button', path: '' } as unknown as CommentDraft['anchor'],
  view: { w: 800, h: 600, dpr: 1, x: 0, y: 0 },
  pageRealPath: PAGE,
  ...overrides
})

const wrote = (threadId: string | null = 'c-new'): CommentWriteResult =>
  ({ ok: true, realPath: PAGE, fileHash: 'h1', threadId }) as unknown as CommentWriteResult

function flow(result: Promise<CommentWriteResult> | (() => Promise<CommentWriteResult>) = Promise.resolve(wrote()), timeoutMs?: number) {
  const keys = new CommentKeyStore<CommentDraft>()
  const next = typeof result === 'function' ? result : () => result
  const writer = { add: vi.fn(next), changeThread: vi.fn(next), deleteDamagedBlock: vi.fn(next) }
  const landed = vi.fn()
  const lateSettled = vi.fn()
  const captureScroll = vi.fn(async () => SCROLL)
  const save = createCommentSaveFlow({
    binding: BINDING,
    realRoot: '/p',
    keys,
    writer,
    captureScroll,
    currentPage: () => PAGE,
    landed,
    lateSettled,
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  })
  return { keys, writer, landed, lateSettled, captureScroll, save }
}

describe('commentSaveFlow add', () => {
  it('M-051 claims the draft, writes once, consumes it on success and arms the reload', async () => {
    const f = flow()
    const token = f.keys.mintDraft(BINDING, draft({ ws: 'collapse' }))
    const result = await f.save({ panelId: 'panel', op: 'add', draftToken: token, text: 'Hi' })
    expect(result).toMatchObject({ ok: true, threadKey: expect.stringMatching(/^t/) })
    expect(f.writer.add).toHaveBeenCalledWith({
      file: { realRoot: '/p', filePath: PAGE },
      draft: { offset: 10, fileHash: 'h0', anchor: draft().anchor, ws: 'collapse' },
      view: draft().view,
      text: 'Hi'
    })
    expect(f.landed).toHaveBeenCalledWith({ realPath: PAGE, fileHash: 'h1', scroll: SCROLL, page: PAGE })
    await Promise.resolve()
    expect(f.keys.size.drafts).toBe(0)
  })

  it('a frame\'s draft hands the frame its own scroll for its next hello', async () => {
    const f = flow()
    const token = f.keys.mintDraft(BINDING, draft({ frame: true, view: { w: 1, h: 1, dpr: 1, x: 5, y: 9 } }))
    await f.save({ panelId: 'panel', op: 'add', draftToken: token, text: 'Hi' })
    expect(f.landed.mock.calls[0][0]).toMatchObject({ frameRestore: { realPath: PAGE, x: 5, y: 9 } })
  })

  it('024-AC-004 (h) a write that dropped the selected words says so in its answer', async () => {
    const f = flow(Promise.resolve({ ...wrote(), wordsDropped: true } as unknown as CommentWriteResult))
    const token = f.keys.mintDraft(BINDING, draft())
    expect(await f.save({ panelId: 'panel', op: 'add', draftToken: token, text: 'Hi' })).toEqual({
      ok: true,
      threadKey: expect.stringMatching(/^t/),
      wordsDropped: true
    })
  })

  it('M-057 a refused write hands the draft back for the next try, and the code reaches the renderer', async () => {
    const f = flow(Promise.resolve({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED } as unknown as CommentWriteResult))
    const token = f.keys.mintDraft(BINDING, draft())
    expect(await f.save({ panelId: 'panel', op: 'add', draftToken: token, text: 'Hi' })).toEqual({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED })
    await Promise.resolve()
    expect(f.keys.claimDraft(token, BINDING).ok).toBe(true)
    expect(f.landed).not.toHaveBeenCalled()
  })

  it('SEC-08 an unknown, foreign or expired draft writes nothing', async () => {
    const f = flow()
    const token = f.keys.mintDraft({ ...BINDING, session: 2 }, draft())
    expect(await f.save({ panelId: 'panel', op: 'add', draftToken: token, text: 'Hi' })).toEqual({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID })
    expect(f.writer.add).not.toHaveBeenCalled()
  })

  it('L3 answers SAVE_PENDING at the time limit while the write carries on; no second write runs meanwhile, and the late landing reloads and tells the window', async () => {
    let finish: (result: CommentWriteResult) => void = () => {}
    const f = flow(() => new Promise(resolve => (finish = resolve)), 20)
    const token = f.keys.mintDraft(BINDING, draft())
    expect(await f.save({ panelId: 'panel', op: 'add', draftToken: token, text: 'Hi' })).toEqual({ ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })
    expect(await f.save({ panelId: 'panel', op: 'add', draftToken: token, text: 'Hi' })).toEqual({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID })
    expect(f.landed).not.toHaveBeenCalled()
    finish(wrote())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.keys.size.drafts).toBe(0)
    expect(f.landed).toHaveBeenCalledWith({ realPath: PAGE, fileHash: 'h1', scroll: SCROLL, page: PAGE })
    expect(f.lateSettled).toHaveBeenCalledExactlyOnceWith({ op: 'add', draftToken: token, ok: true })
  })

  it('H1 a late write that is refused after all lands nothing and tells the window its code, named by the thread', async () => {
    let finish: (result: CommentWriteResult) => void = () => {}
    const k = flow(() => new Promise(resolve => (finish = resolve)), 20)
    const fileKey = k.keys.keyFor(BINDING, { kind: 'file', realPath: PAGE })
    const threadKey = k.keys.keyFor(BINDING, { kind: 'thread', realPath: PAGE, threadId: 'c-1' })
    expect(await k.save({ panelId: 'panel', fileKey, threadKey, rawHash: HASH, op: 'reply', text: 'x' })).toEqual({ ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })
    expect(k.lateSettled).not.toHaveBeenCalled()
    finish({ ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED } as unknown as CommentWriteResult)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(k.landed).not.toHaveBeenCalled()
    expect(k.lateSettled).toHaveBeenCalledExactlyOnceWith({ op: 'reply', threadKey, ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED })
  })

  it('H1 a late write that throws lands nothing, tells the window it failed, and hands the draft back', async () => {
    let fail: (error: Error) => void = () => {}
    const f = flow(() => new Promise((_resolve, reject) => (fail = reject)), 20)
    const token = f.keys.mintDraft(BINDING, draft())
    expect(await f.save({ panelId: 'panel', op: 'add', draftToken: token, text: 'Hi' })).toEqual({ ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })
    fail(new Error('EIO'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.landed).not.toHaveBeenCalled()
    expect(f.lateSettled).toHaveBeenCalledExactlyOnceWith({ op: 'add', draftToken: token, ok: false, code: ErrorCode.COMMENT_WRITE_FAILED })
    expect(f.keys.claimDraft(token, BINDING).ok).toBe(true)
  })

  it('H1 a late block delete is named by its block key, and a save answered in time tells nothing more', async () => {
    let finish: (result: CommentWriteResult) => void = () => {}
    const k = flow(() => new Promise(resolve => (finish = resolve)), 20)
    const fileKey = k.keys.keyFor(BINDING, { kind: 'file', realPath: PAGE })
    const blockKey = k.keys.keyFor(BINDING, { kind: 'block', realPath: PAGE, rawHash: HASH, start: 42 })
    expect(await k.save({ panelId: 'panel', op: 'deleteBlock', fileKey, blockKey, rawHash: HASH })).toEqual({ ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })
    finish(wrote(null))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(k.lateSettled).toHaveBeenCalledExactlyOnceWith({ op: 'deleteBlock', blockKey, ok: true })

    const quick = flow()
    const token = quick.keys.mintDraft(BINDING, draft())
    await quick.save({ panelId: 'panel', op: 'add', draftToken: token, text: 'Hi' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(quick.lateSettled).not.toHaveBeenCalled()
  })

  it('a write that rejects hands the draft back', async () => {
    const f = flow(() => Promise.reject(new Error('EIO')), 20)
    const token = f.keys.mintDraft(BINDING, draft())
    expect(await f.save({ panelId: 'panel', op: 'add', draftToken: token, text: 'Hi' })).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.keys.claimDraft(token, BINDING).ok).toBe(true)
  })
})

describe('commentSaveFlow thread and block changes', () => {
  function keyed() {
    const f = flow()
    const fileKey = f.keys.keyFor(BINDING, { kind: 'file', realPath: PAGE })
    const threadKey = f.keys.keyFor(BINDING, { kind: 'thread', realPath: PAGE, threadId: 'c-1' })
    const blockKey = f.keys.keyFor(BINDING, { kind: 'block', realPath: PAGE, rawHash: HASH, start: 42 })
    const otherThread = f.keys.keyFor(BINDING, { kind: 'thread', realPath: '/p/other.html', threadId: 'c-2' })
    return { ...f, fileKey, threadKey, blockKey, otherThread }
  }
  const target = (k: ReturnType<typeof keyed>) => ({ panelId: 'panel', fileKey: k.fileKey, threadKey: k.threadKey, rawHash: HASH })

  it.each([
    [{ op: 'reply', text: 'R' }, { op: 'reply', text: 'R' }],
    [{ op: 'editMessage', messageId: 'm-abcdefghijklmnop', text: 'E' }, { op: 'editMessage', messageId: 'm-abcdefghijklmnop', text: 'E' }],
    [{ op: 'deleteMessage', messageId: 'm-abcdefghijklmnop' }, { op: 'deleteMessage', messageId: 'm-abcdefghijklmnop' }],
    [{ op: 'setStatus', status: 'resolved' }, { op: 'setStatus', status: 'resolved' }],
    [{ op: 'deleteThread' }, { op: 'deleteThread' }]
  ])('M-053 %o resolves its keys and changes that thread', async (request, change) => {
    const k = keyed()
    const result = await k.save({ ...target(k), ...request } as CommentSaveRequest)
    expect(result).toEqual({ ok: true, threadKey: k.threadKey })
    expect(k.writer.changeThread).toHaveBeenCalledWith({ file: { realRoot: '/p', filePath: PAGE }, threadId: 'c-1', rawHash: HASH, change })
    expect(k.landed).toHaveBeenCalledWith({ realPath: PAGE, fileHash: 'h1', scroll: SCROLL, page: PAGE })
  })

  it('a deleted thread answers a null key', async () => {
    const k = keyed()
    k.writer.changeThread.mockResolvedValueOnce(wrote(null))
    expect(await k.save({ ...target(k), op: 'deleteThread' })).toEqual({ ok: true, threadKey: null })
  })

  it('M-053 SEC-08 a thread of another file, a wrong kind of key or an unknown one is invalid', async () => {
    const k = keyed()
    const invalid = { ok: false, code: ErrorCode.COMMENT_KEY_INVALID }
    expect(await k.save({ ...target(k), threadKey: k.otherThread, op: 'deleteThread' })).toEqual(invalid)
    expect(await k.save({ ...target(k), fileKey: k.threadKey, op: 'deleteThread' })).toEqual(invalid)
    expect(await k.save({ ...target(k), threadKey: 'tunknown', op: 'deleteThread' })).toEqual(invalid)
    expect(k.writer.changeThread).not.toHaveBeenCalled()
  })

  it('deletes a damaged block by its key and its hash, only when both match', async () => {
    const k = keyed()
    const request = { panelId: 'panel', op: 'deleteBlock' as const, fileKey: k.fileKey, blockKey: k.blockKey, rawHash: HASH }
    expect(await k.save(request)).toEqual({ ok: true, threadKey: null })
    expect(k.writer.deleteDamagedBlock).toHaveBeenCalledWith({ file: { realRoot: '/p', filePath: PAGE }, rawHash: HASH, start: 42 })
    expect(await k.save({ ...request, rawHash: 'b'.repeat(64) })).toEqual({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID })
    expect(await k.save({ ...request, blockKey: k.threadKey })).toEqual({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID })
  })

  it('M-056 a refused or failed change passes its code on, and arms nothing', async () => {
    const k = keyed()
    k.writer.changeThread.mockResolvedValueOnce({ ok: false, code: ErrorCode.COMMENT_FILE_GONE } as unknown as CommentWriteResult)
    expect(await k.save({ ...target(k), op: 'reply', text: 'x' })).toEqual({ ok: false, code: ErrorCode.COMMENT_FILE_GONE })
    k.writer.changeThread.mockRejectedValueOnce(new Error('EIO'))
    expect(await k.save({ ...target(k), op: 'reply', text: 'x' })).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED })
    expect(k.landed).not.toHaveBeenCalled()
  })

  it('a change with no scroll read arms the reload without a restore', async () => {
    const k = keyed()
    k.captureScroll.mockResolvedValueOnce(undefined as never)
    await k.save({ ...target(k), op: 'reply', text: 'x' })
    expect(k.landed).toHaveBeenCalledWith({ realPath: PAGE, fileHash: 'h1' })
  })

  it('C-13 "Reply and resolve" asks the writer for the reply and the resolve in one change', async () => {
    const k = keyed()
    await k.save({ ...target(k), op: 'reply', text: 'Done', resolve: true })
    expect(k.writer.changeThread).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ change: { op: 'reply', text: 'Done', resolve: true } }))
  })

  it('C-07 an edit that carries words, or null for the whole target, hands them to the writer as sent', async () => {
    const k = keyed()
    const sel = { exact: 'Buy', prefix: '', suffix: '' }
    await k.save({ ...target(k), op: 'editMessage', messageId: 'm-abcdefghijklmnop', text: 'E', sel })
    await k.save({ ...target(k), op: 'editMessage', messageId: 'm-abcdefghijklmnop', text: 'E', sel: null })
    expect(k.writer.changeThread).toHaveBeenNthCalledWith(1, expect.objectContaining({ change: { op: 'editMessage', messageId: 'm-abcdefghijklmnop', text: 'E', sel } }))
    expect(k.writer.changeThread).toHaveBeenNthCalledWith(2, expect.objectContaining({ change: { op: 'editMessage', messageId: 'm-abcdefghijklmnop', text: 'E', sel: null } }))
  })

  it('024-AC-004 C-07 an edit whose words were not kept says so in its answer', async () => {
    const k = keyed()
    k.writer.changeThread.mockResolvedValueOnce({ ...wrote('c-1'), wordsDropped: true } as unknown as CommentWriteResult)
    expect(await k.save({ ...target(k), op: 'editMessage', messageId: 'm-abcdefghijklmnop', text: 'E', sel: null })).toEqual({
      ok: true,
      threadKey: k.threadKey,
      wordsDropped: true
    })
  })
})

describe('commentSaveFlow rebuildBlock (OD-05)', () => {
  function rebuilding(withRebuild = true) {
    const keys = new CommentKeyStore<CommentDraft>()
    const next = () => Promise.resolve(wrote('c-1'))
    const rebuildDamagedBlock = vi.fn(next)
    const writer = {
      add: vi.fn(next),
      changeThread: vi.fn(next),
      deleteDamagedBlock: vi.fn(next),
      ...(withRebuild ? { rebuildDamagedBlock } : {})
    }
    const landed = vi.fn()
    const save = createCommentSaveFlow({
      binding: BINDING,
      realRoot: '/p',
      keys,
      writer,
      captureScroll: async () => SCROLL,
      currentPage: () => PAGE,
      landed
    })
    const fileKey = keys.keyFor(BINDING, { kind: 'file', realPath: PAGE })
    const blockKey = keys.keyFor(BINDING, { kind: 'block', realPath: PAGE, rawHash: HASH, start: 42 })
    const otherFile = keys.keyFor(BINDING, { kind: 'file', realPath: '/p/other.html' })
    const request = { panelId: 'panel', op: 'rebuildBlock' as const, fileKey, blockKey, rawHash: HASH }
    return { save, rebuildDamagedBlock, landed, request, otherFile, keys }
  }

  it('rebuilds the block its key and hash name, keeping it open when no status is sent', async () => {
    const r = rebuilding()
    expect(await r.save(r.request)).toEqual({ ok: true, threadKey: null })
    expect(r.rebuildDamagedBlock).toHaveBeenCalledExactlyOnceWith({ file: { realRoot: '/p', filePath: PAGE }, rawHash: HASH, start: 42 })
    expect(r.landed).toHaveBeenCalledWith({ realPath: PAGE, fileHash: 'h1', scroll: SCROLL, page: PAGE })
  })

  it('"Mark resolved" passes the status on to the writer', async () => {
    const r = rebuilding()
    await r.save({ ...r.request, status: 'resolved' })
    expect(r.rebuildDamagedBlock).toHaveBeenCalledWith({ file: { realRoot: '/p', filePath: PAGE }, rawHash: HASH, start: 42, status: 'resolved' })
  })

  it('SEC-08 refuses a block of another file, a hash that no longer matches, a wrong kind of key, and a writer that cannot rebuild', async () => {
    const invalid = { ok: false, code: ErrorCode.COMMENT_KEY_INVALID }
    const r = rebuilding()
    expect(await r.save({ ...r.request, fileKey: r.otherFile })).toEqual(invalid)
    expect(await r.save({ ...r.request, rawHash: 'b'.repeat(64) })).toEqual(invalid)
    expect(await r.save({ ...r.request, blockKey: r.request.fileKey })).toEqual(invalid)
    expect(await r.save({ ...r.request, fileKey: 'funknown' })).toEqual(invalid)
    expect(r.rebuildDamagedBlock).not.toHaveBeenCalled()
    const without = rebuilding(false)
    expect(await without.save(without.request)).toEqual(invalid)
    expect(without.landed).not.toHaveBeenCalled()
  })
})

describe('commentSaveFlow without a late-settle listener', () => {
  it('a late landing still reloads, and a late refusal or throw is only logged', async () => {
    const keys = new CommentKeyStore<CommentDraft>()
    const settles: Array<(result: CommentWriteResult) => void> = []
    const fails: Array<(error: Error) => void> = []
    const pending = () => new Promise<CommentWriteResult>((resolve, reject) => { settles.push(resolve); fails.push(reject) })
    const writer = { add: vi.fn(pending), changeThread: vi.fn(pending), deleteDamagedBlock: vi.fn(pending) }
    const landed = vi.fn()
    const save = createCommentSaveFlow({ binding: BINDING, realRoot: '/p', keys, writer, captureScroll: async () => undefined, currentPage: () => PAGE, landed, timeoutMs: 20 })
    const add = (): Promise<unknown> => save({ panelId: 'panel', op: 'add', draftToken: keys.mintDraft(BINDING, draft({ pageRealPath: undefined })), text: 'Hi' })
    expect(await add()).toEqual({ ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })
    expect(await add()).toEqual({ ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })
    expect(await add()).toEqual({ ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })
    settles[0](wrote())
    settles[1]({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED } as unknown as CommentWriteResult)
    fails[2](new Error('EIO'))
    await new Promise(resolve => setTimeout(resolve, 0))
    // No scroll and no page recorded: the landing restores nothing.
    expect(landed).toHaveBeenCalledExactlyOnceWith({ realPath: PAGE, fileHash: 'h1' })
  })
})
