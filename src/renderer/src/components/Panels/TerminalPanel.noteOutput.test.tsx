// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * TerminalPanel feeds every output batch to useTerminalStore.noteOutput (#449).
 *
 * A prompt send presses Enter once the terminal's output has gone quiet after
 * the paste, and noteOutput is the only source of that output time. Without
 * the call every send would fall back to the no-output delay; with a
 * throttled call (like markActivity's) the pauses between pieces of a paste
 * would be mis-measured. So: each batch, unthrottled, for this panel's
 * terminal only – including during the start-up warm-up, when markActivity is
 * skipped.
 *
 * Same xterm / window.api mocks as TerminalPanel.scroll.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { ISplitviewPanelProps } from 'dockview'
import type { TerminalBridge } from '../../../../shared/ipc/terminal-schema'
import { gatewayBridgeMock, type BridgeMock } from '../../test-utils/gatewayBridgeMock'
import { useTerminalStore } from '../../stores/useTerminalStore'

// TerminalPanel ignores its dockview props, so an empty object stands in for them.
const PANEL_PROPS = {} as ISplitviewPanelProps
const TERMINAL_ID = 'test-terminal-1'

const terminalMock = (): BridgeMock<TerminalBridge> => gatewayBridgeMock('terminal')

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
  FitAddon: vi.fn().mockImplementation(function () { return ({ fit: vi.fn(), proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })) }) })
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

describe('TerminalPanel output reaches noteOutput (#449)', () => {
  let onDataCallback: ((data: { terminalId: string; data: string }) => void) | null = null
  let onClearCallback: ((data: { terminalId: string }) => void) | null = null
  const noteOutput = vi.fn()
  const originalNoteOutput = useTerminalStore.getState().noteOutput

  beforeEach(() => {
    vi.clearAllMocks()
    onDataCallback = null
    onClearCallback = null
    // Store state is copied forward on every set, so the stand-in stays in place
    useTerminalStore.setState({ noteOutput })

    ;(window as any).api = {
      terminal: {
        isAvailable: vi.fn().mockResolvedValue({ success: true, available: true }),
        create: vi.fn().mockResolvedValue({ success: true, terminalId: TERMINAL_ID, shellKind: 'posix' }),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn().mockResolvedValue({ success: true }),
        onData: vi.fn().mockImplementation((callback) => {
          onDataCallback = callback
          return vi.fn()
        }),
        onExit: vi.fn().mockReturnValue(vi.fn()),
        onError: vi.fn().mockReturnValue(vi.fn()),
        onClear: vi.fn().mockImplementation((callback) => {
          onClearCallback = callback
          return vi.fn()
        }),
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
        enumerateWindows: vi.fn().mockResolvedValue({ sources: [], truncated: false, availability: 'native-picker' }),
        capture: vi.fn().mockResolvedValue({ success: true, filePath: '/tmp/screenshot.png' }),
        getCapabilities: vi.fn().mockResolvedValue({
          supported: true,
          hasNativeWindowPicker: true,
          areaCaptureMode: 'native'
        })
      }
    }
  })

  afterEach(() => {
    useTerminalStore.setState({ noteOutput: originalNoteOutput })
  })

  /** Render the panel, finish the bootstrap clear, and return the live output handler. */
  async function startPanel(): Promise<(data: { terminalId: string; data: string }) => void> {
    const { TerminalPanel } = await import('./TerminalPanel')
    render(<TerminalPanel {...PANEL_PROPS} />)

    await waitFor(() => {
      expect(terminalMock().create).toHaveBeenCalled()
      expect(onClearCallback).not.toBeNull()
    })
    onClearCallback!({ terminalId: TERMINAL_ID })
    const writeCallback = mockXtermInstance.write.mock.calls[0]?.[1]
    if (writeCallback) writeCallback()

    await waitFor(() => expect(onDataCallback).not.toBeNull())
    noteOutput.mockClear()
    return onDataCallback!
  }

  it('notes every output batch for the panel’s terminal, with its id, unthrottled', async () => {
    const onData = await startPanel()

    // Five batches in the same instant – a throttle would let only the first through
    for (let i = 0; i < 5; i++) onData({ terminalId: TERMINAL_ID, data: `piece ${i}\r\n` })

    expect(noteOutput).toHaveBeenCalledTimes(5)
    for (const call of noteOutput.mock.calls) expect(call).toEqual([TERMINAL_ID])
  })

  it('notes output right after start-up, during the warm-up that skips markActivity', async () => {
    const originalMarkActivity = useTerminalStore.getState().markActivity
    const markActivity = vi.fn()
    useTerminalStore.setState({ markActivity })
    // Clock held still, so the batch is inside the 500 ms warm-up however slow the host
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      const onData = await startPanel()

      onData({ terminalId: TERMINAL_ID, data: 'prompt redraw' })

      expect(noteOutput).toHaveBeenCalledWith(TERMINAL_ID)
      // Shows the batch really fell inside the warm-up window
      expect(markActivity).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
      useTerminalStore.setState({ markActivity: originalMarkActivity })
    }
  })

  it('does not note output that belongs to another terminal', async () => {
    const onData = await startPanel()

    onData({ terminalId: 'some-other-terminal', data: 'not ours' })

    expect(noteOutput).not.toHaveBeenCalled()
  })
})
