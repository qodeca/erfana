// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * TerminalPanel toolbar tooltips per platform (#143): the maximize button's
 * shortcut hint shows ⇧⌘M on macOS and Ctrl+Shift+M on Windows and Linux.
 *
 * Mocks are the same as TerminalPanel.flickering.test.tsx; the platform comes
 * from the preload bridge (`window.api.utils.getPlatform`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TEST_IDS } from '../../constants/testids'

declare global {
  interface Window {
    api: any
  }
}

// Mock xterm with dimension tracking
const mockXtermInstance = {
  cols: 80,
  rows: 24,
  buffer: {
    active: {
      viewportY: 0,
      baseY: 0
    }
  },
  parser: {
    registerCsiHandler: vi.fn().mockReturnValue({ dispose: vi.fn() })
  },
  constructor: vi.fn(),
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

vi.mock('@xterm/xterm', () => {
  return {
    Terminal: vi.fn().mockImplementation((opts) => {
      mockXtermInstance.constructor(opts)
      return mockXtermInstance
    })
  }
})

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn()
  }))
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({}))
}))

// Mock WebGL addon with context loss tracking
const mockWebglAddon = {
  onContextLoss: vi.fn(),
  dispose: vi.fn()
}

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => mockWebglAddon)
}))

vi.mock('../../utils/domUtils', () => ({
  isElementVisible: vi.fn().mockReturnValue(true)
}))

function installApi(platform: NodeJS.Platform): void {
  ;(window as any).api = {
    terminal: {
      isAvailable: vi.fn().mockResolvedValue({ success: true, available: true }),
      create: vi.fn().mockResolvedValue({
        success: true,
        terminalId: 'test-terminal-1',
        shellKind: 'posix'
      }),
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
      getPlatform: vi.fn().mockReturnValue(platform)
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
}

describe('TerminalPanel toolbar tooltips (#143)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows Ctrl+Shift+M, not ⌘, on the maximize button on Windows', async () => {
    installApi('win32')
    const { TerminalPanel } = await import('./TerminalPanel')
    render(<TerminalPanel /> as any)

    const expand = await screen.findByTestId(TEST_IDS.TERMINAL_BTN_EXPAND)
    expect(expand).toHaveAttribute('title', 'Maximize terminal (Ctrl+Shift+M)')
    expect(expand.getAttribute('title')).not.toMatch(/[⌘⌥⇧⌃]|Cmd/)
  })

  it('keeps the macOS glyphs on macOS', async () => {
    installApi('darwin')
    const { TerminalPanel } = await import('./TerminalPanel')
    render(<TerminalPanel /> as any)

    const expand = await screen.findByTestId(TEST_IDS.TERMINAL_BTN_EXPAND)
    expect(expand).toHaveAttribute('title', 'Maximize terminal (⇧⌘M)')
  })
})
