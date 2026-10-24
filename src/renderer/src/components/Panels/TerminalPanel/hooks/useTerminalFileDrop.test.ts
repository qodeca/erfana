// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useTerminalFileDrop: document-level drop listeners that type dropped file
 * paths into the terminal, attached and detached as one set.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import { useTerminalFileDrop } from './useTerminalFileDrop'

const sendToTerminal = vi.fn()
const formatPathsForActiveTerminal = vi.fn((paths: string[]) => paths.join(' '))

vi.mock('../../../../stores/useTerminalStore', () => ({
  useTerminalStore: {
    getState: () => ({ sendToTerminal, formatPathsForActiveTerminal })
  }
}))

vi.mock('../../../../utils/toastHelpers', () => ({ showWarningToast: vi.fn() }))

const overPanel = { value: true }
vi.mock('../../../../utils/domGeometry', () => ({
  isPointInElement: vi.fn(() => overPanel.value)
}))

vi.mock('../../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { showWarningToast } from '../../../../utils/toastHelpers'

/** A drag event jsdom can dispatch, with the parts of DataTransfer the hook reads */
function dragEvent(type: string, files: File[] = [new File(['x'], 'a.txt')]): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  Object.assign(event, { clientX: 5, clientY: 5 })
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files, dropEffect: 'none' }
  })
  return event
}

function setup(terminalId: string | null = 'term-1') {
  const terminalPanelRef = { current: document.createElement('div') }
  const terminalIdRef = { current: terminalId }
  const xterm = { focus: vi.fn() } as unknown as Terminal
  const hook = renderHook(() => useTerminalFileDrop({ terminalPanelRef }))
  return { hook, xterm, terminalIdRef }
}

describe('useTerminalFileDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    overPanel.value = true
    sendToTerminal.mockResolvedValue(true)
    ;(window as unknown as { api: unknown }).api = {
      utils: { getPathForFile: vi.fn((f: File) => `/abs/${f.name}`) }
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('types the dropped paths into the terminal and focuses it', async () => {
    const { hook, xterm, terminalIdRef } = setup()
    act(() => hook.result.current.attachFileDrop(xterm, terminalIdRef))

    document.dispatchEvent(dragEvent('drop'))

    await vi.waitFor(() => expect(xterm.focus).toHaveBeenCalled())
    expect(formatPathsForActiveTerminal).toHaveBeenCalledWith(['/abs/a.txt'])
    expect(sendToTerminal).toHaveBeenCalledWith('/abs/a.txt', false)
    hook.result.current.detachFileDrop()
  })

  it('shows the drop target while a file drag is over the panel, and clears it on dragend', () => {
    const { hook, xterm, terminalIdRef } = setup()
    act(() => hook.result.current.attachFileDrop(xterm, terminalIdRef))

    act(() => {
      document.dispatchEvent(dragEvent('dragenter'))
    })
    expect(hook.result.current.isDropTarget).toBe(true)

    act(() => {
      document.dispatchEvent(dragEvent('dragend'))
    })
    expect(hook.result.current.isDropTarget).toBe(false)
    hook.result.current.detachFileDrop()
  })

  it('ignores a drop outside the panel', () => {
    const { hook, xterm, terminalIdRef } = setup()
    act(() => hook.result.current.attachFileDrop(xterm, terminalIdRef))
    overPanel.value = false

    document.dispatchEvent(dragEvent('drop'))

    expect(sendToTerminal).not.toHaveBeenCalled()
    hook.result.current.detachFileDrop()
  })

  it('ignores a drop while there is no terminal session', () => {
    const { hook, xterm, terminalIdRef } = setup(null)
    act(() => hook.result.current.attachFileDrop(xterm, terminalIdRef))

    document.dispatchEvent(dragEvent('drop'))

    expect(sendToTerminal).not.toHaveBeenCalled()
    hook.result.current.detachFileDrop()
  })

  it('warns when the terminal refuses the paths', async () => {
    sendToTerminal.mockResolvedValue(false)
    const { hook, xterm, terminalIdRef } = setup()
    act(() => hook.result.current.attachFileDrop(xterm, terminalIdRef))

    document.dispatchEvent(dragEvent('drop'))

    await vi.waitFor(() =>
      expect(showWarningToast).toHaveBeenCalledWith('Drop failed', 'Could not insert path into terminal')
    )
    expect(xterm.focus).not.toHaveBeenCalled()
    hook.result.current.detachFileDrop()
  })

  it('removes every listener on detach', () => {
    const { hook, xterm, terminalIdRef } = setup()
    act(() => hook.result.current.attachFileDrop(xterm, terminalIdRef))

    hook.result.current.detachFileDrop()
    document.dispatchEvent(dragEvent('drop'))

    expect(sendToTerminal).not.toHaveBeenCalled()
  })

  it('never doubles the listeners when attached twice', async () => {
    const { hook, xterm, terminalIdRef } = setup()
    act(() => {
      hook.result.current.attachFileDrop(xterm, terminalIdRef)
      hook.result.current.attachFileDrop(xterm, terminalIdRef)
    })

    document.dispatchEvent(dragEvent('drop'))

    await vi.waitFor(() => expect(xterm.focus).toHaveBeenCalled())
    expect(sendToTerminal).toHaveBeenCalledTimes(1)
    hook.result.current.detachFileDrop()
  })

  it('is safe to detach when nothing is attached', () => {
    const { hook } = setup()
    expect(() => hook.result.current.detachFileDrop()).not.toThrow()
  })
})
