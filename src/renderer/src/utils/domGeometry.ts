// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DOM Geometry Utilities
 *
 * Provides helper functions for geometric calculations involving DOM elements.
 * Used for drag-drop detection, hit testing, and viewport calculations.
 *
 * @see Issue #85 - Terminal drag-drop file path insertion
 */

/**
 * Check if a point (x, y) is within an element's bounding rectangle
 *
 * @param x - X coordinate (typically from mouse/drag event clientX)
 * @param y - Y coordinate (typically from mouse/drag event clientY)
 * @param element - DOM element to check against
 * @returns true if the point is inside the element's bounding box
 *
 * @example
 * ```ts
 * const panel = document.querySelector('.terminal-panel')
 * if (isPointInElement(event.clientX, event.clientY, panel)) {
 *   // Handle drop on terminal
 * }
 * ```
 */
export function isPointInElement(x: number, y: number, element: Element | null): boolean {
  if (!element) return false

  const rect = element.getBoundingClientRect()
  return (
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom
  )
}

/**
 * Check if a point is within a DOMRect
 *
 * Useful when you've already computed the rect and want to check multiple points
 * without repeatedly calling getBoundingClientRect().
 *
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param rect - Pre-computed DOMRect
 * @returns true if the point is inside the rect
 */
export function isPointInRect(x: number, y: number, rect: DOMRect | null): boolean {
  if (!rect) return false

  return (
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom
  )
}

/**
 * Get the center point of an element
 *
 * @param element - DOM element
 * @returns Center point coordinates or null if element is null
 */
export function getElementCenter(element: Element | null): { x: number; y: number } | null {
  if (!element) return null

  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  }
}
