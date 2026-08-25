// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure Logic Tests for ImageViewerPanel
 *
 * Tests for pure functions in imageViewer.logic.ts:
 * - getNextZoomLevel(): Get next discrete zoom level
 * - clampScale(): Constrain scale within bounds
 * - clampPan(): Constrain pan within bounds
 * - calculateFitScale(): Calculate scale to fit image in viewport
 * - calculateCursorCenteredZoom(): Calculate zoom centered on cursor
 * - formatZoomLevel(): Format scale for display
 * - formatFileSize(): Format bytes for display
 * - formatDimensions(): Format image dimensions
 * - getKeyboardAction(): Keyboard event to action mapping
 * - getZoomButtonStates(): Calculate button disabled states
 * - isDefaultTransform(): Check if transform is at default
 */

import { describe, it, expect } from 'vitest'
import {
  getNextZoomLevel,
  clampScale,
  clampPan,
  calculateFitScale,
  calculateCursorCenteredZoom,
  formatZoomLevel,
  formatFileSize,
  formatDimensions,
  getKeyboardAction,
  getZoomButtonStates,
  isDefaultTransform,
  ZOOM_CONFIG,
  PAN_CONFIG,
  EPSILON,
  ZOOM_LEVELS,
  INITIAL_TRANSFORM,
  type Transform,
  type KeyEventInfo
} from './imageViewer.logic'

describe('imageViewer.logic', () => {
  // ============================================================================
  // Constants Tests
  // ============================================================================

  describe('ZOOM_CONFIG', () => {
    it('has expected MIN_SCALE value', () => {
      expect(ZOOM_CONFIG.MIN_SCALE).toBe(0.01)
    })

    it('has expected MAX_SCALE value', () => {
      expect(ZOOM_CONFIG.MAX_SCALE).toBe(10)
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

  describe('PAN_CONFIG', () => {
    it('has expected STEP_SIZE value', () => {
      expect(PAN_CONFIG.STEP_SIZE).toBe(50)
    })

    it('has expected MAX_PAN value', () => {
      expect(PAN_CONFIG.MAX_PAN).toBe(10000)
    })
  })

  describe('EPSILON', () => {
    it('is a small positive value', () => {
      expect(EPSILON).toBe(0.001)
      expect(EPSILON).toBeGreaterThan(0)
      expect(EPSILON).toBeLessThan(0.01)
    })
  })

  describe('ZOOM_LEVELS', () => {
    it('contains expected number of levels', () => {
      expect(ZOOM_LEVELS.length).toBe(18)
    })

    it('starts at MIN_SCALE', () => {
      expect(ZOOM_LEVELS[0]).toBe(ZOOM_CONFIG.MIN_SCALE)
    })

    it('ends at MAX_SCALE', () => {
      expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]).toBe(ZOOM_CONFIG.MAX_SCALE)
    })

    it('includes 100% (scale 1)', () => {
      expect(ZOOM_LEVELS).toContain(1)
    })

    it('is sorted in ascending order', () => {
      for (let i = 1; i < ZOOM_LEVELS.length; i++) {
        expect(ZOOM_LEVELS[i]).toBeGreaterThan(ZOOM_LEVELS[i - 1])
      }
    })
  })

  describe('INITIAL_TRANSFORM', () => {
    it('has scale of 1', () => {
      expect(INITIAL_TRANSFORM.scale).toBe(1)
    })

    it('has translateX of 0', () => {
      expect(INITIAL_TRANSFORM.translateX).toBe(0)
    })

    it('has translateY of 0', () => {
      expect(INITIAL_TRANSFORM.translateY).toBe(0)
    })
  })

  // ============================================================================
  // getNextZoomLevel Tests
  // ============================================================================

  describe('getNextZoomLevel()', () => {
    describe('zoom in', () => {
      it('returns next level up from 100%', () => {
        expect(getNextZoomLevel(1, 'in')).toBe(1.25)
      })

      it('returns next level up from 50%', () => {
        expect(getNextZoomLevel(0.5, 'in')).toBe(0.75)
      })

      it('returns next level up from 1%', () => {
        expect(getNextZoomLevel(0.01, 'in')).toBe(0.02)
      })

      it('returns max when at max', () => {
        expect(getNextZoomLevel(10, 'in')).toBe(10)
      })

      it('returns max when above max', () => {
        expect(getNextZoomLevel(15, 'in')).toBe(10)
      })

      it('snaps to nearest level above', () => {
        expect(getNextZoomLevel(0.8, 'in')).toBe(1)
        expect(getNextZoomLevel(1.1, 'in')).toBe(1.25)
      })

      it('handles values just below a level', () => {
        expect(getNextZoomLevel(0.999, 'in')).toBe(1.25)
      })
    })

    describe('zoom out', () => {
      it('returns next level down from 100%', () => {
        expect(getNextZoomLevel(1, 'out')).toBe(0.75)
      })

      it('returns next level down from 200%', () => {
        expect(getNextZoomLevel(2, 'out')).toBe(1.5)
      })

      it('returns min when at min', () => {
        expect(getNextZoomLevel(0.01, 'out')).toBe(0.01)
      })

      it('returns min when below min', () => {
        expect(getNextZoomLevel(0.005, 'out')).toBe(0.01)
      })

      it('snaps to nearest level below', () => {
        expect(getNextZoomLevel(0.8, 'out')).toBe(0.75)
        expect(getNextZoomLevel(1.1, 'out')).toBe(1)
      })

      it('handles values just above a level', () => {
        expect(getNextZoomLevel(1.001, 'out')).toBe(0.75)
      })
    })
  })

  // ============================================================================
  // clampScale Tests
  // ============================================================================

  describe('clampScale()', () => {
    it('returns value when within bounds', () => {
      expect(clampScale(1)).toBe(1)
      expect(clampScale(0.5)).toBe(0.5)
      expect(clampScale(5)).toBe(5)
    })

    it('returns MIN_SCALE when value is below min', () => {
      expect(clampScale(0.005)).toBe(0.01)
      expect(clampScale(0)).toBe(0.01)
      expect(clampScale(-1)).toBe(0.01)
    })

    it('returns MAX_SCALE when value is above max', () => {
      expect(clampScale(15)).toBe(10)
      expect(clampScale(100)).toBe(10)
    })

    it('returns boundary values exactly', () => {
      expect(clampScale(0.01)).toBe(0.01)
      expect(clampScale(10)).toBe(10)
    })
  })

  // ============================================================================
  // clampPan Tests
  // ============================================================================

  describe('clampPan()', () => {
    it('returns value when within bounds', () => {
      expect(clampPan(0)).toBe(0)
      expect(clampPan(100)).toBe(100)
      expect(clampPan(-100)).toBe(-100)
      expect(clampPan(5000)).toBe(5000)
    })

    it('returns MAX_PAN when value exceeds positive bound', () => {
      expect(clampPan(15000)).toBe(10000)
      expect(clampPan(100000)).toBe(10000)
    })

    it('returns -MAX_PAN when value exceeds negative bound', () => {
      expect(clampPan(-15000)).toBe(-10000)
      expect(clampPan(-100000)).toBe(-10000)
    })

    it('returns boundary values exactly', () => {
      expect(clampPan(10000)).toBe(10000)
      expect(clampPan(-10000)).toBe(-10000)
    })
  })

  // ============================================================================
  // calculateFitScale Tests
  // ============================================================================

  describe('calculateFitScale()', () => {
    it('returns 1 for image smaller than container', () => {
      expect(calculateFitScale(100, 100, 800, 600)).toBe(1)
    })

    it('returns 1 for image exactly fitting container (with padding)', () => {
      // Default padding is 40, so available is 720x520
      expect(calculateFitScale(720, 520, 800, 600)).toBe(1)
    })

    it('scales down wide image', () => {
      // Image: 1600x100, Container: 800x600, Padding: 40
      // Available: 720x520
      // scaleX = 720/1600 = 0.45, scaleY = 520/100 = 5.2
      // min(0.45, 5.2, 1) = 0.45
      expect(calculateFitScale(1600, 100, 800, 600)).toBeCloseTo(0.45)
    })

    it('scales down tall image', () => {
      // Image: 100x1200, Container: 800x600, Padding: 40
      // Available: 720x520
      // scaleX = 720/100 = 7.2, scaleY = 520/1200 = 0.433
      // min(7.2, 0.433, 1) = 0.433
      expect(calculateFitScale(100, 1200, 800, 600)).toBeCloseTo(0.433, 2)
    })

    it('uses custom padding', () => {
      // Image: 700x500, Container: 800x600, Padding: 50
      // Available: 700x500 (exact fit)
      expect(calculateFitScale(700, 500, 800, 600, 50)).toBe(1)
    })

    it('handles zero padding', () => {
      // Image: 800x600, Container: 800x600, Padding: 0
      expect(calculateFitScale(800, 600, 800, 600, 0)).toBe(1)
    })

    it('returns 1 for invalid image dimensions', () => {
      expect(calculateFitScale(0, 100, 800, 600)).toBe(1)
      expect(calculateFitScale(100, 0, 800, 600)).toBe(1)
      expect(calculateFitScale(-100, 100, 800, 600)).toBe(1)
      expect(calculateFitScale(100, -100, 800, 600)).toBe(1)
    })

    it('returns 1 for invalid container dimensions', () => {
      expect(calculateFitScale(100, 100, 0, 600)).toBe(1)
      expect(calculateFitScale(100, 100, 800, 0)).toBe(1)
      expect(calculateFitScale(100, 100, -800, 600)).toBe(1)
      expect(calculateFitScale(100, 100, 800, -600)).toBe(1)
    })

    it('returns 1 when padding makes available space zero or negative', () => {
      expect(calculateFitScale(100, 100, 80, 80, 40)).toBe(1)
      expect(calculateFitScale(100, 100, 50, 50, 40)).toBe(1)
    })
  })

  // ============================================================================
  // calculateCursorCenteredZoom Tests
  // ============================================================================

  describe('calculateCursorCenteredZoom()', () => {
    const createMockRect = (
      left: number,
      top: number,
      width: number,
      height: number
    ): DOMRect => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({})
    })

    it('returns new scale in result', () => {
      const current: Transform = { scale: 1, translateX: 0, translateY: 0 }
      const rect = createMockRect(0, 0, 800, 600)
      const result = calculateCursorCenteredZoom(current, 1.5, 400, 300, rect)
      expect(result.scale).toBe(1.5)
    })

    it('keeps center position when zooming at center', () => {
      const current: Transform = { scale: 1, translateX: 0, translateY: 0 }
      const rect = createMockRect(0, 0, 800, 600)
      // Cursor at container center (400, 300)
      const result = calculateCursorCenteredZoom(current, 2, 400, 300, rect)
      expect(result.translateX).toBeCloseTo(0)
      expect(result.translateY).toBeCloseTo(0)
    })

    it('adjusts translation when zooming at corner', () => {
      const current: Transform = { scale: 1, translateX: 0, translateY: 0 }
      const rect = createMockRect(0, 0, 800, 600)
      // Cursor at top-left (0, 0), center is (400, 300)
      // cursorRel = (-400, -300)
      // scaleFactor = 2
      // newTranslate = cursorRel * (1 - scaleFactor) + translate * scaleFactor
      //              = (-400) * (-1) + 0 = 400, (-300) * (-1) + 0 = 300
      const result = calculateCursorCenteredZoom(current, 2, 0, 0, rect)
      expect(result.translateX).toBeCloseTo(400)
      expect(result.translateY).toBeCloseTo(300)
    })

    it('preserves existing translation when zooming', () => {
      const current: Transform = { scale: 1, translateX: 100, translateY: 50 }
      const rect = createMockRect(0, 0, 800, 600)
      const result = calculateCursorCenteredZoom(current, 2, 400, 300, rect)
      // At center, cursorRel = (0, 0)
      // newTranslate = 0 * (1-2) + translate * 2 = translate * 2
      expect(result.translateX).toBeCloseTo(200)
      expect(result.translateY).toBeCloseTo(100)
    })

    it('handles zoom out', () => {
      const current: Transform = { scale: 2, translateX: 0, translateY: 0 }
      const rect = createMockRect(0, 0, 800, 600)
      const result = calculateCursorCenteredZoom(current, 1, 400, 300, rect)
      expect(result.scale).toBe(1)
      expect(result.translateX).toBeCloseTo(0)
      expect(result.translateY).toBeCloseTo(0)
    })
  })

  // ============================================================================
  // formatZoomLevel Tests
  // ============================================================================

  describe('formatZoomLevel()', () => {
    it('formats 100%', () => {
      expect(formatZoomLevel(1)).toBe('100%')
    })

    it('formats 50%', () => {
      expect(formatZoomLevel(0.5)).toBe('50%')
    })

    it('formats 200%', () => {
      expect(formatZoomLevel(2)).toBe('200%')
    })

    it('formats 1%', () => {
      expect(formatZoomLevel(0.01)).toBe('1%')
    })

    it('formats 1000%', () => {
      expect(formatZoomLevel(10)).toBe('1000%')
    })

    it('rounds fractional percentages', () => {
      expect(formatZoomLevel(1.234)).toBe('123%')
      expect(formatZoomLevel(0.567)).toBe('57%')
    })

    it('handles 0%', () => {
      expect(formatZoomLevel(0)).toBe('0%')
    })
  })

  // ============================================================================
  // formatFileSize Tests
  // ============================================================================

  describe('formatFileSize()', () => {
    describe('bytes', () => {
      it('formats 0 bytes', () => {
        expect(formatFileSize(0)).toBe('0 B')
      })

      it('formats small bytes', () => {
        expect(formatFileSize(512)).toBe('512 B')
      })

      it('formats 1023 bytes', () => {
        expect(formatFileSize(1023)).toBe('1023 B')
      })
    })

    describe('kilobytes', () => {
      it('formats 1 KB with decimal', () => {
        // Values under 10 KB show one decimal place
        expect(formatFileSize(1024)).toBe('1.0 KB')
      })

      it('formats small KB with decimal', () => {
        expect(formatFileSize(2560)).toBe('2.5 KB')
      })

      it('formats larger KB without decimal', () => {
        // Values 10 KB and above are rounded to whole numbers
        expect(formatFileSize(262144)).toBe('256 KB')
      })
    })

    describe('megabytes', () => {
      it('formats 1 MB', () => {
        expect(formatFileSize(1048576)).toBe('1.0 MB')
      })

      it('formats 1.5 MB', () => {
        expect(formatFileSize(1572864)).toBe('1.5 MB')
      })

      it('formats larger MB', () => {
        expect(formatFileSize(10485760)).toBe('10.0 MB')
      })
    })

    describe('edge cases', () => {
      it('handles negative values', () => {
        expect(formatFileSize(-100)).toBe('0 B')
      })

      it('handles Infinity', () => {
        expect(formatFileSize(Infinity)).toBe('0 B')
      })

      it('handles NaN', () => {
        expect(formatFileSize(NaN)).toBe('0 B')
      })
    })
  })

  // ============================================================================
  // formatDimensions Tests
  // ============================================================================

  describe('formatDimensions()', () => {
    it('formats standard dimensions', () => {
      expect(formatDimensions(1920, 1080)).toBe('1920 x 1080')
    })

    it('formats small dimensions', () => {
      expect(formatDimensions(16, 16)).toBe('16 x 16')
    })

    it('formats zero dimensions', () => {
      expect(formatDimensions(0, 0)).toBe('0 x 0')
    })

    it('formats large dimensions', () => {
      expect(formatDimensions(4096, 2160)).toBe('4096 x 2160')
    })
  })

  // ============================================================================
  // getKeyboardAction Tests
  // ============================================================================

  describe('getKeyboardAction()', () => {
    const createEvent = (
      key: string,
      modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}
    ): KeyEventInfo => ({
      key,
      ctrlKey: modifiers.ctrlKey ?? false,
      metaKey: modifiers.metaKey ?? false,
      shiftKey: modifiers.shiftKey ?? false
    })

    describe('zoom in', () => {
      it('returns zoomIn for + key', () => {
        expect(getKeyboardAction(createEvent('+'))).toBe('zoomIn')
      })

      it('returns zoomIn for = key', () => {
        expect(getKeyboardAction(createEvent('='))).toBe('zoomIn')
      })

      it('returns zoomIn with shift', () => {
        expect(getKeyboardAction(createEvent('+', { shiftKey: true }))).toBe('zoomIn')
      })
    })

    describe('zoom out', () => {
      it('returns zoomOut for - key', () => {
        expect(getKeyboardAction(createEvent('-'))).toBe('zoomOut')
      })

      it('returns zoomOut with shift', () => {
        expect(getKeyboardAction(createEvent('-', { shiftKey: true }))).toBe('zoomOut')
      })
    })

    describe('reset', () => {
      it('returns reset for 0 key', () => {
        expect(getKeyboardAction(createEvent('0'))).toBe('reset')
      })
    })

    describe('fit', () => {
      it('returns fit for f key', () => {
        expect(getKeyboardAction(createEvent('f'))).toBe('fit')
      })

      it('returns fit for F key', () => {
        expect(getKeyboardAction(createEvent('F'))).toBe('fit')
      })
    })

    describe('fullscreen', () => {
      it('returns fullscreen for Escape key', () => {
        expect(getKeyboardAction(createEvent('Escape'))).toBe('fullscreen')
      })
    })

    describe('pan', () => {
      it('returns panUp for ArrowUp', () => {
        expect(getKeyboardAction(createEvent('ArrowUp'))).toBe('panUp')
      })

      it('returns panDown for ArrowDown', () => {
        expect(getKeyboardAction(createEvent('ArrowDown'))).toBe('panDown')
      })

      it('returns panLeft for ArrowLeft', () => {
        expect(getKeyboardAction(createEvent('ArrowLeft'))).toBe('panLeft')
      })

      it('returns panRight for ArrowRight', () => {
        expect(getKeyboardAction(createEvent('ArrowRight'))).toBe('panRight')
      })
    })

    describe('modifier filtering', () => {
      it('returns null for + with Ctrl', () => {
        expect(getKeyboardAction(createEvent('+', { ctrlKey: true }))).toBeNull()
      })

      it('returns null for + with Meta', () => {
        expect(getKeyboardAction(createEvent('+', { metaKey: true }))).toBeNull()
      })

      it('returns null for - with Ctrl', () => {
        expect(getKeyboardAction(createEvent('-', { ctrlKey: true }))).toBeNull()
      })

      it('returns null for 0 with Meta', () => {
        expect(getKeyboardAction(createEvent('0', { metaKey: true }))).toBeNull()
      })

      it('returns null for f with Ctrl', () => {
        expect(getKeyboardAction(createEvent('f', { ctrlKey: true }))).toBeNull()
      })

      it('returns null for Escape with Ctrl', () => {
        expect(getKeyboardAction(createEvent('Escape', { ctrlKey: true }))).toBeNull()
      })
    })

    describe('unknown keys', () => {
      it('returns null for unrecognized keys', () => {
        expect(getKeyboardAction(createEvent('a'))).toBeNull()
        expect(getKeyboardAction(createEvent('z'))).toBeNull()
        expect(getKeyboardAction(createEvent('1'))).toBeNull()
        expect(getKeyboardAction(createEvent('Enter'))).toBeNull()
        expect(getKeyboardAction(createEvent('Tab'))).toBeNull()
        expect(getKeyboardAction(createEvent(' '))).toBeNull()
      })
    })
  })

  // ============================================================================
  // getZoomButtonStates Tests
  // ============================================================================

  describe('getZoomButtonStates()', () => {
    it('enables both buttons in middle range', () => {
      const result = getZoomButtonStates(1)
      expect(result.canZoomIn).toBe(true)
      expect(result.canZoomOut).toBe(true)
    })

    it('disables zoom out at minimum', () => {
      const result = getZoomButtonStates(0.01)
      expect(result.canZoomIn).toBe(true)
      expect(result.canZoomOut).toBe(false)
    })

    it('disables zoom in at maximum', () => {
      const result = getZoomButtonStates(10)
      expect(result.canZoomIn).toBe(false)
      expect(result.canZoomOut).toBe(true)
    })

    it('enables both just above minimum', () => {
      const result = getZoomButtonStates(0.02)
      expect(result.canZoomIn).toBe(true)
      expect(result.canZoomOut).toBe(true)
    })

    it('enables both just below maximum', () => {
      const result = getZoomButtonStates(9.99)
      expect(result.canZoomIn).toBe(true)
      expect(result.canZoomOut).toBe(true)
    })
  })

  // ============================================================================
  // isDefaultTransform Tests
  // ============================================================================

  describe('isDefaultTransform()', () => {
    it('returns true for default transform', () => {
      expect(isDefaultTransform({ scale: 1, translateX: 0, translateY: 0 })).toBe(true)
    })

    it('returns true for INITIAL_TRANSFORM', () => {
      expect(isDefaultTransform(INITIAL_TRANSFORM)).toBe(true)
    })

    it('returns false when scale differs', () => {
      expect(isDefaultTransform({ scale: 1.5, translateX: 0, translateY: 0 })).toBe(false)
    })

    it('returns false when translateX differs', () => {
      expect(isDefaultTransform({ scale: 1, translateX: 10, translateY: 0 })).toBe(false)
    })

    it('returns false when translateY differs', () => {
      expect(isDefaultTransform({ scale: 1, translateX: 0, translateY: 10 })).toBe(false)
    })

    it('handles floating point precision', () => {
      // Values within EPSILON should be considered equal
      expect(
        isDefaultTransform({ scale: 1.0005, translateX: 0.0005, translateY: -0.0005 })
      ).toBe(true)
    })

    it('returns false for values just outside EPSILON', () => {
      expect(
        isDefaultTransform({ scale: 1.002, translateX: 0, translateY: 0 })
      ).toBe(false)
    })
  })
})
