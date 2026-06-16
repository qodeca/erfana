// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git Error Boundary Component
 * =============================
 * Error boundary for git status components to prevent tree crashes.
 *
 * If GitStatusBadge or GitStatusBar throw, this catches the error
 * and renders nothing instead of crashing the entire tree.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'
import { logger } from '../../utils/logger'

interface GitErrorBoundaryProps {
  children: ReactNode
  /** Optional fallback to render on error (default: null = render nothing) */
  fallback?: ReactNode
}

interface GitErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Error boundary for git status UI components.
 * Prevents rendering failures in badges/bars from crashing the entire ProjectTree.
 */
export class GitErrorBoundary extends Component<GitErrorBoundaryProps, GitErrorBoundaryState> {
  constructor(props: GitErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): GitErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error for debugging but don't crash the app
    logger.error('[GitErrorBoundary] Git component error', error, { componentStack: errorInfo.componentStack })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Render fallback (default: nothing) - tree continues working
      return this.props.fallback ?? null
    }

    return this.props.children
  }
}
