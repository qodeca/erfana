// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * TerminalPanel teardown (lens review [51], [52], [53]): unmount, restart and a
 * project switch all go through the session's single `teardownTerminal`, so
 * each one releases the start-up clear listener, the file-drop listeners and
 * the parser hooks, clears every pending timer, and disposes xterm before the
 * PTY kill.
 *
 * Timers are faked so the test decides when the panel's own timers fire.
 * `vi.waitFor` (not Testing Library's, whose async wrapper waits on a real
 * `setTimeout`) advances them by 1 ms per check, far below the 50 ms fit
 * delay, so a timer armed at start-up is still pending when a test acts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { TEST_IDS } from '../../constants/testids'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useClaudeStatusStore } from '../../stores/useClaudeStatusStore'

declare global {
  interface Window {
    api: any
  }
}

const TERMINAL_ID = 'test-terminal-1'
/** Poll every 1 ms of fake time, see the header */
const WAIT = { interval: 1, timeout: 2000 }

type Listener = () => void
const parserDisposable = { dispose: vi.fn() }
const inputDisposable = { dispose: vi.fn() }
let inputHandler: ((data: string) => void) | null = null

const mockXtermInstance = {
  cols: 80,
  rows: 24,
  element: document.createElement('div'),
  buffer: { active: { viewportY: 0, baseY: 0 } },
  parser: { registerCsiHandler: vi.fn(() => parserDisposable) },
  open: vi.fn(),
  loadAddon: vi.fn(),
  dispose: vi.fn(),
  write: vi.fn(),
  clear: vi.fn(),
  blur: vi.fn(),
  focus: vi.fn(),
  scrollToBottom: vi.fn(),
  onData: vi.fn((cb: (data: string) => void) => {
    inputHandler = cb
    return inputDisposable
  }),
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

const fit = vi.fn()
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit }))
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({}))
}))

let contextLoss: Listener | null = null
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    onContextLoss: vi.fn((cb: Listener) => {
      contextLoss = cb
    }),
    dispose: vi.fn()
  }))
}))

vi.mock('../../utils/domUtils', () => ({
  isElementVisible: vi.fn().mockReturnValue(true)
}))

import { WebglAddon } from '@xterm/addon-webgl'

/** One unsubscribe mock per onClear subscription, in subscription order */
const clearUnsubscribes: Array<ReturnType<typeof vi.fn>> = []
let projectChanged: ((data: { newPath: string | null }) => void) | null = null

function installApi(): void {
  ;(window as any).api = {
    terminal: {
      isAvailable: vi.fn().mockResolvedValue({ success: true, available: true }),
      create: vi.fn().mockResolvedValue({ success: true, terminalId: TERMINAL_ID, shellKind: 'posix' }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn().mockResolvedValue({ success: true }),
      getActivity: vi.fn().mockResolvedValue({ success: true, busy: false }),
      onData: vi.fn().mockReturnValue(vi.fn()),
      onExit: vi.fn().mockReturnValue(vi.fn()),
      onError: vi.fn().mockReturnValue(vi.fn()),
      onClear: vi.fn(() => {
        const unsubscribe = vi.fn()
        clearUnsubscribes.push(unsubscribe)
        return unsubscribe
      }),
      markClearComplete: vi.fn(),
      ackOutput: vi.fn()
    },
    claudeStatus: {
      register: vi.fn().mockResolvedValue(undefined),
      unregister: vi.fn().mockResolvedValue(undefined),
      nudge: vi.fn().mockResolvedValue(undefined)
    },
    file: {
      getProjectPath: vi.fn().mockResolvedValue('/test/project'),
      onProjectChanged: vi.fn((cb: (data: { newPath: string | null }) => void) => {
        projectChanged = cb
        return vi.fn()
      })
    },
    utils: {
      getPathForFile: vi.fn(),
      getPlatform: vi.fn().mockReturnValue('darwin')
    },
    screenshot: {
      getDisplays: vi.fn().mockResolvedValue({ displays: [] }),
      enumerateWindows: vi.fn().mockResolvedValue({ sources: [], truncated: false, availability: 'native-picker' }),
      capture: vi.fn().mockResolvedValue({ success: true, filePath: '/tmp/screenshot.png' }),
      getCapabilities: vi.fn().mockResolvedValue({ supported: false, hasNativeWindowPicker: true, areaCaptureMode: 'native' })
    }
  }
}

async function renderPanel() {
  const { TerminalPanel } = await import('./TerminalPanel')
  const view = render(<TerminalPanel {...({} as any)} />)
  await vi.waitFor(() => expect(useTerminalStore.getState().activeTerminalId).toBe(TERMINAL_ID), WAIT)
  // The toolbar renders once the panel has committed the id, so teardown can see it
  await vi.waitFor(() => expect(screen.getByTestId(TEST_IDS.TERMINAL_BTN_RESTART)).toBeTruthy(), WAIT)
  return view
}

/** Document-level listeners added for `type` in the capture phase, minus those removed */
function captureListenerCount(spyAdd: ReturnType<typeof vi.spyOn>, spyRemove: ReturnType<typeof vi.spyOn>, type: string): number {
  const count = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.filter((c: unknown[]) => c[0] === type && (c[2] as { capture?: boolean } | undefined)?.capture).length
  return count(spyAdd) - count(spyRemove)
}

describe('TerminalPanel teardown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    clearUnsubscribes.length = 0
    projectChanged = null
    inputHandler = null
    contextLoss = null
    installApi()
    useTerminalStore.setState({ activityById: new Map(), userInputById: new Map(), activeTerminalId: null, activeShellKind: null })
    useClaudeStatusStore.getState().reset()
  })

  afterEach(() => {
    vi.useRealTimers()
    // Spies only: restoreAllMocks would also strip the module mocks' implementations
    vi.mocked(document.addEventListener).mockRestore?.()
    vi.mocked(document.removeEventListener).mockRestore?.()
    vi.mocked(mockXtermInstance.element.removeEventListener).mockRestore?.()
  })

  it('on unmount releases every listener, disposes xterm and kills the PTY', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const elementRemove = vi.spyOn(mockXtermInstance.element, 'removeEventListener')
    const { unmount } = await renderPanel()
    expect(captureListenerCount(addSpy, removeSpy, 'drop')).toBe(1)

    unmount()

    expect(clearUnsubscribes).toHaveLength(1)
    expect(clearUnsubscribes[0]).toHaveBeenCalledTimes(1)
    expect(captureListenerCount(addSpy, removeSpy, 'drop')).toBe(0)
    expect(elementRemove).toHaveBeenCalledWith('contextmenu', expect.any(Function))
    expect(parserDisposable.dispose).toHaveBeenCalled()
    expect(inputDisposable.dispose).toHaveBeenCalled()
    expect(mockXtermInstance.dispose).toHaveBeenCalledTimes(1)
    expect(window.api.terminal.kill).toHaveBeenCalledWith(TERMINAL_ID)
    expect(window.api.claudeStatus.unregister).toHaveBeenCalledWith(TERMINAL_ID)
    // Disposed before the kill is sent, so no output lands on a dying instance
    expect(mockXtermInstance.dispose.mock.invocationCallOrder[0]).toBeLessThan(
      window.api.terminal.kill.mock.invocationCallOrder[0]
    )
  })

  it('on unmount clears the pending fit and Claude-nudge timers', async () => {
    const { unmount } = await renderPanel()
    // A keystroke arms the 1 s Claude-status nudge
    inputHandler!('a')
    fit.mockClear()

    // Both still pending: the fit (50 ms) and the nudge (1 s)
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2)
    unmount()
    // The fit callback checks xtermRef itself, so `fit` not running proves
    // little: the timers must be gone, not merely harmless
    expect(vi.getTimerCount()).toBe(0)
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(fit).not.toHaveBeenCalled()
    expect(window.api.claudeStatus.nudge).not.toHaveBeenCalled()
  })

  it('on unmount cancels a pending WebGL recovery', async () => {
    const { unmount } = await renderPanel()
    expect(contextLoss).not.toBeNull()
    contextLoss!()
    vi.mocked(WebglAddon).mockClear()

    unmount()
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(WebglAddon).not.toHaveBeenCalled()
  })

  it('on restart releases the first session\'s clear listener before starting the next', async () => {
    await renderPanel()

    await act(async () => {
      screen.getByTestId(TEST_IDS.TERMINAL_BTN_RESTART).click()
      await vi.advanceTimersByTimeAsync(200)
    })

    await vi.waitFor(() => expect(window.api.terminal.create).toHaveBeenCalledTimes(2), WAIT)
    expect(clearUnsubscribes).toHaveLength(2)
    expect(clearUnsubscribes[0]).toHaveBeenCalledTimes(1)
    expect(clearUnsubscribes[1]).not.toHaveBeenCalled()
    expect(window.api.terminal.kill).toHaveBeenCalledWith(TERMINAL_ID)
  })

  it('on a project switch leaves one set of file-drop listeners, not two', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    await renderPanel()

    await act(async () => {
      projectChanged!({ newPath: '/other/project' })
    })

    await vi.waitFor(() => expect(window.api.terminal.create).toHaveBeenCalledTimes(2), WAIT)
    expect(clearUnsubscribes[0]).toHaveBeenCalledTimes(1)
    expect(captureListenerCount(addSpy, removeSpy, 'drop')).toBe(1)
    expect(mockXtermInstance.dispose).toHaveBeenCalledTimes(1)
  })

  it('on a project switch to no project tears down and starts nothing', async () => {
    await renderPanel()

    await act(async () => {
      projectChanged!({ newPath: null })
    })

    await vi.waitFor(() => expect(window.api.terminal.kill).toHaveBeenCalledWith(TERMINAL_ID), WAIT)
    expect(window.api.terminal.create).toHaveBeenCalledTimes(1)
    expect(useTerminalStore.getState().activeTerminalId).toBeNull()
  })
})
