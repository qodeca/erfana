// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One key table, both previews (plan step 6; K-4, K-12, K-25, K-6, K-10, K-11,
 * I-17, K-8, K-26, I-25; differences table A-15, 024-NFR-006, 024-AC-029).
 *
 * {@link runPickerKeySuite} presses the picker's keys in the page, and
 * {@link runPanelKeySuite} the panel's keys around it. Neither uses a mouse:
 * every case gets where it starts with keys alone. The hosts share
 * `overlayCore/pickerKeys`; this proves each one is wired to it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModeLeavePlace, OverlayDriver, OverlayTargetId, PanelKeyDriver, PickerKeyPress } from './overlayDriver'

const TAB: PickerKeyPress = { key: 'Tab', code: 'Tab' }
const SHIFT_TAB: PickerKeyPress = { ...TAB, shift: true }
const ALT_UP: PickerKeyPress = { key: 'ArrowUp', code: 'ArrowUp', alt: true }
const ALT_DOWN: PickerKeyPress = { key: 'ArrowDown', code: 'ArrowDown', alt: true }
const ENTER: PickerKeyPress = { key: 'Enter', code: 'Enter' }
const SHIFT_F10: PickerKeyPress = { key: 'F10', code: 'F10', shift: true }
const MENU_KEY: PickerKeyPress = { key: 'ContextMenu', code: 'ContextMenu' }
const ESCAPE: PickerKeyPress = { key: 'Escape', code: 'Escape' }

/** The keys from the start of the walk, `container`, to each target. */
const WALK: Readonly<Record<OverlayTargetId, readonly PickerKeyPress[]>> = {
  container: [],
  first: [ALT_DOWN],
  inner: [ALT_DOWN, ALT_DOWN],
  second: [ALT_DOWN, TAB],
  long: [ALT_DOWN, TAB, TAB]
}

/** From, key, and where it lands: the same level for Tab, one level for Alt+Up and Alt+Down. */
const MOVES: ReadonlyArray<readonly [OverlayTargetId, string, PickerKeyPress, OverlayTargetId]> = [
  ['first', 'Tab', TAB, 'second'],
  ['second', 'Tab', TAB, 'long'],
  ['long', 'Shift+Tab', SHIFT_TAB, 'second'],
  ['second', 'Shift+Tab', SHIFT_TAB, 'first'],
  ['inner', 'Alt+Up', ALT_UP, 'first'],
  ['second', 'Alt+Up', ALT_UP, 'container'],
  ['first', 'Alt+Down', ALT_DOWN, 'inner'],
  ['container', 'Alt+Down', ALT_DOWN, 'first']
]

/** From, key, and what is said: the picker stays where it is. Tab never climbs out of its level (A-15). */
const ENDS: ReadonlyArray<readonly [OverlayTargetId, string, PickerKeyPress, (kind: string) => string]> = [
  ['long', 'Tab', TAB, kind => `Last ${kind} at this level – Alt+Up for the parent.`],
  ['inner', 'Tab', TAB, kind => `Last ${kind} at this level – Alt+Up for the parent.`],
  ['first', 'Shift+Tab', SHIFT_TAB, kind => `First ${kind} at this level.`],
  ['inner', 'Shift+Tab', SHIFT_TAB, kind => `First ${kind} at this level.`],
  ['inner', 'Alt+Down', ALT_DOWN, () => 'Nothing inside to select.']
]

/** Keys the picker leaves alone: they stay the page's, in both previews. */
const NOT_PICKER_KEYS: ReadonlyArray<readonly [string, PickerKeyPress]> = [
  ['Shift+Esc', { ...ESCAPE, shift: true }],
  ['Alt+Esc', { ...ESCAPE, alt: true }],
  ['Ctrl+Esc', { ...ESCAPE, ctrl: true }],
  ['Alt+Menu', { ...MENU_KEY, alt: true }],
  ['Ctrl+Menu', { ...MENU_KEY, ctrl: true }],
  ['Alt+Tab', { ...TAB, alt: true }],
  ['Ctrl+Tab', { ...TAB, ctrl: true }],
  ['Cmd+Tab', { ...TAB, meta: true }],
  ['Shift+Enter', { ...ENTER, shift: true }],
  ['Alt+Enter', { ...ENTER, alt: true }],
  ['Ctrl+Enter', { ...ENTER, ctrl: true }],
  ['F10', { key: 'F10', code: 'F10' }],
  ['Alt+Shift+F10', { ...SHIFT_F10, alt: true }],
  ['Alt+Shift+Up', { ...ALT_UP, shift: true }],
  ['Up', { key: 'ArrowUp', code: 'ArrowUp' }]
]

/**
 * Run the picker's key table against one host.
 *
 * @param name - The preview, as every case title names it.
 * @param makeDriver - A fresh driver, comment mode off. Called once per test.
 */
export function runPickerKeySuite(name: string, makeDriver: () => OverlayDriver | Promise<OverlayDriver>): void {
  const title = `024-AC-029 (${name}) `

  describe(`the picker's keys – ${name}`, () => {
    let d: OverlayDriver

    beforeEach(async () => {
      d = await makeDriver()
    })

    afterEach(async () => {
      await d.dispose()
    })

    /** Comment mode on from the keyboard, and the keys that reach `target`. */
    const walkTo = async (target: OverlayTargetId): Promise<void> => {
      await d.modeOnByKeys()
      expect(d.outlinedTarget()).toBe('container')
      for (const press of WALK[target]) d.pressKey(press)
      expect(d.outlinedTarget()).toBe(target)
    }

    it.each(MOVES)(`${title}KEY-01 from %s, %s moves`, async (from, _key, press, to) => {
      await walkTo(from)
      d.pressKey(press)
      expect(d.outlinedTarget()).toBe(to)
      expect(d.pageSaw()).toEqual([])
    })

    it.each(ENDS)(`${title}KEY-02 from %s, %s stays and says so`, async (from, _key, press, sentence) => {
      await walkTo(from)
      d.pressKey(press)
      expect(d.outlinedTarget()).toBe(from)
      expect(d.saidAtEnd()).toBe(sentence(d.kinds[from]))
    })

    it(`${title}KEY-03 Alt+Up at the top says so`, async () => {
      await walkTo('container')
      // The HTML page has one level more, <body>; the Markdown Preview's top is the quote.
      d.pressKey(ALT_UP)
      if (d.saidAtEnd() === null) d.pressKey(ALT_UP)
      expect(d.saidAtEnd()).toBe('Top level – no parent to select.')
    })

    it.each(['first', 'second', 'long'] as const)(`${title}KEY-04 Alt+Down goes back to %s, the way Alt+Up came`, async from => {
      await walkTo(from)
      d.pressKey(ALT_UP)
      expect(d.outlinedTarget()).toBe('container')
      d.pressKey(ALT_DOWN)
      expect(d.outlinedTarget()).toBe(from)
    })

    it(`${title}KEY-05 Alt+Down keeps the whole way back, and a Tab ends it`, async () => {
      await walkTo('inner')
      d.pressKey(ALT_UP)
      d.pressKey(ALT_UP)
      d.pressKey(ALT_DOWN)
      d.pressKey(ALT_DOWN)
      expect(d.outlinedTarget()).toBe('inner')
      d.pressKey(ALT_UP)
      d.pressKey(TAB)
      expect(d.outlinedTarget()).toBe('second')
    })

    it.each(NOT_PICKER_KEYS)(`${title}KEY-06 %s is not a picker key: the page keeps it`, async (_key, press) => {
      await walkTo('second')
      const before = d.picks().length
      d.pressKey(press)
      expect(d.isModeOn()).toBe(true)
      expect(d.outlinedTarget()).toBe('second')
      expect(d.picks()).toHaveLength(before)
      expect(d.pageSaw()).toContain('keydown')
    })

    it(`${title}KEY-07 Enter opens what is outlined`, async () => {
      await walkTo('long')
      d.pressKey(ENTER)
      expect(d.picks().at(-1)).toEqual({ kind: 'open', via: 'keyboard', target: 'long' })
    })

    it.each([
      ['Shift+F10', SHIFT_F10],
      ['the Menu key', MENU_KEY]
    ] as const)(`${title}KEY-08 %s asks for the menu on what is outlined`, async (_key, press) => {
      await walkTo('long')
      d.pressKey(press)
      expect(d.picks().at(-1)).toEqual({ kind: 'menu', via: 'keyboard', target: 'long' })
    })

    it(`${title}KEY-09 Esc leaves the mode and the page never sees it`, async () => {
      await walkTo('second')
      d.pressKey(ESCAPE)
      expect(d.isModeOn()).toBe(false)
      expect(d.pageSaw()).not.toContain('keydown')
    })

    it(`${title}KEY-10 K-6: the keyboard entry starts the picker, outlined, with no key pressed`, async () => {
      await d.modeOnByKeys()
      expect(d.outlinedTarget()).toBe('container')
    })

    // Comment mode from a mouse click: nothing is outlined, and the keys have to start somewhere (K-10).
    it.each([
      ['Enter', ENTER, 'open'],
      ['Shift+F10', SHIFT_F10, 'menu'],
      ['the Menu key', MENU_KEY, 'menu']
    ] as const)(`${title}KEY-11 %s with nothing outlined acts on the start target`, (_key, press, kind) => {
      d.modeOn()
      d.pressKey(press)
      expect(d.picks().at(-1)).toEqual({ kind, via: 'keyboard', target: 'container' })
    })

    it(`${title}KEY-12 the first Tab with nothing outlined lands on the start target, not past it`, () => {
      d.modeOn()
      d.pressKey(TAB)
      expect(d.outlinedTarget()).toBe('container')
    })

    it(`${title}KEY-13 K-11: after a move away from selected words, Enter opens the outlined target`, async () => {
      d.selectText('second')
      await d.modeOnByKeys()
      expect(d.outlinedTarget()).toBe('second')
      d.pressKey(TAB)
      d.pressKey(ENTER)
      expect(d.picks().at(-1)).toEqual({ kind: 'open', via: 'keyboard', target: 'long' })
    })

    it(`${title}KEY-14 K-11: with no move, the words' target is what Enter opens`, async () => {
      d.selectText('second')
      await d.modeOnByKeys()
      d.pressKey(ENTER)
      expect(d.picks().at(-1)).toEqual({ kind: 'open', via: 'keyboard', target: 'second' })
    })
  })
}

/** Where the step keys and the shortcut are pressed from. */
const CHROME: readonly ModeLeavePlace[] = ['toggle', 'drawer', 'group']

/**
 * The panel's keys around the picker, from wherever focus is.
 *
 * @param name - The preview, as every case title names it.
 * @param makeDriver - A fresh driver on a laid-out panel, comment mode off. Called once per test.
 */
export function runPanelKeySuite(name: string, makeDriver: () => PanelKeyDriver | Promise<PanelKeyDriver>): void {
  const title = `024-AC-029 (${name}) `

  describe(`the panel's keys – ${name}`, () => {
    let d: PanelKeyDriver

    beforeEach(async () => {
      d = await makeDriver()
    })

    afterEach(async () => {
      await d.dispose()
    })

    it.each(CHROME)(`${title}KEY-20 I-25: Alt+F9 with focus on %s opens the comment`, async place => {
      await d.withComment()
      await d.focusOn(place)
      await d.pressStep(place)
      await vi.waitFor(() => expect(d.windowOpen()).toBe(true))
    })

    it.each(CHROME)(`${title}KEY-21 K-26: Alt+F9 on %s with no comment says so`, async place => {
      await d.focusOn(place)
      await d.pressStep(place)
      expect(d.windowOpen()).toBe(false)
      await vi.waitFor(() => expect(d.said()).toBe('No comments to go to.'))
    })

    it(`${title}KEY-22 I-17: the shortcut from the toolbar takes the keyboard into the preview`, async () => {
      await d.focusOn('toggle')
      await d.pressModeKey('toggle')
      expect(d.isModeOn()).toBe(true)
      expect(d.keysInPreview()).toBe(true)
    })

    it(`${title}KEY-23 K-8: Esc in the preview leaves the mode for the toggle`, async () => {
      await d.focusOn('toggle')
      await d.pressModeKey('toggle')
      await d.pressEscapeInPreview()
      expect(d.isModeOn()).toBe(false)
      expect(d.focused()).toBe('toggle')
    })
  })
}
