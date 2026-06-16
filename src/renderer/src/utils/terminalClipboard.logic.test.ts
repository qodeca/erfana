// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure Logic Tests for Terminal Clipboard Operations
 *
 * Tests for pure functions in terminalClipboard.logic.ts:
 * - getClipboardAction(): Keyboard event to action mapping
 * - shouldPassThrough(): Event filtering logic
 *
 * Platform detection (isMacOS) now lives in utils/platform.ts and is tested
 * there. These tests pass the platform as an explicit argument so they stay
 * pure (no `window.api`/`navigator` access).
 */

import { describe, it, expect } from 'vitest'
import {
  getClipboardAction,
  shouldPassThrough,
  type ClipboardAction,
  type KeyEventInfo
} from './terminalClipboard.logic'

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

describe('terminalClipboard.logic', () => {
  describe('getClipboardAction()', () => {
    describe('macOS (Cmd+C/V)', () => {
      it('returns copy for Cmd+C with selection', () => {
        const event = createEvent('c', { metaKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('copy')
      })

      it('returns copy for Cmd+C with uppercase C', () => {
        const event = createEvent('C', { metaKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('copy')
      })

      it('returns none for Cmd+C without selection (SIGINT)', () => {
        const event = createEvent('c', { metaKey: true })
        expect(getClipboardAction(event, false, 'darwin')).toBe('none')
      })

      it('returns none for Cmd+V (let xterm handle native paste)', () => {
        const event = createEvent('v', { metaKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('none')
        expect(getClipboardAction(event, false, 'darwin')).toBe('none')
      })

      it('returns none for Cmd+V with uppercase V', () => {
        const event = createEvent('V', { metaKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('none')
      })

      it('returns none for Cmd+C with Ctrl also pressed', () => {
        const event = createEvent('c', { metaKey: true, ctrlKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('none')
      })

      it('returns none for Cmd+C with Shift also pressed', () => {
        const event = createEvent('c', { metaKey: true, shiftKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('none')
      })

      it('returns none for Cmd+A (select all)', () => {
        const event = createEvent('a', { metaKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('none')
      })
    })

    describe('Windows/Linux (Ctrl+C/V)', () => {
      it('returns copy for Ctrl+C with selection', () => {
        const event = createEvent('c', { ctrlKey: true })
        expect(getClipboardAction(event, true, 'win32')).toBe('copy')
      })

      it('returns copy for Ctrl+C with uppercase C', () => {
        const event = createEvent('C', { ctrlKey: true })
        expect(getClipboardAction(event, true, 'win32')).toBe('copy')
      })

      it('returns none for Ctrl+C without selection (SIGINT)', () => {
        const event = createEvent('c', { ctrlKey: true })
        expect(getClipboardAction(event, false, 'win32')).toBe('none')
      })

      it('returns none for Ctrl+V (let xterm handle native paste)', () => {
        const event = createEvent('v', { ctrlKey: true })
        expect(getClipboardAction(event, true, 'win32')).toBe('none')
        expect(getClipboardAction(event, false, 'win32')).toBe('none')
      })

      it('returns none for Ctrl+V with uppercase V', () => {
        const event = createEvent('V', { ctrlKey: true })
        expect(getClipboardAction(event, true, 'win32')).toBe('none')
      })

      it('returns copy for Ctrl+Shift+C (handled in explicit shortcuts)', () => {
        const event = createEvent('c', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, true, 'win32')).toBe('copy')
      })

      it('returns none for Ctrl+C with Meta also pressed', () => {
        const event = createEvent('c', { ctrlKey: true, metaKey: true })
        expect(getClipboardAction(event, true, 'win32')).toBe('none')
      })

      it('returns none for Ctrl+A (select all)', () => {
        const event = createEvent('a', { ctrlKey: true })
        expect(getClipboardAction(event, true, 'win32')).toBe('none')
      })

      it('behaves identically on linux as on win32', () => {
        const event = createEvent('c', { ctrlKey: true })
        expect(getClipboardAction(event, true, 'linux')).toBe('copy')
        expect(getClipboardAction(event, false, 'linux')).toBe('none')
      })
    })

    describe('Explicit shortcuts (Ctrl+Shift+C/V) - All Platforms', () => {
      it('returns copy for Ctrl+Shift+C with selection on macOS', () => {
        const event = createEvent('c', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('copy')
      })

      it('returns copy for Ctrl+Shift+C without selection on macOS', () => {
        const event = createEvent('c', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, false, 'darwin')).toBe('copy')
      })

      it('returns copy for Ctrl+Shift+C with selection on Windows', () => {
        const event = createEvent('c', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, true, 'win32')).toBe('copy')
      })

      it('returns copy for Ctrl+Shift+C without selection on Windows', () => {
        const event = createEvent('c', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, false, 'win32')).toBe('copy')
      })

      it('returns paste for Ctrl+Shift+V on macOS', () => {
        const event = createEvent('v', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('paste')
        expect(getClipboardAction(event, false, 'darwin')).toBe('paste')
      })

      it('returns paste for Ctrl+Shift+V on Windows', () => {
        const event = createEvent('v', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, true, 'win32')).toBe('paste')
        expect(getClipboardAction(event, false, 'win32')).toBe('paste')
      })

      it('returns paste for Ctrl+Shift+V with uppercase V', () => {
        const event = createEvent('V', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('paste')
      })
    })

    describe('Non-clipboard keys', () => {
      it('returns none for just "c" key', () => {
        const event = createEvent('c')
        expect(getClipboardAction(event, true, 'darwin')).toBe('none')
        expect(getClipboardAction(event, false, 'darwin')).toBe('none')
      })

      it('returns none for just "v" key', () => {
        const event = createEvent('v')
        expect(getClipboardAction(event, true, 'darwin')).toBe('none')
        expect(getClipboardAction(event, false, 'darwin')).toBe('none')
      })

      it('returns none for Cmd+A', () => {
        const event = createEvent('a', { metaKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('none')
      })

      it('returns none for Cmd+X', () => {
        const event = createEvent('x', { metaKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('none')
      })

      it('returns none for Cmd+Z', () => {
        const event = createEvent('z', { metaKey: true })
        expect(getClipboardAction(event, true, 'darwin')).toBe('none')
      })

      it('returns none for Ctrl+A on Windows', () => {
        const event = createEvent('a', { ctrlKey: true })
        expect(getClipboardAction(event, true, 'win32')).toBe('none')
      })

      it('returns none for Enter key', () => {
        const event = createEvent('Enter')
        expect(getClipboardAction(event, true, 'darwin')).toBe('none')
      })

      it('returns none for Escape key', () => {
        const event = createEvent('Escape')
        expect(getClipboardAction(event, true, 'darwin')).toBe('none')
      })

      it('returns none for Arrow keys', () => {
        expect(getClipboardAction(createEvent('ArrowUp'), true, 'darwin')).toBe('none')
        expect(getClipboardAction(createEvent('ArrowDown'), true, 'darwin')).toBe('none')
        expect(getClipboardAction(createEvent('ArrowLeft'), true, 'darwin')).toBe('none')
        expect(getClipboardAction(createEvent('ArrowRight'), true, 'darwin')).toBe('none')
      })
    })

    /**
     * Regression guard: pin the full SIGINT-vs-copy decision table.
     *
     * `getClipboardAction` is load-bearing (it decides whether Ctrl+C/Cmd+C is a
     * copy or passes through as SIGINT). This test recomputes the expected action
     * from an INDEPENDENT reference implementation for every combination of key,
     * modifiers, selection state, and platform — so any behavioral drift after the
     * platform-bridge migration is caught here.
     */
    describe('decision table regression (pin behavior)', () => {
      // Independent reference mirroring the documented decision table.
      const referenceAction = (
        isMac: boolean,
        key: string,
        ctrlKey: boolean,
        metaKey: boolean,
        shiftKey: boolean,
        hasSelection: boolean
      ): ClipboardAction => {
        const k = key.toLowerCase()
        if (ctrlKey && shiftKey) {
          if (k === 'c') return 'copy'
          if (k === 'v') return 'paste'
        }
        if (isMac && metaKey && !ctrlKey && !shiftKey) {
          if (k === 'c') return hasSelection ? 'copy' : 'none'
        }
        if (!isMac && ctrlKey && !shiftKey && !metaKey) {
          if (k === 'c') return hasSelection ? 'copy' : 'none'
        }
        return 'none'
      }

      const keys = ['c', 'C', 'v', 'V', 'a', 'x', 'Enter']
      const bools = [false, true]
      const platforms: Array<{ platform: NodeJS.Platform; isMac: boolean }> = [
        { platform: 'darwin', isMac: true },
        { platform: 'win32', isMac: false }
      ]

      it('matches the reference for every input combination on darwin and win32', () => {
        for (const { platform, isMac } of platforms) {
          for (const key of keys) {
            for (const ctrlKey of bools) {
              for (const metaKey of bools) {
                for (const shiftKey of bools) {
                  for (const hasSelection of bools) {
                    const event = createEvent(key, { ctrlKey, metaKey, shiftKey })
                    const expected = referenceAction(
                      isMac,
                      key,
                      ctrlKey,
                      metaKey,
                      shiftKey,
                      hasSelection
                    )
                    const actual = getClipboardAction(event, hasSelection, platform)
                    expect(
                      actual,
                      `platform=${platform} key=${key} ctrl=${ctrlKey} meta=${metaKey} shift=${shiftKey} sel=${hasSelection}`
                    ).toBe(expected)
                    // shouldPassThrough must stay the exact inverse of "action !== none"
                    expect(shouldPassThrough(event, hasSelection, platform)).toBe(
                      expected === 'none'
                    )
                  }
                }
              }
            }
          }
        }
      })
    })
  })

  describe('shouldPassThrough()', () => {
    it('returns false when getClipboardAction returns copy', () => {
      const event = createEvent('c', { metaKey: true })
      expect(shouldPassThrough(event, true, 'darwin')).toBe(false)
    })

    it('returns false when getClipboardAction returns paste (explicit Ctrl+Shift+V)', () => {
      // Use Ctrl+Shift+V since standard Cmd+V / Ctrl+V now return 'none'
      // (letting xterm handle native paste to avoid double-paste)
      const event = createEvent('v', { ctrlKey: true, shiftKey: true })
      expect(shouldPassThrough(event, true, 'darwin')).toBe(false)
    })

    it('returns true when getClipboardAction returns none', () => {
      const event = createEvent('a', { metaKey: true })
      expect(shouldPassThrough(event, true, 'darwin')).toBe(true)
    })

    it('returns true for Cmd+C without selection (SIGINT)', () => {
      const event = createEvent('c', { metaKey: true })
      expect(shouldPassThrough(event, false, 'darwin')).toBe(true)
    })

    it('returns true for Ctrl+C without selection on Windows (SIGINT)', () => {
      const event = createEvent('c', { ctrlKey: true })
      expect(shouldPassThrough(event, false, 'win32')).toBe(true)
    })

    it('returns true for regular key presses', () => {
      const event = createEvent('a')
      expect(shouldPassThrough(event, true, 'darwin')).toBe(true)
    })

    it('returns true for Enter key', () => {
      const event = createEvent('Enter')
      expect(shouldPassThrough(event, true, 'darwin')).toBe(true)
    })

    it('returns true for Escape key', () => {
      const event = createEvent('Escape')
      expect(shouldPassThrough(event, true, 'darwin')).toBe(true)
    })
  })
})
