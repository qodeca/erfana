// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for TerminalToolbar Component
 *
 * @module TerminalPanel/components/TerminalToolbar.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TerminalToolbar } from './TerminalToolbar'
import { TEST_IDS } from '../../../../constants/testids'

// Mock the Dialog barrel - both ScreenSelectDialog and WindowPickerDialog are no-ops here
vi.mock('../../../Dialog', () => ({
  ScreenSelectDialog: vi.fn(() => null),
  WindowPickerDialog: vi.fn(() => null)
}))

describe('TerminalToolbar', () => {
  const defaultProps = {
    isTerminalReady: true,
    isScreenshotSupported: false,
    hasNativeWindowPicker: false,
    capturingMode: null,
    scrollLocked: false,
    displays: [],
    windowSources: [],
    showScreenSelectDialog: false,
    showWindowPickerDialog: false,
    isLoadingWindowSources: false,
    onCaptureScreen: vi.fn(),
    onCaptureWindow: vi.fn(),
    onCaptureArea: vi.fn(),
    onDisplaySelect: vi.fn(),
    onDisplaySelectCancel: vi.fn(),
    onWindowSelect: vi.fn(),
    onWindowPickerCancel: vi.fn(),
    onScrollToBottom: vi.fn(),
    onToggleScrollLock: vi.fn(),
    onRestart: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders terminal title', () => {
    render(<TerminalToolbar {...defaultProps} />)

    expect(screen.getByText('Terminal')).toBeInTheDocument()
  })

  it('hides control buttons when terminal not ready', () => {
    render(<TerminalToolbar {...defaultProps} isTerminalReady={false} />)

    expect(screen.queryByTestId(TEST_IDS.TERMINAL_BTN_SCROLL)).not.toBeInTheDocument()
    expect(screen.queryByTestId(TEST_IDS.TERMINAL_BTN_RESTART)).not.toBeInTheDocument()
    expect(screen.queryByTestId(TEST_IDS.TERMINAL_BTN_LOCK)).not.toBeInTheDocument()
  })

  it('shows control buttons when terminal ready', () => {
    render(<TerminalToolbar {...defaultProps} isTerminalReady={true} />)

    expect(screen.getByTestId(TEST_IDS.TERMINAL_BTN_SCROLL)).toBeInTheDocument()
    expect(screen.getByTestId(TEST_IDS.TERMINAL_BTN_RESTART)).toBeInTheDocument()
    expect(screen.getByTestId(TEST_IDS.TERMINAL_BTN_LOCK)).toBeInTheDocument()
  })

  it('hides screenshot buttons on unsupported platforms', () => {
    render(<TerminalToolbar {...defaultProps} isScreenshotSupported={false} />)

    expect(screen.queryByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_SCREEN)).not.toBeInTheDocument()
    expect(screen.queryByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_WINDOW)).not.toBeInTheDocument()
    expect(screen.queryByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_AREA)).not.toBeInTheDocument()
  })

  it('shows screenshot buttons on supported platforms', () => {
    render(<TerminalToolbar {...defaultProps} isScreenshotSupported={true} />)

    expect(screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_SCREEN)).toBeInTheDocument()
    expect(screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_WINDOW)).toBeInTheDocument()
    expect(screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_AREA)).toBeInTheDocument()
  })

  it('calls onScrollToBottom when scroll button clicked', () => {
    render(<TerminalToolbar {...defaultProps} />)

    fireEvent.click(screen.getByTestId(TEST_IDS.TERMINAL_BTN_SCROLL))

    expect(defaultProps.onScrollToBottom).toHaveBeenCalled()
  })

  it('calls onRestart when restart button clicked', () => {
    render(<TerminalToolbar {...defaultProps} />)

    fireEvent.click(screen.getByTestId(TEST_IDS.TERMINAL_BTN_RESTART))

    expect(defaultProps.onRestart).toHaveBeenCalled()
  })

  it('calls onToggleScrollLock when lock button clicked', () => {
    render(<TerminalToolbar {...defaultProps} />)

    fireEvent.click(screen.getByTestId(TEST_IDS.TERMINAL_BTN_LOCK))

    expect(defaultProps.onToggleScrollLock).toHaveBeenCalled()
  })

  it('shows active state when scroll locked', () => {
    render(<TerminalToolbar {...defaultProps} scrollLocked={true} />)

    const lockButton = screen.getByTestId(TEST_IDS.TERMINAL_BTN_LOCK)
    expect(lockButton).toHaveAttribute('aria-pressed', 'true')
    expect(lockButton).toHaveClass('icon-btn--active')
  })

  it('disables screenshot buttons during capture', () => {
    render(
      <TerminalToolbar {...defaultProps} isScreenshotSupported={true} capturingMode="screen" />
    )

    expect(screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_SCREEN)).toBeDisabled()
    expect(screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_WINDOW)).toBeDisabled()
    expect(screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_AREA)).toBeDisabled()
  })

  it('shows loading state on capturing button', () => {
    render(
      <TerminalToolbar {...defaultProps} isScreenshotSupported={true} capturingMode="window" />
    )

    const windowButton = screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_WINDOW)
    expect(windowButton).toHaveClass('icon-btn--loading')
  })

  it('calls onCaptureScreen when screen button clicked', () => {
    render(<TerminalToolbar {...defaultProps} isScreenshotSupported={true} />)

    fireEvent.click(screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_SCREEN))

    expect(defaultProps.onCaptureScreen).toHaveBeenCalled()
  })

  it('calls onCaptureWindow when window button clicked', () => {
    render(<TerminalToolbar {...defaultProps} isScreenshotSupported={true} />)

    fireEvent.click(screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_WINDOW))

    expect(defaultProps.onCaptureWindow).toHaveBeenCalled()
  })

  it('calls onCaptureArea when area button clicked', () => {
    render(<TerminalToolbar {...defaultProps} isScreenshotSupported={true} />)

    fireEvent.click(screen.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_AREA))

    expect(defaultProps.onCaptureArea).toHaveBeenCalled()
  })
})
