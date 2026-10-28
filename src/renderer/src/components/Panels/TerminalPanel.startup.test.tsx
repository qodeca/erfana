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
import type { TerminalBridge } from '../../../../shared/ipc/terminal-schema'
import { gatewayBridgeMock, type BridgeMock } from '../../test-utils/gatewayBridgeMock'

const terminalMock = (): BridgeMock<TerminalBridge> => gatewayBridgeMock('terminal')

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
  Terminal: vi.fn().mockImplementation(function () { return mockXtermInstance })
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function () { return ({ fit: vi.fn() }) })
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(function () { return ({}) })
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(function () { return ({ onContextLoss: vi.fn(), dispose: vi.fn() }) })
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
      markClearComplete: vi.fn(),
      ackOutput: vi.fn()
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
  await waitFor(() => expect(terminalMock().create).toHaveBeenCalled())
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
    terminalMock().onClear.mockImplementation((cb: ClearHandler) => {
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
    await waitFor(() => expect(terminalMock().onData).toHaveBeenCalled())
    clearHandler!({ terminalId: TERMINAL_ID })
    await waitFor(() => expect(terminalMock().markClearComplete).toHaveBeenCalledWith(TERMINAL_ID))
    const dataOrder = terminalMock().onData.mock.invocationCallOrder[0]
    const confirmOrder = terminalMock().markClearComplete.mock.invocationCallOrder[0]
    expect(dataOrder).toBeLessThan(confirmOrder)
  })

  it('ignores a clear event for another terminal', async () => {
    await renderPanel()
    await waitFor(() => expect(terminalMock().onData).toHaveBeenCalled())
    clearHandler!({ terminalId: 'some-other-terminal' })
    expect(clearWrites()).toBe(0)
    expect(terminalMock().markClearComplete).not.toHaveBeenCalled()
  })

  it('holds a clear event that arrives before create resolves and runs it for the right id', async () => {
    let resolveCreate: (v: unknown) => void = () => {}
    terminalMock().create.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve })
    )
    await renderPanel()
    clearHandler!({ terminalId: TERMINAL_ID })
    expect(clearWrites()).toBe(0)
    resolveCreate({ success: true, terminalId: TERMINAL_ID, shellKind: 'posix' })
    await waitFor(() => expect(terminalMock().markClearComplete).toHaveBeenCalledWith(TERMINAL_ID))
    expect(clearWrites()).toBe(1)
    // the clear ran before the data effect did, yet the confirmation still waited for it
    expect(terminalMock().onData.mock.invocationCallOrder[0]).toBeLessThan(
      terminalMock().markClearComplete.mock.invocationCallOrder[0]
    )
  })

  it('does not run an early clear event that belongs to another terminal', async () => {
    let resolveCreate: (v: unknown) => void = () => {}
    terminalMock().create.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve })
    )
    await renderPanel()
    clearHandler!({ terminalId: 'some-other-terminal' })
    resolveCreate({ success: true, terminalId: TERMINAL_ID, shellKind: 'posix' })
    await waitFor(() => expect(terminalMock().onData).toHaveBeenCalled())
    expect(clearWrites()).toBe(0)
    expect(terminalMock().markClearComplete).not.toHaveBeenCalled()
  })

  it('acknowledges output once xterm has parsed it (flow control)', async () => {
    let dataHandler: ((d: { terminalId: string; data: string }) => void) | null = null
    terminalMock().onData.mockImplementation((cb: typeof dataHandler) => {
      dataHandler = cb
      return vi.fn()
    })
    // Hold the parse callbacks so the test decides when xterm is done
    const parsed: Array<() => void> = []
    mockXtermInstance.write.mockImplementation((_d: string, cb?: () => void) => {
      if (cb) parsed.push(cb)
    })
    await renderPanel()
    await waitFor(() => expect(dataHandler).not.toBeNull())
    parsed.length = 0

    const batch = 'x'.repeat(16 * 1024)
    dataHandler!({ terminalId: TERMINAL_ID, data: batch })
    dataHandler!({ terminalId: TERMINAL_ID, data: batch })
    dataHandler!({ terminalId: 'some-other-terminal', data: batch })
    expect(terminalMock().ackOutput).not.toHaveBeenCalled()

    for (const done of parsed.splice(0)) done()
    expect(terminalMock().ackOutput).toHaveBeenCalledExactlyOnceWith(TERMINAL_ID, 32 * 1024)
  })

  describe('hidden window (flow control)', () => {
    let visibility: DocumentVisibilityState = 'visible'
    beforeEach(() => {
      visibility = 'visible'
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    })
    afterEach(() => {
      delete (document as unknown as { visibilityState?: unknown }).visibilityState
    })

    async function panelWithHeldParses() {
      let dataHandler: ((d: { terminalId: string; data: string }) => void) | null = null
      terminalMock().onData.mockImplementation((cb: typeof dataHandler) => {
        dataHandler = cb
        return vi.fn()
      })
      const parsed: Array<() => void> = []
      mockXtermInstance.write.mockImplementation((_d: string, cb?: () => void) => {
        if (cb) parsed.push(cb)
      })
      await renderPanel()
      await waitFor(() => expect(dataHandler).not.toBeNull())
      parsed.length = 0
      return { send: (data: string) => dataHandler!({ terminalId: TERMINAL_ID, data }), parsed }
    }

    it('acks on receipt while hidden, before xterm has parsed anything', async () => {
      const { send, parsed } = await panelWithHeldParses()
      visibility = 'hidden'
      send('x'.repeat(32 * 1024))
      expect(terminalMock().ackOutput).toHaveBeenCalledExactlyOnceWith(TERMINAL_ID, 32 * 1024)
      // Written without a parse callback, so it can never be counted twice
      expect(parsed).toHaveLength(0)
      expect(mockXtermInstance.write).toHaveBeenLastCalledWith('x'.repeat(32 * 1024), undefined)
    })

    it('releases output still being parsed when the window hides, and counts it once', async () => {
      const { send, parsed } = await panelWithHeldParses()
      send('x'.repeat(16 * 1024))
      send('x'.repeat(8 * 1024))
      expect(terminalMock().ackOutput).not.toHaveBeenCalled()

      visibility = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      expect(terminalMock().ackOutput).toHaveBeenCalledExactlyOnceWith(TERMINAL_ID, 24 * 1024)

      // The parses finish later: nothing more is reported for them
      for (const done of parsed.splice(0)) done()
      expect(terminalMock().ackOutput).toHaveBeenCalledTimes(1)

      // Visible again: acks follow the parse callbacks once more
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
      send('x'.repeat(32 * 1024))
      expect(terminalMock().ackOutput).toHaveBeenCalledTimes(1)
      for (const done of parsed.splice(0)) done()
      expect(terminalMock().ackOutput).toHaveBeenLastCalledWith(TERMINAL_ID, 32 * 1024)
    })
  })
})
