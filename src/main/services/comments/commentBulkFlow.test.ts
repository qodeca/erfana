// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Plan step 13: what both families share of a bulk action. No comment is lost
 * on a partial failure: a refused file wrote nothing, and the next still runs.
 */
import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { createCommentBulkFlow, runBulkFiles, type BulkFileWork } from './commentBulkFlow'
import type { CommentWriteResult } from './CommentWriter'

vi.mock('../LoggingService', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

const WRITTEN: CommentWriteResult = { ok: true, realPath: '/p/a.html', fileHash: 'h', threadId: null }
const REFUSED: CommentWriteResult = { ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED, reason: 'block-changed' }
const THREADS = [{ threadId: 'one', rawHash: 'r' }]

const work = (fileKey: string, write: BulkFileWork['write']): BulkFileWork => ({ fileKey, threads: THREADS, write })

describe('runBulkFiles', () => {
  it('a refused file does not stop the next, and each answers for itself', async () => {
    const later = vi.fn(async () => WRITTEN)
    const land = vi.fn()
    const result = await runBulkFiles([work('a', async () => REFUSED), work('b', later)], 1000, land)
    expect(result).toEqual({
      ok: true,
      files: [
        { fileKey: 'a', ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED, reason: 'block-changed' },
        { fileKey: 'b', ok: true, done: 1 }
      ]
    })
    expect(later).toHaveBeenCalledTimes(1)
    expect(land).toHaveBeenCalledTimes(1)
  })

  it('one write at a time, in request order', async () => {
    const order: string[] = []
    const step = (name: string) => async (): Promise<CommentWriteResult> => {
      order.push(`${name} start`)
      await Promise.resolve()
      order.push(`${name} end`)
      return WRITTEN
    }
    await runBulkFiles([work('a', step('a')), work('b', step('b'))])
    expect(order).toEqual(['a start', 'a end', 'b start', 'b end'])
  })

  it('a key that did not hold refuses that file and writes nothing', async () => {
    const write = vi.fn(async () => WRITTEN)
    const result = await runBulkFiles([{ fileKey: 'a', threads: null, write }])
    expect(result).toEqual({ ok: true, files: [{ fileKey: 'a', ok: false, code: ErrorCode.COMMENT_KEY_INVALID, reason: 'key-invalid' }] })
    expect(write).not.toHaveBeenCalled()
  })

  it('a thrown write is that file failing, not the request', async () => {
    const result = await runBulkFiles([work('a', () => Promise.reject(new Error('disk'))), work('b', async () => WRITTEN)])
    expect(result).toEqual({
      ok: true,
      files: [
        { fileKey: 'a', ok: false, code: ErrorCode.COMMENT_WRITE_FAILED },
        { fileKey: 'b', ok: true, done: 1 }
      ]
    })
  })

  it('a slow write answers "still saving", and still lands', async () => {
    let finish: (result: CommentWriteResult) => void = () => {}
    const write = new Promise<CommentWriteResult>(resolve => {
      finish = resolve
    })
    const land = vi.fn()
    const result = await runBulkFiles([work('a', () => write)], 1, land)
    expect(result).toEqual({ ok: true, files: [{ fileKey: 'a', ok: false, code: ErrorCode.COMMENT_SAVE_PENDING }] })
    finish(WRITTEN)
    await vi.waitFor(() => expect(land).toHaveBeenCalledTimes(1))
  })

  it('L-1 a file that changed right after its write landed counts as done, with the warning: nothing says it stayed unwritten', async () => {
    const land = vi.fn()
    const changed: CommentWriteResult = { ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'changed-during-save' }
    expect(await runBulkFiles([work('a', async () => changed)], 1000, land)).toEqual({
      ok: true,
      files: [{ fileKey: 'a', ok: true, done: 1, changedDuringSave: true }]
    })
    // No hash of what is on disk: the file watch reloads the view, not the landing path.
    expect(land).not.toHaveBeenCalled()
  })

  describe('L-2 a write past the time limit tells the reader how it ended, per file', () => {
    /** A write still running when its time limit passes, and the run that answered "still saving". */
    async function outlasted(): Promise<{ settled: ReturnType<typeof vi.fn>; finish: (result: CommentWriteResult) => void; fail: (error: Error) => void }> {
      let finish: (result: CommentWriteResult) => void = () => {}
      let fail: (error: Error) => void = () => {}
      const write = new Promise<CommentWriteResult>((resolve, reject) => {
        finish = resolve
        fail = reject
      })
      const settled = vi.fn()
      await runBulkFiles([work('a', () => write)], 1, () => {}, settled)
      expect(settled).not.toHaveBeenCalled()
      return { settled, finish, fail }
    }

    it('a late refusal names its file, code and reason', async () => {
      const { settled, finish } = await outlasted()
      finish(REFUSED)
      await vi.waitFor(() => expect(settled).toHaveBeenCalledExactlyOnceWith({ fileKey: 'a', ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED, reason: 'block-changed' }))
    })

    it('a late landing says so', async () => {
      const { settled, finish } = await outlasted()
      finish(WRITTEN)
      await vi.waitFor(() => expect(settled).toHaveBeenCalledExactlyOnceWith({ fileKey: 'a', ok: true }))
    })

    it('a late write whose file changed right after it landed says landed, with the warning', async () => {
      const { settled, finish } = await outlasted()
      finish({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'changed-during-save' })
      await vi.waitFor(() => expect(settled).toHaveBeenCalledExactlyOnceWith({ fileKey: 'a', ok: true, changedDuringSave: true }))
    })

    it('a late write that threw is that file failing', async () => {
      const { settled, fail } = await outlasted()
      fail(new Error('disk'))
      await vi.waitFor(() => expect(settled).toHaveBeenCalledExactlyOnceWith({ fileKey: 'a', ok: false, code: ErrorCode.COMMENT_WRITE_FAILED }))
    })

    it('a write that answered in time sends no settle', async () => {
      const settled = vi.fn()
      await runBulkFiles([work('a', async () => REFUSED)], 1000, () => {}, settled)
      expect(settled).not.toHaveBeenCalled()
    })
  })
})

describe('createCommentBulkFlow', () => {
  const REAL: Readonly<Record<string, { realPath: string; threadId?: string }>> = {
    f1: { realPath: '/p/a.html' },
    t1: { realPath: '/p/a.html', threadId: 'one' },
    other: { realPath: '/p/b.html', threadId: 'two' }
  }
  const keys = {
    resolve: (_binding: unknown, key: string) => (key in REAL ? { ok: true, value: REAL[key] } : { ok: false })
  }
  const flow = (changeThreads: (...args: never[]) => Promise<CommentWriteResult>) => {
    const landed = vi.fn()
    const run = createCommentBulkFlow({
      binding: { windowId: 1, panelId: 'p', session: 1 },
      realRoot: '/p',
      keys: keys as never,
      writer: { changeThreads: changeThreads as never },
      captureScroll: async () => ({ x: 0, y: 9 }),
      currentPage: () => '/p/a.html',
      landed
    })
    return { run, landed }
  }
  const request = (threadKey: string) => ({ panelId: 'p', change: 'resolve' as const, files: [{ fileKey: 'f1', threads: [{ threadKey, rawHash: 'r'.repeat(64) }] }] })

  it('resolves keys to the file main knows, and the reader keeps their place', async () => {
    const changeThreads = vi.fn(async () => WRITTEN)
    const { run, landed } = flow(changeThreads)
    expect(await run(request('t1'))).toEqual({ ok: true, files: [{ fileKey: 'f1', ok: true, done: 1 }] })
    expect(changeThreads).toHaveBeenCalledWith({
      // L-4: the key's real path is what the writer must reach again: a swapped folder redirects nothing.
      file: { realRoot: '/p', filePath: '/p/a.html', expectedRealPath: '/p/a.html' },
      threads: [{ threadId: 'one', rawHash: 'r'.repeat(64) }],
      change: 'resolve'
    })
    expect(landed).toHaveBeenCalledWith({ realPath: '/p/a.html', fileHash: 'h', scroll: { x: 0, y: 9 }, page: '/p/a.html' })
  })

  it('a thread key of another file, or an unknown one, writes nothing', async () => {
    const changeThreads = vi.fn(async () => WRITTEN)
    const { run } = flow(changeThreads)
    for (const key of ['other', 'unknown']) {
      expect(await run(request(key))).toEqual({ ok: true, files: [{ fileKey: 'f1', ok: false, code: ErrorCode.COMMENT_KEY_INVALID, reason: 'key-invalid' }] })
    }
    expect(changeThreads).not.toHaveBeenCalled()
  })
})
