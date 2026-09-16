// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * previewInputForward tests (Issue #74, work item 36).
 *
 * Covers the frozen shortcut list, per-platform accelerator matching, that only
 * the four enumerated accelerators and Back / Forward are forwarded (with
 * preventDefault), and the attach/detach lifecycle. Back and Forward (issue
 * #124) come from the shared `previewNavKeys` table and count on key down only.
 */
import { PreviewForwardedShortcutSchema } from '../../../shared/ipc/preview-schema'
import { previewNavKeyRows } from '../../../shared/previewNavKeys'
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
    code: '',
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
      { key: 'Escape', accel: false },
      { key: 'back', accel: false, nav: true },
      { key: 'forward', accel: false, nav: true }
    ])
  })

  it('does NOT forward the zoom keys, because the View menu owns them', () => {
    // Page zoom reaches a focused preview through `menu.ts` -> `zoomFocused` ->
    // `wc.setZoomLevel`, which is what satisfies WCAG 2.2 SC 1.4.4 here.
    //
    // Listing them here as well was dead weight in one direction and a hazard
    // in the other: the IPC schema never enumerated them, so every one was
    // dropped at the boundary; and widening the schema to "fix" that would have
    // zoomed TWICE per keypress, once from the accelerator and once from the
    // forward. That is the collision `menu.ts` replaced the built-in zoom roles
    // to avoid.
    const keys = PREVIEW_FORWARDED_SHORTCUTS.map((s) => s.key)
    for (const zoomKey of ['=', '+', '-', '_', '0']) {
      expect(keys).not.toContain(zoomKey)
    }
    // The positive control: the list is not simply empty.
    expect(keys).toEqual(expect.arrayContaining(['f', 's', 'w', 'Escape']))
  })

  it('carries exactly the keys the IPC schema will accept', () => {
    // THE DRIFT THAT MADE THIS NECESSARY. This list is documented as "the
    // complete, frozen set... adding a key here is the ONLY way to widen the
    // input bridge", but the wire schema restates the same vocabulary by hand.
    // Five keys were added here and not there, so main called preventDefault on
    // them inside the page and then dropped every resulting event at
    // `validateAndSend` with a warning. Nothing failed; the feature was simply
    // absent.
    //
    // Compared as SETS in both directions, so neither list can grow past the
    // other unnoticed.
    const forwarded = [...PREVIEW_FORWARDED_SHORTCUTS.map((s) => s.key)].sort()
    const accepted = [...PreviewForwardedShortcutSchema.shape.key.options].sort()
    expect(forwarded).toEqual(accepted)
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

describe('matchForwardedShortcut — Back and Forward (issue #124, part 3 §3.7)', () => {
  const PLATFORMS = ['darwin', 'win32', 'linux'] as const

  it('takes its Back and Forward rows from previewNavKeys, not from a table of its own', () => {
    const navKeys = PREVIEW_FORWARDED_SHORTCUTS.filter((s) => 'nav' in s).map((s) => s.key)
    for (const platform of PLATFORMS) {
      expect(navKeys).toEqual(previewNavKeyRows(platform).map((row) => row.action))
    }
  })

  it.each(PLATFORMS)('forwards every row of the shared table on %s', (platform) => {
    for (const row of previewNavKeyRows(platform)) {
      const modifier = row.modifier === 'meta' ? { meta: true } : { alt: true }
      const input = keyDown({ code: row.code, key: 'Unidentified', ...modifier })
      expect(matchForwardedShortcut(input, platform)).toBe(row.action)
    }
  })

  it('macOS: Cmd+[ is Back and Cmd+] is Forward', () => {
    expect(
      matchForwardedShortcut(keyDown({ code: 'BracketLeft', key: '[', meta: true }), 'darwin')
    ).toBe('back')
    expect(
      matchForwardedShortcut(keyDown({ code: 'BracketRight', key: ']', meta: true }), 'darwin')
    ).toBe('forward')
  })

  it.each(['win32', 'linux'] as const)('%s: Alt+Left is Back and Alt+Right is Forward', (platform) => {
    expect(
      matchForwardedShortcut(keyDown({ code: 'ArrowLeft', key: 'ArrowLeft', alt: true }), platform)
    ).toBe('back')
    expect(
      matchForwardedShortcut(keyDown({ code: 'ArrowRight', key: 'ArrowRight', alt: true }), platform)
    ).toBe('forward')
  })

  it('matches the physical key, whatever the layout types on it (spike S8)', () => {
    // German layout: the key right of P types `ü`; it is still Back.
    expect(
      matchForwardedShortcut(keyDown({ code: 'BracketLeft', key: 'ü', meta: true }), 'darwin')
    ).toBe('back')
    // A `[` typed on another physical key is not Back.
    expect(
      matchForwardedShortcut(keyDown({ code: 'Digit5', key: '[', meta: true }), 'darwin')
    ).toBeNull()
  })

  it.each(['keyUp', 'char'])('forwards a press only, never a %s', (type) => {
    expect(
      matchForwardedShortcut(keyDown({ type, code: 'BracketLeft', meta: true }), 'darwin')
    ).toBeNull()
    expect(
      matchForwardedShortcut(keyDown({ type, code: 'ArrowLeft', alt: true }), 'win32')
    ).toBeNull()
  })

  it('forwards nothing with another modifier down', () => {
    const back = { code: 'BracketLeft', meta: true }
    expect(matchForwardedShortcut(keyDown({ ...back, shift: true }), 'darwin')).toBeNull()
    expect(matchForwardedShortcut(keyDown({ ...back, alt: true }), 'darwin')).toBeNull()
    expect(matchForwardedShortcut(keyDown({ ...back, control: true }), 'darwin')).toBeNull()
    expect(
      matchForwardedShortcut(keyDown({ code: 'ArrowLeft', alt: true, shift: true }), 'win32')
    ).toBeNull()
  })

  it('leaves the other platform’s binding with the page', () => {
    // Alt+Left moves by word in a macOS text field; it must stay the page's.
    expect(matchForwardedShortcut(keyDown({ code: 'ArrowLeft', alt: true }), 'darwin')).toBeNull()
    expect(matchForwardedShortcut(keyDown({ code: 'BracketLeft', meta: true }), 'win32')).toBeNull()
    expect(
      matchForwardedShortcut(keyDown({ code: 'BracketLeft', control: true }), 'win32')
    ).toBeNull()
  })

  it('never matches a Back or Forward row on its name', () => {
    expect(matchForwardedShortcut(keyDown({ key: 'back', meta: true }), 'darwin')).toBeNull()
    expect(matchForwardedShortcut(keyDown({ key: 'forward', alt: true }), 'win32')).toBeNull()
  })

  it('emits every row in a shape the wire schema accepts', () => {
    // `emit.ts` builds the payload from this list; a row the schema refuses
    // would be dropped at the boundary with only a warning.
    for (const shortcut of PREVIEW_FORWARDED_SHORTCUTS) {
      const payload = { panelId: 'preview-1', key: shortcut.key, accel: shortcut.accel }
      expect(PreviewForwardedShortcutSchema.safeParse(payload).success).toBe(true)
    }
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

  it('hides a Back press from the page and reports it', () => {
    const onShortcut = vi.fn()
    const h = makeTarget()
    attachInputForwarding(h.target, onShortcut, 'darwin')

    const event = h.fire(keyDown({ code: 'BracketLeft', key: '[', meta: true }))
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(onShortcut).toHaveBeenCalledWith('back')
  })

  it('detaches the listener', () => {
    const h = makeTarget()
    const detach = attachInputForwarding(h.target, vi.fn(), 'darwin')
    detach()
    expect(h.removed()).toBe(true)
  })
})
