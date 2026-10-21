// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * TerminalPanel start-up clear handshake: the clear confirmation is sent only
 * once the terminal:data listener is attached (main flushes the held prompt on
 * that confirmation), clear events for other terminals are ignored, and a clear
 * event that beats the create response is held until the id is known.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useClaudeStatusStore } from '../../stores/useClaudeStatusStore'

declare global {
  interface Window {
    api: any
  }
}

const TERMINAL_ID = 'test-terminal-1'

const mockXtermInstance = {
  cols: 80,
  rows: 24,
  buffer: { active: { viewportY: 0, baseY: 0 } },
  parser: { registerCsiHandler: vi.fn().mockReturnValue({ dispose: vi.fn() }) },
  open: vi.fn(),
  loadAddon: vi.fn(),
  dispose: vi.fn(),
  write: vi.fn(),
  clear: vi.fn(),
  focus: vi.fn(),
  scrollToBottom: vi.fn(),
  onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  attachCustomKeyEventHandler: vi.fn(),
  attachCustomWheelEventHandler: vi.fn(),
  hasSelection: vi.fn().mockReturnValue(false),
  getSelection: vi.fn().mockReturnValue(''),
  clearSelection: vi.fn(),
  onSelectionChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  paste: vi.fn()
}

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => mockXtermInstance)
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() }))
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({ onContextLoss: vi.fn(), dispose: vi.fn() }))
}))

vi.mock('../../utils/domUtils', () => ({
  isElementVisible: vi.fn().mockReturnValue(true)
}))

function installApi(): void {
  ;(window as any).api = {
    terminal: {
      isAvailable: vi.fn().mockResolvedValue({ success: true, available: true }),
      create: vi.fn().mockResolvedValue({ success: true, terminalId: TERMINAL_ID, shellKind: 'posix' }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn().mockResolvedValue({ success: true }),
      onData: vi.fn().mockReturnValue(vi.fn()),
      onExit: vi.fn().mockReturnValue(vi.fn()),
      onError: vi.fn().mockReturnValue(vi.fn()),
      onClear: vi.fn().mockReturnValue(vi.fn()),
      markClearComplete: vi.fn()
    },
    file: {
      getProjectPath: vi.fn().mockResolvedValue('/test/project'),
      onProjectChanged: vi.fn().mockReturnValue(vi.fn())
    },
    utils: {
      getPathForFile: vi.fn(),
      getPlatform: vi.fn().mockReturnValue('darwin')
    },
    screenshot: {
      getDisplays: vi.fn().mockResolvedValue({ displays: [] }),
      enumerateWindows: vi
        .fn()
        .mockResolvedValue({ sources: [], truncated: false, availability: 'native-picker' }),
      capture: vi.fn().mockResolvedValue({ success: true, filePath: '/tmp/screenshot.png' }),
      getCapabilities: vi.fn().mockResolvedValue({
        supported: true,
        hasNativeWindowPicker: true,
        areaCaptureMode: 'native'
      })
    }
  }
}

const CLEAR_SEQUENCE = '\x1b[2J\x1b[3J\x1b[H'

type ClearHandler = (data: { terminalId: string }) => void
let clearHandler: ClearHandler | null = null

async function renderPanel(): Promise<void> {
  const { TerminalPanel } = await import('./TerminalPanel')
  render(<TerminalPanel {...({} as any)} />)
  await waitFor(() => expect(window.api.terminal.create).toHaveBeenCalled())
  writesBefore = rawClearWrites()
}

let writesBefore = 0
function rawClearWrites(): number {
  return mockXtermInstance.write.mock.calls.filter((c) => c[0] === CLEAR_SEQUENCE).length
}
/** Clear writes made by the handshake, not by the panel's own set-up */
function clearWrites(): number {
  return rawClearWrites() - writesBefore
}

describe('TerminalPanel start-up clear handshake', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
    clearHandler = null
    window.api.terminal.onClear.mockImplementation((cb: ClearHandler) => {
      clearHandler = cb
      return vi.fn()
    })
    // xterm runs the write callback once the data is processed
    mockXtermInstance.write.mockImplementation((_d: string, cb?: () => void) => cb?.())
    useTerminalStore.setState({ activityById: new Map(), userInputById: new Map() })
    useClaudeStatusStore.getState().reset()
  })

  afterEach(() => {
    mockXtermInstance.write.mockReset()
  })

  it('confirms the clear only after the data listener is attached', async () => {
    await renderPanel()
    await waitFor(() => expect(window.api.terminal.onData).toHaveBeenCalled())
    clearHandler!({ terminalId: TERMINAL_ID })
    await waitFor(() => expect(window.api.terminal.markClearComplete).toHaveBeenCalledWith(TERMINAL_ID))
    const dataOrder = window.api.terminal.onData.mock.invocationCallOrder[0]
    const confirmOrder = window.api.terminal.markClearComplete.mock.invocationCallOrder[0]
    expect(dataOrder).toBeLessThan(confirmOrder)
  })

  it('ignores a clear event for another terminal', async () => {
    await renderPanel()
    await waitFor(() => expect(window.api.terminal.onData).toHaveBeenCalled())
    clearHandler!({ terminalId: 'some-other-terminal' })
    expect(clearWrites()).toBe(0)
    expect(window.api.terminal.markClearComplete).not.toHaveBeenCalled()
  })

  it('holds a clear event that arrives before create resolves and runs it for the right id', async () => {
    let resolveCreate: (v: unknown) => void = () => {}
    window.api.terminal.create.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve })
    )
    await renderPanel()
    clearHandler!({ terminalId: TERMINAL_ID })
    expect(clearWrites()).toBe(0)
    resolveCreate({ success: true, terminalId: TERMINAL_ID, shellKind: 'posix' })
    await waitFor(() => expect(window.api.terminal.markClearComplete).toHaveBeenCalledWith(TERMINAL_ID))
    expect(clearWrites()).toBe(1)
    // the clear ran before the data effect did, yet the confirmation still waited for it
    expect(window.api.terminal.onData.mock.invocationCallOrder[0]).toBeLessThan(
      window.api.terminal.markClearComplete.mock.invocationCallOrder[0]
    )
  })

  it('does not run an early clear event that belongs to another terminal', async () => {
    let resolveCreate: (v: unknown) => void = () => {}
    window.api.terminal.create.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve })
    )
    await renderPanel()
    clearHandler!({ terminalId: 'some-other-terminal' })
    resolveCreate({ success: true, terminalId: TERMINAL_ID, shellKind: 'posix' })
    await waitFor(() => expect(window.api.terminal.onData).toHaveBeenCalled())
    expect(clearWrites()).toBe(0)
    expect(window.api.terminal.markClearComplete).not.toHaveBeenCalled()
  })
})
