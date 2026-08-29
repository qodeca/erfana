// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * previewInputForward tests (Issue #74, work item 36).
 *
 * Covers the frozen shortcut list, per-platform accelerator matching, that only
 * the four enumerated accelerators are forwarded (with preventDefault), and the
 * attach/detach lifecycle.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  PREVIEW_FORWARDED_SHORTCUTS,
  attachInputForwarding,
  matchForwardedShortcut,
  type ForwardableInput,
  type InputForwardEvent,
  type InputForwardTarget
} from './previewInputForward'

function keyDown(overrides: Partial<ForwardableInput>): ForwardableInput {
  return {
    type: 'keyDown',
    key: '',
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...overrides
  }
}

describe('PREVIEW_FORWARDED_SHORTCUTS', () => {
  it('is a frozen list of exactly the forwarded accelerators', () => {
    expect(Object.isFrozen(PREVIEW_FORWARDED_SHORTCUTS)).toBe(true)
    expect(PREVIEW_FORWARDED_SHORTCUTS).toEqual([
      { key: 'f', accel: true },
      { key: 's', accel: true },
      { key: 'w', accel: true },
      { key: '=', accel: true },
      { key: '+', accel: true },
      { key: '-', accel: true },
      { key: '_', accel: true },
      { key: '0', accel: true },
      { key: 'Escape', accel: false }
    ])
  })

  it('forwards the zoom keys, without which previewed text cannot be enlarged', () => {
    // The sealed page swallows every key it is not handed. Host zoom scales the
    // view's RECTANGLE, so it makes the page's text relatively smaller — leaving
    // a reader no way to reach the 200% WCAG 2.2 SC 1.4.4 requires.
    const zoomKeys = PREVIEW_FORWARDED_SHORTCUTS.filter((s) => s.accel).map((s) => s.key)
    expect(zoomKeys).toEqual(expect.arrayContaining(['=', '+', '-', '_', '0']))
  })
})

describe('matchForwardedShortcut', () => {
  describe('macOS (accel = Cmd/meta)', () => {
    it('forwards Cmd+F / Cmd+S / Cmd+W', () => {
      expect(matchForwardedShortcut(keyDown({ key: 'f', meta: true }), 'darwin')).toBe('f')
      expect(matchForwardedShortcut(keyDown({ key: 's', meta: true }), 'darwin')).toBe('s')
      expect(matchForwardedShortcut(keyDown({ key: 'w', meta: true }), 'darwin')).toBe('w')
    })

    it('does not forward Ctrl+F on macOS', () => {
      expect(matchForwardedShortcut(keyDown({ key: 'f', control: true }), 'darwin')).toBeNull()
    })
  })

  describe('non-macOS (accel = Ctrl)', () => {
    it('forwards Ctrl+F', () => {
      expect(matchForwardedShortcut(keyDown({ key: 'f', control: true }), 'win32')).toBe('f')
    })
  })

  describe('Escape (no accel)', () => {
    it('forwards plain Escape', () => {
      expect(matchForwardedShortcut(keyDown({ key: 'Escape' }), 'darwin')).toBe('Escape')
    })

    it('does not forward Cmd+Escape or Alt+Escape', () => {
      expect(matchForwardedShortcut(keyDown({ key: 'Escape', meta: true }), 'darwin')).toBeNull()
      expect(matchForwardedShortcut(keyDown({ key: 'Escape', alt: true }), 'darwin')).toBeNull()
    })
  })

  describe('non-forwarded input', () => {
    it('ignores Cmd+R and Cmd+P', () => {
      expect(matchForwardedShortcut(keyDown({ key: 'r', meta: true }), 'darwin')).toBeNull()
      expect(matchForwardedShortcut(keyDown({ key: 'p', meta: true }), 'darwin')).toBeNull()
    })

    it('ignores plain typing of a forwarded letter', () => {
      expect(matchForwardedShortcut(keyDown({ key: 'f' }), 'darwin')).toBeNull()
    })

    it('ignores keyUp events', () => {
      expect(
        matchForwardedShortcut(keyDown({ type: 'keyUp', key: 'f', meta: true }), 'darwin')
      ).toBeNull()
    })
  })
})

describe('attachInputForwarding', () => {
  function makeTarget(): {
    target: InputForwardTarget
    fire: (input: ForwardableInput) => { preventDefault: ReturnType<typeof vi.fn> }
    removed: () => boolean
  } {
    let listener:
      | ((event: InputForwardEvent, input: ForwardableInput) => void)
      | null = null
    let removedListener: unknown = null
    const target: InputForwardTarget = {
      on: (_event, l) => {
        listener = l
      },
      removeListener: (_event, l) => {
        removedListener = l
      }
    }
    return {
      target,
      fire: (input) => {
        const event = { preventDefault: vi.fn() }
        listener?.(event, input)
        return event
      },
      removed: () => removedListener !== null && removedListener === listener
    }
  }

  it('calls preventDefault and onShortcut for a forwarded accelerator', () => {
    const onShortcut = vi.fn()
    const h = makeTarget()
    attachInputForwarding(h.target, onShortcut, 'darwin')

    const event = h.fire(keyDown({ key: 'f', meta: true }))
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(onShortcut).toHaveBeenCalledWith('f')
  })

  it('does nothing for non-forwarded input', () => {
    const onShortcut = vi.fn()
    const h = makeTarget()
    attachInputForwarding(h.target, onShortcut, 'darwin')

    const event = h.fire(keyDown({ key: 'r', meta: true }))
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(onShortcut).not.toHaveBeenCalled()
  })

  it('detaches the listener', () => {
    const h = makeTarget()
    const detach = attachInputForwarding(h.target, vi.fn(), 'darwin')
    detach()
    expect(h.removed()).toBe(true)
  })
})
