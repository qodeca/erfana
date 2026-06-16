// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * FileConflictNotification.test.tsx
 *
 * Test coverage for the FileConflictNotification component.
 *
 * Test groups:
 * - Rendering (2 tests)
 * - Test IDs (4 tests)
 * - Accessibility (2 tests)
 * - Callbacks (3 tests)
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileConflictNotification } from './FileConflictNotification'
import { TEST_IDS } from '../../constants/testids'

const defaultProps = {
  fileName: 'example.md',
  onReload: vi.fn(),
  onKeepLocal: vi.fn(),
  onDismiss: vi.fn()
}

function renderComponent(overrides: Partial<typeof defaultProps> = {}) {
  return render(<FileConflictNotification {...defaultProps} {...overrides} />)
}

describe('FileConflictNotification', () => {
  describe('Rendering', () => {
    it('should render the notification with the file name', () => {
      renderComponent()
      expect(screen.getByText('example.md')).toBeInTheDocument()
    })

    it('should display the conflict message', () => {
      renderComponent()
      expect(
        screen.getByText('Your version may be outdated. Choose an action:')
      ).toBeInTheDocument()
    })
  })

  describe('Test IDs', () => {
    it('should have data-testid on the container', () => {
      renderComponent()
      expect(screen.getByTestId(TEST_IDS.FILE_CONFLICT_NOTIFICATION)).toBeInTheDocument()
    })

    it('should have data-testid on the reload button', () => {
      renderComponent()
      expect(screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_RELOAD)).toBeInTheDocument()
    })

    it('should have data-testid on the keep button', () => {
      renderComponent()
      expect(screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_KEEP)).toBeInTheDocument()
    })

    it('should have data-testid on the dismiss button', () => {
      renderComponent()
      expect(screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_DISMISS)).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have role="alert" on the container', () => {
      renderComponent()
      const container = screen.getByTestId(TEST_IDS.FILE_CONFLICT_NOTIFICATION)
      expect(container).toHaveAttribute('role', 'alert')
    })

    it('should have aria-label="Dismiss" on the dismiss button', () => {
      renderComponent()
      const dismissBtn = screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_DISMISS)
      expect(dismissBtn).toHaveAttribute('aria-label', 'Dismiss')
    })
  })

  describe('Callbacks', () => {
    it('should call onReload when reload button is clicked', () => {
      const onReload = vi.fn()
      renderComponent({ onReload })

      fireEvent.click(screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_RELOAD))
      expect(onReload).toHaveBeenCalledOnce()
    })

    it('should call onKeepLocal when keep button is clicked', () => {
      const onKeepLocal = vi.fn()
      renderComponent({ onKeepLocal })

      fireEvent.click(screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_KEEP))
      expect(onKeepLocal).toHaveBeenCalledOnce()
    })

    it('should call onDismiss when dismiss button is clicked', () => {
      const onDismiss = vi.fn()
      renderComponent({ onDismiss })

      fireEvent.click(screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_DISMISS))
      expect(onDismiss).toHaveBeenCalledOnce()
    })
  })
})
