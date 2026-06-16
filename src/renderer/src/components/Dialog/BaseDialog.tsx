// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, useRef, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { logger } from '../../utils/logger'
import { TEST_IDS } from '../../constants/testids'
import './Dialog.css'

// Small delay to ensure dialog is fully rendered before focusing
// This prevents focus from being lost during the portal mounting animation
const FOCUS_DELAY_MS = 10

export interface BaseDialogProps {
  isOpen: boolean
  onClose: () => void
  zIndex: number
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  className?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  children: ReactNode
}

/**
 * BaseDialog - Shared dialog component with common functionality
 *
 * Features:
 * - Portal rendering to #portal-root (consistent across all dialogs)
 * - Backdrop/overlay with configurable click-to-close
 * - Keyboard handling (Escape key)
 * - Focus trap for accessibility
 * - Z-index management via props
 * - Fade-in animation
 */
export function BaseDialog({
  isOpen,
  onClose,
  zIndex,
  closeOnBackdrop = true,
  closeOnEscape = true,
  className = '',
  ariaLabelledBy,
  ariaDescribedBy,
  children
}: BaseDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  // Store the currently focused element when dialog opens
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement
    }
  }, [isOpen])

  // Focus trap and keyboard handler
  useEffect(() => {
    if (!isOpen) return undefined

    // Auto-focus first focusable element in dialog
    const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )

    if (focusableElements && focusableElements.length > 0) {
      const timer = setTimeout(() => {
        focusableElements[0]?.focus()
      }, FOCUS_DELAY_MS)

      return () => clearTimeout(timer)
    }

    return undefined
  }, [isOpen])

  // Keyboard event handler
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    // Add listener with capture to ensure it runs before other handlers
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isOpen, closeOnEscape, onClose])

  // Restore focus when dialog closes
  useEffect(() => {
    if (!isOpen && previousActiveElement.current) {
      previousActiveElement.current.focus()
      previousActiveElement.current = null
    }
  }, [isOpen])

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) return null

  const portalRoot = document.getElementById('portal-root')
  if (!portalRoot) {
    logger.error('BaseDialog: #portal-root element not found')
    return null
  }

  const dialogContent = (
    <div
      className="dialog-overlay"
      style={{ zIndex }}
      onClick={handleBackdropClick}
      data-testid={TEST_IDS.DIALOG_OVERLAY}
    >
      <div
        ref={dialogRef}
        className={`dialog-container ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        data-testid={TEST_IDS.DIALOG_CONTAINER}
      >
        {children}
      </div>
    </div>
  )

  return createPortal(dialogContent, portalRoot)
}
