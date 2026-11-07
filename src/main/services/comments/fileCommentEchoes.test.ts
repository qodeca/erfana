// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `FileCommentEchoes` – the own-write echo filter of `file-comment:changed`
 * (§7.5), with an injected read so every branch is deterministic.
 */
import { describe, expect, it, vi } from 'vitest'
import type { LoadResult } from './commentFileAccess'
import { sha256HexOf } from './commentJobDocs'
import type { CommentWriteResult } from './CommentWriter'
import { FileCommentEchoes } from './fileCommentEchoes'

const PATH = '/project/notes.md'
const WRITER = '1\u0000panel-a'
const WRITTEN = Buffer.from('after the write\n')

const loaded = (bytes: Buffer): LoadResult => ({ ok: true, realPath: PATH, id: { dev: 1, ino: 1 }, bytes } as unknown as LoadResult)
const written = (bytes: Buffer = WRITTEN): CommentWriteResult => ({ ok: true, realPath: PATH, fileHash: sha256HexOf(bytes), threadId: 't1' })

/** Dispatch one change and wait for its send; resolves with the panel left out. */
function dispatched(echoes: FileCommentEchoes): Promise<string | undefined> {
  return new Promise(resolve => echoes.dispatch(PATH, resolve))
}

describe('FileCommentEchoes', () => {
  it('with no write remembered, sends to everyone at once, without reading the file', () => {
    const read = vi.fn<(realPath: string) => Promise<LoadResult>>()
    const send = vi.fn()
    new FileCommentEchoes(read).dispatch(PATH, send)
    expect(send).toHaveBeenCalledWith(undefined)
    expect(read).not.toHaveBeenCalled()
  })

  it('leaves the writer out when the file holds the bytes it wrote', async () => {
    const echoes = new FileCommentEchoes(async () => loaded(WRITTEN))
    await echoes.track(PATH, WRITER, Promise.resolve(written()))
    expect(await dispatched(echoes)).toBe(WRITER)
  })

  it('sends to everyone when the bytes differ, the read is refused or the read throws', async () => {
    const reads: Array<() => Promise<LoadResult>> = [
      async () => loaded(Buffer.from('changed outside\n')),
      async () => ({ ok: false, reason: 'missing' }) as LoadResult,
      async () => {
        throw new Error('EIO')
      }
    ]
    for (const read of reads) {
      const echoes = new FileCommentEchoes(read)
      await echoes.track(PATH, WRITER, Promise.resolve(written()))
      expect(await dispatched(echoes)).toBeUndefined()
    }
  })

  it('uses a remembered write once', async () => {
    const read = vi.fn(async () => loaded(WRITTEN))
    const echoes = new FileCommentEchoes(read)
    await echoes.track(PATH, WRITER, Promise.resolve(written()))
    expect(await dispatched(echoes)).toBe(WRITER)
    const send = vi.fn()
    echoes.dispatch(PATH, send)
    expect(send).toHaveBeenCalledWith(undefined)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('remembers neither a refused nor a rejected write, and hands the rejection back', async () => {
    const echoes = new FileCommentEchoes(async () => loaded(WRITTEN))
    await echoes.track(PATH, WRITER, Promise.resolve({ ok: false, code: 'COMMENT_BLOCK_CHANGED', reason: 'block-changed' } as unknown as CommentWriteResult))
    const failure = new Error('worker died')
    await expect(echoes.track(PATH, WRITER, Promise.reject(failure))).rejects.toBe(failure)
    const send = vi.fn()
    echoes.dispatch(PATH, send)
    expect(send).toHaveBeenCalledWith(undefined)
  })

  it('forgets every write on clear, also one still settling', async () => {
    const echoes = new FileCommentEchoes(async () => loaded(WRITTEN))
    await echoes.track(PATH, WRITER, Promise.resolve(written()))
    let settle: (result: CommentWriteResult) => void = () => undefined
    const late = echoes.track('/project/other.md', WRITER, new Promise<CommentWriteResult>(resolve => (settle = resolve)))
    echoes.clear()
    settle(written())
    await late
    const send = vi.fn()
    echoes.dispatch(PATH, send)
    echoes.dispatch('/project/other.md', send)
    expect(send.mock.calls).toEqual([[undefined], [undefined]])
  })
})
