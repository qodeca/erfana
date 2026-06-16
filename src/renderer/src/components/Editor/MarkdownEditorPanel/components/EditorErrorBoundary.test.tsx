// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * EditorErrorBoundary.test.tsx
 *
 * Tests for the EditorErrorBoundary component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorErrorBoundary } from './EditorErrorBoundary'
import { TEST_IDS } from '../../../../constants/testids'
import { logger } from '../../../../utils/logger'

// Mock logger
vi.mock('../../../../utils/logger', () => ({
  logger: {
    error: vi.fn()
  }
}))

// Component that throws an error
function ThrowingComponent(): JSX.Element {
  throw new Error('Test error')
}

// Component that renders normally
function NormalComponent(): JSX.Element {
  return <div data-testid="normal-content">Normal content</div>
}

describe('EditorErrorBoundary', () => {
  // Suppress console.error during tests since we expect errors
  const originalConsoleError = console.error
  beforeEach(() => {
    vi.clearAllMocks()
    console.error = vi.fn()
  })
  afterEach(() => {
    console.error = originalConsoleError
  })

  describe('Normal rendering', () => {
    it('renders children when no error occurs', () => {
      render(
        <EditorErrorBoundary>
          <NormalComponent />
        </EditorErrorBoundary>
      )

      expect(screen.getByTestId('normal-content')).toBeInTheDocument()
    })

    it('does not log errors when children render normally', () => {
      render(
        <EditorErrorBoundary>
          <NormalComponent />
        </EditorErrorBoundary>
      )

      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe('Error handling', () => {
    it('catches errors and renders default fallback', () => {
      render(
        <EditorErrorBoundary>
          <ThrowingComponent />
        </EditorErrorBoundary>
      )

      expect(screen.getByText('Component failed to render')).toBeInTheDocument()
    })

    it('renders custom fallback when provided', () => {
      render(
        <EditorErrorBoundary fallback={<div>Custom error message</div>}>
          <ThrowingComponent />
        </EditorErrorBoundary>
      )

      expect(screen.getByText('Custom error message')).toBeInTheDocument()
    })

    it('renders null fallback when explicitly set', () => {
      const { container } = render(
        <EditorErrorBoundary fallback={null}>
          <ThrowingComponent />
        </EditorErrorBoundary>
      )

      expect(container.innerHTML).toBe('')
    })

    it('logs error with component name', () => {
      render(
        <EditorErrorBoundary componentName="TestComponent">
          <ThrowingComponent />
        </EditorErrorBoundary>
      )

      expect(logger.error).toHaveBeenCalledWith(
        '[EditorErrorBoundary] TestComponent error',
        expect.any(Error),
        expect.objectContaining({
          componentStack: expect.any(String)
        })
      )
    })

    it('logs error with default component name when not provided', () => {
      render(
        <EditorErrorBoundary>
          <ThrowingComponent />
        </EditorErrorBoundary>
      )

      expect(logger.error).toHaveBeenCalledWith(
        '[EditorErrorBoundary] Editor component error',
        expect.any(Error),
        expect.objectContaining({
          componentStack: expect.any(String)
        })
      )
    })
  })

  describe('Error isolation', () => {
    it('does not affect sibling components', () => {
      render(
        <div>
          <EditorErrorBoundary>
            <ThrowingComponent />
          </EditorErrorBoundary>
          <NormalComponent />
        </div>
      )

      expect(screen.getByText('Component failed to render')).toBeInTheDocument()
      expect(screen.getByTestId('normal-content')).toBeInTheDocument()
    })

    it('isolates errors to specific boundary', () => {
      render(
        <div>
          <EditorErrorBoundary componentName="First">
            <ThrowingComponent />
          </EditorErrorBoundary>
          <EditorErrorBoundary componentName="Second">
            <NormalComponent />
          </EditorErrorBoundary>
        </div>
      )

      // First boundary shows error
      expect(screen.getByText('Component failed to render')).toBeInTheDocument()
      // Second boundary renders normally
      expect(screen.getByTestId('normal-content')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('default fallback has role="alert"', () => {
      render(
        <EditorErrorBoundary>
          <ThrowingComponent />
        </EditorErrorBoundary>
      )

      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('default fallback has data-testid', () => {
      render(
        <EditorErrorBoundary>
          <ThrowingComponent />
        </EditorErrorBoundary>
      )

      expect(screen.getByTestId(TEST_IDS.EDITOR_ERROR_BOUNDARY)).toBeInTheDocument()
    })
  })

  describe('Fallback styling', () => {
    it('applies default fallback styling', () => {
      render(
        <EditorErrorBoundary>
          <ThrowingComponent />
        </EditorErrorBoundary>
      )

      const fallback = screen.getByText('Component failed to render')
      expect(fallback).toHaveStyle({
        textAlign: 'center'
      })
    })
  })
})
