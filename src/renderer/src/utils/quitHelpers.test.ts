// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Quit Confirmation Helper Functions
 *
 * Tests checkQuitBlocked() and buildQuitConfirmMessage() utilities
 * used by quit confirmation feature.
 *
 * @see Issue #64 - quit confirmation feature
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkQuitBlocked, buildQuitConfirmMessage } from './quitHelpers'
import type { QuitBlockedState } from './quitHelpers'

// Mock switchHelpers
vi.mock('../components/ProjectTree/switchHelpers', () => ({
  checkHasDirtyEditors: vi.fn(),
  checkTerminalBusy: vi.fn()
}))

import { checkHasDirtyEditors, checkTerminalBusy } from '../components/ProjectTree/switchHelpers'

describe('quitHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checkQuitBlocked', () => {
    it('returns isBlocked=false when no dirty editors and no terminal activity', async () => {
      vi.mocked(checkHasDirtyEditors).mockResolvedValue(false)
      vi.mocked(checkTerminalBusy).mockResolvedValue(false)

      const result = await checkQuitBlocked()

      expect(result).toEqual({
        hasDirtyEditors: false,
        hasTerminalActivity: false,
        isBlocked: false
      })
    })

    it('returns isBlocked=true when dirty editors exist', async () => {
      vi.mocked(checkHasDirtyEditors).mockResolvedValue(true)
      vi.mocked(checkTerminalBusy).mockResolvedValue(false)

      const result = await checkQuitBlocked()

      expect(result).toEqual({
        hasDirtyEditors: true,
        hasTerminalActivity: false,
        isBlocked: true
      })
    })

    it('returns isBlocked=true when terminal activity exists', async () => {
      vi.mocked(checkHasDirtyEditors).mockResolvedValue(false)
      vi.mocked(checkTerminalBusy).mockResolvedValue(true)

      const result = await checkQuitBlocked()

      expect(result).toEqual({
        hasDirtyEditors: false,
        hasTerminalActivity: true,
        isBlocked: true
      })
    })

    it('returns isBlocked=true when both conditions exist', async () => {
      vi.mocked(checkHasDirtyEditors).mockResolvedValue(true)
      vi.mocked(checkTerminalBusy).mockResolvedValue(true)

      const result = await checkQuitBlocked()

      expect(result).toEqual({
        hasDirtyEditors: true,
        hasTerminalActivity: true,
        isBlocked: true
      })
    })

    it('correctly sets hasDirtyEditors flag', async () => {
      vi.mocked(checkHasDirtyEditors).mockResolvedValue(true)
      vi.mocked(checkTerminalBusy).mockResolvedValue(false)

      const result = await checkQuitBlocked()

      expect(result.hasDirtyEditors).toBe(true)
      expect(checkHasDirtyEditors).toHaveBeenCalledTimes(1)
    })

    it('correctly sets hasTerminalActivity flag', async () => {
      vi.mocked(checkHasDirtyEditors).mockResolvedValue(false)
      vi.mocked(checkTerminalBusy).mockResolvedValue(true)

      const result = await checkQuitBlocked()

      expect(result.hasTerminalActivity).toBe(true)
      expect(checkTerminalBusy).toHaveBeenCalledTimes(1)
    })

    it('passes RECENT_ACTIVITY_WINDOW constant to checkTerminalBusy', async () => {
      vi.mocked(checkHasDirtyEditors).mockResolvedValue(false)
      vi.mocked(checkTerminalBusy).mockResolvedValue(false)

      await checkQuitBlocked()

      // Should pass 20000ms constant from TERMINAL.RECENT_ACTIVITY_WINDOW
      expect(checkTerminalBusy).toHaveBeenCalledWith(20000)
    })
  })

  describe('buildQuitConfirmMessage', () => {
    it('returns "Unsaved changes" title when only dirty editors', () => {
      const state: QuitBlockedState = {
        hasDirtyEditors: true,
        hasTerminalActivity: false,
        isBlocked: true
      }

      const result = buildQuitConfirmMessage(state)

      expect(result.title).toBe('Unsaved changes')
    })

    it('returns "Active terminal session" title when only terminal activity', () => {
      const state: QuitBlockedState = {
        hasDirtyEditors: false,
        hasTerminalActivity: true,
        isBlocked: true
      }

      const result = buildQuitConfirmMessage(state)

      expect(result.title).toBe('Active terminal session')
    })

    it('returns combined title when both conditions exist', () => {
      const state: QuitBlockedState = {
        hasDirtyEditors: true,
        hasTerminalActivity: true,
        isBlocked: true
      }

      const result = buildQuitConfirmMessage(state)

      expect(result.title).toBe('Unsaved changes and active terminal')
    })

    it('message includes unsaved changes warning when hasDirtyEditors=true', () => {
      const state: QuitBlockedState = {
        hasDirtyEditors: true,
        hasTerminalActivity: false,
        isBlocked: true
      }

      const result = buildQuitConfirmMessage(state)

      expect(result.message).toContain('unsaved changes')
      expect(result.message).toBe('You have unsaved changes. Discard and quit?')
    })

    it('message includes terminal warning when hasTerminalActivity=true', () => {
      const state: QuitBlockedState = {
        hasDirtyEditors: false,
        hasTerminalActivity: true,
        isBlocked: true
      }

      const result = buildQuitConfirmMessage(state)

      expect(result.message).toContain('Terminal shows recent activity')
      expect(result.message).toBe('Terminal shows recent activity. Stop it and quit?')
    })

    it('message includes both warnings when both conditions exist', () => {
      const state: QuitBlockedState = {
        hasDirtyEditors: true,
        hasTerminalActivity: true,
        isBlocked: true
      }

      const result = buildQuitConfirmMessage(state)

      expect(result.message).toContain('unsaved changes')
      expect(result.message).toContain('active terminal session')
      expect(result.message).toBe(
        'You have unsaved changes and an active terminal session. Discard changes and quit?'
      )
    })

    it('message ends with quit confirmation question', () => {
      const state: QuitBlockedState = {
        hasDirtyEditors: true,
        hasTerminalActivity: false,
        isBlocked: true
      }

      const result = buildQuitConfirmMessage(state)

      expect(result.message).toMatch(/quit\?$/i)
    })

    it('provides fallback message when not blocked (edge case)', () => {
      const state: QuitBlockedState = {
        hasDirtyEditors: false,
        hasTerminalActivity: false,
        isBlocked: false
      }

      const result = buildQuitConfirmMessage(state)

      expect(result.title).toBe('Quit application')
      expect(result.message).toBe('Are you sure you want to quit?')
    })
  })

  describe('integration scenarios', () => {
    it('checkQuitBlocked state can be directly passed to buildQuitConfirmMessage', async () => {
      vi.mocked(checkHasDirtyEditors).mockResolvedValue(true)
      vi.mocked(checkTerminalBusy).mockResolvedValue(true)

      const state = await checkQuitBlocked()
      const message = buildQuitConfirmMessage(state)

      expect(state.isBlocked).toBe(true)
      expect(message.title).toBe('Unsaved changes and active terminal')
      expect(message.message).toContain('unsaved changes')
      expect(message.message).toContain('active terminal session')
    })

    it('handles all four combinations of blocker states correctly', async () => {
      const scenarios: Array<{
        hasDirty: boolean
        termBusy: boolean
        expectedTitle: string
      }> = [
        { hasDirty: false, termBusy: false, expectedTitle: 'Quit application' },
        { hasDirty: true, termBusy: false, expectedTitle: 'Unsaved changes' },
        { hasDirty: false, termBusy: true, expectedTitle: 'Active terminal session' },
        { hasDirty: true, termBusy: true, expectedTitle: 'Unsaved changes and active terminal' }
      ]

      for (const scenario of scenarios) {
        vi.mocked(checkHasDirtyEditors).mockResolvedValue(scenario.hasDirty)
        vi.mocked(checkTerminalBusy).mockResolvedValue(scenario.termBusy)

        const state = await checkQuitBlocked()
        const message = buildQuitConfirmMessage(state)

        expect(message.title).toBe(scenario.expectedTitle)
      }
    })
  })
})
