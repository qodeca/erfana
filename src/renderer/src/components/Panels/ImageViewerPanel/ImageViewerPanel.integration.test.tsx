// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Integration tests for the image viewer: the real panel over the real hooks,
 * with only `window.api` mocked.
 *
 * `ImageViewerPanel.test.tsx` covers behaviour case by case; this file walks the
 * whole loop the user sees – mount, watch, change, re-read, repaint, settle –
 * and asserts the wiring between the layers rather than any one layer.
 *
 * @module ImageViewerPanel.integration.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import type { IDockviewPanelProps } from 'dockview'

import type { ImageReadResponse } from '../../../../../shared/ipc/file-image-schema'
import { ImageViewerPanel } from './ImageViewerPanel'
import { TEST_IDS } from '../../../constants/testids'
import { INDICATOR_DURATION_MS } from '../../../constants/fileWatch'

const PATH = '/proj/icon.png'

let mockNaturalSize = { width: 800, height: 600 }
/** The bytes the fake disk serves; {@link mockReadImage} wraps them in `ok`. */
const mockReadBytes = vi.fn<(path: string) => Promise<string>>()
/** Fake `window.api.file.readImage` – the bridge the viewer calls. */
const mockReadImage =
  vi.fn<(path: string, knownVersion?: string) => Promise<ImageReadResponse>>()
const mockGetStats = vi.fn<(path: string) => Promise<{ size: number }>>()

/** Version counter behind the fake disk; every read here is a genuine change. */
let versionSeq = 0

type WatchCallback = (data: { filePath: string }) => void
let changedListeners: WatchCallback[] = []

const mockFileWatch = {
  start: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  onFileChanged: vi.fn((cb: WatchCallback) => {
    changedListeners.push(cb)
    return () => {
      changedListeners = changedListeners.filter((l) => l !== cb)
    }
  }),
  onFileDeleted: vi.fn(() => vi.fn()),
  onFileError: vi.fn(() => vi.fn())
}

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

function makeProps(): IDockviewPanelProps<{ filePath: string }> {
  return {
    params: { filePath: PATH },
    api: {
      isVisible: true,
      setTitle: vi.fn(),
      onDidVisibilityChange: vi.fn(() => ({ dispose: vi.fn() }))
    }
  } as unknown as IDockviewPanelProps<{ filePath: string }>
}

function emitChanged(): void {
  for (const listener of [...changedListeners]) listener({ filePath: PATH })
}

beforeEach(() => {
  mockNaturalSize = { width: 800, height: 600 }
  changedListeners = []

  versionSeq = 0
  mockReadBytes.mockReset().mockResolvedValue('data:image/png;base64,AAAA')
  mockReadImage.mockReset().mockImplementation(async (path) => {
    const dataUrl = await mockReadBytes(path)
    versionSeq += 1
    return { status: 'ok', dataUrl, version: `v${versionSeq}` }
  })
  mockGetStats.mockReset().mockResolvedValue({ size: 2048 })
  mockFileWatch.start.mockReset().mockResolvedValue({ success: true })
  mockFileWatch.stop.mockReset().mockResolvedValue({ success: true })
  mockFileWatch.pause.mockReset()
  mockFileWatch.resume.mockReset()
  ;(window as unknown as { api: unknown }).api = {
    file: { readImage: mockReadImage, getStats: mockGetStats },
    fileWatch: mockFileWatch
  }

  Element.prototype.getBoundingClientRect = vi.fn(
    () => ({ width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800 }) as DOMRect
  ) as unknown as typeof Element.prototype.getBoundingClientRect

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
    value: () => Promise.resolve()
  })
})

afterEach(() => {
  cleanup()
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
})

describe('ImageViewerPanel integration', () => {
  it('walks the whole refresh loop: watch, change, re-read, repaint, settle', async () => {
    render(<ImageViewerPanel {...makeProps()} />)
    await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)
    expect(mockFileWatch.start).toHaveBeenCalledWith(PATH)

    mockReadBytes.mockResolvedValue('data:image/png;base64,BBBB')
    emitChanged()

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
        'src',
        'data:image/png;base64,BBBB'
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveAttribute(
        'data-state',
        'reloading'
      )
    })

    await waitFor(
      () => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveAttribute(
          'data-state',
          'idle'
        )
      },
      { timeout: INDICATOR_DURATION_MS + 1500 }
    )
  })

  it('performs exactly one read per change and never triggers itself', async () => {
    render(<ImageViewerPanel {...makeProps()} />)
    await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)

    for (let i = 0; i < 10; i += 1) {
      mockReadBytes.mockResolvedValue(`data:image/png;base64,X${i}`)
      emitChanged()

      await waitFor(() => expect(mockReadBytes).toHaveBeenCalledTimes(i + 2))
    }

    // 1 initial + 10 changes. A self-triggered read would push this higher.
    expect(mockReadBytes).toHaveBeenCalledTimes(11)
  })

  it('tears the watch down on unmount', async () => {
    const { unmount } = render(<ImageViewerPanel {...makeProps()} />)
    await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)

    unmount()

    // The stop is queued behind the start, so it lands on a later tick - that
    // ordering is what stops a fast mount/unmount leaking a watch slot.
    await waitFor(() => expect(mockFileWatch.stop).toHaveBeenCalledWith(PATH))
    expect(changedListeners).toHaveLength(0)
  })
})
