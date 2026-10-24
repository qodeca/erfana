// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal screen-reader mode (lens review [23]): the Auto / On / Off override
 * applied to what the OS reports, kept live.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { resolveScreenReaderMode, useScreenReaderSupport, useTerminalScreenReaderMode } from './useTerminalScreenReaderMode'
import { useGlobalSettingsStore } from '../stores/useGlobalSettingsStore'
import { getDefaultGlobalSettings, type TerminalScreenReaderMode } from '../../../shared/ipc/global-settings-schema'

type Support = { enabled: boolean }
let pushSupport: ((data: Support) => void) | null = null
let answerQuery: ((data: Support) => void) | null = null
const unsubscribe = vi.fn()

function installBridge(): void {
  ;(window as any).api = {
    ...(window as any).api,
    terminal: {
      getScreenReaderSupport: vi.fn(() => new Promise<Support>((resolve) => { answerQuery = resolve })),
      onScreenReaderSupportChanged: vi.fn((cb: (data: Support) => void) => {
        pushSupport = cb
        return unsubscribe
      })
    }
  }
}

function setMode(mode: TerminalScreenReaderMode | null): void {
  if (mode === null) {
    useGlobalSettingsStore.setState({ settings: null })
    return
  }
  const settings = getDefaultGlobalSettings()
  useGlobalSettingsStore.setState({ settings: { ...settings, terminal: { screenReaderMode: mode } } })
}

describe('resolveScreenReaderMode', () => {
  it.each([
    ['auto', true, true],
    ['auto', false, false],
    ['on', false, true],
    ['on', true, true],
    ['off', true, false],
    ['off', false, false]
  ] as const)('%s with OS screen reader %s -> %s', (mode, os, expected) => {
    expect(resolveScreenReaderMode(mode, os)).toBe(expected)
  })
})

describe('useScreenReaderSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushSupport = null
    answerQuery = null
    installBridge()
  })

  it('is null until main answers, then follows the answer', async () => {
    const { result } = renderHook(() => useScreenReaderSupport())
    expect(result.current).toBeNull()
    await act(async () => {
      answerQuery!({ enabled: true })
    })
    expect(result.current).toBe(true)
  })

  it('follows a pushed change', async () => {
    const { result } = renderHook(() => useScreenReaderSupport())
    await act(async () => {
      answerQuery!({ enabled: false })
    })
    act(() => pushSupport!({ enabled: true }))
    expect(result.current).toBe(true)
    act(() => pushSupport!({ enabled: false }))
    expect(result.current).toBe(false)
  })

  it('lets a pushed change win over a late answer to the first query', async () => {
    const { result } = renderHook(() => useScreenReaderSupport())
    act(() => pushSupport!({ enabled: true }))
    await act(async () => {
      answerQuery!({ enabled: false })
    })
    expect(result.current).toBe(true)
  })

  it('reads a failed query as "no screen reader"', async () => {
    ;(window as any).api.terminal.getScreenReaderSupport = vi.fn().mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useScreenReaderSupport())
    await vi.waitFor(() => expect(result.current).toBe(false))
  })

  it('reads a missing bridge as "no screen reader" without throwing', async () => {
    ;(window as any).api = { ...(window as any).api, terminal: {} }
    const { result } = renderHook(() => useScreenReaderSupport())
    await vi.waitFor(() => expect(result.current).toBe(false))
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useScreenReaderSupport())
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('useTerminalScreenReaderMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushSupport = null
    answerQuery = null
    installBridge()
  })

  it('in Auto follows the OS, live', async () => {
    setMode('auto')
    const { result } = renderHook(() => useTerminalScreenReaderMode())
    expect(result.current).toBe(false)
    await act(async () => {
      answerQuery!({ enabled: true })
    })
    expect(result.current).toBe(true)
    act(() => pushSupport!({ enabled: false }))
    expect(result.current).toBe(false)
  })

  it('On and Off override the OS, and a settings change applies at once', async () => {
    setMode('off')
    const { result } = renderHook(() => useTerminalScreenReaderMode())
    await act(async () => {
      answerQuery!({ enabled: true })
    })
    expect(result.current).toBe(false)

    act(() => setMode('on'))
    expect(result.current).toBe(true)
    act(() => pushSupport!({ enabled: false }))
    expect(result.current).toBe(true)
  })

  it('treats settings that are not loaded yet as Auto', async () => {
    setMode(null)
    const { result } = renderHook(() => useTerminalScreenReaderMode())
    await act(async () => {
      answerQuery!({ enabled: true })
    })
    expect(result.current).toBe(true)
  })
})
