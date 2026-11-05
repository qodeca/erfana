// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The active editor tab's file (#453): what the project tree follows.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useActiveTabFilePath } from './useActiveTabFilePath'
import { useProjectStore } from '../stores/useProjectStore'
import { createFakeDockview } from '../test-utils/fakeDockview'

beforeEach(() => {
  useProjectStore.setState({ dockviewApi: null })
})

describe('useActiveTabFilePath', () => {
  it('is null before the editor area is ready', () => {
    const { result } = renderHook(() => useActiveTabFilePath())
    expect(result.current).toBeNull()
  })

  it('follows tab switches, and reads a tab with no file as null', () => {
    const dock = createFakeDockview()
    dock.activate('/proj/a.md')
    useProjectStore.setState({ dockviewApi: dock.api })
    const { result } = renderHook(() => useActiveTabFilePath())
    expect(result.current).toBe('/proj/a.md')

    act(() => dock.activate('/proj/docs/b.md'))
    expect(result.current).toBe('/proj/docs/b.md')

    act(() => dock.activate(null))
    expect(result.current).toBeNull()
  })

  it('follows a preview tab moving to another page', () => {
    const dock = createFakeDockview()
    dock.activate('/proj/site/index.html')
    useProjectStore.setState({ dockviewApi: dock.api })
    const { result } = renderHook(() => useActiveTabFilePath())

    act(() => dock.movePage('/proj/site/about.html'))
    expect(result.current).toBe('/proj/site/about.html')
  })

  it('picks up the editor area when it becomes ready, and lets go on unmount', () => {
    const dock = createFakeDockview()
    dock.activate('/proj/a.md')
    const { result, unmount } = renderHook(() => useActiveTabFilePath())
    expect(result.current).toBeNull()

    act(() => useProjectStore.setState({ dockviewApi: dock.api }))
    expect(result.current).toBe('/proj/a.md')

    unmount()
    expect(dock.listenerCount()).toBe(0)
  })
})
