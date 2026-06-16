// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Toast Helper Utilities
 *
 * todo025: Extracted from WelcomePanel to reduce duplication
 *
 * Provides type-safe toast functions with sensible defaults.
 */

import { showGlobalToast } from '../components/Toast/toastService'
import { TOAST_DURATION } from '../../../shared/constants'

/**
 * Show an error toast notification
 */
export function showErrorToast(title: string, message: string, duration: number = TOAST_DURATION.ERROR): void {
  showGlobalToast({ title, message, type: 'error', duration })
}

/**
 * Show a success toast notification
 */
export function showSuccessToast(title: string, message: string, duration = TOAST_DURATION.SUCCESS): void {
  showGlobalToast({ title, message, type: 'success', duration })
}

/**
 * Show a warning toast notification
 */
export function showWarningToast(title: string, message: string, duration = TOAST_DURATION.WARNING): void {
  showGlobalToast({ title, message, type: 'warning', duration })
}

/**
 * Show an info toast notification
 */
export function showInfoToast(title: string, message: string, duration = TOAST_DURATION.INFO): void {
  showGlobalToast({ title, message, type: 'info', duration })
}
