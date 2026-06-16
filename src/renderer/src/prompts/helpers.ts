// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Template helper functions for prompt rendering
 * These are simple functions that don't require Handlebars (CSP-safe)
 */

import { getBasename, getDirname } from '../utils/fileUtils'

/**
 * Truncate a string to a maximum length
 * Usage: {{truncate selectedText 100}}
 */
export function truncate(str?: string | number, length?: string | number): string {
  if (typeof str !== 'string') return ''
  const maxLength = typeof length === 'number' ? length : Number(length)
  return str.length > maxLength ? str.substring(0, maxLength) + '...' : str
}

/**
 * Get the basename (filename) from a file path
 * Usage: {{basename filePath}}
 */
export function basename(path?: string | number): string {
  if (typeof path !== 'string') return ''
  return getBasename(path) || path
}

/**
 * Get the directory name from a file path
 * Usage: {{dirname filePath}}
 */
export function dirname(path?: string | number): string {
  if (typeof path !== 'string') return ''
  return getDirname(path) || '/'
}

/**
 * Format a line range into a human-readable string
 * Includes boundary validation for line numbers.
 *
 * Usage: {{formatLineRange startLine endLine}}
 *
 * Validation:
 * - Line numbers < 1 are treated as invalid (returns empty string)
 * - If start > end, they are swapped automatically
 * - If only start is provided and valid, returns "line X"
 */
export function formatLineRange(start?: string | number, end?: string | number): string {
  let startNum = typeof start === 'number' ? start : Number(start)
  let endNum = typeof end === 'number' ? end : Number(end)

  // Validate start line (must be >= 1)
  if (!startNum || startNum < 1) return ''

  // Validate end line
  if (endNum && endNum < 1) {
    endNum = startNum // Treat invalid end as single line
  }

  // Swap if start > end
  if (endNum && startNum > endNum) {
    const temp = startNum
    startNum = endNum
    endNum = temp
  }

  if (!endNum || startNum === endNum) return `line ${startNum}`
  return `lines ${startNum}-${endNum}`
}

/**
 * Convert text to uppercase
 * Usage: {{uppercase text}}
 */
export function uppercase(str?: string | number): string {
  if (typeof str !== 'string') return ''
  return str.toUpperCase()
}

/**
 * Convert text to lowercase
 * Usage: {{lowercase text}}
 */
export function lowercase(str?: string | number): string {
  if (typeof str !== 'string') return ''
  return str.toLowerCase()
}

/**
 * Pluralize a word based on count
 * Usage: {{pluralize count "file" "files"}}
 */
export function pluralize(
  count?: string | number,
  singular?: string | number,
  plural?: string | number
): string {
  const num = typeof count === 'number' ? count : Number(count)
  const singularStr = String(singular)
  const pluralStr = String(plural)
  return num === 1 ? singularStr : pluralStr
}
