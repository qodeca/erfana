// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

declare global {
  interface Window {
    api: any
  }
}

// Mock xterm and addons to avoid canvas usage in jsdom
vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    cols = 80
    rows = 24
    constructor(_opts?: any) {}
    open() {}
    loadAddon(_a?: any) {}
    dispose() {}
    write(_d?: string) {}
    attachCustomKeyEventHandler(_handler?: any) {}
    hasSelection() { return false }
    getSelection() { return '' }
    clearSelection() {}
    onSelectionChange() { return { dispose() {} } }
    paste(_text?: string) {}
  }
  return { Terminal: MockTerminal }
})
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss() {}; dispose() {} } }))

// Mock the central clipboard service (issue #203): the "copy fix command"
// button routes through textClipboard.writeText, not navigator.clipboard.
const mockWriteText = vi.fn()
vi.mock('../../services/textClipboard', () => ({
  textClipboard: {
    writeText: (text: string) => mockWriteText(text),
    readText: vi.fn()
  }
}))

describe('TerminalPanel unavailable flow', () => {
  beforeEach(() => {
    ;(window as any).api = {
      terminal: {
        isAvailable: vi.fn().mockResolvedValue({ success: true, available: false }),
        create: vi.fn().mockResolvedValue({ success: true, terminalId: 'term-1', shellKind: 'posix' }),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn().mockReturnValue(() => {}),
        onExit: vi.fn().mockReturnValue(() => {}),
        onError: vi.fn().mockReturnValue(() => {})
        // #164 round-2 F#1: `terminal:getShellKind` was deleted; `shellKind`
        // now travels with the `terminal:create` response above.
      },
      file: {
        onProjectChanged: vi.fn().mockReturnValue(() => {}),
        getProjectPath: vi.fn().mockResolvedValue(null),
        validatePath: vi.fn().mockResolvedValue({ exists: false })
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
    mockWriteText.mockReset().mockResolvedValue(true)
  })

  it('shows unavailable message with actions and recheck debounces', async () => {
    // Install fake timers BEFORE the click that starts the cooldown so the timer
    // is both started and advanced under fake timers. Starting a timer under
    // real timers and advancing it under fake ones is the flake this guards.
    vi.useFakeTimers()
    try {
      const { TerminalPanel } = await import('./TerminalPanel')
      render(<TerminalPanel /> as any)

      // Drive the async unavailable-header render under fake timers.
      await vi.waitFor(() => {
        expect(screen.getByText('Terminal not available')).toBeInTheDocument()
      })

      const recheckBtn = screen.getByRole('button', { name: /recheck/i })
      expect(recheckBtn).toBeEnabled()

      // Click recheck triggers the cooldown timer (now under fake timers).
      fireEvent.click(recheckBtn)
      expect(recheckBtn).toBeDisabled()

      // Advance fake timers to release cooldown (1000ms cooldown + buffer).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100)
      })

      // Button should be enabled after cooldown.
      expect(recheckBtn).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('copies fix command to clipboard', async () => {
    const { TerminalPanel } = await import('./TerminalPanel')
    render(<TerminalPanel /> as any)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy fix command/i })).toBeInTheDocument()
    })

    const copyBtn = screen.getByRole('button', { name: /copy fix command/i })
    fireEvent.click(copyBtn)
    expect(mockWriteText).toHaveBeenCalledWith('npm rebuild node-pty --build-from-source')
  })
})
