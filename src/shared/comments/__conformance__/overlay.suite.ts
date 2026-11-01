// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared comment overlay behaviour suite (spec 024, 024-FR-001,
 * 024-FR-020; architecture note
 * specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md
 * § 2 decision C, § 6 commit 4).
 *
 * One behaviour, two hosts: every host runs this suite behind an
 * {@link OverlayDriver} – the HTML overlay in the page preload
 * (`src/preload/previewPageComments/overlay.conformance.test.ts`) and the
 * renderer host of the Markdown Preview
 * (`src/renderer/src/components/Editor/markdownComments/MarkdownComments.overlay.conformance.test.tsx`).
 * Every case title starts `024-AC-001 ({preview})`. It covers what jsdom can
 * show: comment mode on and off, the gesture table, the Esc order and the
 * label. Pin placement and the underline run in Playwright, per preview. The
 * Comment button and the menu's subject are `selection.suite.ts`, beside this.
 *
 * Where the differences table makes the hosts differ on purpose, the driver
 * says so and the case checks that host's behaviour instead: the floating
 * label (D-05), the mode tab's words (A-03) and a right-click outside comment
 * mode (D-11).
 *
 * The expectations are the v0.23.1 HTML overlay's behaviour, pinned before the
 * refactor (commit 4). Where spec 024 changes that behaviour on purpose, the
 * test title says which requirement will change it; that change lands in the
 * `feat:` commit naming it, together with the new expectation here, and both
 * hosts must then pass it. Everything else must hold unchanged through every
 * `refactor:` commit.
 *
 * A layer a host does not own (the HTML overlay never sees the element menu,
 * the comment window or Find – main and the renderer own them) is skipped with
 * the host's stated reason, never silently passed.
 */
import { afterEach, beforeEach, describe, expect, it, type TestFunction } from 'vitest'
import { OVERLAY_FIXTURE } from './overlayDriver'
import type { ModeLeaveDriver, ModeLeavePlace, OptionalPart, OverlayDriver, OverlayPick, OverlayTargetId } from './overlayDriver'
import { MODE_TAB_AVOID_PX } from '../overlayCore/reveal'

/** The longest name part a label shows before its size (design §10.2: at most 40 characters). */
const LABEL_NAME_MAX_CHARS = 40

const open = (target: OverlayTargetId): OverlayPick => ({ kind: 'open', via: 'pointer', target })
const menu = (target: OverlayTargetId): OverlayPick => ({ kind: 'menu', via: 'pointer', target })

/** Options for {@link runOverlaySuite}. */
export interface OverlaySuiteOptions {
  /**
   * Cases this host is known to fail, by case id (`OVL-G-01`), each with the
   * defect and where it lives. Such a case runs as `it.fails`: it stays red
   * in the report title, and it turns the run red the day the host passes it,
   * so the entry has to go. Never a design difference – those are driver
   * capabilities, decided in the differences table.
   */
  readonly knownGaps?: Readonly<Record<string, string>>
}

/**
 * Run the overlay behaviour suite against one host.
 *
 * @param name - The preview, as every case title names it: `024-AC-001 (HTML) OVL-M-01 …`.
 * @param makeDriver - A fresh driver on a freshly laid-out fixture, comment mode off. Called once per test.
 * @param options - {@link OverlaySuiteOptions}
 */
export function runOverlaySuite(
  name: string,
  makeDriver: () => OverlayDriver | Promise<OverlayDriver>,
  options: OverlaySuiteOptions = {}
): void {
  /** Every case proves 024-AC-001's last clause for this preview. */
  const ac001 = `024-AC-001 (${name}) `
  const knownGaps = options.knownGaps ?? {}
  const unknown = Object.keys(knownGaps).filter(id => !/^OVL-[MGEL]-\d\d$/.test(id))
  if (unknown.length > 0) throw new Error(`not overlay case ids: ${unknown.join(', ')}`)

  /** One case, titled for AC-001; a known gap runs as `it.fails`, its defect in the title. */
  const caseIt = (title: string, fn: TestFunction): void => {
    const gap = knownGaps[title.split(' ')[0]]
    if (gap === undefined) it(ac001 + title, fn)
    else it.fails(`${ac001}${title} – KNOWN GAP: ${gap}`, fn)
  }

  describe(`overlay behaviour – ${name}`, () => {
    let d: OverlayDriver

    beforeEach(async () => {
      d = await makeDriver()
    })

    afterEach(async () => {
      await d.dispose()
    })

    /** The reason a host gave for not owning `part`, for a skip note. */
    const notOwned = (part: OptionalPart): string => d.notOwned?.[part] ?? `${d.host} gives no reason for leaving out ${part}`

    describe('comment mode on and off', () => {
      caseIt('OVL-M-01 starts off; turns on and off', () => {
        expect(d.isModeOn()).toBe(false)
        d.modeOn()
        expect(d.isModeOn()).toBe(true)
        d.modeOff()
        expect(d.isModeOn()).toBe(false)
      })

      caseIt('OVL-M-02 off: a click belongs to the page – nothing is picked, outlined or labelled', () => {
        d.click('inner')
        expect(d.picks()).toEqual([])
        expect(d.pageSaw()).toContain('click')
        expect(d.outlinedTarget()).toBeNull()
        expect(d.labelText('inner')).toBeNull()
      })

      caseIt('OVL-M-03 on: a click is kept from the page and picks', () => {
        d.modeOn()
        d.click('inner')
        expect(d.pageSaw()).toEqual([])
        expect(d.picks()).toEqual([open('inner')])
      })

      caseIt('OVL-M-04 turning it off clears the outline and the label', () => {
        d.modeOn()
        d.hover({ target: 'inner' })
        expect(d.outlinedTarget()).toBe('inner')
        d.modeOff()
        expect(d.outlinedTarget()).toBeNull()
        expect(d.labelText('inner')).toBeNull()
      })

      caseIt('OVL-M-05 the mode indicator shows only while comment mode is on', ctx => {
        if (d.modeIndicatorText === undefined) {
          ctx.skip(notOwned('modeIndicator'))
          return
        }
        expect(d.modeIndicatorText()).toBeNull()
        d.modeOn()
        expect(d.modeIndicatorText()).toBe(d.modeIndicatorIdle)
        d.modeOff()
        expect(d.modeIndicatorText()).toBeNull()
      })

      caseIt('OVL-M-07 leaving the mode with focus on the picked target hands focus on: it never falls out of the preview', ctx => {
        if (d.pickByKeys === undefined || d.focusHeldInPreview === undefined) {
          ctx.skip(notOwned('pickFocus'))
          return
        }
        d.modeOn()
        d.pickByKeys()
        d.modeOff()
        expect(d.focusHeldInPreview()).toBe(true)
      })

      caseIt('OVL-M-06 the fixture is laid out whole', () => {
        expect([...d.targets()].sort()).toEqual(['container', 'first', 'inner', 'long', 'second'])
      })
    })

    describe('the gesture table (comment mode on)', () => {
      beforeEach(() => {
        d.modeOn()
      })

      caseIt('OVL-G-01 click picks the innermost target under the pointer and paints it selected', () => {
        d.click('inner')
        expect(d.picks()).toEqual([open('inner')])
        expect(d.pickedTarget()).toBe('inner')
        expect(d.outlinedTarget()).toBe('inner')
        expect(d.outlineSelected()).toBe(true)
      })

      caseIt('OVL-G-02 click on a parent outside its child picks the parent', () => {
        d.click('first')
        expect(d.picks()).toEqual([open('first')])
      })

      caseIt('OVL-G-03 double click: each click of it picks, the page sees nothing (v0.23.1)', () => {
        d.doubleClick('inner')
        expect(d.picks()).toEqual([open('inner'), open('inner')])
        expect(d.pageSaw()).toEqual([])
      })

      caseIt('OVL-G-04 triple click: each click of it picks, the page sees nothing (v0.23.1)', () => {
        d.tripleClick('inner')
        expect(d.picks()).toEqual([open('inner'), open('inner'), open('inner')])
        expect(d.pageSaw()).toEqual([])
      })

      caseIt('OVL-G-05 a drag under 4 px is a click: it picks the target', () => {
        d.drag({ target: 'inner' }, { target: 'inner', dx: 3 })
        expect(d.picks()).toEqual([open('inner')])
      })

      caseIt('OVL-G-06 024-FR-004 a drag of 4 px inside one target selects: nothing is picked, the page sees nothing', () => {
        d.drag({ target: 'inner', dx: -2 }, { target: 'inner', dx: 2 })
        expect(d.picks()).toEqual([])
        expect(d.pageSaw()).toEqual([])
      })

      caseIt('OVL-G-07 024-FR-004 a drag across two targets selects: nothing is picked', () => {
        d.drag({ target: 'first', dx: 100 }, { target: 'second', dx: 100 })
        expect(d.picks()).toEqual([])
      })

      caseIt('OVL-G-08 024-FR-004 a click that ends with a non-collapsed selection keeps it and picks nothing', () => {
        d.selectText('second')
        expect(d.selectedText()).not.toBe('')
        d.click('inner')
        expect(d.picks()).toEqual([])
        expect(d.selectedText()).not.toBe('')
      })

      caseIt('OVL-G-09 Shift+click picks like a click (v0.23.1)', () => {
        d.click('inner', { shift: true })
        expect(d.picks()).toEqual([open('inner')])
        expect(d.pageSaw()).toEqual([])
      })

      caseIt('OVL-G-10 right-click asks for the menu on the target – never opens – and the page sees nothing', () => {
        d.rightClick('inner')
        expect(d.picks()).toEqual([menu('inner')])
        expect(d.pageSaw()).toEqual([])
      })

      caseIt('OVL-G-11 middle click picks nothing and the page sees nothing', () => {
        d.middleClick('inner')
        expect(d.picks()).toEqual([])
        expect(d.pageSaw()).toEqual([])
      })

      caseIt('OVL-G-12 off: right-click and drag belong to the page', () => {
        d.modeOff()
        d.rightClick('inner')
        // D-11: the Markdown Preview's own right-click menu is Erfana's, with the comment items first.
        const menuAsked = d.rightClickOutsideMode === 'menu' ? [menu('inner')] : []
        if (d.rightClickOutsideMode === 'page') expect(d.pageSaw()).toContain('contextmenu')
        else expect(d.pageSaw()).not.toContain('contextmenu')
        expect(d.picks()).toEqual(menuAsked)
        d.drag({ target: 'inner', dx: -10 }, { target: 'inner', dx: 10 })
        expect(d.pageSaw()).toContain('mousedown')
        expect(d.picks()).toEqual(menuAsked)
      })
    })

    describe('the Esc order: menu → window → comment mode → Find', () => {
      caseIt('OVL-E-01 with comment mode on, Esc leaves comment mode and the page never sees the key', () => {
        d.modeOn()
        d.hover({ target: 'inner' })
        expect(d.openLayer()).toBe('mode')
        d.pressEscape()
        expect(d.isModeOn()).toBe(false)
        expect(d.picks()).toEqual([{ kind: 'exit', via: 'keyboard', target: null }])
        expect(d.pageSaw()).toEqual([])
        expect(d.outlinedTarget()).toBeNull()
        expect(d.openLayer()).toBeNull()
      })

      caseIt('OVL-E-02 with nothing open, the overlay leaves Esc alone (it falls through to Find’s owner)', () => {
        expect(d.openLayer()).toBeNull()
        d.pressEscape()
        expect(d.picks()).toEqual([])
        expect(d.pageSaw()).toEqual(['keydown', 'keyup'])
      })

      caseIt('OVL-E-03 Esc closes the menu first; comment mode stays on', async ctx => {
        if (d.open === undefined || d.notOwned?.menu !== undefined) {
          ctx.skip(notOwned('menu'))
          return
        }
        d.modeOn()
        await d.open('menu', 'inner')
        expect(d.openLayer()).toBe('menu')
        d.pressEscape()
        expect(d.openLayer()).toBe('mode')
        expect(d.isModeOn()).toBe(true)
      })

      caseIt('OVL-E-04 Esc closes the comment window before comment mode', async ctx => {
        if (d.open === undefined || d.notOwned?.window !== undefined) {
          ctx.skip(notOwned('window'))
          return
        }
        d.modeOn()
        await d.open('window', 'inner')
        expect(d.openLayer()).toBe('window')
        d.pressEscape()
        expect(d.openLayer()).toBe('mode')
        expect(d.isModeOn()).toBe(true)
      })

      caseIt('OVL-E-05 Esc leaves comment mode before it closes Find', async ctx => {
        if (d.open === undefined || d.notOwned?.find !== undefined) {
          ctx.skip(notOwned('find'))
          return
        }
        await d.open('find')
        d.modeOn()
        expect(d.openLayer()).toBe('mode')
        d.pressEscape()
        expect(d.isModeOn()).toBe(false)
        expect(d.openLayer()).toBe('find')
      })
    })

    describe('the label', () => {
      it.each(['container', 'first', 'inner', 'second', 'long'] as const)(
        ac001 + 'OVL-L-01 the label of %s reads as the host words it',
        target => {
          d.modeOn()
          expect(d.labelText(target)).toBe(d.labels[target])
        }
      )

      caseIt('OVL-L-02 no label while comment mode is off', () => {
        for (const target of d.targets()) expect(d.labelText(target), target).toBeNull()
      })

      caseIt('OVL-L-03 the outline and label follow the pointer to the innermost target', () => {
        d.modeOn()
        d.hover({ target: 'first' })
        expect(d.outlinedTarget()).toBe('first')
        expect(d.outlineSelected()).toBe(false)
        d.hover({ target: 'inner' })
        expect(d.outlinedTarget()).toBe('inner')
        d.hover({ target: 'container', dy: 150 })
        expect(d.outlinedTarget()).toBe('container')
      })

      caseIt('OVL-L-05 after a cancelled pick the outline follows the pointer again, and a click hits what it shows', async () => {
        d.modeOn()
        d.click('inner')
        await d.cancelPick()
        d.hover({ target: 'second' })
        expect(d.outlinedTarget()).toBe('second')
        expect(d.outlineSelected()).toBe(false)
        expect(d.labelText('second')).toBe(d.labels.second)
        d.click('second')
        expect(d.picks().at(-1)).toEqual(open('second'))
      })

      caseIt('OVL-L-06 after a cancelled pick, the pick stays outlined until the pointer really moves off it', async () => {
        d.modeOn()
        d.click('inner')
        await d.cancelPick()
        expect(d.outlinedTarget()).toBe('inner')
        d.hover({ target: 'inner', dx: 2 })
        expect(d.outlinedTarget()).toBe('inner')
        expect(d.outlineSelected()).toBe(true)
      })

      caseIt('OVL-L-07 Enter after the pointer took over acts on what is outlined, not on the old pick', async () => {
        d.modeOn()
        d.click('inner')
        await d.cancelPick()
        d.hover({ target: 'second' })
        d.pressEnter()
        expect(d.picks().at(-1)).toEqual({ kind: 'open', via: 'keyboard', target: 'second' })
      })

      // Letting go outside the level is `overlayCore/pointerFollow`'s test: nothing in the fixture lies outside `container`.
      caseIt('OVL-L-08 a level picked by keys holds while the pointer moves inside it', () => {
        d.modeOn()
        d.hover({ target: 'second' })
        d.levelUpByKeys()
        expect(d.outlinedTarget()).toBe('container')
        d.hover({ target: 'second', dx: 2 })
        expect(d.outlinedTarget()).toBe('container')
      })

      caseIt('OVL-L-09 while the window is open, the outline stays on its target', async ctx => {
        if (d.open === undefined || d.notOwned?.window !== undefined) {
          ctx.skip(notOwned('window'))
          return
        }
        d.modeOn()
        await d.open('window', 'inner')
        d.hover({ target: 'second' })
        expect(d.outlinedTarget()).toBe('inner')
      })

      caseIt('OVL-L-10 the mode tab moves away while the pointer is near the top, and comes back (I-19)', () => {
        d.modeOn()
        expect(d.modeTabMovedAway()).toBe(false)
        const near = OVERLAY_FIXTURE.first.box.top + OVERLAY_FIXTURE.first.box.height / 2
        d.hover({ target: 'first', dy: MODE_TAB_AVOID_PX - 1 - near })
        expect(d.modeTabMovedAway()).toBe(true)
        d.hover({ target: 'first', dy: MODE_TAB_AVOID_PX - near })
        expect(d.modeTabMovedAway()).toBe(false)
      })

      caseIt(`OVL-L-04 a label's name never runs past ${LABEL_NAME_MAX_CHARS} characters, and it ends in the size`, ctx => {
        if (!d.floatingLabel) {
          ctx.skip(notOwned('floatingLabel'))
          return
        }
        d.modeOn()
        for (const target of d.targets()) {
          const label = d.labelText(target) ?? ''
          const cut = label.lastIndexOf(' ')
          expect([...label.slice(0, cut)].length, target).toBeLessThanOrEqual(LABEL_NAME_MAX_CHARS)
          expect(label.slice(cut + 1), target).toMatch(/^\d+×\d+$/)
        }
      })
    })
  })
}

/** Who may hold focus when Esc is pressed, for {@link runModeLeaveSuite}. */
const LEAVE_PLACES: readonly ModeLeavePlace[] = ['toggle', 'drawer', 'find', 'group']

/**
 * Leaving comment mode: the mode tab says "Esc to leave", so Esc does so from
 * anywhere in the panel, with no mouse, in both previews (plan step 4; I-1,
 * K-19). The Esc order stays menu → window → comment mode → Find.
 *
 * @param name - The preview, as every case title names it.
 * @param makeDriver - A fresh driver on a laid-out panel, comment mode off. Called once per test.
 */
export function runModeLeaveSuite(name: string, makeDriver: () => ModeLeaveDriver | Promise<ModeLeaveDriver>): void {
  describe(`leaving comment mode – ${name}`, () => {
    let d: ModeLeaveDriver

    beforeEach(async () => {
      d = await makeDriver()
    })

    afterEach(async () => {
      await d.dispose()
    })

    it.each(LEAVE_PLACES)(`024-AC-001 (${name}) LVE-01 Esc with focus on %s leaves comment mode, in one press`, async place => {
      await d.modeOn()
      await d.focusOn(place)
      await d.pressEscape(place)
      expect(d.isModeOn()).toBe(false)
      expect(d.findOpen()).toBe(place === 'find')
    })

    it(`024-AC-001 (${name}) LVE-02 the second Esc in Find closes Find`, async () => {
      await d.modeOn()
      await d.focusOn('find')
      await d.pressEscape('find')
      await d.pressEscape('find')
      expect(d.findOpen()).toBe(false)
    })

    it(`024-AC-001 (${name}) LVE-03 Esc from the toggle keeps focus on the toggle`, async () => {
      await d.modeOn()
      await d.focusOn('toggle')
      await d.pressEscape('toggle')
      expect(d.focused()).toBe('toggle')
    })

    it.each(LEAVE_PLACES)(`024-AC-001 (${name}) LVE-04 comment mode off: Esc on %s stays the panel's`, async place => {
      await d.focusOn(place)
      expect(await d.pressEscape(place)).toBe(place !== 'find')
    })

    it(`024-AC-001 (${name}) LVE-05 Shift+Esc is not Esc`, async () => {
      await d.modeOn()
      await d.focusOn('toggle')
      await d.pressEscape('toggle', { shift: true })
      expect(d.isModeOn()).toBe(true)
    })

    it(`024-AC-001 (${name}) LVE-06 Esc outside the panel is not this panel's`, async () => {
      await d.modeOn()
      await d.pressEscapeOutside()
      expect(d.isModeOn()).toBe(true)
    })

    it(`024-FR-005 (${name}) LVE-07 a tab switch keeps comment mode, with no press to get it back`, async () => {
      await d.modeOn()
      await d.setTabShown(false)
      await d.setTabShown(true)
      expect(d.isModeOn()).toBe(true)
    })

    it(`024-AC-001 (${name}) LVE-08 after coming back to the tab, Esc still leaves`, async () => {
      await d.modeOn()
      await d.setTabShown(false)
      await d.setTabShown(true)
      await d.focusOn('group')
      await d.pressEscape('group')
      expect(d.isModeOn()).toBe(false)
    })
  })
}
