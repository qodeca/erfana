// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Time Formatting Utilities
 *
 * todo027: Extracted from WelcomePanel for reusability
 *
 * Provides human-readable relative time formatting.
 */

import { TIME } from '../../../shared/constants'

/**
 * Format a unit with proper pluralization
 */
function formatUnit(value: number, unit: string): string {
  return `${value} ${unit}${value > 1 ? 's' : ''} ago`
}

/**
 * Format a timestamp as a human-readable relative time string
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Human-readable string like "Just now", "5 minutes ago", "2 days ago"
 *
 * @example
 * formatRelativeTime(Date.now() - 30000)  // "Just now"
 * formatRelativeTime(Date.now() - 300000) // "5 minutes ago"
 * formatRelativeTime(Date.now() - 7200000) // "2 hours ago"
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  if (diff < TIME.MINUTE) return 'Just now'

  const minutes = Math.floor(diff / TIME.MINUTE)
  if (diff < TIME.HOUR) return formatUnit(minutes, 'minute')

  const hours = Math.floor(diff / TIME.HOUR)
  if (diff < TIME.DAY) return formatUnit(hours, 'hour')

  const days = Math.floor(diff / TIME.DAY)
  if (diff < TIME.WEEK) return formatUnit(days, 'day')

  return new Date(timestamp).toLocaleDateString()
}
