// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useXtermSession key handler (#90, carried into the hook with the develop
 * merge): Shift+F10 and the Menu key open the terminal's context menu and
 * never reach the shell; every other key goes to the panel's handler.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import { useXtermSession, type UseXtermSessionOptions } from './useXtermSession'
import { resetKeyboardMenuEcho } from '../../../ContextMenu/contextMenuKey'

type KeyHandler = (event: KeyboardEvent) => boolean
let keyHandler: KeyHandler | null = null
let contextMenuListener: ((e: MouseEvent) => void) | null = null

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => {
    const element = document.createElement('div')
    const addListener = element.addEventListener.bind(element)
    element.addEventListener = ((type: string, listener: EventListener, options?: unknown) => {
      if (type === 'contextmenu') contextMenuListener = listener as (e: MouseEvent) => void
      addListener(type, listener, options as AddEventListenerOptions)
    }) as typeof element.addEventListener
    return {
      cols: 80,
      rows: 24,
      element,
      textarea: document.createElement('textarea'),
      open: vi.fn(),
      loadAddon: vi.fn(),
      dispose: vi.fn(),
      write: vi.fn(),
      clear: vi.fn(),
      blur: vi.fn(),
      focus: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      attachCustomKeyEventHandler: vi.fn((handler: KeyHandler) => {
        keyHandler = handler
      }),
      attachCustomWheelEventHandler: vi.fn()
    }
  })
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() })) }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: vi.fn().mockImplementation(() => ({})) }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({ onContextLoss: vi.fn(), dispose: vi.fn() }))
}))
vi.mock('../../../../utils/domUtils', () => ({ isElementVisible: vi.fn().mockReturnValue(true) }))
vi.mock('../terminalPanel.logic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../terminalPanel.logic')>()
  return { ...actual, ensureTerminalFontLoaded: () => Promise.resolve() }
})

function installApi(): void {
  ;(window as any).api = {
    terminal: {
      create: vi.fn().mockResolvedValue({ success: true, terminalId: 'pty-1', shellKind: 'posix' }),
      write: vi.fn(),
      kill: vi.fn().mockResolvedValue({ success: true }),
      onClear: vi.fn(() => vi.fn()),
      markClearComplete: vi.fn()
    }
  }
}

async function startSession() {
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
  await act(async () => {
    await hook.result.current.start()
  })
  expect(keyHandler).not.toBeNull()
  return options
}

function key(type: string, init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent(type, { cancelable: true, ...init })
}

describe('useXtermSession menu key (#90)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    keyHandler = null
    contextMenuListener = null
    resetKeyboardMenuEcho()
    installApi()
  })

  it('Shift+F10 opens the context menu and is kept from the shell', async () => {
    const options = await startSession()

    const down = key('keydown', { key: 'F10', shiftKey: true })
    expect(keyHandler!(down)).toBe(false)
    expect(down.defaultPrevented).toBe(true)
    expect(options.onContextMenu).toHaveBeenCalledTimes(1)
    // The matching keyup is swallowed too, without opening a second menu
    expect(keyHandler!(key('keyup', { key: 'F10', shiftKey: true }))).toBe(false)
    expect(options.onContextMenu).toHaveBeenCalledTimes(1)
    expect(options.keyEventHandler).not.toHaveBeenCalled()
  })

  it('the Menu key opens it too, and the native contextmenu echo that follows is ignored', async () => {
    const options = await startSession()

    expect(keyHandler!(key('keydown', { key: 'ContextMenu' }))).toBe(false)
    expect(options.onContextMenu).toHaveBeenCalledTimes(1)
    contextMenuListener!(new MouseEvent('contextmenu', { cancelable: true, clientX: 5, clientY: 5 }))
    expect(options.onContextMenu).toHaveBeenCalledTimes(1)
  })

  it('a right-click opens the menu at the pointer without blurring xterm', async () => {
    const options = await startSession()

    contextMenuListener!(new MouseEvent('contextmenu', { cancelable: true, clientX: 12, clientY: 34 }))
    expect(options.onContextMenu).toHaveBeenCalledWith(12, 34)
    const xterm = options.xtermRef.current as unknown as { blur: ReturnType<typeof vi.fn> }
    expect(xterm.blur).not.toHaveBeenCalled()
  })

  it('every other key goes to the panel handler', async () => {
    const options = await startSession()

    const event = key('keydown', { key: 'F10' })
    expect(keyHandler!(event)).toBe(true)
    expect(options.keyEventHandler).toHaveBeenCalledWith(event)
    expect(options.onContextMenu).not.toHaveBeenCalled()
  })
})
