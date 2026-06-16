// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * UIBlocker.test.tsx
 *
 * todo004: Comprehensive test coverage for UIBlocker component
 *
 * Test groups:
 * - Visibility (4 tests)
 * - Event blocking (8 tests)
 * - Content (4 tests)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UIBlocker, UIBlockerBase } from './UIBlocker'
import { TEST_IDS } from '../../constants/testids'

// Mock useProjectStore
const mockIsProjectChanging = vi.fn(() => false)

vi.mock('../../stores/useProjectStore', () => ({
  useProjectStore: (selector: (state: { isProjectChanging: boolean }) => boolean) => {
    return selector({ isProjectChanging: mockIsProjectChanging() })
  }
}))

describe('UIBlocker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Visibility', () => {
    it('should not render when isProjectChanging is false', () => {
      mockIsProjectChanging.mockReturnValue(false)
      const { container } = render(<UIBlocker />)
      expect(container.querySelector('.ui-blocker')).toBeNull()
    })

    it('should render when isProjectChanging is true', () => {
      mockIsProjectChanging.mockReturnValue(true)
      render(<UIBlocker />)
      expect(screen.getByTitle('Waiting for folder selection...')).toBeInTheDocument()
    })

    it('should update visibility when store changes', () => {
      mockIsProjectChanging.mockReturnValue(false)
      const { container, rerender } = render(<UIBlocker />)
      expect(container.querySelector('.ui-blocker')).toBeNull()

      mockIsProjectChanging.mockReturnValue(true)
      rerender(<UIBlocker />)
      expect(container.querySelector('.ui-blocker')).toBeInTheDocument()
    })

    it('should hide when isProjectChanging changes to false', () => {
      mockIsProjectChanging.mockReturnValue(true)
      const { container, rerender } = render(<UIBlocker />)
      expect(container.querySelector('.ui-blocker')).toBeInTheDocument()

      mockIsProjectChanging.mockReturnValue(false)
      rerender(<UIBlocker />)
      expect(container.querySelector('.ui-blocker')).toBeNull()
    })
  })

  describe('Event blocking', () => {
    beforeEach(() => {
      mockIsProjectChanging.mockReturnValue(true)
    })

    it('should prevent onClick', () => {
      render(<UIBlocker />)
      const blocker = screen.getByTitle('Waiting for folder selection...')
      const event = fireEvent.click(blocker)
      // fireEvent returns false when preventDefault was called
      expect(event).toBe(false)
    })

    it('should prevent onContextMenu', () => {
      render(<UIBlocker />)
      const blocker = screen.getByTitle('Waiting for folder selection...')
      const event = fireEvent.contextMenu(blocker)
      expect(event).toBe(false)
    })

    it('should prevent onDoubleClick', () => {
      render(<UIBlocker />)
      const blocker = screen.getByTitle('Waiting for folder selection...')
      const event = fireEvent.doubleClick(blocker)
      expect(event).toBe(false)
    })

    it('should prevent onMouseDown', () => {
      render(<UIBlocker />)
      const blocker = screen.getByTitle('Waiting for folder selection...')
      const event = fireEvent.mouseDown(blocker)
      expect(event).toBe(false)
    })

    it('should prevent onMouseUp', () => {
      render(<UIBlocker />)
      const blocker = screen.getByTitle('Waiting for folder selection...')
      const event = fireEvent.mouseUp(blocker)
      expect(event).toBe(false)
    })

    it('should prevent onKeyDown', () => {
      render(<UIBlocker />)
      const blocker = screen.getByTitle('Waiting for folder selection...')
      const event = fireEvent.keyDown(blocker, { key: 'Enter' })
      expect(event).toBe(false)
    })

    it('should prevent onKeyUp', () => {
      render(<UIBlocker />)
      const blocker = screen.getByTitle('Waiting for folder selection...')
      const event = fireEvent.keyUp(blocker, { key: 'Enter' })
      expect(event).toBe(false)
    })

    it('should have onWheel handler that prevents default', () => {
      render(<UIBlocker />)
      const blocker = screen.getByTitle('Waiting for folder selection...')
      // Create a wheel event and verify it can be dispatched
      // The component calls preventDefault on wheel events
      const wheelEvent = new WheelEvent('wheel', { bubbles: true, cancelable: true })
      const preventDefaultSpy = vi.spyOn(wheelEvent, 'preventDefault')
      blocker.dispatchEvent(wheelEvent)
      expect(preventDefaultSpy).toHaveBeenCalled()
    })
  })

  describe('Content', () => {
    beforeEach(() => {
      mockIsProjectChanging.mockReturnValue(true)
    })

    it('should have ui-blocker class on root element', () => {
      const { container } = render(<UIBlocker />)
      expect(container.querySelector('.ui-blocker')).toBeInTheDocument()
    })

    it('should have ui-blocker-content container', () => {
      const { container } = render(<UIBlocker />)
      expect(container.querySelector('.ui-blocker-content')).toBeInTheDocument()
    })

    it('should have spinner element', () => {
      const { container } = render(<UIBlocker />)
      expect(container.querySelector('.ui-blocker-spinner')).toBeInTheDocument()
    })

    it('should show "Waiting for folder selection..." message', () => {
      render(<UIBlocker />)
      expect(screen.getByText('Waiting for folder selection...')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    beforeEach(() => {
      mockIsProjectChanging.mockReturnValue(true)
    })

    it('should have title attribute for tooltip', () => {
      render(<UIBlocker />)
      const blocker = screen.getByTitle('Waiting for folder selection...')
      expect(blocker).toBeInTheDocument()
    })

    it('should have role="status"', () => {
      render(<UIBlocker />)
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should have aria-live="polite"', () => {
      render(<UIBlocker />)
      const blocker = screen.getByRole('status')
      expect(blocker).toHaveAttribute('aria-live', 'polite')
    })

    it('should have aria-label matching message prop', () => {
      render(<UIBlocker />)
      const blocker = screen.getByRole('status')
      expect(blocker).toHaveAttribute('aria-label', 'Waiting for folder selection...')
    })

    it('should have data-testid', () => {
      render(<UIBlocker />)
      expect(screen.getByTestId(TEST_IDS.UI_BLOCKER)).toBeInTheDocument()
    })
  })

  describe('Blocking mechanism', () => {
    /**
     * UIBlocker prevents interactions via TWO mechanisms:
     * 1. CSS: position: fixed, inset: 0, z-index: 9999 - visually covers all content
     * 2. JS: preventDefault() on all events - prevents default browser actions
     *
     * Note: We don't use stopPropagation() because:
     * - In production, CSS positioning ensures clicks hit the blocker first
     * - The blocker doesn't need to stop propagation; it intercepts clicks directly
     * - stopPropagation() would break event delegation patterns if added
     */

    it('should call preventDefault on click events', () => {
      mockIsProjectChanging.mockReturnValue(true)
      const { container } = render(<UIBlocker />)

      const blocker = container.querySelector('.ui-blocker')!
      const event = fireEvent.click(blocker)

      // fireEvent returns false when preventDefault was called
      expect(event).toBe(false)
    })

    it('should have blocking CSS class for visual coverage', () => {
      mockIsProjectChanging.mockReturnValue(true)
      const { container } = render(<UIBlocker />)

      // The ui-blocker class applies: position: fixed, inset: 0, z-index: 9999
      // This ensures visual coverage (CSS cannot be tested in jsdom)
      const blocker = container.querySelector('.ui-blocker')
      expect(blocker).toBeInTheDocument()
      expect(blocker).toHaveClass('ui-blocker')
    })
  })
})

describe('UIBlockerBase (reusable)', () => {
  describe('Props-based visibility', () => {
    it('should not render when visible is false', () => {
      const { container } = render(<UIBlockerBase visible={false} />)
      expect(container.querySelector('.ui-blocker')).toBeNull()
    })

    it('should render when visible is true', () => {
      const { container } = render(<UIBlockerBase visible={true} />)
      expect(container.querySelector('.ui-blocker')).toBeInTheDocument()
    })
  })

  describe('Custom message', () => {
    it('should show default message when not provided', () => {
      render(<UIBlockerBase visible={true} />)
      expect(screen.getByText('Please wait...')).toBeInTheDocument()
    })

    it('should show custom message when provided', () => {
      render(<UIBlockerBase visible={true} message="Loading data..." />)
      expect(screen.getByText('Loading data...')).toBeInTheDocument()
    })
  })

  describe('Custom tooltip', () => {
    it('should use message as tooltip by default', () => {
      render(<UIBlockerBase visible={true} message="Custom message" />)
      expect(screen.getByTitle('Custom message')).toBeInTheDocument()
    })

    it('should use custom tooltip when provided', () => {
      render(<UIBlockerBase visible={true} message="Message" tooltip="Custom tooltip" />)
      expect(screen.getByTitle('Custom tooltip')).toBeInTheDocument()
    })
  })

  describe('Event blocking', () => {
    it('should prevent onClick', () => {
      render(<UIBlockerBase visible={true} />)
      const blocker = screen.getByTitle('Please wait...')
      const event = fireEvent.click(blocker)
      expect(event).toBe(false)
    })

    it('should prevent onContextMenu', () => {
      render(<UIBlockerBase visible={true} />)
      const blocker = screen.getByTitle('Please wait...')
      const event = fireEvent.contextMenu(blocker)
      expect(event).toBe(false)
    })
  })
})
