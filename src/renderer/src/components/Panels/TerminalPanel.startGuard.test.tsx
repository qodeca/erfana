// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * TerminalPanel start-up races (lens review [18]), through the real panel:
 * a remount, a fast project switch and an unmount while `terminal:create` is
 * still unanswered must leave exactly one live PTY, kill the others, and never
 * write a superseded PTY's output into the terminal that replaced it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useClaudeStatusStore } from '../../stores/useClaudeStatusStore'

declare global {
  interface Window {
    api: any
  }
}

function makeXterm() {
  return {
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
}
const instances: Array<ReturnType<typeof makeXterm>> = []

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => {
    const xterm = makeXterm()
    instances.push(xterm)
    return xterm
  })
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() })) }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: vi.fn().mockImplementation(() => ({})) }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({ onContextLoss: vi.fn(), dispose: vi.fn() }))
}))
vi.mock('../../utils/domUtils', () => ({ isElementVisible: vi.fn().mockReturnValue(true) }))

type CreateResult = { success: true; terminalId: string; shellKind: 'posix' }
const pendingCreates: Array<(result: CreateResult) => void> = []
const projectListeners: Array<(data: { newPath: string | null }) => void> = []
let dataListener: ((d: { terminalId: string; data: string }) => void) | null = null

function installApi(): void {
  ;(window as any).api = {
    terminal: {
      isAvailable: vi.fn().mockResolvedValue({ success: true, available: true }),
      create: vi.fn(() => new Promise<CreateResult>((resolve) => { pendingCreates.push(resolve) })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn().mockResolvedValue({ success: true }),
      getActivity: vi.fn().mockResolvedValue({ success: true, busy: false }),
      onData: vi.fn((cb: typeof dataListener) => {
        dataListener = cb
        return vi.fn()
      }),
      onExit: vi.fn().mockReturnValue(vi.fn()),
      onError: vi.fn().mockReturnValue(vi.fn()),
      onClear: vi.fn().mockReturnValue(vi.fn()),
      markClearComplete: vi.fn(),
      ackOutput: vi.fn()
    },
    file: {
      getProjectPath: vi.fn().mockResolvedValue('/test/project'),
      onProjectChanged: vi.fn((cb: (data: { newPath: string | null }) => void) => {
        projectListeners.push(cb)
        return vi.fn()
      })
    },
    utils: { getPathForFile: vi.fn(), getPlatform: vi.fn().mockReturnValue('darwin') },
    screenshot: {
      getDisplays: vi.fn().mockResolvedValue({ displays: [] }),
      enumerateWindows: vi.fn().mockResolvedValue({ sources: [], truncated: false, availability: 'native-picker' }),
      capture: vi.fn().mockResolvedValue({ success: true, filePath: '/tmp/s.png' }),
      getCapabilities: vi.fn().mockResolvedValue({ supported: false, hasNativeWindowPicker: true, areaCaptureMode: 'native' })
    }
  }
}

async function mountPanel() {
  const { TerminalPanel } = await import('./TerminalPanel')
  return render(<TerminalPanel {...({} as any)} />)
}

async function answerCreate(index: number, terminalId: string): Promise<void> {
  await act(async () => {
    pendingCreates[index]({ success: true, terminalId, shellKind: 'posix' })
  })
}

/** Emit a project switch on the panel's restart listener (the second subscription) */
async function switchProject(newPath: string): Promise<void> {
  await act(async () => {
    for (const listener of projectListeners) listener({ newPath })
  })
}

describe('TerminalPanel start-up guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    instances.length = 0
    pendingCreates.length = 0
    projectListeners.length = 0
    dataListener = null
    installApi()
    useTerminalStore.setState({ activeTerminalId: null, activeShellKind: null, activityById: new Map(), userInputById: new Map() })
    useClaudeStatusStore.getState().reset()
  })

  it('a remount during start leaves one live PTY and kills the first', async () => {
    const first = await mountPanel()
    await waitFor(() => expect(window.api.terminal.create).toHaveBeenCalledTimes(1))
    first.unmount()

    await mountPanel()
    await waitFor(() => expect(window.api.terminal.create).toHaveBeenCalledTimes(2))
    await answerCreate(1, 'pty-second')
    await answerCreate(0, 'pty-first')

    await waitFor(() => expect(window.api.terminal.kill).toHaveBeenCalledWith('pty-first'))
    expect(window.api.terminal.kill).not.toHaveBeenCalledWith('pty-second')
    expect(useTerminalStore.getState().activeTerminalId).toBe('pty-second')
    // Two instances were made; only the first one is disposed
    expect(instances).toHaveLength(2)
    expect(instances[0].dispose).toHaveBeenCalledTimes(1)
    expect(instances[1].dispose).not.toHaveBeenCalled()
  })

  it('a fast project switch during start keeps only the last PTY and drops late output', async () => {
    await mountPanel()
    await waitFor(() => expect(window.api.terminal.create).toHaveBeenCalledTimes(1))

    await switchProject('/project/b')
    await waitFor(() => expect(window.api.terminal.create).toHaveBeenCalledTimes(2))
    await switchProject('/project/c')
    await waitFor(() => expect(window.api.terminal.create).toHaveBeenCalledTimes(3))

    // Main answers in the worst order: newest first, then the stale ones
    await answerCreate(2, 'pty-c')
    await answerCreate(0, 'pty-a')
    await answerCreate(1, 'pty-b')

    await waitFor(() => expect(window.api.terminal.kill).toHaveBeenCalledWith('pty-a'))
    await waitFor(() => expect(window.api.terminal.kill).toHaveBeenCalledWith('pty-b'))
    expect(window.api.terminal.kill).not.toHaveBeenCalledWith('pty-c')
    expect(useTerminalStore.getState().activeTerminalId).toBe('pty-c')
    await waitFor(() => expect(dataListener).not.toBeNull())

    const live = instances[2]
    live.write.mockClear()
    act(() => {
      dataListener!({ terminalId: 'pty-a', data: 'late output from A' })
      dataListener!({ terminalId: 'pty-c', data: 'output from C' })
    })
    expect(live.write).toHaveBeenCalledTimes(1)
    expect(live.write).toHaveBeenCalledWith('output from C', expect.any(Function))
  })

  it('an unmount during start kills the PTY created afterwards', async () => {
    const view = await mountPanel()
    await waitFor(() => expect(window.api.terminal.create).toHaveBeenCalledTimes(1))

    view.unmount()
    await answerCreate(0, 'pty-orphan')

    await waitFor(() => expect(window.api.terminal.kill).toHaveBeenCalledWith('pty-orphan'))
    expect(useTerminalStore.getState().activeTerminalId).toBeNull()
    expect(instances[0].dispose).toHaveBeenCalledTimes(1)
  })
})
