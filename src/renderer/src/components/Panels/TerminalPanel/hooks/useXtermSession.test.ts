// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useXtermSession start-up guard (lens review [18]): a generation token
 * checked after every await, plus one start in flight per generation.
 *
 * `terminal:create` is held open with a deferred promise, so each test
 * decides exactly when main "answers" relative to a second start, a restart
 * or a teardown.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import { useTerminalStore } from '../../../../stores/useTerminalStore'
import { useClaudeStatusStore } from '../../../../stores/useClaudeStatusStore'
import { useXtermSession, type UseXtermSessionOptions } from './useXtermSession'

/** A fresh mock per `new Terminal()`, so tests can tell instances apart */
function makeXterm() {
  return {
    cols: 80,
    rows: 24,
    element: undefined as HTMLElement | undefined,
    open: vi.fn(),
    loadAddon: vi.fn(),
    dispose: vi.fn(),
    write: vi.fn(),
    clear: vi.fn(),
    blur: vi.fn(),
    focus: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    attachCustomKeyEventHandler: vi.fn(),
    attachCustomWheelEventHandler: vi.fn()
  }
}
type MockXterm = ReturnType<typeof makeXterm>
const instances: MockXterm[] = []

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
vi.mock('../../../../utils/domUtils', () => ({ isElementVisible: vi.fn().mockReturnValue(true) }))

let releaseFont: (() => void) | null = null
let rejectFont: ((err: Error) => void) | null = null
const fontGate = { held: false, error: null as Error | null }
vi.mock('../terminalPanel.logic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../terminalPanel.logic')>()
  return {
    ...actual,
    ensureTerminalFontLoaded: () => {
      if (fontGate.error) return Promise.reject(fontGate.error)
      return fontGate.held ? new Promise<void>((resolve, reject) => { releaseFont = resolve; rejectFont = reject }) : Promise.resolve()
    }
  }
})

type CreateResult = { success: true; terminalId: string; shellKind: 'posix' } | { success: false; error: string }
/** Pending `terminal:create` answers, oldest first */
const pendingCreates: Array<(result: CreateResult) => void> = []

function answerCreate(index: number, terminalId: string): void {
  pendingCreates[index]({ success: true, terminalId, shellKind: 'posix' })
}

function installApi(): void {
  ;(window as any).api = {
    terminal: {
      create: vi.fn(() => new Promise<CreateResult>((resolve) => { pendingCreates.push(resolve) })),
      write: vi.fn(),
      kill: vi.fn().mockResolvedValue({ success: true }),
      onClear: vi.fn(() => vi.fn()),
      markClearComplete: vi.fn()
    },
    claudeStatus: { register: vi.fn(), unregister: vi.fn(), nudge: vi.fn() }
  }
}

function renderSession() {
  const options: UseXtermSessionOptions = {
    xtermRef: { current: null as Terminal | null },
    containerRef: { current: document.createElement('div') },
    registerParserHooks: vi.fn(() => []),
    keyEventHandler: vi.fn(() => true),
    wheelEventHandler: vi.fn(() => true),
    onContextMenu: vi.fn(),
    attachFileDrop: vi.fn(),
    detachFileDrop: vi.fn()
  }
  const hook = renderHook(() => useXtermSession(options))
  return { hook, options }
}

/** Let the start run up to its pending `terminal:create` */
async function untilCreates(count: number): Promise<void> {
  await vi.waitFor(() => expect(window.api.terminal.create).toHaveBeenCalledTimes(count))
}

describe('useXtermSession start-up guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    instances.length = 0
    pendingCreates.length = 0
    fontGate.held = false
    fontGate.error = null
    releaseFont = null
    rejectFont = null
    installApi()
    useTerminalStore.setState({ activeTerminalId: null, activeShellKind: null, activityById: new Map(), userInputById: new Map() })
    useClaudeStatusStore.getState().reset()
  })

  it('joins a second start that runs while the first is in flight (double mount)', async () => {
    const { hook } = renderSession()

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = hook.result.current.start()
      second = hook.result.current.start()
    })
    expect(second).toBe(first)

    await untilCreates(1)
    await act(async () => {
      answerCreate(0, 'pty-1')
      await first
    })

    expect(instances).toHaveLength(1)
    expect(window.api.terminal.create).toHaveBeenCalledTimes(1)
    expect(hook.result.current.terminalId).toBe('pty-1')
  })

  it('does nothing when started again while a session is live', async () => {
    const { hook } = renderSession()
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.start()
    })
    await untilCreates(1)
    await act(async () => {
      answerCreate(0, 'pty-1')
      await first
    })

    await act(async () => {
      await hook.result.current.start()
    })

    expect(instances).toHaveLength(1)
    expect(window.api.terminal.create).toHaveBeenCalledTimes(1)
  })

  it('a restart during start kills the late PTY and keeps the new one', async () => {
    const { hook, options } = renderSession()
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.start()
    })
    await untilCreates(1)

    // Restart = teardown, then a new start, while the first create is unanswered
    let second!: Promise<void>
    await act(async () => {
      await hook.result.current.teardownTerminal({ resetState: true })
      second = hook.result.current.start()
    })
    await untilCreates(2)
    expect(instances[0].dispose).toHaveBeenCalledTimes(1)

    await act(async () => {
      answerCreate(1, 'pty-new')
      await second
    })
    await act(async () => {
      answerCreate(0, 'pty-late')
      await first
    })

    expect(window.api.terminal.kill).toHaveBeenCalledWith('pty-late')
    expect(window.api.terminal.kill).not.toHaveBeenCalledWith('pty-new')
    expect(hook.result.current.terminalId).toBe('pty-new')
    expect(useTerminalStore.getState().activeTerminalId).toBe('pty-new')
    expect(options.xtermRef.current).toBe(instances[1])
    // The late PTY's xterm never got an input handler: its keystrokes go nowhere
    expect(instances[0].onData).not.toHaveBeenCalled()
    expect(window.api.claudeStatus.register).toHaveBeenCalledTimes(1)
    expect(window.api.claudeStatus.register).toHaveBeenCalledWith('pty-new')
  })

  it('an unmount during start kills the PTY created afterwards and never activates it', async () => {
    const { hook } = renderSession()
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.start()
    })
    await untilCreates(1)

    const { teardownTerminal } = hook.result.current
    hook.unmount()
    void teardownTerminal({ resetState: false })
    answerCreate(0, 'pty-orphan')
    await first

    expect(window.api.terminal.kill).toHaveBeenCalledWith('pty-orphan')
    expect(instances[0].dispose).toHaveBeenCalledTimes(1)
    expect(useTerminalStore.getState().activeTerminalId).toBeNull()
    expect(window.api.claudeStatus.register).not.toHaveBeenCalled()
  })

  it('a teardown while the font loads never opens xterm or creates a PTY', async () => {
    fontGate.held = true
    const { hook, options } = renderSession()
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.start()
    })
    await vi.waitFor(() => expect(releaseFont).not.toBeNull())

    await act(async () => {
      await hook.result.current.teardownTerminal({ resetState: true })
      releaseFont!()
      await first
    })

    expect(instances).toHaveLength(1)
    expect(instances[0].open).not.toHaveBeenCalled()
    expect(instances[0].dispose).toHaveBeenCalledTimes(1)
    expect(window.api.terminal.create).not.toHaveBeenCalled()
    expect(options.xtermRef.current).toBeNull()
  })

  it('a teardown right after create resolves, before React commits, still kills the PTY', async () => {
    const { hook } = renderSession()
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.start()
    })
    await untilCreates(1)
    answerCreate(0, 'pty-1')
    await first

    // No act(): the state update for the id is not committed yet
    await hook.result.current.teardownTerminal({ resetState: false })

    expect(window.api.terminal.kill).toHaveBeenCalledWith('pty-1')
  })

  it('a failed start that was superseded does not report its error', async () => {
    const { hook } = renderSession()
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.start()
    })
    await untilCreates(1)

    await act(async () => {
      await hook.result.current.teardownTerminal({ resetState: true })
      pendingCreates[0]({ success: false, error: 'spawn failed' })
      await first
    })

    expect(hook.result.current.error).toBeNull()
  })
})

describe('useXtermSession failed starts (review F1, F2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    instances.length = 0
    pendingCreates.length = 0
    fontGate.held = false
    fontGate.error = null
    releaseFont = null
    rejectFont = null
    installApi()
    useTerminalStore.setState({ activeTerminalId: null, activeShellKind: null, activityById: new Map(), userInputById: new Map() })
    useClaudeStatusStore.getState().reset()
  })

  it('a failed create disposes the instance and clears the refs, so a later start creates again', async () => {
    const { hook, options } = renderSession()
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.start()
    })
    await untilCreates(1)
    await act(async () => {
      pendingCreates[0]({ success: false, error: 'spawn failed' })
      await first
    })

    expect(hook.result.current.error).toBe('spawn failed')
    expect(instances[0].dispose).toHaveBeenCalledTimes(1)
    expect(options.xtermRef.current).toBeNull()
    expect(hook.result.current.fitAddonRef.current).toBeNull()
    expect(options.detachFileDrop).toHaveBeenCalled()

    // What "Recheck" leads to: a new start, which must not be blocked by the dead instance
    let second!: Promise<void>
    act(() => {
      second = hook.result.current.start()
    })
    await untilCreates(2)
    await act(async () => {
      answerCreate(1, 'pty-2')
      await second
    })

    expect(instances).toHaveLength(2)
    expect(options.xtermRef.current).toBe(instances[1])
    expect(instances[1].dispose).not.toHaveBeenCalled()
    expect(hook.result.current.terminalId).toBe('pty-2')
  })

  it('a failed create releases the context-menu listener and parser hooks of its instance', async () => {
    const { hook, options } = renderSession()
    const parserHook = { dispose: vi.fn() }
    vi.mocked(options.registerParserHooks).mockReturnValue([parserHook])
    const element = document.createElement('div')
    const removeListener = vi.spyOn(element, 'removeEventListener')
    // Every instance gets the element, so the one this start builds has it at attach time
    vi.mocked((await import('@xterm/xterm')).Terminal).mockImplementationOnce(() => {
      const xterm = makeXterm()
      xterm.element = element
      instances.push(xterm)
      return xterm as unknown as Terminal
    })

    let first!: Promise<void>
    act(() => {
      first = hook.result.current.start()
    })
    await untilCreates(1)
    await act(async () => {
      pendingCreates[0]({ success: false, error: 'spawn failed' })
      await first
    })

    expect(removeListener).toHaveBeenCalledWith('contextmenu', expect.any(Function))
    expect(parserHook.dispose).toHaveBeenCalledTimes(1)
    expect(instances[0].dispose).toHaveBeenCalledTimes(1)
  })

  it('a font load that throws disposes the instance it built and reports the error', async () => {
    fontGate.error = new Error('font failed')
    const { hook, options } = renderSession()

    await act(async () => {
      await hook.result.current.start()
    })

    expect(instances).toHaveLength(1)
    expect(instances[0].open).not.toHaveBeenCalled()
    expect(instances[0].dispose).toHaveBeenCalledTimes(1)
    expect(window.api.terminal.create).not.toHaveBeenCalled()
    expect(options.xtermRef.current).toBeNull()
    expect(hook.result.current.error).toBe('font failed')
  })

  it('an open() that throws disposes the instance and leaves the refs empty', async () => {
    const { hook, options } = renderSession()
    vi.mocked((await import('@xterm/xterm')).Terminal).mockImplementationOnce(() => {
      const xterm = makeXterm()
      xterm.open.mockImplementation(() => {
        throw new Error('open failed')
      })
      instances.push(xterm)
      return xterm as unknown as Terminal
    })

    await act(async () => {
      await hook.result.current.start()
    })

    expect(instances[0].dispose).toHaveBeenCalledTimes(1)
    expect(options.xtermRef.current).toBeNull()
    expect(window.api.terminal.create).not.toHaveBeenCalled()
    expect(hook.result.current.error).toBe('open failed')

    // The next start is not blocked
    let second!: Promise<void>
    act(() => {
      second = hook.result.current.start()
    })
    await untilCreates(1)
    await act(async () => {
      answerCreate(0, 'pty-1')
      await second
    })
    expect(options.xtermRef.current).toBe(instances[1])
  })

  it('a superseded start whose font load throws still disposes its instance', async () => {
    fontGate.held = true
    const { hook } = renderSession()
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.start()
    })
    await vi.waitFor(() => expect(releaseFont).not.toBeNull())

    // The teardown cannot reach this instance: it was never in the refs
    await act(async () => {
      await hook.result.current.teardownTerminal({ resetState: true })
    })
    expect(instances[0].dispose).not.toHaveBeenCalled()

    await act(async () => {
      rejectFont!(new Error('font failed late'))
      await first
    })
    expect(instances[0].open).not.toHaveBeenCalled()
    expect(instances[0].dispose).toHaveBeenCalledTimes(1)
    expect(hook.result.current.error).toBeNull()
  })
})
