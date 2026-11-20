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
 * - Not saved copy (1 test)
 * - Callbacks (4 tests)
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
    it('carries no live-region role of its own (the panel status region announces it – #478 F13)', () => {
      renderComponent()
      const container = screen.getByTestId(TEST_IDS.FILE_CONFLICT_NOTIFICATION)
      expect(container).not.toHaveAttribute('role')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('names what Dismiss does: it keeps your version (#478 U4, owner decision N6)', () => {
      renderComponent()
      expect(screen.getByRole('button', { name: 'Dismiss – keeps your version' })).toBe(
        screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_DISMISS)
      )
    })

    it('hides every icon from assistive technology: they are decoration (#478 U7)', () => {
      renderComponent()
      const icons = screen.getByTestId(TEST_IDS.FILE_CONFLICT_NOTIFICATION).querySelectorAll('svg')
      expect(icons).toHaveLength(3)
      icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'))
    })
  })

  describe('Not saved copy', () => {
    it('says the autosave was not saved when it was given up (#478 F16)', () => {
      render(<FileConflictNotification {...defaultProps} notSaved />)
      expect(screen.getByTestId(TEST_IDS.FILE_CONFLICT_NOTIFICATION)).toHaveTextContent(
        'Not saved – example.md changed on disk since it was last read.'
      )
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

    it('should call onReload with no arguments, never the click event', () => {
      const onReload = vi.fn()
      renderComponent({ onReload })

      fireEvent.click(screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_RELOAD))

      // `onReload` is backed by `useFileWatcher.reloadFromDisk(prefetched?)`.
      // Wiring it straight into `onClick` handed the synthetic mouse event in
      // as the file's new content, and the editor panel crashed rendering it.
      // The "called once" assertion above passes either way, so the argument
      // list is the part that actually guards the defect.
      expect(onReload).toHaveBeenCalledWith()
    })
  })
})
