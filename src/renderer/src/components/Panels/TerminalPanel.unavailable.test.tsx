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

describe('TerminalPanel unavailable flow', () => {
  beforeEach(() => {
    ;(window as any).api = {
      terminal: {
        isAvailable: vi.fn().mockResolvedValue({ success: true, available: false }),
        create: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn().mockReturnValue(() => {}),
        onExit: vi.fn().mockReturnValue(() => {}),
        onError: vi.fn().mockReturnValue(() => {})
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
        capture: vi.fn().mockResolvedValue({ success: true, filePath: '/tmp/screenshot.png' })
      }
    }
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
  })

  it('shows unavailable message with actions and recheck debounces', async () => {
    const { TerminalPanel } = await import('./TerminalPanel')
    render(<TerminalPanel /> as any)

    // Wait for unavailable header (uses real timers, fine for async rendering)
    await waitFor(() => {
      expect(screen.getByText('Terminal Not Available')).toBeInTheDocument()
    })

    const recheckBtn = screen.getByRole('button', { name: /recheck/i })
    expect(recheckBtn).toBeEnabled()

    // Click recheck triggers cooldown
    fireEvent.click(recheckBtn)
    expect(recheckBtn).toBeDisabled()

    // NOW switch to fake timers for the cooldown part
    vi.useFakeTimers()

    // Advance fake timers to release cooldown (1000ms cooldown + buffer)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })

    // Button should be enabled after cooldown
    expect(recheckBtn).toBeEnabled()

    vi.useRealTimers()
  })

  it('copies fix command to clipboard', async () => {
    const { TerminalPanel } = await import('./TerminalPanel')
    render(<TerminalPanel /> as any)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy fix command/i })).toBeInTheDocument()
    })

    const copyBtn = screen.getByRole('button', { name: /copy fix command/i })
    fireEvent.click(copyBtn)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('npm rebuild node-pty --build-from-source')
  })
})
