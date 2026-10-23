// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link useLatestFileLoad}: only the latest read applies, whatever
 * order the reads finish in; a failure is reported, never silent; and neither
 * the document text nor an error-quoted path reaches the log.
 */

import { StrictMode, createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { beginLatestLoad, useLatestFileLoad, type FileLoadResult } from './useLatestFileLoad'
import { logger } from '../utils/logger'

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

/** A read the test settles by hand, so it can finish in any order. */
interface DeferredRead {
  resolve: (content: string) => void
  reject: (error: Error) => void
}

/** A `read` whose calls are kept per path, settled later by the test. */
function deferredReads(): {
  read: (filePath: string) => Promise<FileLoadResult>
  calls: Map<string, DeferredRead[]>
} {
  const calls = new Map<string, DeferredRead[]>()
  const read = (filePath: string): Promise<FileLoadResult> =>
    new Promise<FileLoadResult>((resolve, reject) => {
      const list = calls.get(filePath) ?? []
      list.push({ resolve: (content) => resolve({ content }), reject })
      calls.set(filePath, list)
    })
  return { read, calls }
}

const enoent = (path: string): Error =>
  new Error(
    `Error invoking remote method 'file:readFile': Error: ENOENT: no such file or directory, open '${path}'`
  )

describe('useLatestFileLoad', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the file and reports no error', async () => {
    const { read, calls } = deferredReads()
    const onLoaded = vi.fn()
    const { result } = renderHook(() => useLatestFileLoad('/p/a.md', { read, onLoaded }))

    await act(async () => calls.get('/p/a.md')?.[0].resolve('# A'))

    expect(onLoaded).toHaveBeenCalledWith('/p/a.md', { content: '# A' })
    expect(result.current.loadError).toBeNull()
  })

  it('A slow, B fast: the older read landing last does not replace B', async () => {
    const { read, calls } = deferredReads()
    const onLoaded = vi.fn()
    const { rerender } = renderHook(
      ({ filePath }) => useLatestFileLoad(filePath, { read, onLoaded }),
      { initialProps: { filePath: '/p/a.md' } }
    )
    rerender({ filePath: '/p/b.md' })

    await act(async () => calls.get('/p/b.md')?.[0].resolve('# B'))
    await act(async () => calls.get('/p/a.md')?.[0].resolve('# A'))

    expect(onLoaded).toHaveBeenCalledTimes(1)
    expect(onLoaded).toHaveBeenCalledWith('/p/b.md', { content: '# B' })
  })

  it('B fails, then the older A succeeds: the error stands and A is not shown', async () => {
    const { read, calls } = deferredReads()
    const onLoaded = vi.fn()
    const onFailed = vi.fn()
    const { result, rerender } = renderHook(
      ({ filePath }) => useLatestFileLoad(filePath, { read, onLoaded, onFailed }),
      { initialProps: { filePath: '/p/a.md' } }
    )
    rerender({ filePath: '/p/b.md' })

    await act(async () => calls.get('/p/b.md')?.[0].reject(enoent('/p/b.md')))
    await act(async () => calls.get('/p/a.md')?.[0].resolve('# A'))

    expect(onLoaded).not.toHaveBeenCalled()
    expect(result.current.loadError).toBe('"b.md" could not be opened: it no longer exists on disk.')
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  it('drops a stale failure: no error and no toast for a file no longer asked for', async () => {
    const { read, calls } = deferredReads()
    const onLoaded = vi.fn()
    const onFailed = vi.fn()
    const { result, rerender } = renderHook(
      ({ filePath }) => useLatestFileLoad(filePath, { read, onLoaded, onFailed }),
      { initialProps: { filePath: '/p/a.md' } }
    )
    rerender({ filePath: '/p/b.md' })

    await act(async () => calls.get('/p/a.md')?.[0].reject(enoent('/p/a.md')))
    await act(async () => calls.get('/p/b.md')?.[0].resolve('# B'))

    expect(onFailed).not.toHaveBeenCalled()
    expect(result.current.loadError).toBeNull()
    expect(onLoaded).toHaveBeenCalledWith('/p/b.md', { content: '# B' })
  })

  it('applies nothing when the panel unmounts mid-read', async () => {
    const { read, calls } = deferredReads()
    const onLoaded = vi.fn()
    const onFailed = vi.fn()
    const { unmount } = renderHook(() => useLatestFileLoad('/p/a.md', { read, onLoaded, onFailed }))

    unmount()
    await act(async () => calls.get('/p/a.md')?.[0].resolve('# A'))

    expect(onLoaded).not.toHaveBeenCalled()
    expect(onFailed).not.toHaveBeenCalled()
  })

  it('under StrictMode, only the second mount’s read applies, once', async () => {
    const { read, calls } = deferredReads()
    const onLoaded = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element =>
      createElement(StrictMode, null, children)
    renderHook(() => useLatestFileLoad('/p/a.md', { read, onLoaded }), { wrapper })

    const reads = calls.get('/p/a.md') ?? []
    expect(reads).toHaveLength(2)
    // the first mount's read lands last, after StrictMode retired it
    await act(async () => reads[1].resolve('# A second'))
    await act(async () => reads[0].resolve('# A first'))

    expect(onLoaded).toHaveBeenCalledTimes(1)
    expect(onLoaded).toHaveBeenCalledWith('/p/a.md', { content: '# A second' })
  })

  it('a failure sets the error, calls onFailed once, and retry reads again and clears it', async () => {
    const { read, calls } = deferredReads()
    const onLoaded = vi.fn()
    const onFailed = vi.fn()
    const onStart = vi.fn()
    const { result } = renderHook(() =>
      useLatestFileLoad('/p/a.md', { read, onLoaded, onFailed, onStart })
    )

    await act(async () => calls.get('/p/a.md')?.[0].reject(new Error('EACCES: permission denied')))
    expect(result.current.loadError).toBe('"a.md" could not be opened: permission denied.')
    expect(onFailed).toHaveBeenCalledWith('"a.md" could not be opened: permission denied.')

    act(() => result.current.retry())
    expect(calls.get('/p/a.md')).toHaveLength(2)
    expect(onStart).toHaveBeenCalledTimes(2)
    await act(async () => calls.get('/p/a.md')?.[1].resolve('# A'))

    expect(result.current.loadError).toBeNull()
    expect(onLoaded).toHaveBeenCalledWith('/p/a.md', { content: '# A' })
  })

  it('never logs the document text, and the error log drops the path the error quotes', async () => {
    const { read, calls } = deferredReads()
    const { rerender } = renderHook(
      ({ filePath }) => useLatestFileLoad(filePath, { read, onLoaded: vi.fn() }),
      { initialProps: { filePath: '/Users/alice/notes/a.md' } }
    )
    await act(async () => calls.get('/Users/alice/notes/a.md')?.[0].resolve('SECRET BODY TEXT'))
    rerender({ filePath: '/Users/alice/notes/b.md' })
    await act(async () => calls.get('/Users/alice/notes/b.md')?.[0].reject(enoent('/Users/alice/notes/b.md')))

    const infoCalls = JSON.stringify(vi.mocked(logger.info).mock.calls)
    expect(infoCalls).not.toContain('SECRET')
    expect(infoCalls).toContain('"contentLength":16')
    const [[label, logged]] = vi.mocked(logger.error).mock.calls
    expect(label).toBe('Error loading file')
    expect((logged as Error).message).not.toContain('alice')
  })

  it('does nothing without a path', () => {
    const read = vi.fn()
    renderHook(() => useLatestFileLoad(undefined, { read, onLoaded: vi.fn() }))

    expect(read).not.toHaveBeenCalled()
  })
})

describe('beginLatestLoad', () => {
  it('is latest until a newer load, or a retirement, bumps the counter', () => {
    const ref = { current: 0 }
    const first = beginLatestLoad(ref)
    expect(first()).toBe(true)

    const second = beginLatestLoad(ref)
    expect(first()).toBe(false)
    expect(second()).toBe(true)

    ref.current += 1
    expect(second()).toBe(false)
  })
})
