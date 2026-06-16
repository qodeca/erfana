// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Editor Error Boundary Component
 *
 * Error boundary for editor panel components to prevent crashes.
 * If MarkdownToolbar, EditorContentLayout, or DocumentStatsBar throw,
 * this catches the error and renders a fallback instead of crashing
 * the entire editor panel.
 *
 * @module components/Editor/MarkdownEditorPanel/components/EditorErrorBoundary
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'
import { TEST_IDS } from '../../../../constants/testids'
import { logger } from '../../../../utils/logger'

/**
 * Props for EditorErrorBoundary component.
 */
interface EditorErrorBoundaryProps {
  /** Child components to wrap with error boundary */
  children: ReactNode
  /** Optional fallback to render on error (default: error message) */
  fallback?: ReactNode
  /** Component name for error logging context */
  componentName?: string
}

/**
 * State for EditorErrorBoundary component.
 */
interface EditorErrorBoundaryState {
  /** Whether an error has been caught */
  hasError: boolean
  /** The caught error, if any */
  error: Error | null
}

/**
 * Error boundary for editor panel UI components.
 *
 * Prevents rendering failures in toolbar, layout, or stats bar from
 * crashing the entire MarkdownEditorPanel. Logs errors for debugging
 * and renders a minimal fallback UI.
 *
 * @example Basic usage
 * ```tsx
 * <EditorErrorBoundary componentName="Toolbar">
 *   <MarkdownToolbar {...props} />
 * </EditorErrorBoundary>
 * ```
 *
 * @example With custom fallback
 * ```tsx
 * <EditorErrorBoundary
 *   componentName="Layout"
 *   fallback={<div>Editor failed to load</div>}
 * >
 *   <EditorContentLayout {...props} />
 * </EditorErrorBoundary>
 * ```
 */
export class EditorErrorBoundary extends Component<
  EditorErrorBoundaryProps,
  EditorErrorBoundaryState
> {
  constructor(props: EditorErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): EditorErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { componentName = 'Editor component' } = this.props
    logger.error(`[EditorErrorBoundary] ${componentName} error`, error, {
      componentStack: errorInfo.componentStack
    })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Render custom fallback or default error message
      if (this.props.fallback !== undefined) {
        return this.props.fallback
      }

      // Default fallback: minimal error indicator
      return (
        <div
          style={{
            padding: 'var(--space-4)',
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--text-sm)',
            textAlign: 'center'
          }}
          role="alert"
          data-testid={TEST_IDS.EDITOR_ERROR_BOUNDARY}
        >
          Component failed to render
        </div>
      )
    }

    return this.props.children
  }
}
