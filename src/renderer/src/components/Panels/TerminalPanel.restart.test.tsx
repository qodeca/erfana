// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * TerminalPanel "Restart terminal" confirmation (lens review [25]).
 *
 * Restart kills the PTY and whatever runs in it, so it asks first while the
 * terminal looks busy and restarts straight away while it is idle. Mocks are
 * the same as TerminalPanel.tooltips.test.tsx, plus the real DialogProvider +
 * DialogManager so the actual ConfirmDialog renders.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TEST_IDS } from '../../constants/testids'
import { DialogProvider } from '../Dialog/DialogContext'
import { DialogManager } from '../Dialog/DialogManager'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useClaudeStatusStore } from '../../stores/useClaudeStatusStore'

declare global {
  interface Window {
    api: any
  }
}

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
  Terminal: vi.fn().mockImplementation(() => mockXtermInstance)
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() }))
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({ onContextLoss: vi.fn(), dispose: vi.fn() }))
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

/** Render the panel inside the real dialog system and wait for its PTY. */
async function renderPanel(): Promise<void> {
  const { TerminalPanel } = await import('./TerminalPanel')
  render(
    <DialogProvider>
      <TerminalPanel {...({} as any)} />
      <DialogManager />
    </DialogProvider>
  )
  await waitFor(() => expect(window.api.terminal.create).toHaveBeenCalled())
}

/** The user typed in the terminal and it is still producing output. */
function makeTerminalBusy(): void {
  const store = useTerminalStore.getState()
  store.markUserInput(TERMINAL_ID)
  store.markActivity(TERMINAL_ID)
}

describe('TerminalPanel restart confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
    useTerminalStore.setState({ activityById: new Map(), userInputById: new Map() })
    useClaudeStatusStore.getState().reset()
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    document.getElementById('portal-root')?.remove()
  })

  it('restarts an idle terminal without asking', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByTestId(TEST_IDS.TERMINAL_BTN_RESTART))

    await waitFor(() => expect(window.api.terminal.kill).toHaveBeenCalledWith(TERMINAL_ID))
    expect(screen.queryByTestId(TEST_IDS.DIALOG_CONFIRM)).not.toBeInTheDocument()
  })

  it('asks first while the terminal is busy, with focus on Cancel', async () => {
    const user = userEvent.setup()
    await renderPanel()
    makeTerminalBusy()

    await user.click(screen.getByTestId(TEST_IDS.TERMINAL_BTN_RESTART))

    expect(await screen.findByTestId(TEST_IDS.DIALOG_CONFIRM)).toBeInTheDocument()
    expect(screen.getByTestId(TEST_IDS.DIALOG_TITLE)).toHaveTextContent('Restart terminal?')
    // Danger prompt: the destructive button is red and does not hold focus.
    expect(screen.getByTestId(TEST_IDS.DIALOG_BTN_CONFIRM)).toHaveClass('dialog-btn-danger')
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId(TEST_IDS.DIALOG_BTN_CANCEL))
    )
    expect(window.api.terminal.kill).not.toHaveBeenCalled()
  })

  it('asks while Claude Code runs in the terminal, even with no recent output', async () => {
    const user = userEvent.setup()
    await renderPanel()
    useClaudeStatusStore.getState().setSnapshot({
      terminalId: TERMINAL_ID,
      snapshot: {
        terminalId: TERMINAL_ID,
        modelId: 'claude-opus-4-8',
        friendlyName: 'Opus 4.8',
        windowSize: 200000,
        usedTokens: 1000,
        percent: 1,
        level: 'green',
        tooltip: '1k / 200k',
        inferred: false
      }
    })

    await user.click(screen.getByTestId(TEST_IDS.TERMINAL_BTN_RESTART))

    expect(await screen.findByTestId(TEST_IDS.DIALOG_CONFIRM_MESSAGE)).toHaveTextContent(
      /Claude Code is running/
    )
    expect(window.api.terminal.kill).not.toHaveBeenCalled()
  })

  it('keeps the terminal when the user cancels', async () => {
    const user = userEvent.setup()
    await renderPanel()
    makeTerminalBusy()

    await user.click(screen.getByTestId(TEST_IDS.TERMINAL_BTN_RESTART))
    await user.click(await screen.findByTestId(TEST_IDS.DIALOG_BTN_CANCEL))

    await waitFor(() =>
      expect(screen.queryByTestId(TEST_IDS.DIALOG_CONFIRM)).not.toBeInTheDocument()
    )
    expect(window.api.terminal.kill).not.toHaveBeenCalled()
    expect(window.api.terminal.create).toHaveBeenCalledTimes(1)
  })

  it('opens one prompt for a double click on Restart', async () => {
    const user = userEvent.setup()
    await renderPanel()
    makeTerminalBusy()

    const restart = screen.getByTestId(TEST_IDS.TERMINAL_BTN_RESTART)
    await user.click(restart)
    await screen.findByTestId(TEST_IDS.DIALOG_CONFIRM)
    // jsdom does no hit-testing, so this click reaches the button even though
    // the dialog backdrop covers it in the app – the latch is what stops it.
    await user.click(restart)

    expect(screen.getAllByTestId(TEST_IDS.DIALOG_CONFIRM)).toHaveLength(1)
  })

  it('restarts once the user confirms', async () => {
    const user = userEvent.setup()
    await renderPanel()
    makeTerminalBusy()

    await user.click(screen.getByTestId(TEST_IDS.TERMINAL_BTN_RESTART))
    await user.click(await screen.findByTestId(TEST_IDS.DIALOG_BTN_CONFIRM))

    await waitFor(() => expect(window.api.terminal.kill).toHaveBeenCalledWith(TERMINAL_ID))
  })
})
