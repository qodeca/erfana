// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useXtermSession key handler (#90, carried into the hook with the develop
 * merge): Shift+F10 and the Menu key open the terminal's context menu and
 * never reach the shell; every other key goes to the panel's handler.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import { useXtermSession, type UseXtermSessionOptions } from './useXtermSession'
import { resetKeyboardMenuEcho } from '../../../ContextMenu/contextMenuKey'

type KeyHandler = (event: KeyboardEvent) => boolean

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}
let keyHandler: KeyHandler | null = null
let contextMenuListener: ((e: MouseEvent) => void) | null = null

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function () {
    const element = document.createElement('div')
    // Panel at (100, 200); 80 x 24 cells of 8 x 16 px from (104, 204)
    element.getBoundingClientRect = () => rect(100, 200, 700, 400)
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    screen.getBoundingClientRect = () => rect(104, 204, 640, 384)
    element.appendChild(screen)
    const addListener = element.addEventListener.bind(element)
    element.addEventListener = ((type: string, listener: EventListener, options?: unknown) => {
      if (type === 'contextmenu') contextMenuListener = listener as (e: MouseEvent) => void
      addListener(type, listener, options as AddEventListenerOptions)
    }) as typeof element.addEventListener
    return {
      cols: 80,
      rows: 24,
      element,
      // Parked off-screen like the panel's CSS does: the menu must not anchor here
      textarea: Object.assign(document.createElement('textarea'), {
        getBoundingClientRect: () => ({ left: -9999, top: -9999, right: -9999, bottom: -9999, width: 0, height: 0 })
      }),
      buffer: { active: { cursorX: 2, cursorY: 1, baseY: 0, viewportY: 0 } },
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
vi.mock('@xterm/addon-fit', () => ({ FitAddon: vi.fn().mockImplementation(function () { return ({ fit: vi.fn() }) }) }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: vi.fn().mockImplementation(function () { return ({}) }) }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(function () { return ({ onContextLoss: vi.fn(), dispose: vi.fn() }) })
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
    detachFileDrop: vi.fn(),
    screenReaderMode: false
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
    // Below the cursor cell (col 2, row 1), not the parked textarea's corner
    expect(options.onContextMenu).toHaveBeenCalledWith(104 + 2 * 8, 204 + 2 * 16)
    // The matching keyup is swallowed too, without opening a second menu
    expect(keyHandler!(key('keyup', { key: 'F10', shiftKey: true }))).toBe(false)
    expect(options.onContextMenu).toHaveBeenCalledTimes(1)
    expect(options.keyEventHandler).not.toHaveBeenCalled()
  })

  it('the Menu key opens it too, and the native contextmenu echo that follows is ignored', async () => {
    const options = await startSession()

    const down = key('keydown', { key: 'ContextMenu' })
    expect(keyHandler!(down)).toBe(false)
    expect(down.defaultPrevented).toBe(true)
    expect(options.onContextMenu).toHaveBeenCalledTimes(1)
    expect(options.keyEventHandler).not.toHaveBeenCalled()
    contextMenuListener!(new MouseEvent('contextmenu', { cancelable: true, clientX: 5, clientY: 5 }))
    expect(options.onContextMenu).toHaveBeenCalledTimes(1)
  })

  it('a right-click opens the menu at the pointer without blurring xterm', async () => {
    const options = await startSession()

    contextMenuListener!(new MouseEvent('contextmenu', { cancelable: true, clientX: 12, clientY: 34 }))
    expect(options.onContextMenu).toHaveBeenCalledWith(12, 34)
    const xterm = options.xtermRef.current as unknown as { blur: Mock }
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
