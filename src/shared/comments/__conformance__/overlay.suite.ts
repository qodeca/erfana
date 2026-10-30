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
 * (`src/preload/previewPageComments/overlay.conformance.test.ts`) first, the
 * Markdown and `.txt` hosts when they land. It covers what jsdom can show:
 * comment mode on and off, the gesture table, the Esc order and the label.
 * Pin placement and the underline run in Playwright, per preview.
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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HostedLayer, OverlayDriver, OverlayPick, OverlayTargetId } from './overlayDriver'

/** The longest name part a label shows before its size (design §10.2: at most 40 characters). */
const LABEL_NAME_MAX_CHARS = 40

const open = (target: OverlayTargetId): OverlayPick => ({ kind: 'open', via: 'pointer', target })
const menu = (target: OverlayTargetId): OverlayPick => ({ kind: 'menu', via: 'pointer', target })

/**
 * Run the overlay behaviour suite against one host.
 *
 * @param name - The host, as the describe block names it.
 * @param makeDriver - A fresh driver on a freshly laid-out fixture, comment mode off. Called once per test.
 */
export function runOverlaySuite(name: string, makeDriver: () => OverlayDriver | Promise<OverlayDriver>): void {
  describe(`overlay behaviour – ${name}`, () => {
    let d: OverlayDriver

    beforeEach(async () => {
      d = await makeDriver()
    })

    afterEach(() => {
      d.dispose()
    })

    /** The reason a host gave for not owning `layer`, for a skip note. */
    const notOwned = (layer: HostedLayer | 'modeIndicator'): string =>
      d.notOwned?.[layer] ?? `${d.host} gives no reason for leaving out ${layer}`

    describe('comment mode on and off', () => {
      it('OVL-M-01 starts off; turns on and off', () => {
        expect(d.isModeOn()).toBe(false)
        d.modeOn()
        expect(d.isModeOn()).toBe(true)
        d.modeOff()
        expect(d.isModeOn()).toBe(false)
      })

      it('OVL-M-02 off: a click belongs to the page – nothing is picked, outlined or labelled', () => {
        d.click('inner')
        expect(d.picks()).toEqual([])
        expect(d.pageSaw()).toContain('click')
        expect(d.outlinedTarget()).toBeNull()
        expect(d.labelText('inner')).toBeNull()
      })

      it('OVL-M-03 on: a click is kept from the page and picks', () => {
        d.modeOn()
        d.click('inner')
        expect(d.pageSaw()).toEqual([])
        expect(d.picks()).toEqual([open('inner')])
      })

      it('OVL-M-04 turning it off clears the outline and the label', () => {
        d.modeOn()
        d.hover({ target: 'inner' })
        expect(d.outlinedTarget()).toBe('inner')
        d.modeOff()
        expect(d.outlinedTarget()).toBeNull()
        expect(d.labelText('inner')).toBeNull()
      })

      it('OVL-M-05 the mode indicator shows only while comment mode is on', ctx => {
        if (d.modeIndicatorText === undefined) {
          ctx.skip(notOwned('modeIndicator'))
          return
        }
        expect(d.modeIndicatorText()).toBeNull()
        d.modeOn()
        expect(d.modeIndicatorText()).toBe('Comment mode – Esc to leave')
        d.modeOff()
        expect(d.modeIndicatorText()).toBeNull()
      })

      it('OVL-M-06 the fixture is laid out whole', () => {
        expect([...d.targets()].sort()).toEqual(['container', 'first', 'inner', 'long', 'second'])
      })
    })

    describe('the gesture table (comment mode on)', () => {
      beforeEach(() => {
        d.modeOn()
      })

      it('OVL-G-01 click picks the innermost target under the pointer and paints it selected', () => {
        d.click('inner')
        expect(d.picks()).toEqual([open('inner')])
        expect(d.pickedTarget()).toBe('inner')
        expect(d.outlinedTarget()).toBe('inner')
        expect(d.outlineSelected()).toBe(true)
      })

      it('OVL-G-02 click on a parent outside its child picks the parent', () => {
        d.click('first')
        expect(d.picks()).toEqual([open('first')])
      })

      it('OVL-G-03 double click: each click of it picks, the page sees nothing (v0.23.1)', () => {
        d.doubleClick('inner')
        expect(d.picks()).toEqual([open('inner'), open('inner')])
        expect(d.pageSaw()).toEqual([])
      })

      it('OVL-G-04 triple click: each click of it picks, the page sees nothing (v0.23.1)', () => {
        d.tripleClick('inner')
        expect(d.picks()).toEqual([open('inner'), open('inner'), open('inner')])
        expect(d.pageSaw()).toEqual([])
      })

      it('OVL-G-05 a drag under 4 px is a click: it picks the target', () => {
        d.drag({ target: 'inner' }, { target: 'inner', dx: 3 })
        expect(d.picks()).toEqual([open('inner')])
      })

      it('OVL-G-06 024-FR-004 a drag of 4 px inside one target selects: nothing is picked, the page sees nothing', () => {
        d.drag({ target: 'inner', dx: -2 }, { target: 'inner', dx: 2 })
        expect(d.picks()).toEqual([])
        expect(d.pageSaw()).toEqual([])
      })

      it('OVL-G-07 024-FR-004 a drag across two targets selects: nothing is picked', () => {
        d.drag({ target: 'first', dx: 100 }, { target: 'second', dx: 100 })
        expect(d.picks()).toEqual([])
      })

      it('OVL-G-08 024-FR-004 a click that ends with a non-collapsed selection keeps it and picks nothing', () => {
        d.selectText('second')
        expect(d.selectedText()).not.toBe('')
        d.click('inner')
        expect(d.picks()).toEqual([])
        expect(d.selectedText()).not.toBe('')
      })

      it('OVL-G-09 Shift+click picks like a click (v0.23.1)', () => {
        d.click('inner', { shift: true })
        expect(d.picks()).toEqual([open('inner')])
        expect(d.pageSaw()).toEqual([])
      })

      it('OVL-G-10 right-click asks for the menu on the target – never opens – and the page sees nothing', () => {
        d.rightClick('inner')
        expect(d.picks()).toEqual([menu('inner')])
        expect(d.pageSaw()).toEqual([])
      })

      it('OVL-G-11 middle click picks nothing and the page sees nothing', () => {
        d.middleClick('inner')
        expect(d.picks()).toEqual([])
        expect(d.pageSaw()).toEqual([])
      })

      it('OVL-G-12 off: right-click and drag belong to the page', () => {
        d.modeOff()
        d.rightClick('inner')
        expect(d.pageSaw()).toContain('contextmenu')
        d.drag({ target: 'inner', dx: -10 }, { target: 'inner', dx: 10 })
        expect(d.pageSaw()).toContain('mousedown')
        expect(d.picks()).toEqual([])
      })
    })

    describe('the Esc order: menu → window → comment mode → Find', () => {
      it('OVL-E-01 with comment mode on, Esc leaves comment mode and the page never sees the key', () => {
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

      it('OVL-E-02 with nothing open, the overlay leaves Esc alone (it falls through to Find’s owner)', () => {
        expect(d.openLayer()).toBeNull()
        d.pressEscape()
        expect(d.picks()).toEqual([])
        expect(d.pageSaw()).toEqual(['keydown', 'keyup'])
      })

      it('OVL-E-03 Esc closes the menu first; comment mode stays on', ctx => {
        if (d.open === undefined || d.notOwned?.menu !== undefined) {
          ctx.skip(notOwned('menu'))
          return
        }
        d.modeOn()
        d.open('menu', 'inner')
        expect(d.openLayer()).toBe('menu')
        d.pressEscape()
        expect(d.openLayer()).toBe('mode')
        expect(d.isModeOn()).toBe(true)
      })

      it('OVL-E-04 Esc closes the comment window before comment mode', ctx => {
        if (d.open === undefined || d.notOwned?.window !== undefined) {
          ctx.skip(notOwned('window'))
          return
        }
        d.modeOn()
        d.open('window', 'inner')
        expect(d.openLayer()).toBe('window')
        d.pressEscape()
        expect(d.openLayer()).toBe('mode')
        expect(d.isModeOn()).toBe(true)
      })

      it('OVL-E-05 Esc leaves comment mode before it closes Find', ctx => {
        if (d.open === undefined || d.notOwned?.find !== undefined) {
          ctx.skip(notOwned('find'))
          return
        }
        d.open('find')
        d.modeOn()
        expect(d.openLayer()).toBe('mode')
        d.pressEscape()
        expect(d.isModeOn()).toBe(false)
        expect(d.openLayer()).toBe('find')
      })
    })

    describe('the label', () => {
      it.each(['container', 'first', 'inner', 'second', 'long'] as const)(
        'OVL-L-01 the label of %s reads as the host words it',
        target => {
          d.modeOn()
          expect(d.labelText(target)).toBe(d.labels[target])
        }
      )

      it('OVL-L-02 no label while comment mode is off', () => {
        for (const target of d.targets()) expect(d.labelText(target), target).toBeNull()
      })

      it('OVL-L-03 the outline and label follow the pointer to the innermost target', () => {
        d.modeOn()
        d.hover({ target: 'first' })
        expect(d.outlinedTarget()).toBe('first')
        expect(d.outlineSelected()).toBe(false)
        d.hover({ target: 'inner' })
        expect(d.outlinedTarget()).toBe('inner')
        d.hover({ target: 'container', dy: 150 })
        expect(d.outlinedTarget()).toBe('container')
      })

      it(`OVL-L-04 a label's name never runs past ${LABEL_NAME_MAX_CHARS} characters, and it ends in the size`, () => {
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
