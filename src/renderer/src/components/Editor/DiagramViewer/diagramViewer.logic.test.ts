// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure Logic Tests for DiagramViewer
 *
 * Tests for pure functions in diagramViewer.logic.ts:
 * - getKeyboardAction(): Keyboard event to action mapping
 * - calculateZoomPercentage(): Scale to percentage conversion
 * - formatZoomLevel(): Format scale for display
 * - clampScale(): Constrain scale within bounds
 * - getZoomButtonStates(): Calculate button disabled states
 * - calculateFitScale(): Calculate scale to fit diagram in viewport
 */

import { describe, it, expect } from 'vitest'
import {
  getKeyboardAction,
  calculateZoomPercentage,
  formatZoomLevel,
  clampScale,
  getZoomButtonStates,
  calculateFitScale,
  parseViewBox,
  createViewBoxFromDimensions,
  calculateViewBox,
  formatViewBox,
  pixelToViewBoxDelta,
  ZOOM_CONFIG,
  type KeyEventInfo,
  type ViewBox
} from './diagramViewer.logic'

describe('diagramViewer.logic', () => {
  describe('getKeyboardAction()', () => {
    // Helper to create key event info
    const createEvent = (
      key: string,
      modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}
    ): KeyEventInfo => ({
      key,
      ctrlKey: modifiers.ctrlKey ?? false,
      metaKey: modifiers.metaKey ?? false,
      shiftKey: modifiers.shiftKey ?? false
    })

    describe('zoom-in shortcuts', () => {
      it('returns zoom-in for + key', () => {
        expect(getKeyboardAction(createEvent('+'))).toBe('zoom-in')
      })

      it('returns zoom-in for = key', () => {
        expect(getKeyboardAction(createEvent('='))).toBe('zoom-in')
      })

      it('returns zoom-in for + with shift', () => {
        expect(getKeyboardAction(createEvent('+', { shiftKey: true }))).toBe('zoom-in')
      })

      it('returns zoom-in for = with shift', () => {
        expect(getKeyboardAction(createEvent('=', { shiftKey: true }))).toBe('zoom-in')
      })
    })

    describe('zoom-out shortcuts', () => {
      it('returns zoom-out for - key', () => {
        expect(getKeyboardAction(createEvent('-'))).toBe('zoom-out')
      })

      it('returns zoom-out for - with shift', () => {
        expect(getKeyboardAction(createEvent('-', { shiftKey: true }))).toBe('zoom-out')
      })
    })

    describe('reset shortcuts', () => {
      it('returns reset for 0 key', () => {
        expect(getKeyboardAction(createEvent('0'))).toBe('reset')
      })

      it('returns reset for 0 with shift', () => {
        expect(getKeyboardAction(createEvent('0', { shiftKey: true }))).toBe('reset')
      })
    })

    describe('fit shortcuts', () => {
      it('returns fit for lowercase f', () => {
        expect(getKeyboardAction(createEvent('f'))).toBe('fit')
      })

      it('returns fit for uppercase F', () => {
        expect(getKeyboardAction(createEvent('F'))).toBe('fit')
      })

      it('returns fit for f with shift', () => {
        expect(getKeyboardAction(createEvent('f', { shiftKey: true }))).toBe('fit')
      })
    })

    describe('escape key (no longer closes)', () => {
      it('returns none for Escape key (use X button to close)', () => {
        expect(getKeyboardAction(createEvent('Escape'))).toBe('none')
      })

      it('returns none for Escape with shift', () => {
        expect(getKeyboardAction(createEvent('Escape', { shiftKey: true }))).toBe('none')
      })
    })

    describe('modifier key filtering', () => {
      it('returns none for + with Ctrl', () => {
        expect(getKeyboardAction(createEvent('+', { ctrlKey: true }))).toBe('none')
      })

      it('returns none for + with Meta', () => {
        expect(getKeyboardAction(createEvent('+', { metaKey: true }))).toBe('none')
      })

      it('returns none for - with Ctrl', () => {
        expect(getKeyboardAction(createEvent('-', { ctrlKey: true }))).toBe('none')
      })

      it('returns none for 0 with Meta', () => {
        expect(getKeyboardAction(createEvent('0', { metaKey: true }))).toBe('none')
      })

      it('returns none for f with Ctrl+Meta', () => {
        expect(getKeyboardAction(createEvent('f', { ctrlKey: true, metaKey: true }))).toBe('none')
      })

      it('returns none for Escape with Ctrl', () => {
        expect(getKeyboardAction(createEvent('Escape', { ctrlKey: true }))).toBe('none')
      })
    })

    describe('unknown keys', () => {
      it('returns none for unhandled keys', () => {
        expect(getKeyboardAction(createEvent('a'))).toBe('none')
        expect(getKeyboardAction(createEvent('z'))).toBe('none')
        expect(getKeyboardAction(createEvent('1'))).toBe('none')
        expect(getKeyboardAction(createEvent('Enter'))).toBe('none')
        expect(getKeyboardAction(createEvent('Tab'))).toBe('none')
        expect(getKeyboardAction(createEvent(' '))).toBe('none')
      })

      it('returns none for arrow keys', () => {
        expect(getKeyboardAction(createEvent('ArrowUp'))).toBe('none')
        expect(getKeyboardAction(createEvent('ArrowDown'))).toBe('none')
        expect(getKeyboardAction(createEvent('ArrowLeft'))).toBe('none')
        expect(getKeyboardAction(createEvent('ArrowRight'))).toBe('none')
      })
    })
  })

  describe('calculateZoomPercentage()', () => {
    it('converts scale 1 to 100%', () => {
      expect(calculateZoomPercentage(1)).toBe(100)
    })

    it('converts scale 0.5 to 50%', () => {
      expect(calculateZoomPercentage(0.5)).toBe(50)
    })

    it('converts scale 2 to 200%', () => {
      expect(calculateZoomPercentage(2)).toBe(200)
    })

    it('converts scale 0.1 to 10%', () => {
      expect(calculateZoomPercentage(0.1)).toBe(10)
    })

    it('converts scale 5 to 500%', () => {
      expect(calculateZoomPercentage(5)).toBe(500)
    })

    it('rounds scale 1.234 to 123%', () => {
      expect(calculateZoomPercentage(1.234)).toBe(123)
    })

    it('rounds scale 0.567 to 57%', () => {
      expect(calculateZoomPercentage(0.567)).toBe(57)
    })

    it('handles scale 0 as 0%', () => {
      expect(calculateZoomPercentage(0)).toBe(0)
    })

    it('handles negative scale', () => {
      expect(calculateZoomPercentage(-1)).toBe(-100)
    })

    it('handles very large scale', () => {
      expect(calculateZoomPercentage(100)).toBe(10000)
    })

    it('handles very small positive scale', () => {
      expect(calculateZoomPercentage(0.01)).toBe(1)
    })

    it('rounds 1.5 to 150%', () => {
      expect(calculateZoomPercentage(1.5)).toBe(150)
    })

    it('rounds 1.499 to 150% (rounds to nearest)', () => {
      expect(calculateZoomPercentage(1.499)).toBe(150)
    })

    it('rounds 1.501 to 150%', () => {
      expect(calculateZoomPercentage(1.501)).toBe(150)
    })
  })

  describe('formatZoomLevel()', () => {
    it('formats scale 1 as "100%"', () => {
      expect(formatZoomLevel(1)).toBe('100%')
    })

    it('formats scale 0.5 as "50%"', () => {
      expect(formatZoomLevel(0.5)).toBe('50%')
    })

    it('formats scale 2 as "200%"', () => {
      expect(formatZoomLevel(2)).toBe('200%')
    })

    it('formats scale 1.234 as "123%"', () => {
      expect(formatZoomLevel(1.234)).toBe('123%')
    })

    it('formats scale 0 as "0%"', () => {
      expect(formatZoomLevel(0)).toBe('0%')
    })

    it('includes % suffix', () => {
      expect(formatZoomLevel(1.5)).toContain('%')
      expect(formatZoomLevel(1.5)).toBe('150%')
    })
  })

  describe('clampScale()', () => {
    it('returns value when within bounds', () => {
      expect(clampScale(1, 0.1, 5)).toBe(1)
      expect(clampScale(2.5, 0.1, 5)).toBe(2.5)
      expect(clampScale(0.5, 0.1, 5)).toBe(0.5)
    })

    it('returns min when value is below min', () => {
      expect(clampScale(0.05, 0.1, 5)).toBe(0.1)
      expect(clampScale(0, 0.1, 5)).toBe(0.1)
      expect(clampScale(-1, 0.1, 5)).toBe(0.1)
    })

    it('returns max when value is above max', () => {
      expect(clampScale(6, 0.1, 5)).toBe(5)
      expect(clampScale(10, 0.1, 5)).toBe(5)
      expect(clampScale(100, 0.1, 5)).toBe(5)
    })

    it('returns min when value equals min', () => {
      expect(clampScale(0.1, 0.1, 5)).toBe(0.1)
    })

    it('returns max when value equals max', () => {
      expect(clampScale(5, 0.1, 5)).toBe(5)
    })

    it('works with ZOOM_CONFIG constants', () => {
      expect(clampScale(1, ZOOM_CONFIG.MIN_SCALE, ZOOM_CONFIG.MAX_SCALE)).toBe(1)
      expect(clampScale(0.05, ZOOM_CONFIG.MIN_SCALE, ZOOM_CONFIG.MAX_SCALE)).toBe(
        ZOOM_CONFIG.MIN_SCALE
      )
      expect(clampScale(10, ZOOM_CONFIG.MIN_SCALE, ZOOM_CONFIG.MAX_SCALE)).toBe(
        ZOOM_CONFIG.MAX_SCALE
      )
    })

    it('handles edge case where min equals max', () => {
      expect(clampScale(5, 1, 1)).toBe(1)
      expect(clampScale(0.5, 1, 1)).toBe(1)
    })
  })

  describe('getZoomButtonStates()', () => {
    it('enables both buttons in middle range', () => {
      const result = getZoomButtonStates(1, 0.1, 5)
      expect(result.zoomInDisabled).toBe(false)
      expect(result.zoomOutDisabled).toBe(false)
    })

    it('disables zoom-out at minimum scale', () => {
      const result = getZoomButtonStates(0.1, 0.1, 5)
      expect(result.zoomInDisabled).toBe(false)
      expect(result.zoomOutDisabled).toBe(true)
    })

    it('disables zoom-in at maximum scale', () => {
      const result = getZoomButtonStates(5, 0.1, 5)
      expect(result.zoomInDisabled).toBe(true)
      expect(result.zoomOutDisabled).toBe(false)
    })

    it('disables zoom-out when scale is below minimum', () => {
      // This shouldn't happen in practice due to clamping, but test the logic
      const result = getZoomButtonStates(0.05, 0.1, 5)
      expect(result.zoomOutDisabled).toBe(true)
    })

    it('disables zoom-in when scale is above maximum', () => {
      // This shouldn't happen in practice due to clamping, but test the logic
      const result = getZoomButtonStates(10, 0.1, 5)
      expect(result.zoomInDisabled).toBe(true)
    })

    it('enables both buttons just above minimum', () => {
      const result = getZoomButtonStates(0.11, 0.1, 5)
      expect(result.zoomInDisabled).toBe(false)
      expect(result.zoomOutDisabled).toBe(false)
    })

    it('enables both buttons just below maximum', () => {
      const result = getZoomButtonStates(4.99, 0.1, 5)
      expect(result.zoomInDisabled).toBe(false)
      expect(result.zoomOutDisabled).toBe(false)
    })

    it('works with ZOOM_CONFIG constants', () => {
      const result = getZoomButtonStates(
        ZOOM_CONFIG.INITIAL_SCALE,
        ZOOM_CONFIG.MIN_SCALE,
        ZOOM_CONFIG.MAX_SCALE
      )
      expect(result.zoomInDisabled).toBe(false)
      expect(result.zoomOutDisabled).toBe(false)
    })
  })

  describe('calculateFitScale()', () => {
    it('fits wider-than-tall diagram in viewport', () => {
      // Diagram: 800x400, Viewport: 1000x600, Padding: 40
      // Available: 920x520
      // scaleX = 920/800 = 1.15, scaleY = 520/400 = 1.3
      // Should use min(1.15, 1.3, 1) = 1 (capped at 1)
      const result = calculateFitScale(800, 400, 1000, 600, 40)
      expect(result).toBe(1)
    })

    it('fits taller-than-wide diagram in viewport', () => {
      // Diagram: 400x800, Viewport: 1000x600, Padding: 40
      // Available: 920x520
      // scaleX = 920/400 = 2.3, scaleY = 520/800 = 0.65
      // Should use min(2.3, 0.65, 1) = 0.65
      const result = calculateFitScale(400, 800, 1000, 600, 40)
      expect(result).toBe(0.65)
    })

    it('returns 1 for exact fit', () => {
      // Diagram: 920x520, Viewport: 1000x600, Padding: 40
      // Available: 920x520 (exact match)
      const result = calculateFitScale(920, 520, 1000, 600, 40)
      expect(result).toBe(1)
    })

    it('caps scale at 1 (no upscaling)', () => {
      // Small diagram: 100x100, Viewport: 1000x1000, Padding: 40
      // Available: 920x920
      // scaleX = 920/100 = 9.2, scaleY = 920/100 = 9.2
      // Should cap at 1
      const result = calculateFitScale(100, 100, 1000, 1000, 40)
      expect(result).toBe(1)
    })

    it('uses default padding of 40', () => {
      // Diagram: 920x520, Viewport: 1000x600
      // Default padding: 40
      // Available: 920x520 (exact match)
      const result = calculateFitScale(920, 520, 1000, 600)
      expect(result).toBe(1)
    })

    it('uses custom padding', () => {
      // Diagram: 900x500, Viewport: 1000x600, Padding: 50
      // Available: 900x500 (exact match with padding 50)
      const result = calculateFitScale(900, 500, 1000, 600, 50)
      expect(result).toBe(1)
    })

    it('handles zero padding', () => {
      // Diagram: 1000x600, Viewport: 1000x600, Padding: 0
      // Available: 1000x600 (exact match)
      const result = calculateFitScale(1000, 600, 1000, 600, 0)
      expect(result).toBe(1)
    })

    it('returns 1 for zero svg width', () => {
      const result = calculateFitScale(0, 400, 1000, 600, 40)
      expect(result).toBe(1)
    })

    it('returns 1 for zero svg height', () => {
      const result = calculateFitScale(800, 0, 1000, 600, 40)
      expect(result).toBe(1)
    })

    it('returns 1 for zero viewport width', () => {
      const result = calculateFitScale(800, 400, 0, 600, 40)
      expect(result).toBe(1)
    })

    it('returns 1 for zero viewport height', () => {
      const result = calculateFitScale(800, 400, 1000, 0, 40)
      expect(result).toBe(1)
    })

    it('returns 1 for negative svg dimensions', () => {
      expect(calculateFitScale(-800, 400, 1000, 600, 40)).toBe(1)
      expect(calculateFitScale(800, -400, 1000, 600, 40)).toBe(1)
    })

    it('returns 1 for negative viewport dimensions', () => {
      expect(calculateFitScale(800, 400, -1000, 600, 40)).toBe(1)
      expect(calculateFitScale(800, 400, 1000, -600, 40)).toBe(1)
    })

    it('calculates scale for very large diagram', () => {
      // Diagram: 4000x3000, Viewport: 1000x600, Padding: 40
      // Available: 920x520
      // scaleX = 920/4000 = 0.23, scaleY = 520/3000 = 0.173
      // Should use min(0.23, 0.173, 1) = 0.173
      const result = calculateFitScale(4000, 3000, 1000, 600, 40)
      expect(result).toBeCloseTo(0.173, 3)
    })

    it('calculates scale for very small viewport', () => {
      // Diagram: 800x600, Viewport: 400x300, Padding: 20
      // Available: 360x260
      // scaleX = 360/800 = 0.45, scaleY = 260/600 = 0.433
      // Should use min(0.45, 0.433, 1) = 0.433
      const result = calculateFitScale(800, 600, 400, 300, 20)
      expect(result).toBeCloseTo(0.433, 3)
    })
  })

  describe('ZOOM_CONFIG constants', () => {
    it('has expected MIN_SCALE value', () => {
      expect(ZOOM_CONFIG.MIN_SCALE).toBe(0.1)
    })

    it('has expected MAX_SCALE value', () => {
      expect(ZOOM_CONFIG.MAX_SCALE).toBe(5)
    })

    it('has expected ZOOM_STEP value', () => {
      expect(ZOOM_CONFIG.ZOOM_STEP).toBe(0.2)
    })

    it('has expected INITIAL_SCALE value', () => {
      expect(ZOOM_CONFIG.INITIAL_SCALE).toBe(1)
    })

    it('has MIN_SCALE less than INITIAL_SCALE', () => {
      expect(ZOOM_CONFIG.MIN_SCALE).toBeLessThan(ZOOM_CONFIG.INITIAL_SCALE)
    })

    it('has MAX_SCALE greater than INITIAL_SCALE', () => {
      expect(ZOOM_CONFIG.MAX_SCALE).toBeGreaterThan(ZOOM_CONFIG.INITIAL_SCALE)
    })
  })

  // ============================================================================
  // ViewBox-based zoom tests (issue #31 fix)
  // ============================================================================

  describe('parseViewBox()', () => {
    it('parses valid viewBox with spaces', () => {
      const result = parseViewBox('0 0 100 200')
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 200 })
    })

    it('parses viewBox with negative values', () => {
      const result = parseViewBox('-50 -100 200 300')
      expect(result).toEqual({ x: -50, y: -100, width: 200, height: 300 })
    })

    it('parses viewBox with comma separators', () => {
      const result = parseViewBox('0,0,100,200')
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 200 })
    })

    it('parses viewBox with mixed separators', () => {
      const result = parseViewBox('0, 0, 100 200')
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 200 })
    })

    it('parses viewBox with decimal values', () => {
      const result = parseViewBox('0.5 1.5 100.25 200.75')
      expect(result).toEqual({ x: 0.5, y: 1.5, width: 100.25, height: 200.75 })
    })

    it('trims whitespace', () => {
      const result = parseViewBox('  0 0 100 200  ')
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 200 })
    })

    it('returns null for null input', () => {
      expect(parseViewBox(null)).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(parseViewBox('')).toBeNull()
    })

    it('returns null for too few values', () => {
      expect(parseViewBox('0 0 100')).toBeNull()
    })

    it('returns null for too many values', () => {
      expect(parseViewBox('0 0 100 200 300')).toBeNull()
    })

    it('returns null for non-numeric values', () => {
      expect(parseViewBox('a b c d')).toBeNull()
    })

    it('returns null for zero width', () => {
      expect(parseViewBox('0 0 0 200')).toBeNull()
    })

    it('returns null for zero height', () => {
      expect(parseViewBox('0 0 100 0')).toBeNull()
    })

    it('returns null for negative width', () => {
      expect(parseViewBox('0 0 -100 200')).toBeNull()
    })

    it('returns null for negative height', () => {
      expect(parseViewBox('0 0 100 -200')).toBeNull()
    })

    it('returns null for Infinity values', () => {
      expect(parseViewBox('0 0 Infinity 200')).toBeNull()
    })

    it('returns null for NaN values', () => {
      expect(parseViewBox('0 0 NaN 200')).toBeNull()
    })
  })

  describe('createViewBoxFromDimensions()', () => {
    it('creates viewBox from positive dimensions', () => {
      const result = createViewBoxFromDimensions(800, 600)
      expect(result).toEqual({ x: 0, y: 0, width: 800, height: 600 })
    })

    it('creates viewBox from decimal dimensions', () => {
      const result = createViewBoxFromDimensions(100.5, 200.75)
      expect(result).toEqual({ x: 0, y: 0, width: 100.5, height: 200.75 })
    })

    it('returns null for zero width', () => {
      expect(createViewBoxFromDimensions(0, 600)).toBeNull()
    })

    it('returns null for zero height', () => {
      expect(createViewBoxFromDimensions(800, 0)).toBeNull()
    })

    it('returns null for negative width', () => {
      expect(createViewBoxFromDimensions(-800, 600)).toBeNull()
    })

    it('returns null for negative height', () => {
      expect(createViewBoxFromDimensions(800, -600)).toBeNull()
    })

    it('returns null for Infinity width', () => {
      expect(createViewBoxFromDimensions(Infinity, 600)).toBeNull()
    })

    it('returns null for NaN height', () => {
      expect(createViewBoxFromDimensions(800, NaN)).toBeNull()
    })
  })

  describe('calculateViewBox()', () => {
    const original: ViewBox = { x: 0, y: 0, width: 100, height: 100 }

    it('returns original viewBox at scale 1 with no pan', () => {
      const result = calculateViewBox(original, 1, 0, 0)
      expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    })

    it('zooms in (scale 2) - smaller viewBox centered', () => {
      const result = calculateViewBox(original, 2, 0, 0)
      expect(result).toEqual({ x: 25, y: 25, width: 50, height: 50 })
    })

    it('zooms out (scale 0.5) - larger viewBox centered', () => {
      const result = calculateViewBox(original, 0.5, 0, 0)
      expect(result).toEqual({ x: -50, y: -50, width: 200, height: 200 })
    })

    it('pans right (positive panX moves view left, viewBox x decreases)', () => {
      const result = calculateViewBox(original, 1, 10, 0)
      expect(result).toEqual({ x: -10, y: 0, width: 100, height: 100 })
    })

    it('pans left (negative panX moves view right, viewBox x increases)', () => {
      const result = calculateViewBox(original, 1, -10, 0)
      expect(result).toEqual({ x: 10, y: 0, width: 100, height: 100 })
    })

    it('pans down (positive panY moves view up, viewBox y decreases)', () => {
      const result = calculateViewBox(original, 1, 0, 10)
      expect(result).toEqual({ x: 0, y: -10, width: 100, height: 100 })
    })

    it('pans up (negative panY moves view down, viewBox y increases)', () => {
      const result = calculateViewBox(original, 1, 0, -10)
      expect(result).toEqual({ x: 0, y: 10, width: 100, height: 100 })
    })

    it('combines zoom and pan', () => {
      // Scale 2 centers at (25, 25) with size (50, 50)
      // Pan (10, 5) shifts viewBox by (-10, -5)
      const result = calculateViewBox(original, 2, 10, 5)
      expect(result).toEqual({ x: 15, y: 20, width: 50, height: 50 })
    })

    it('handles non-zero original x and y', () => {
      const offsetOriginal: ViewBox = { x: 10, y: 20, width: 100, height: 100 }
      const result = calculateViewBox(offsetOriginal, 2, 0, 0)
      expect(result).toEqual({ x: 35, y: 45, width: 50, height: 50 })
    })

    it('clamps very small scale to 0.01 to avoid division issues', () => {
      const result = calculateViewBox(original, 0.001, 0, 0)
      // scale clamped to 0.01: width = 100/0.01 = 10000
      expect(result.width).toBe(10000)
      expect(result.height).toBe(10000)
    })

    it('handles scale of 0 by clamping to 0.01', () => {
      const result = calculateViewBox(original, 0, 0, 0)
      expect(result.width).toBe(10000) // 100/0.01
      expect(result.height).toBe(10000)
    })

    it('handles negative scale by clamping to 0.01', () => {
      const result = calculateViewBox(original, -1, 0, 0)
      expect(result.width).toBe(10000) // 100/0.01
    })

    it('handles rectangular viewBox (width != height)', () => {
      const rectangular: ViewBox = { x: 0, y: 0, width: 200, height: 100 }
      const result = calculateViewBox(rectangular, 2, 0, 0)
      // width: 200/2 = 100, height: 100/2 = 50
      // centerOffsetX: (200-100)/2 = 50, centerOffsetY: (100-50)/2 = 25
      expect(result).toEqual({ x: 50, y: 25, width: 100, height: 50 })
    })
  })

  describe('formatViewBox()', () => {
    it('formats viewBox with integers', () => {
      const viewBox: ViewBox = { x: 0, y: 0, width: 100, height: 200 }
      expect(formatViewBox(viewBox)).toBe('0 0 100 200')
    })

    it('formats viewBox with decimals', () => {
      const viewBox: ViewBox = { x: 0.5, y: 1.5, width: 100.25, height: 200.75 }
      expect(formatViewBox(viewBox)).toBe('0.5 1.5 100.25 200.75')
    })

    it('formats viewBox with negative values', () => {
      const viewBox: ViewBox = { x: -50, y: -100, width: 200, height: 300 }
      expect(formatViewBox(viewBox)).toBe('-50 -100 200 300')
    })

    it('formats viewBox with very small values', () => {
      const viewBox: ViewBox = { x: 0.001, y: 0.002, width: 0.003, height: 0.004 }
      expect(formatViewBox(viewBox)).toBe('0.001 0.002 0.003 0.004')
    })
  })

  describe('pixelToViewBoxDelta()', () => {
    it('converts pixel delta to viewBox units', () => {
      // 10px in 100px viewport with 50 viewBox units = 5 viewBox units
      expect(pixelToViewBoxDelta(10, 100, 50)).toBe(5)
    })

    it('returns 0 for zero pixel delta', () => {
      expect(pixelToViewBoxDelta(0, 100, 50)).toBe(0)
    })

    it('handles 1:1 ratio', () => {
      expect(pixelToViewBoxDelta(10, 100, 100)).toBe(10)
    })

    it('handles viewBox larger than viewport', () => {
      // 10px in 100px viewport with 200 viewBox units = 20 viewBox units
      expect(pixelToViewBoxDelta(10, 100, 200)).toBe(20)
    })

    it('handles viewBox smaller than viewport', () => {
      // 10px in 200px viewport with 100 viewBox units = 5 viewBox units
      expect(pixelToViewBoxDelta(10, 200, 100)).toBe(5)
    })

    it('handles negative pixel delta', () => {
      expect(pixelToViewBoxDelta(-10, 100, 50)).toBe(-5)
    })

    it('returns 0 for zero viewport size', () => {
      expect(pixelToViewBoxDelta(10, 0, 50)).toBe(0)
    })

    it('returns 0 for negative viewport size', () => {
      expect(pixelToViewBoxDelta(10, -100, 50)).toBe(0)
    })

    it('handles decimal values', () => {
      const result = pixelToViewBoxDelta(5.5, 100, 50)
      expect(result).toBeCloseTo(2.75)
    })
  })
})
