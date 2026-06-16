// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for domGeometry.ts - DOM geometry utilities
 *
 * @see domGeometry.ts
 * @see Issue #85 - Terminal drag-drop file path insertion
 */

import { describe, it, expect, vi } from 'vitest'
import { isPointInElement, isPointInRect, getElementCenter } from './domGeometry'

describe('isPointInElement', () => {
  const mockRect: DOMRect = {
    left: 100,
    right: 300,
    top: 50,
    bottom: 150,
    width: 200,
    height: 100,
    x: 100,
    y: 50,
    toJSON: () => ({})
  }

  const createMockElement = (rect: DOMRect): Element => ({
    getBoundingClientRect: vi.fn(() => rect)
  } as unknown as Element)

  it('should return true when point is inside element', () => {
    const element = createMockElement(mockRect)
    expect(isPointInElement(150, 100, element)).toBe(true)
  })

  it('should return true when point is at top-left corner', () => {
    const element = createMockElement(mockRect)
    expect(isPointInElement(100, 50, element)).toBe(true)
  })

  it('should return true when point is at bottom-right corner', () => {
    const element = createMockElement(mockRect)
    expect(isPointInElement(300, 150, element)).toBe(true)
  })

  it('should return true when point is on left edge', () => {
    const element = createMockElement(mockRect)
    expect(isPointInElement(100, 100, element)).toBe(true)
  })

  it('should return true when point is on right edge', () => {
    const element = createMockElement(mockRect)
    expect(isPointInElement(300, 100, element)).toBe(true)
  })

  it('should return true when point is on top edge', () => {
    const element = createMockElement(mockRect)
    expect(isPointInElement(200, 50, element)).toBe(true)
  })

  it('should return true when point is on bottom edge', () => {
    const element = createMockElement(mockRect)
    expect(isPointInElement(200, 150, element)).toBe(true)
  })

  it('should return false when point is above element', () => {
    const element = createMockElement(mockRect)
    expect(isPointInElement(200, 49, element)).toBe(false)
  })

  it('should return false when point is below element', () => {
    const element = createMockElement(mockRect)
    expect(isPointInElement(200, 151, element)).toBe(false)
  })

  it('should return false when point is left of element', () => {
    const element = createMockElement(mockRect)
    expect(isPointInElement(99, 100, element)).toBe(false)
  })

  it('should return false when point is right of element', () => {
    const element = createMockElement(mockRect)
    expect(isPointInElement(301, 100, element)).toBe(false)
  })

  it('should return false when element is null', () => {
    expect(isPointInElement(150, 100, null)).toBe(false)
  })

  it('should return false when point is far outside element', () => {
    const element = createMockElement(mockRect)
    expect(isPointInElement(1000, 1000, element)).toBe(false)
  })

  it('should handle negative coordinates', () => {
    const negativeRect: DOMRect = {
      left: -100,
      right: 100,
      top: -50,
      bottom: 50,
      width: 200,
      height: 100,
      x: -100,
      y: -50,
      toJSON: () => ({})
    }
    const element = createMockElement(negativeRect)
    expect(isPointInElement(0, 0, element)).toBe(true)
    expect(isPointInElement(-50, -25, element)).toBe(true)
    expect(isPointInElement(-101, 0, element)).toBe(false)
  })

  it('should handle zero-size element', () => {
    const zeroRect: DOMRect = {
      left: 100,
      right: 100,
      top: 50,
      bottom: 50,
      width: 0,
      height: 0,
      x: 100,
      y: 50,
      toJSON: () => ({})
    }
    const element = createMockElement(zeroRect)
    // Point exactly at the zero-size element should be "inside" (edge case)
    expect(isPointInElement(100, 50, element)).toBe(true)
    expect(isPointInElement(101, 50, element)).toBe(false)
  })
})

describe('isPointInRect', () => {
  const mockRect: DOMRect = {
    left: 100,
    right: 300,
    top: 50,
    bottom: 150,
    width: 200,
    height: 100,
    x: 100,
    y: 50,
    toJSON: () => ({})
  }

  it('should return true when point is inside rect', () => {
    expect(isPointInRect(150, 100, mockRect)).toBe(true)
  })

  it('should return true when point is at corner', () => {
    expect(isPointInRect(100, 50, mockRect)).toBe(true)
    expect(isPointInRect(300, 150, mockRect)).toBe(true)
  })

  it('should return false when point is outside rect', () => {
    expect(isPointInRect(50, 100, mockRect)).toBe(false)
    expect(isPointInRect(350, 100, mockRect)).toBe(false)
    expect(isPointInRect(200, 25, mockRect)).toBe(false)
    expect(isPointInRect(200, 175, mockRect)).toBe(false)
  })

  it('should return false when rect is null', () => {
    expect(isPointInRect(150, 100, null)).toBe(false)
  })
})

describe('getElementCenter', () => {
  it('should return center of element', () => {
    const mockRect: DOMRect = {
      left: 100,
      right: 300,
      top: 50,
      bottom: 150,
      width: 200,
      height: 100,
      x: 100,
      y: 50,
      toJSON: () => ({})
    }
    const element = {
      getBoundingClientRect: vi.fn(() => mockRect)
    } as unknown as Element

    const center = getElementCenter(element)
    expect(center).toEqual({ x: 200, y: 100 })
  })

  it('should return null when element is null', () => {
    expect(getElementCenter(null)).toBeNull()
  })

  it('should handle element at origin', () => {
    const mockRect: DOMRect = {
      left: 0,
      right: 100,
      top: 0,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }
    const element = {
      getBoundingClientRect: vi.fn(() => mockRect)
    } as unknown as Element

    const center = getElementCenter(element)
    expect(center).toEqual({ x: 50, y: 50 })
  })

  it('should handle element with negative position', () => {
    const mockRect: DOMRect = {
      left: -100,
      right: 100,
      top: -50,
      bottom: 50,
      width: 200,
      height: 100,
      x: -100,
      y: -50,
      toJSON: () => ({})
    }
    const element = {
      getBoundingClientRect: vi.fn(() => mockRect)
    } as unknown as Element

    const center = getElementCenter(element)
    expect(center).toEqual({ x: 0, y: 0 })
  })
})
