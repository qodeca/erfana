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
      file: { realRoot: '/p', filePath: '/p/a.html' },
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
