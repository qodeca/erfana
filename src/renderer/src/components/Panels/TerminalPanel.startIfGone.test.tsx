// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `useStartIfGone` over the real TerminalPanel's restart control – the
 * built-in browser's **Open terminal** (spec 025, 025-FR-061, 025-AC-077): a
 * new terminal only once the current one's shell has exited, never over a
 * live one, without asking and without taking focus. Mocks are the same as
 * TerminalPanel.restart.test.tsx.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { TerminalPortalProvider, useTerminalPortal } from '../../context/TerminalPortalContext'
import { DialogProvider } from '../Dialog/DialogContext'
import { DialogManager } from '../Dialog/DialogManager'
import { useStartIfGone } from './TerminalPanel/hooks/useStartIfGone'
import { useTerminalStore } from '../../stores/useTerminalStore'
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

/** Render the panel with a probe that uses the hook as the browser does; hand back its start function. */
async function renderPanel(): Promise<{ start: () => Promise<boolean> }> {
  const { TerminalPanel } = await import('./TerminalPanel')
  let start: (() => Promise<boolean>) | null = null
  function Probe(): null {
    const portal = useTerminalPortal()
    const terminalId = useTerminalStore((s) => s.activeTerminalId)
    start = useStartIfGone(terminalId, async () => {
      await portal.terminalControls?.restart()
    })
    return null
  }
  render(
    <DialogProvider>
      <TerminalPortalProvider>
        <TerminalPanel {...({} as any)} />
        <Probe />
      </TerminalPortalProvider>
      <DialogManager />
    </DialogProvider>
  )
  await waitFor(() => expect(terminalMock().create).toHaveBeenCalledOnce())
  await waitFor(() => expect(useTerminalStore.getState().activeTerminalId).toBe(TERMINAL_ID))
  return { start: () => start!() }
}

/** The shell of `terminalId` exits, as main reports it. */
function exitShell(terminalId: string): void {
  for (const [listener] of terminalMock().onExit.mock.calls as unknown as Array<[(data: { terminalId: string; exitCode: number }) => void]>) {
    listener({ terminalId, exitCode: 0 })
  }
}

describe('TerminalPanel startIfGone (025-FR-061 Open terminal)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
    useTerminalStore.setState({ activityById: new Map(), userInputById: new Map() })
  })

  it('does nothing while the shell runs, starts a new terminal once it has exited, and only once', async () => {
    const { start } = await renderPanel()
    expect(await start()).toBe(false)
    expect(terminalMock().create).toHaveBeenCalledOnce()
    expect(terminalMock().kill).not.toHaveBeenCalled()

    terminalMock().create.mockResolvedValueOnce({ success: true, terminalId: 'test-terminal-2', shellKind: 'posix' })
    act(() => exitShell(TERMINAL_ID))
    // An exit of another terminal is not this one's.
    act(() => exitShell('someone-else'))
    let started: Promise<boolean> | undefined
    act(() => {
      started = start()
    })
    // A second press while the first is starting does not start another.
    expect(await start()).toBe(false)
    await act(async () => {
      expect(await started).toBe(true)
    })
    expect(terminalMock().kill).toHaveBeenCalledWith(TERMINAL_ID)
    await waitFor(() => expect(useTerminalStore.getState().activeTerminalId).toBe('test-terminal-2'))
    expect(terminalMock().create).toHaveBeenCalledTimes(2)
    // No restart prompt was shown for the exited terminal, and no focus was taken.
    expect(document.querySelector('[role="alertdialog"], [role="dialog"]')).toBeNull()
    expect(mockXtermInstance.focus).not.toHaveBeenCalled()
    // The new terminal runs: nothing more to start.
    expect(await start()).toBe(false)
    expect(terminalMock().create).toHaveBeenCalledTimes(2)
  })
})
