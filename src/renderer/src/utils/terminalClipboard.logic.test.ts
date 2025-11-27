/**
 * Pure Logic Tests for Terminal Clipboard Operations
 *
 * Tests for pure functions in terminalClipboard.logic.ts:
 * - isMacOS(): Platform detection
 * - getClipboardAction(): Keyboard event to action mapping
 * - shouldPassThrough(): Event filtering logic
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isMacOS, getClipboardAction, shouldPassThrough, type KeyEventInfo } from './terminalClipboard.logic'

describe('terminalClipboard.logic', () => {
  describe('isMacOS()', () => {
    let originalPlatform: string

    beforeEach(() => {
      originalPlatform = navigator.platform
    })

    afterEach(() => {
      // Restore original platform
      Object.defineProperty(navigator, 'platform', {
        value: originalPlatform,
        writable: true,
        configurable: true
      })
    })

    it('returns true for MacIntel', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        writable: true,
        configurable: true
      })
      expect(isMacOS()).toBe(true)
    })

    it('returns true for MacPPC', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacPPC',
        writable: true,
        configurable: true
      })
      expect(isMacOS()).toBe(true)
    })

    it('returns true for Macintosh', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Macintosh',
        writable: true,
        configurable: true
      })
      expect(isMacOS()).toBe(true)
    })

    it('returns true for lowercase mac', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'mac',
        writable: true,
        configurable: true
      })
      expect(isMacOS()).toBe(true)
    })

    it('returns false for Win32', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true,
        configurable: true
      })
      expect(isMacOS()).toBe(false)
    })

    it('returns false for Linux x86_64', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux x86_64',
        writable: true,
        configurable: true
      })
      expect(isMacOS()).toBe(false)
    })

    it('returns false for empty string', () => {
      Object.defineProperty(navigator, 'platform', {
        value: '',
        writable: true,
        configurable: true
      })
      expect(isMacOS()).toBe(false)
    })
  })

  describe('getClipboardAction()', () => {
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

    let originalPlatform: string

    beforeEach(() => {
      originalPlatform = navigator.platform
    })

    afterEach(() => {
      Object.defineProperty(navigator, 'platform', {
        value: originalPlatform,
        writable: true,
        configurable: true
      })
    })

    describe('macOS (Cmd+C/V)', () => {
      beforeEach(() => {
        Object.defineProperty(navigator, 'platform', {
          value: 'MacIntel',
          writable: true,
          configurable: true
        })
      })

      it('returns copy for Cmd+C with selection', () => {
        const event = createEvent('c', { metaKey: true })
        expect(getClipboardAction(event, true)).toBe('copy')
      })

      it('returns copy for Cmd+C with uppercase C', () => {
        const event = createEvent('C', { metaKey: true })
        expect(getClipboardAction(event, true)).toBe('copy')
      })

      it('returns none for Cmd+C without selection (SIGINT)', () => {
        const event = createEvent('c', { metaKey: true })
        expect(getClipboardAction(event, false)).toBe('none')
      })

      it('returns none for Cmd+V (let xterm handle native paste)', () => {
        const event = createEvent('v', { metaKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
        expect(getClipboardAction(event, false)).toBe('none')
      })

      it('returns none for Cmd+V with uppercase V', () => {
        const event = createEvent('V', { metaKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
      })

      it('returns none for Cmd+C with Ctrl also pressed', () => {
        const event = createEvent('c', { metaKey: true, ctrlKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
      })

      it('returns none for Cmd+C with Shift also pressed', () => {
        const event = createEvent('c', { metaKey: true, shiftKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
      })

      it('returns none for Cmd+A (select all)', () => {
        const event = createEvent('a', { metaKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
      })
    })

    describe('Windows/Linux (Ctrl+C/V)', () => {
      beforeEach(() => {
        Object.defineProperty(navigator, 'platform', {
          value: 'Win32',
          writable: true,
          configurable: true
        })
      })

      it('returns copy for Ctrl+C with selection', () => {
        const event = createEvent('c', { ctrlKey: true })
        expect(getClipboardAction(event, true)).toBe('copy')
      })

      it('returns copy for Ctrl+C with uppercase C', () => {
        const event = createEvent('C', { ctrlKey: true })
        expect(getClipboardAction(event, true)).toBe('copy')
      })

      it('returns none for Ctrl+C without selection (SIGINT)', () => {
        const event = createEvent('c', { ctrlKey: true })
        expect(getClipboardAction(event, false)).toBe('none')
      })

      it('returns none for Ctrl+V (let xterm handle native paste)', () => {
        const event = createEvent('v', { ctrlKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
        expect(getClipboardAction(event, false)).toBe('none')
      })

      it('returns none for Ctrl+V with uppercase V', () => {
        const event = createEvent('V', { ctrlKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
      })

      it('returns none for Ctrl+C with Shift also pressed', () => {
        const event = createEvent('c', { ctrlKey: true, shiftKey: true })
        // Ctrl+Shift+C is handled in explicit shortcuts section
        expect(getClipboardAction(event, true)).toBe('copy')
      })

      it('returns none for Ctrl+C with Meta also pressed', () => {
        const event = createEvent('c', { ctrlKey: true, metaKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
      })

      it('returns none for Ctrl+A (select all)', () => {
        const event = createEvent('a', { ctrlKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
      })
    })

    describe('Explicit shortcuts (Ctrl+Shift+C/V) - All Platforms', () => {
      it('returns copy for Ctrl+Shift+C with selection on macOS', () => {
        Object.defineProperty(navigator, 'platform', {
          value: 'MacIntel',
          writable: true,
          configurable: true
        })
        const event = createEvent('c', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, true)).toBe('copy')
      })

      it('returns copy for Ctrl+Shift+C without selection on macOS', () => {
        Object.defineProperty(navigator, 'platform', {
          value: 'MacIntel',
          writable: true,
          configurable: true
        })
        const event = createEvent('c', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, false)).toBe('copy')
      })

      it('returns copy for Ctrl+Shift+C with selection on Windows', () => {
        Object.defineProperty(navigator, 'platform', {
          value: 'Win32',
          writable: true,
          configurable: true
        })
        const event = createEvent('c', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, true)).toBe('copy')
      })

      it('returns copy for Ctrl+Shift+C without selection on Windows', () => {
        Object.defineProperty(navigator, 'platform', {
          value: 'Win32',
          writable: true,
          configurable: true
        })
        const event = createEvent('c', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, false)).toBe('copy')
      })

      it('returns paste for Ctrl+Shift+V on macOS', () => {
        Object.defineProperty(navigator, 'platform', {
          value: 'MacIntel',
          writable: true,
          configurable: true
        })
        const event = createEvent('v', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, true)).toBe('paste')
        expect(getClipboardAction(event, false)).toBe('paste')
      })

      it('returns paste for Ctrl+Shift+V on Windows', () => {
        Object.defineProperty(navigator, 'platform', {
          value: 'Win32',
          writable: true,
          configurable: true
        })
        const event = createEvent('v', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, true)).toBe('paste')
        expect(getClipboardAction(event, false)).toBe('paste')
      })

      it('returns paste for Ctrl+Shift+V with uppercase V', () => {
        const event = createEvent('V', { ctrlKey: true, shiftKey: true })
        expect(getClipboardAction(event, true)).toBe('paste')
      })
    })

    describe('Non-clipboard keys', () => {
      beforeEach(() => {
        Object.defineProperty(navigator, 'platform', {
          value: 'MacIntel',
          writable: true,
          configurable: true
        })
      })

      it('returns none for just "c" key', () => {
        const event = createEvent('c')
        expect(getClipboardAction(event, true)).toBe('none')
        expect(getClipboardAction(event, false)).toBe('none')
      })

      it('returns none for just "v" key', () => {
        const event = createEvent('v')
        expect(getClipboardAction(event, true)).toBe('none')
        expect(getClipboardAction(event, false)).toBe('none')
      })

      it('returns none for Cmd+A', () => {
        const event = createEvent('a', { metaKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
      })

      it('returns none for Cmd+X', () => {
        const event = createEvent('x', { metaKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
      })

      it('returns none for Cmd+Z', () => {
        const event = createEvent('z', { metaKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
      })

      it('returns none for Ctrl+A on Windows', () => {
        Object.defineProperty(navigator, 'platform', {
          value: 'Win32',
          writable: true,
          configurable: true
        })
        const event = createEvent('a', { ctrlKey: true })
        expect(getClipboardAction(event, true)).toBe('none')
      })

      it('returns none for Enter key', () => {
        const event = createEvent('Enter')
        expect(getClipboardAction(event, true)).toBe('none')
      })

      it('returns none for Escape key', () => {
        const event = createEvent('Escape')
        expect(getClipboardAction(event, true)).toBe('none')
      })

      it('returns none for Arrow keys', () => {
        expect(getClipboardAction(createEvent('ArrowUp'), true)).toBe('none')
        expect(getClipboardAction(createEvent('ArrowDown'), true)).toBe('none')
        expect(getClipboardAction(createEvent('ArrowLeft'), true)).toBe('none')
        expect(getClipboardAction(createEvent('ArrowRight'), true)).toBe('none')
      })
    })
  })

  describe('shouldPassThrough()', () => {
    const createEvent = (
      key: string,
      modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}
    ): KeyEventInfo => ({
      key,
      ctrlKey: modifiers.ctrlKey ?? false,
      metaKey: modifiers.metaKey ?? false,
      shiftKey: modifiers.shiftKey ?? false
    })

    let originalPlatform: string

    beforeEach(() => {
      originalPlatform = navigator.platform
    })

    afterEach(() => {
      Object.defineProperty(navigator, 'platform', {
        value: originalPlatform,
        writable: true,
        configurable: true
      })
    })

    it('returns false when getClipboardAction returns copy', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        writable: true,
        configurable: true
      })
      const event = createEvent('c', { metaKey: true })
      expect(shouldPassThrough(event, true)).toBe(false)
    })

    it('returns false when getClipboardAction returns paste (explicit Ctrl+Shift+V)', () => {
      // Use Ctrl+Shift+V since standard Cmd+V / Ctrl+V now return 'none'
      // (letting xterm handle native paste to avoid double-paste)
      const event = createEvent('v', { ctrlKey: true, shiftKey: true })
      expect(shouldPassThrough(event, true)).toBe(false)
    })

    it('returns true when getClipboardAction returns none', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        writable: true,
        configurable: true
      })
      const event = createEvent('a', { metaKey: true })
      expect(shouldPassThrough(event, true)).toBe(true)
    })

    it('returns true for Cmd+C without selection (SIGINT)', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        writable: true,
        configurable: true
      })
      const event = createEvent('c', { metaKey: true })
      expect(shouldPassThrough(event, false)).toBe(true)
    })

    it('returns true for Ctrl+C without selection on Windows (SIGINT)', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true,
        configurable: true
      })
      const event = createEvent('c', { ctrlKey: true })
      expect(shouldPassThrough(event, false)).toBe(true)
    })

    it('returns true for regular key presses', () => {
      const event = createEvent('a')
      expect(shouldPassThrough(event, true)).toBe(true)
    })

    it('returns true for Enter key', () => {
      const event = createEvent('Enter')
      expect(shouldPassThrough(event, true)).toBe(true)
    })

    it('returns true for Escape key', () => {
      const event = createEvent('Escape')
      expect(shouldPassThrough(event, true)).toBe(true)
    })
  })
})
