// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the shared Back / Forward key table (issue #124, part 3 §3.7).
 *
 * One table serves main (focus in the page) and the panel root (focus in
 * Erfana's chrome), so this is the one test of which keys are Back and Forward
 * on each platform, and of the strings the toolbar shows for them.
 *
 * @see previewNavKeys.ts
 */
import { describe, expect, it } from 'vitest'

import {
  matchPreviewNavKey,
  navKeyFromDomEvent,
  previewNavKeyFor,
  previewNavKeyRows,
  type DomKeyEventLike,
  type PreviewNavKeyInput
} from './previewNavKeys'

type Modifier = 'meta' | 'control' | 'alt' | 'shift'

/** The given modifiers held down, every other one up. */
function held(...modifiers: Modifier[]): Partial<Record<Modifier, boolean>> {
  const down: Partial<Record<Modifier, boolean>> = {}
  for (const modifier of modifiers) {
    down[modifier] = true
  }
  return down
}

/** A key event as Electron's `before-input-event` reports it. */
function press(
  code: string,
  modifiers: Partial<Record<Modifier, boolean>> = {},
  type = 'keyDown'
): PreviewNavKeyInput {
  return { type, code, meta: false, control: false, alt: false, shift: false, ...modifiers }
}

/** A DOM `KeyboardEvent`'s fields, as React hands them to `onKeyDown`. */
function domEvent(type: string, code: string, down: Partial<DomKeyEventLike> = {}): DomKeyEventLike {
  return { type, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...down }
}

const PLATFORMS = ['darwin', 'win32', 'linux'] as const

const EVERY_ROW = PLATFORMS.flatMap((platform) =>
  previewNavKeyRows(platform).map((row) => ({ platform, row }))
)

describe('previewNavKeyRows', () => {
  it('macOS: Cmd+[ is Back and Cmd+] is Forward', () => {
    expect(previewNavKeyRows('darwin')).toEqual([
      { action: 'back', code: 'BracketLeft', modifier: 'meta', label: 'Cmd+[', ariaKeyShortcuts: 'Meta+[' },
      { action: 'forward', code: 'BracketRight', modifier: 'meta', label: 'Cmd+]', ariaKeyShortcuts: 'Meta+]' }
    ])
  })

  it.each(['win32', 'linux'] as const)(
    '%s: Alt+Left Arrow is Back and Alt+Right Arrow is Forward',
    (platform) => {
      expect(previewNavKeyRows(platform)).toEqual([
        {
          action: 'back',
          code: 'ArrowLeft',
          modifier: 'alt',
          label: 'Alt+Left Arrow',
          ariaKeyShortcuts: 'Alt+ArrowLeft'
        },
        {
          action: 'forward',
          code: 'ArrowRight',
          modifier: 'alt',
          label: 'Alt+Right Arrow',
          ariaKeyShortcuts: 'Alt+ArrowRight'
        }
      ])
    }
  )

  it.each(PLATFORMS)('%s: the table is frozen', (platform) => {
    expect(Object.isFrozen(previewNavKeyRows(platform))).toBe(true)
  })
})

describe('matchPreviewNavKey – every row on every platform', () => {
  it.each(EVERY_ROW)('$platform: $row.label is $row.action', ({ platform, row }) => {
    expect(matchPreviewNavKey(press(row.code, held(row.modifier)), platform)).toBe(row.action)
  })

  it.each(EVERY_ROW)('$platform: $row.code with no modifier does nothing', ({ platform, row }) => {
    expect(matchPreviewNavKey(press(row.code), platform)).toBeNull()
  })

  it.each(EVERY_ROW)(
    '$platform: $row.label with any other modifier as well does nothing',
    ({ platform, row }) => {
      const others = (['meta', 'control', 'alt', 'shift'] as const).filter((m) => m !== row.modifier)
      for (const extra of others) {
        expect(matchPreviewNavKey(press(row.code, held(row.modifier, extra)), platform)).toBeNull()
      }
    }
  )

  it.each(EVERY_ROW)('$platform: releasing $row.label does nothing', ({ platform, row }) => {
    expect(matchPreviewNavKey(press(row.code, held(row.modifier), 'keyUp'), platform)).toBeNull()
  })

  it("ignores the other platform's keys", () => {
    expect(matchPreviewNavKey(press('ArrowLeft', held('alt')), 'darwin')).toBeNull()
    expect(matchPreviewNavKey(press('BracketLeft', held('meta')), 'win32')).toBeNull()
    expect(matchPreviewNavKey(press('BracketLeft', held('meta')), 'linux')).toBeNull()
  })
})

describe('matchPreviewNavKey – the physical key, never the typed character', () => {
  it('matches the key right of P on a layout where it types something else', () => {
    // Electron's Input carries `key` as well; the table must not read it (S8).
    const layoutKey: PreviewNavKeyInput & { key: string } = {
      ...press('BracketLeft', held('meta')),
      key: 'ü'
    }
    expect(matchPreviewNavKey(layoutKey, 'darwin')).toBe('back')
  })

  it('ignores another physical key even when it types "["', () => {
    const typedBracket: PreviewNavKeyInput & { key: string } = {
      ...press('Digit8', held('meta')),
      key: '['
    }
    expect(matchPreviewNavKey(typedBracket, 'darwin')).toBeNull()
  })
})

describe('navKeyFromDomEvent – the panel root uses the same table', () => {
  it('turns a DOM keydown into a press the table matches', () => {
    const back = navKeyFromDomEvent(domEvent('keydown', 'BracketLeft', { metaKey: true }))
    const forward = navKeyFromDomEvent(domEvent('keydown', 'ArrowRight', { altKey: true }))
    expect(matchPreviewNavKey(back, 'darwin')).toBe('back')
    expect(matchPreviewNavKey(forward, 'win32')).toBe('forward')
  })

  it('keeps a DOM keyup a release', () => {
    const release = navKeyFromDomEvent(domEvent('keyup', 'BracketLeft', { metaKey: true }))
    expect(matchPreviewNavKey(release, 'darwin')).toBeNull()
  })

  it('carries every modifier across', () => {
    const all = { metaKey: true, ctrlKey: true, altKey: true, shiftKey: true }
    expect(navKeyFromDomEvent(domEvent('keydown', 'KeyA', all))).toEqual({
      type: 'keyDown',
      code: 'KeyA',
      meta: true,
      control: true,
      alt: true,
      shift: true
    })
  })
})

describe('previewNavKeyFor – the strings the toolbar shows', () => {
  it.each([
    ['darwin', 'back', 'Cmd+[', 'Meta+['],
    ['darwin', 'forward', 'Cmd+]', 'Meta+]'],
    ['win32', 'back', 'Alt+Left Arrow', 'Alt+ArrowLeft'],
    ['win32', 'forward', 'Alt+Right Arrow', 'Alt+ArrowRight'],
    ['linux', 'back', 'Alt+Left Arrow', 'Alt+ArrowLeft'],
    ['linux', 'forward', 'Alt+Right Arrow', 'Alt+ArrowRight']
  ] as const)('%s %s: tooltip "%s", aria-keyshortcuts "%s"', (platform, action, label, aria) => {
    const row = previewNavKeyFor(action, platform)
    expect(row.action).toBe(action)
    expect(row.label).toBe(label)
    expect(row.ariaKeyShortcuts).toBe(aria)
  })
})
