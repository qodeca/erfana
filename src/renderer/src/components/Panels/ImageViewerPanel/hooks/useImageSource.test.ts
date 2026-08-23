// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link useImageSource}.
 *
 * jsdom has no image decoder, so `naturalWidth` / `naturalHeight` / `decode`
 * are stubbed on `HTMLImageElement.prototype` and read from one mutable mock
 * size. That keeps the off-DOM decoder and the rendered element in agreement.
 *
 * @module useImageSource.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import type { ImageReadResponse } from '../../../../../../shared/ipc/file-image-schema'
import { useImageSource } from './useImageSource'

const PATH = '/proj/icon.png'

let mockNaturalSize = { width: 800, height: 600 }
/**
 * The bytes the fake disk serves. Not the bridge – {@link mockReadImage} calls
 * it for the `dataUrl` half of an `ok` answer, so pointing it at new bytes (or
 * making it reject) stages a rewrite or a failed read, and its call count is
 * the number of reads that actually touched the file.
 */
const mockReadBytes = vi.fn<(path: string) => Promise<string>>()
/** Fake `window.api.file.readImage` – the bridge the hook calls. */
const mockReadImage =
  vi.fn<(path: string, knownVersion?: string) => Promise<ImageReadResponse>>()
const mockGetStats = vi.fn<(path: string) => Promise<{ size: number }>>()

/** Version counter behind the fake disk. */
let versionSeq = 0
/** Version the fake disk last handed out. */
let servedVersion = 'v0'

/**
 * Default bridge behaviour: every read is a genuine read of fresh bytes.
 *
 * Each answer carries a new version, which is what a real watcher event means –
 * the file changed. Tests that need the skip path override `mockReadImage`.
 */
const alwaysChanged = async (path: string): Promise<ImageReadResponse> => {
  const dataUrl = await mockReadBytes(path)
  versionSeq += 1
  servedVersion = `v${versionSeq}`
  return { status: 'ok', dataUrl, version: servedVersion }
}

/**
 * Answers `unchanged` when the caller echoes back the version the fake disk
 * last handed out, and does a full read otherwise – the real main-process rule.
 */
const compareVersions = async (
  path: string,
  knownVersion?: string
): Promise<ImageReadResponse> =>
  knownVersion === servedVersion
    ? { status: 'unchanged', version: servedVersion }
    : alwaysChanged(path)

beforeEach(() => {
  mockNaturalSize = { width: 800, height: 600 }
  versionSeq = 0
  servedVersion = 'v0'
  mockReadBytes.mockReset().mockResolvedValue('data:image/png;base64,AAAA')
  mockReadImage.mockReset().mockImplementation(alwaysChanged)
  mockGetStats.mockReset().mockResolvedValue({ size: 2048 })
  ;(window as unknown as { api: unknown }).api = {
    file: { readImage: mockReadImage, getStats: mockGetStats }
  }

  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get: () => mockNaturalSize.width
  })
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get: () => mockNaturalSize.height
  })
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: function decode(this: HTMLImageElement) {
      return this.src.includes('CORRUPT')
        ? Promise.reject(new Error('decode failed'))
        : Promise.resolve()
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useImageSource', () => {
  describe('Initial load', () => {
    it('resolves to a committed source and drops the loading flag', async () => {
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))

      expect(result.current.isLoading).toBe(true)

      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.source).toEqual({
        url: 'data:image/png;base64,AAAA',
        version: 'v1',
        naturalWidth: 800,
        naturalHeight: 600,
        generation: 1,
        fileSize: 2048,
        updatedAt: expect.any(Number)
      })
    })

    it('sets an error and no source when the read fails', async () => {
      mockReadBytes.mockRejectedValue(new Error('File too large'))
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))

      await waitFor(() => expect(result.current.error).toBe('File too large'))
      expect(result.current.source).toBeNull()
      expect(result.current.isLoading).toBe(false)
    })

    it('sets an error when the bytes cannot be decoded', async () => {
      mockReadBytes.mockResolvedValue('data:image/png;base64,CORRUPT')
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))

      await waitFor(() => expect(result.current.error).toBe('decode failed'))
    })

    it('reports a missing path without touching IPC', async () => {
      const { result } = renderHook(() => useImageSource({ filePath: '', isVisible: true }))

      await waitFor(() => expect(result.current.error).toBe('No file path provided'))
      expect(mockReadBytes).not.toHaveBeenCalled()
    })

    it('treats a stats failure as non-fatal', async () => {
      mockGetStats.mockRejectedValue(new Error('EACCES'))
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))

      await waitFor(() => expect(result.current.source).not.toBeNull())
      expect(result.current.source?.fileSize).toBe(0)
      expect(result.current.error).toBeNull()
    })

    it('reloads from scratch when the path changes', async () => {
      const { result, rerender } = renderHook(
        ({ path }) => useImageSource({ filePath: path, isVisible: true }),
        { initialProps: { path: PATH } }
      )
      await waitFor(() => expect(result.current.source).not.toBeNull())

      mockReadBytes.mockResolvedValue('data:image/png;base64,BBBB')
      rerender({ path: '/proj/other.png' })

      await waitFor(() => expect(result.current.source?.url).toBe('data:image/png;base64,BBBB'))
      expect(mockReadBytes).toHaveBeenLastCalledWith('/proj/other.png')
    })
  })

  describe('Refresh', () => {
    it('never raises isLoading and never nulls the source', async () => {
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))
      await waitFor(() => expect(result.current.source).not.toBeNull())

      const seenLoading: boolean[] = []
      const seenNull: boolean[] = []
      mockReadBytes.mockResolvedValue('data:image/png;base64,BBBB')

      act(() => result.current.refresh())
      seenLoading.push(result.current.isLoading)
      seenNull.push(result.current.source === null)

      await waitFor(() => expect(result.current.source?.url).toBe('data:image/png;base64,BBBB'))
      expect(seenLoading).not.toContain(true)
      expect(seenNull).not.toContain(true)
    })

    it('refreshes the file size and the update stamp', async () => {
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))
      await waitFor(() => expect(result.current.source).not.toBeNull())
      const before = result.current.source!

      mockGetStats.mockResolvedValue({ size: 8192 })
      mockReadBytes.mockResolvedValue('data:image/png;base64,BBBB')
      act(() => result.current.refresh())

      await waitFor(() => expect(result.current.source?.fileSize).toBe(8192))
      expect(result.current.source!.updatedAt).toBeGreaterThanOrEqual(before.updatedAt)
      expect(result.current.source!.generation).toBe(before.generation + 1)
    })

    it('calls onRefreshed only for refreshes, never for the initial load', async () => {
      const onRefreshed = vi.fn()
      const { result } = renderHook(() =>
        useImageSource({ filePath: PATH, isVisible: true, onRefreshed })
      )
      await waitFor(() => expect(result.current.source).not.toBeNull())
      expect(onRefreshed).not.toHaveBeenCalled()

      act(() => result.current.refresh())

      await waitFor(() => expect(onRefreshed).toHaveBeenCalledTimes(1))
    })

    it('keeps the last good image and stays error-free when a refresh fails', async () => {
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))
      await waitFor(() => expect(result.current.source).not.toBeNull())

      mockReadBytes.mockResolvedValue('data:image/png;base64,CORRUPT')
      act(() => result.current.refresh())

      await waitFor(() => expect(mockReadBytes).toHaveBeenCalledTimes(2))
      expect(result.current.source?.url).toBe('data:image/png;base64,AAAA')
      expect(result.current.error).toBeNull()
      // ...but it reports that the pixels are behind the file (QG-11a H2).
      expect(result.current.isStale).toBe(true)
    })

    it('clears the stale flag on the next successful refresh', async () => {
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))
      await waitFor(() => expect(result.current.source).not.toBeNull())

      mockReadBytes.mockResolvedValue('data:image/png;base64,CORRUPT')
      act(() => result.current.refresh())
      await waitFor(() => expect(result.current.isStale).toBe(true))

      mockReadBytes.mockResolvedValue('data:image/png;base64,BBBB')
      act(() => result.current.refresh())

      await waitFor(() => expect(result.current.source?.url).toBe('data:image/png;base64,BBBB'))
      expect(result.current.isStale).toBe(false)
    })

    it('clears a fatal initial-load error when a later refresh succeeds', async () => {
      // H1: the error used to be cleared only in `initial` mode, so a tab whose
      // first load lost a race with a half-written file kept the error screen
      // forever - with the refreshed bytes committed behind it.
      mockReadBytes.mockRejectedValueOnce(new Error('truncated'))
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))
      await waitFor(() => expect(result.current.error).toBe('truncated'))

      mockReadBytes.mockResolvedValue('data:image/png;base64,BBBB')
      act(() => result.current.refresh())

      await waitFor(() => expect(result.current.source?.url).toBe('data:image/png;base64,BBBB'))
      expect(result.current.error).toBeNull()
    })

    it('reports a throwing view reconciler without claiming the load failed', async () => {
      // The bytes are committed before the reconciler runs, so "keeping the
      // last loaded image" would be a lie - and `onRefreshed` must still fire.
      const onRefreshed = vi.fn()
      const onSourceCommit = vi.fn(() => {
        throw new Error('reconciler exploded')
      })
      const { result } = renderHook(() =>
        useImageSource({ filePath: PATH, isVisible: true, onRefreshed, onSourceCommit })
      )
      await waitFor(() => expect(result.current.source).not.toBeNull())

      mockReadBytes.mockResolvedValue('data:image/png;base64,BBBB')
      act(() => result.current.refresh())

      await waitFor(() => expect(result.current.source?.url).toBe('data:image/png;base64,BBBB'))
      expect(result.current.error).toBeNull()
      expect(result.current.isStale).toBe(false)
      await waitFor(() => expect(onRefreshed).toHaveBeenCalledTimes(1))
    })

    it('bumps the generation even for a byte-identical rewrite', async () => {
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))
      await waitFor(() => expect(result.current.source).not.toBeNull())

      act(() => result.current.refresh())

      await waitFor(() => expect(result.current.source?.generation).toBe(2))
      expect(result.current.source?.url).toBe('data:image/png;base64,AAAA')
    })

    it('never lets an older decode overwrite a newer one', async () => {
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))
      await waitFor(() => expect(result.current.source).not.toBeNull())

      // First refresh resolves slowly, second resolves immediately.
      let resolveSlow: (value: string) => void = () => {}
      mockReadBytes.mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveSlow = resolve
        })
      )
      act(() => result.current.refresh())

      mockReadBytes.mockResolvedValue('data:image/png;base64,NEW')
      act(() => result.current.refresh())
      await waitFor(() => expect(result.current.source?.url).toBe('data:image/png;base64,NEW'))

      await act(async () => {
        resolveSlow('data:image/png;base64,STALE')
        await Promise.resolve()
      })

      expect(result.current.source?.url).toBe('data:image/png;base64,NEW')
    })
  })

  describe('Version-gated reads (#70)', () => {
    it('sends no version on the initial load', async () => {
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))
      await waitFor(() => expect(result.current.source).not.toBeNull())

      // Nothing is held yet, so there is nothing to compare against - asking
      // the main process to skip here could only skip a read we need.
      expect(mockReadImage).toHaveBeenCalledWith(PATH, undefined)
    })

    it('echoes the version it is displaying on a refresh', async () => {
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))
      await waitFor(() => expect(result.current.source?.version).toBe('v1'))

      act(() => result.current.refresh())

      await waitFor(() => expect(mockReadImage).toHaveBeenLastCalledWith(PATH, 'v1'))
    })

    it('sends no version when the panel is repointed at another file', async () => {
      // A repoint holds bytes for the OLD file. Comparing them against the NEW
      // one would be comparing versions of two different files.
      const { result, rerender } = renderHook(
        ({ path }) => useImageSource({ filePath: path, isVisible: true }),
        { initialProps: { path: PATH } }
      )
      await waitFor(() => expect(result.current.source).not.toBeNull())

      mockReadBytes.mockResolvedValue('data:image/png;base64,BBBB')
      rerender({ path: '/proj/other.png' })

      await waitFor(() => expect(result.current.source?.url).toBe('data:image/png;base64,BBBB'))
      expect(mockReadImage).toHaveBeenLastCalledWith('/proj/other.png', undefined)
    })

    it('does nothing at all when the file has not changed', async () => {
      const onRefreshed = vi.fn()
      const onSourceCommit = vi.fn()
      const { result } = renderHook(() =>
        useImageSource({ filePath: PATH, isVisible: true, onRefreshed, onSourceCommit })
      )
      await waitFor(() => expect(result.current.source).not.toBeNull())
      const before = result.current.source!
      onSourceCommit.mockClear()

      mockReadImage.mockImplementation(compareVersions)
      act(() => result.current.refresh())
      await waitFor(() => expect(mockReadImage).toHaveBeenCalledTimes(2))

      // No bytes were read, so nothing was decoded...
      expect(mockReadBytes).toHaveBeenCalledTimes(1)
      // ...and the committed source is the very same object: same url, same
      // updatedAt, same generation, no re-render of the image.
      expect(result.current.source).toBe(before)
      expect(onSourceCommit).not.toHaveBeenCalled()
      // `unchanged` is a success, so it neither announces a reload...
      expect(onRefreshed).not.toHaveBeenCalled()
      // ...nor reports a problem: the pixels ARE the file on disk.
      expect(result.current.error).toBeNull()
      expect(result.current.isStale).toBe(false)
    })

    it('still refreshes on the next real change after a skip', async () => {
      const onRefreshed = vi.fn()
      const { result } = renderHook(() =>
        useImageSource({ filePath: PATH, isVisible: true, onRefreshed })
      )
      await waitFor(() => expect(result.current.source).not.toBeNull())

      mockReadImage.mockImplementation(compareVersions)
      act(() => result.current.refresh())
      await waitFor(() => expect(mockReadImage).toHaveBeenCalledTimes(2))
      expect(onRefreshed).not.toHaveBeenCalled()

      // The file really changes this time: a skip must not latch.
      mockReadBytes.mockResolvedValue('data:image/png;base64,BBBB')
      mockReadImage.mockImplementation(alwaysChanged)
      act(() => result.current.refresh())

      await waitFor(() => expect(result.current.source?.url).toBe('data:image/png;base64,BBBB'))
      expect(result.current.source?.version).toBe('v2')
      await waitFor(() => expect(onRefreshed).toHaveBeenCalledTimes(1))
    })

    it('reverts the version with the bytes when the rendered image fails', async () => {
      // Otherwise the reverted image would be compared against the version of
      // the bytes that were thrown away, the file would look "unchanged", and
      // the tab would stay on the old picture for good - issue #70 again.
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))
      await waitFor(() => expect(result.current.source?.version).toBe('v1'))

      mockReadBytes.mockResolvedValue('data:image/png;base64,BBBB')
      act(() => result.current.refresh())
      await waitFor(() => expect(result.current.source?.version).toBe('v2'))

      act(() => result.current.handleImageError())
      expect(result.current.source?.version).toBe('v1')

      act(() => result.current.refresh())

      await waitFor(() => expect(mockReadImage).toHaveBeenLastCalledWith(PATH, 'v1'))
    })
  })

  describe('Visibility deferral', () => {
    it('does not read while hidden, then reads once on the visibility transition', async () => {
      const { result, rerender } = renderHook(
        ({ visible }) => useImageSource({ filePath: PATH, isVisible: visible }),
        { initialProps: { visible: true } }
      )
      await waitFor(() => expect(result.current.source).not.toBeNull())
      expect(mockReadBytes).toHaveBeenCalledTimes(1)

      rerender({ visible: false })
      mockReadBytes.mockResolvedValue('data:image/png;base64,BBBB')
      act(() => result.current.refresh())

      // Deferred: the watch fired, the multi-MB pull did not.
      expect(mockReadBytes).toHaveBeenCalledTimes(1)

      rerender({ visible: true })

      await waitFor(() => expect(mockReadBytes).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(result.current.source?.url).toBe('data:image/png;base64,BBBB'))
    })

    it('coalesces several hidden changes into one read', async () => {
      const { result, rerender } = renderHook(
        ({ visible }) => useImageSource({ filePath: PATH, isVisible: visible }),
        { initialProps: { visible: true } }
      )
      await waitFor(() => expect(result.current.source).not.toBeNull())

      rerender({ visible: false })
      act(() => {
        result.current.refresh()
        result.current.refresh()
        result.current.refresh()
      })
      rerender({ visible: true })

      await waitFor(() => expect(mockReadBytes).toHaveBeenCalledTimes(2))
    })
  })

  describe('handleImageError', () => {
    it('reverts to the previous good source and says the view is behind disk', async () => {
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))
      await waitFor(() => expect(result.current.source).not.toBeNull())

      mockReadBytes.mockResolvedValue('data:image/png;base64,BBBB')
      act(() => result.current.refresh())
      await waitFor(() => expect(result.current.source?.url).toBe('data:image/png;base64,BBBB'))

      act(() => result.current.handleImageError())

      expect(result.current.source?.url).toBe('data:image/png;base64,AAAA')
      expect(result.current.error).toBeNull()
      // A silent revert is the same defect as a silent failed refresh.
      expect(result.current.isStale).toBe(true)
    })

    it('reports failure when there is nothing to fall back to', async () => {
      const { result } = renderHook(() => useImageSource({ filePath: PATH, isVisible: true }))
      await waitFor(() => expect(result.current.source).not.toBeNull())

      act(() => result.current.handleImageError())

      expect(result.current.source).toBeNull()
      expect(result.current.error).toBe('Failed to display image')
    })
  })
})
