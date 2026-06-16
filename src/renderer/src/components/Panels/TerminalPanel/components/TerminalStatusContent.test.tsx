// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for TerminalStatusContent Component
 *
 * @module TerminalPanel/components/TerminalStatusContent.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TerminalStatusContent } from './TerminalStatusContent'
import { TEST_IDS } from '../../../../constants/testids'
import { NODE_PTY_FIX_COMMAND } from '../terminalPanel.logic'

describe('TerminalStatusContent', () => {
  const defaultProps = {
    state: 'ready' as const,
    errorMessage: null,
    recheckCooldown: false,
    isDropTarget: false,
    terminalContainerRef: { current: null },
    onRecheck: vi.fn(),
    onCopyFix: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checking state', () => {
    it('shows checking message', () => {
      render(<TerminalStatusContent {...defaultProps} state="checking" />)

      expect(screen.getByText('Checking terminal availability...')).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TERMINAL_STATUS_CHECKING)).toBeInTheDocument()
    })
  })

  describe('unavailable state', () => {
    it('shows unavailable message', () => {
      render(<TerminalStatusContent {...defaultProps} state="unavailable" />)

      expect(screen.getByText('Terminal not available')).toBeInTheDocument()
      expect(screen.getByText(/node-pty is not available/)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TERMINAL_STATUS_UNAVAILABLE)).toBeInTheDocument()
    })

    it('shows error details when provided', () => {
      render(
        <TerminalStatusContent {...defaultProps} state="unavailable" errorMessage="Module not found" />
      )

      expect(screen.getByText('Module not found')).toBeInTheDocument()
    })

    it('shows recheck button', () => {
      render(<TerminalStatusContent {...defaultProps} state="unavailable" />)

      expect(screen.getByText('Recheck')).toBeInTheDocument()
    })

    it('shows copy fix button', () => {
      render(<TerminalStatusContent {...defaultProps} state="unavailable" />)

      expect(screen.getByText('Copy fix command')).toBeInTheDocument()
    })

    it('shows fix command hint', () => {
      render(<TerminalStatusContent {...defaultProps} state="unavailable" />)

      expect(screen.getByText(NODE_PTY_FIX_COMMAND)).toBeInTheDocument()
    })

    it('calls onRecheck when recheck clicked', () => {
      render(<TerminalStatusContent {...defaultProps} state="unavailable" />)

      fireEvent.click(screen.getByText('Recheck'))

      expect(defaultProps.onRecheck).toHaveBeenCalled()
    })

    it('calls onCopyFix when copy fix clicked', () => {
      render(<TerminalStatusContent {...defaultProps} state="unavailable" />)

      fireEvent.click(screen.getByText('Copy fix command'))

      expect(defaultProps.onCopyFix).toHaveBeenCalled()
    })

    it('disables recheck during cooldown', () => {
      render(<TerminalStatusContent {...defaultProps} state="unavailable" recheckCooldown={true} />)

      expect(screen.getByText('Recheck')).toBeDisabled()
    })
  })

  describe('error state', () => {
    it('shows error message', () => {
      render(<TerminalStatusContent {...defaultProps} state="error" />)

      expect(screen.getByText('Terminal error')).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TERMINAL_STATUS_ERROR)).toBeInTheDocument()
    })

    it('shows error details when provided', () => {
      render(
        <TerminalStatusContent {...defaultProps} state="error" errorMessage="Connection refused" />
      )

      expect(screen.getByText('Connection refused')).toBeInTheDocument()
    })
  })

  describe('ready state', () => {
    it('shows terminal container', () => {
      render(<TerminalStatusContent {...defaultProps} state="ready" />)

      expect(screen.getByTestId(TEST_IDS.TERMINAL_INSTANCE)).toBeInTheDocument()
    })

    it('sets drop target data attribute when active', () => {
      render(<TerminalStatusContent {...defaultProps} state="ready" isDropTarget={true} />)

      const container = screen.getByTestId(TEST_IDS.TERMINAL_INSTANCE)
      expect(container).toHaveAttribute('data-drop-target', 'true')
    })

    it('sets aria-dropeffect when drop target', () => {
      render(<TerminalStatusContent {...defaultProps} state="ready" isDropTarget={true} />)

      const container = screen.getByTestId(TEST_IDS.TERMINAL_INSTANCE)
      expect(container).toHaveAttribute('aria-dropeffect', 'copy')
    })

    it('has no aria-dropeffect when not drop target', () => {
      render(<TerminalStatusContent {...defaultProps} state="ready" isDropTarget={false} />)

      const container = screen.getByTestId(TEST_IDS.TERMINAL_INSTANCE)
      expect(container).toHaveAttribute('aria-dropeffect', 'none')
    })
  })
})
