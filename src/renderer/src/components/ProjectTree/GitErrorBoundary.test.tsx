// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Git Error Boundary Component
 * =======================================
 * Error boundary for git status components to prevent tree crashes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GitErrorBoundary } from './GitErrorBoundary'

// Mock logger
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))
vi.mock('../../utils/logger', () => ({ logger: mockLogger }))

// Component that throws an error for testing
const ThrowingComponent = ({ shouldThrow = true }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error from ThrowingComponent')
  }
  return <div data-testid="child-content">Normal content</div>
}

// Suppress console.error for error boundary tests
const originalConsoleError = console.error

describe('GitErrorBoundary', () => {
  beforeEach(() => {
    // Suppress React error boundary console output
    console.error = vi.fn()
  })

  afterEach(() => {
    console.error = originalConsoleError
  })

  describe('normal rendering', () => {
    it('should render children when no error occurs', () => {
      render(
        <GitErrorBoundary>
          <div data-testid="child">Child content</div>
        </GitErrorBoundary>
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
      expect(screen.getByText('Child content')).toBeInTheDocument()
    })

    it('should render multiple children when no error occurs', () => {
      render(
        <GitErrorBoundary>
          <div data-testid="child-1">First</div>
          <div data-testid="child-2">Second</div>
        </GitErrorBoundary>
      )

      expect(screen.getByTestId('child-1')).toBeInTheDocument()
      expect(screen.getByTestId('child-2')).toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('should render nothing (null) when child throws and no fallback provided', () => {
      const { container } = render(
        <GitErrorBoundary>
          <ThrowingComponent />
        </GitErrorBoundary>
      )

      // Container should be empty (null rendered)
      expect(container.firstChild).toBeNull()
    })

    it('should render fallback when child throws and fallback provided', () => {
      render(
        <GitErrorBoundary fallback={<div data-testid="fallback">Fallback content</div>}>
          <ThrowingComponent />
        </GitErrorBoundary>
      )

      expect(screen.getByTestId('fallback')).toBeInTheDocument()
      expect(screen.getByText('Fallback content')).toBeInTheDocument()
    })

    it('should log error to logger when child throws', () => {
      mockLogger.error.mockClear()

      render(
        <GitErrorBoundary>
          <ThrowingComponent />
        </GitErrorBoundary>
      )

      // Check that logger.error was called with our error
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[GitErrorBoundary] Git component error',
        expect.any(Error),
        expect.objectContaining({
          componentStack: expect.any(String)
        })
      )
    })

    it('should catch errors from nested children', () => {
      const NestedThrowing = () => (
        <div>
          <div>
            <ThrowingComponent />
          </div>
        </div>
      )

      const { container } = render(
        <GitErrorBoundary>
          <NestedThrowing />
        </GitErrorBoundary>
      )

      expect(container.firstChild).toBeNull()
    })

    it('should not affect siblings when one child throws', () => {
      // This tests that errors are properly contained
      render(
        <div>
          <div data-testid="sibling-before">Before</div>
          <GitErrorBoundary>
            <ThrowingComponent />
          </GitErrorBoundary>
          <div data-testid="sibling-after">After</div>
        </div>
      )

      // Siblings should still render
      expect(screen.getByTestId('sibling-before')).toBeInTheDocument()
      expect(screen.getByTestId('sibling-after')).toBeInTheDocument()
    })
  })

  describe('state management', () => {
    it('should set hasError state to true on error', () => {
      const { container } = render(
        <GitErrorBoundary>
          <ThrowingComponent />
        </GitErrorBoundary>
      )

      // The fact that nothing renders indicates hasError is true
      expect(container.firstChild).toBeNull()
    })

    it('should capture the error object', () => {
      mockLogger.error.mockClear()

      render(
        <GitErrorBoundary>
          <ThrowingComponent />
        </GitErrorBoundary>
      )

      // Error should be passed to componentDidCatch and logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[GitErrorBoundary]'),
        expect.any(Error),
        expect.objectContaining({
          componentStack: expect.any(String)
        })
      )
    })
  })

  describe('fallback variations', () => {
    it('should accept string as fallback', () => {
      render(
        <GitErrorBoundary fallback="Error occurred">
          <ThrowingComponent />
        </GitErrorBoundary>
      )

      expect(screen.getByText('Error occurred')).toBeInTheDocument()
    })

    it('should accept JSX element as fallback', () => {
      render(
        <GitErrorBoundary fallback={<span className="error-msg">Oops!</span>}>
          <ThrowingComponent />
        </GitErrorBoundary>
      )

      const fallback = screen.getByText('Oops!')
      expect(fallback).toBeInTheDocument()
      expect(fallback).toHaveClass('error-msg')
    })

    it('should accept null as explicit fallback', () => {
      const { container } = render(
        <GitErrorBoundary fallback={null}>
          <ThrowingComponent />
        </GitErrorBoundary>
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('real-world scenarios', () => {
    it('should protect ProjectTree from GitStatusBadge errors', () => {
      // Simulates the actual use case
      const MockProjectTree = () => (
        <div data-testid="project-tree">
          <div data-testid="tree-content">Tree content</div>
          <GitErrorBoundary>
            <ThrowingComponent /> {/* Simulates broken GitStatusBadge */}
          </GitErrorBoundary>
        </div>
      )

      render(<MockProjectTree />)

      // Tree should still render even though badge throws
      expect(screen.getByTestId('project-tree')).toBeInTheDocument()
      expect(screen.getByTestId('tree-content')).toBeInTheDocument()
    })

    it('should protect ProjectTree from GitStatusBar errors', () => {
      // Simulates footer bar error
      const MockProjectTree = () => (
        <div data-testid="project-tree">
          <div data-testid="tree-content">Tree content</div>
          <GitErrorBoundary>
            <ThrowingComponent /> {/* Simulates broken GitStatusBar */}
          </GitErrorBoundary>
        </div>
      )

      render(<MockProjectTree />)

      expect(screen.getByTestId('project-tree')).toBeInTheDocument()
      expect(screen.getByTestId('tree-content')).toBeInTheDocument()
    })
  })
})
