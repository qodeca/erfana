// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link usePreviewFindShortcuts}: the keys main forwards while focus
 * is inside the native preview page, routed to the panel's actions (design
 * §1.9; issue #124, part 3 §3.7).
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePreviewFindShortcuts, type PreviewShortcutActions } from './usePreviewFindShortcuts'
import type { PreviewForwardedShortcut } from '../../../../../../shared/ipc/preview-schema'

let listener: ((payload: PreviewForwardedShortcut) => void) | null = null
const unsubscribe = vi.fn()
const onForwardedShortcut = vi.fn((callback: (payload: PreviewForwardedShortcut) => void) => {
  listener = callback
  return unsubscribe
})

beforeEach(() => {
  listener = null
  unsubscribe.mockClear()
  onForwardedShortcut.mockClear()
  ;(window as unknown as { api: unknown }).api = { preview: { onForwardedShortcut } }
})

function makeActions(overrides: Partial<PreviewShortcutActions> = {}): PreviewShortcutActions {
  return {
    openSearch: vi.fn(),
    isSearchOpen: vi.fn(() => false),
    closeSearch: vi.fn(),
    exportPdf: vi.fn(),
    closePanel: vi.fn(),
    focusChrome: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    ...overrides
  }
}

const send = (key: PreviewForwardedShortcut['key'], accel = false, panelId = 'preview-1'): void =>
  listener?.({ panelId, key, accel })

describe('usePreviewFindShortcuts', () => {
  it('routes a forwarded Back and Forward on the key alone – accel is false on every platform', () => {
    // Main matched them through the shared previewNavKeys table, whose
    // modifier is Alt on Windows and Linux, so `accel` never describes them.
    const actions = makeActions()
    renderHook(() => usePreviewFindShortcuts('preview-1', actions))

    send('back')
    expect(actions.goBack).toHaveBeenCalledTimes(1)
    send('forward')
    expect(actions.goForward).toHaveBeenCalledTimes(1)

    // The key decides, whatever the flag says.
    send('back', true)
    expect(actions.goBack).toHaveBeenCalledTimes(2)
    expect(actions.openSearch).not.toHaveBeenCalled()
  })

  it('needs accel for Cmd/Ctrl+F, +S and +W', () => {
    const actions = makeActions()
    renderHook(() => usePreviewFindShortcuts('preview-1', actions))

    send('f')
    send('s')
    send('w')
    expect(actions.openSearch).not.toHaveBeenCalled()
    expect(actions.exportPdf).not.toHaveBeenCalled()
    expect(actions.closePanel).not.toHaveBeenCalled()

    send('f', true)
    send('s', true)
    send('w', true)
    expect(actions.openSearch).toHaveBeenCalledTimes(1)
    expect(actions.exportPdf).toHaveBeenCalledTimes(1)
    expect(actions.closePanel).toHaveBeenCalledTimes(1)
  })

  it('makes Escape do one thing: close an open find bar, otherwise leave the page', () => {
    let open = true
    const actions = makeActions({ isSearchOpen: () => open })
    renderHook(() => usePreviewFindShortcuts('preview-1', actions))

    send('Escape')
    expect(actions.closeSearch).toHaveBeenCalledTimes(1)
    expect(actions.focusChrome).not.toHaveBeenCalled()

    open = false
    send('Escape')
    expect(actions.focusChrome).toHaveBeenCalledTimes(1)
    expect(actions.closeSearch).toHaveBeenCalledTimes(1)
  })

  it("ignores another panel's keys", () => {
    const actions = makeActions()
    renderHook(() => usePreviewFindShortcuts('preview-1', actions))

    send('back', false, 'preview-2')
    send('f', true, 'preview-2')
    expect(actions.goBack).not.toHaveBeenCalled()
    expect(actions.openSearch).not.toHaveBeenCalled()
  })

  it('calls the latest actions without subscribing again', () => {
    const first = makeActions()
    const second = makeActions()
    const { rerender } = renderHook(({ actions }) => usePreviewFindShortcuts('preview-1', actions), {
      initialProps: { actions: first }
    })

    rerender({ actions: second })
    send('forward')
    expect(second.goForward).toHaveBeenCalledTimes(1)
    expect(first.goForward).not.toHaveBeenCalled()
    expect(onForwardedShortcut).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => usePreviewFindShortcuts('preview-1', makeActions()))
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
