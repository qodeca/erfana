// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link usePreviewLifecycle}.
 *
 * The issue #124 contract first: the open/close effect is keyed by the panel
 * id only. A same-tab move changes `filePath` under a live view, and a close
 * and re-open on that change would destroy the view and the tab's history.
 * The refusal paths follow, so the hook is covered on its own and not only
 * through `HtmlPreviewPanel.test.tsx`.
 *
 * @see usePreviewLifecycle.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { ErrorCode } from '../../../../../../shared/errors'
import { usePreviewStore } from '../../../../stores/usePreviewStore'
import { stablePathDigest } from '../../../../utils/fileUtils'
import { usePreviewLifecycle, type UsePreviewLifecycleOptions } from './usePreviewLifecycle'

const mockLogger = vi.hoisted(() => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}))
vi.mock('../../../../utils/logger', () => ({ logger: mockLogger }))

let open: Mock
let close: Mock

/** Options for a tab minted for a.html. */
function optionsFor(overrides: Partial<UsePreviewLifecycleOptions> = {}): UsePreviewLifecycleOptions {
  return {
    panelId: 'preview-a',
    filePath: '/proj/a.html',
    placeholderRef: { current: null },
    ...overrides
  }
}

function mount(initial: UsePreviewLifecycleOptions = optionsFor()) {
  return renderHook((props: UsePreviewLifecycleOptions) => usePreviewLifecycle(props), {
    initialProps: initial
  })
}

beforeEach(() => {
  open = vi.fn().mockResolvedValue({ ok: true })
  close = vi.fn().mockResolvedValue(undefined)
  ;(window as unknown as { api: unknown }).api = { preview: { open, close } }
})

afterEach(() => {
  usePreviewStore.getState().reset()
  vi.clearAllMocks()
})

describe('usePreviewLifecycle – keyed by panel id (issue #124, part 3 §3.4)', () => {
  it('opens once on mount with the panel id and the page', async () => {
    mount()

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ panelId: 'preview-a', filePath: '/proj/a.html' })
    )
  })

  it('neither closes nor re-opens when the tab moves to another page', async () => {
    const { rerender } = mount()
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))

    rerender(optionsFor({ filePath: '/proj/b.html' }))
    await act(async () => {})

    expect(open).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
  })

  it('sends the page the tab shows NOW when it resumes after a move', async () => {
    const { rerender } = mount()
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    rerender(optionsFor({ filePath: '/proj/b.html' }))

    act(() => {
      usePreviewStore.getState().setLoadState('preview-a', 'suspended')
    })

    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ panelId: 'preview-a', filePath: '/proj/b.html' })
    )
  })

  it('does not resume a background tab', async () => {
    mount(optionsFor({ isVisible: false }))
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))

    act(() => {
      usePreviewStore.getState().setLoadState('preview-a', 'suspended')
    })
    await act(async () => {})

    expect(open).toHaveBeenCalledTimes(1)
  })

  it('treats another panel id as another tab: the old view closes, the new one opens', async () => {
    const { rerender } = mount()
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))

    rerender(optionsFor({ panelId: 'preview-b', filePath: '/proj/b.html' }))

    expect(close).toHaveBeenCalledWith('preview-a')
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ panelId: 'preview-b' }))
  })

  it('closes on unmount and forgets the panel, its holder mark included', async () => {
    const { unmount } = mount()
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    usePreviewStore.getState().setLoadState('preview-a', 'ready')
    usePreviewStore.getState().setHolder('preview-a')

    unmount()

    expect(close).toHaveBeenCalledWith('preview-a')
    expect(usePreviewStore.getState().getPanel('preview-a')).toBeUndefined()
    expect(usePreviewStore.getState().holderPanelId).toBeNull()
  })

  it('swallows a close that rejects – the destroy is best effort', async () => {
    close.mockRejectedValue(new Error('gone'))
    const { unmount } = mount()
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))

    expect(() => unmount()).not.toThrow()
  })
})

describe('usePreviewLifecycle – refusals', () => {
  it('reports the other-window refusal and records the holder', async () => {
    open.mockResolvedValue({
      ok: false,
      errorCode: ErrorCode.PREVIEW_VIEW_LIMIT_REACHED,
      holderPanelId: 'preview-other'
    })

    const { result } = mount()

    await waitFor(() => expect(result.current.limitReached).toBe(true))
    expect(result.current.holderPanelId).toBe('preview-other')
    expect(usePreviewStore.getState().holderPanelId).toBe('preview-other')
  })

  it('reports the refusal without a holder when main names none', async () => {
    open.mockResolvedValue({ ok: false, errorCode: ErrorCode.PREVIEW_VIEW_LIMIT_REACHED })

    const { result } = mount()

    await waitFor(() => expect(result.current.limitReached).toBe(true))
    expect(result.current.holderPanelId).toBeNull()
    expect(usePreviewStore.getState().holderPanelId).toBeNull()
  })

  it('shows no banner for a superseded first open, and logs it', async () => {
    open.mockResolvedValue({ ok: false, errorCode: ErrorCode.PREVIEW_OPEN_SUPERSEDED })

    const { result } = mount()

    await waitFor(() => expect(mockLogger.debug).toHaveBeenCalledWith(
      'Preview open superseded',
      { panelId: stablePathDigest('preview-a'), file: 'a.html' }
    ))
    expect(result.current.openFailed).toBe(false)
    expect(result.current.limitReached).toBe(false)
  })

  it('collapses to the failed view on any other refusal', async () => {
    open.mockResolvedValue({ ok: false, errorCode: ErrorCode.PREVIEW_OPEN_INVALID_REQUEST })

    const { result } = mount()

    await waitFor(() => expect(result.current.openFailed).toBe(true))
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Preview open failed',
      { panelId: stablePathDigest('preview-a'), errorCode: ErrorCode.PREVIEW_OPEN_INVALID_REQUEST }
    )
  })

  it('collapses to the failed view when the open throws', async () => {
    open.mockRejectedValue(new Error('ipc down'))

    const { result } = mount()

    await waitFor(() => expect(result.current.openFailed).toBe(true))
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Preview open threw',
      expect.any(Error),
      { panelId: stablePathDigest('preview-a') }
    )
  })

  it('ignores an answer that lands after unmount', async () => {
    let answer: (value: unknown) => void = () => {}
    open.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result, unmount } = mount()
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))

    unmount()
    await act(async () => {
      answer({ ok: false, errorCode: ErrorCode.PREVIEW_OPEN_INVALID_REQUEST })
    })

    expect(result.current.openFailed).toBe(false)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })
})
