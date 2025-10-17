import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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
      file: { onProjectChanged: vi.fn().mockReturnValue(() => {}) }
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

    // Expect unavailable header
    expect(await screen.findByText('Terminal Not Available')).toBeInTheDocument()

    const recheckBtn = screen.getByRole('button', { name: /recheck/i })
    expect(recheckBtn).toBeEnabled()
    // Click recheck triggers cooldown
    fireEvent.click(recheckBtn)
    expect(recheckBtn).toBeDisabled()
    // Wait real time to release cooldown
    await new Promise((r) => setTimeout(r, 1100))
    expect(recheckBtn).toBeEnabled()
  })

  it('copies fix command to clipboard', async () => {
    const { TerminalPanel } = await import('./TerminalPanel')
    render(<TerminalPanel /> as any)
    const copyBtn = await screen.findByRole('button', { name: /copy fix command/i })
    fireEvent.click(copyBtn)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('npm rebuild node-pty --build-from-source')
  })
})
