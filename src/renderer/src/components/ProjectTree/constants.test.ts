// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for ProjectTree Constants
 *
 * Simple validation tests for constant values used throughout ProjectTree.
 * These tests ensure the constants remain stable and match expected values.
 */

import { describe, it, expect } from 'vitest'
import { DRAG_DROP, TERMINAL, AUTO_SCROLL, AUTO_EXPAND } from './constants'

describe('ProjectTree constants', () => {
  describe('DRAG_DROP', () => {
    it('should have ACTIVATION_DISTANCE = 5', () => {
      expect(DRAG_DROP.ACTIVATION_DISTANCE).toBe(5)
    })
  })

  describe('TERMINAL', () => {
    it('should have RECENT_ACTIVITY_WINDOW = 20000', () => {
      expect(TERMINAL.RECENT_ACTIVITY_WINDOW).toBe(20_000)
    })

    it('should have INTERRUPT_SIGNAL = \\u0003 (Ctrl+C)', () => {
      expect(TERMINAL.INTERRUPT_SIGNAL).toBe('\u0003')
    })

    it('should have SIGNAL_DELAY = 300', () => {
      expect(TERMINAL.SIGNAL_DELAY).toBe(300)
    })

    it('should have ACTIVITY_CHECK_WINDOW = 300', () => {
      expect(TERMINAL.ACTIVITY_CHECK_WINDOW).toBe(300)
    })
  })

  describe('AUTO_SCROLL', () => {
    it('should have TRIGGER_DISTANCE_TOP = 50', () => {
      expect(AUTO_SCROLL.TRIGGER_DISTANCE_TOP).toBe(50)
    })

    it('should have TRIGGER_DISTANCE_BOTTOM = 50', () => {
      expect(AUTO_SCROLL.TRIGGER_DISTANCE_BOTTOM).toBe(50)
    })

    it('should have SCROLL_AMOUNT = 5', () => {
      expect(AUTO_SCROLL.SCROLL_AMOUNT).toBe(5)
    })

    it('should have SCROLL_INTERVAL = 16 (~60fps)', () => {
      expect(AUTO_SCROLL.SCROLL_INTERVAL).toBe(16)
    })
  })

  describe('AUTO_EXPAND', () => {
    it('should have HOVER_DELAY = 1000', () => {
      expect(AUTO_EXPAND.HOVER_DELAY).toBe(1_000)
    })
  })
})
