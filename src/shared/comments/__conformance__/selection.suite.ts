// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The one Comment button rule and the menu's subject, against both previews
 * (plan step 9; I-10, I-12, I-22; comments-v2 C-16; differences table D-51,
 * D-52). A file of its own beside `overlay.suite.ts`, as `pickerKeys.suite.ts`
 * is, because of the 500-line ratchet.
 *
 * The rule itself is `overlayCore/selectionRules`; this suite proves each host
 * follows it. Comment-mode cases, because outside the mode only the Markdown
 * Preview has the button for now (D-10). Line boxes are the suite's: jsdom has
 * no layout.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OVERLAY_FIXTURE, type OverlayTargetBox, type SelectionDriver } from './overlayDriver'

const { left, top, width, height } = OVERLAY_FIXTURE.second.box
/** The selection's one line, over the centre of `second`, where the driver's right-click lands. */
const LINE: OverlayTargetBox = { left, top, width, height }
/** The same line, scrolled up by this. */
const SCROLLED_BY = 60
const SCROLLED: OverlayTargetBox = { ...LINE, top: LINE.top - SCROLLED_BY }
/** The line far below any view. */
const OUT_OF_VIEW: OverlayTargetBox = { ...LINE, top: 50_000 }
/** A line this near the top takes the button below it, in both previews. */
const NEAR_TOP: OverlayTargetBox = { ...LINE, top: 40 }

/**
 * Run the suite against one host.
 *
 * @param name - The preview, as every case title names it.
 * @param makeDriver - A fresh driver on a laid-out fixture, comment mode off.
 */
export function runSelectionSuite(name: string, makeDriver: () => SelectionDriver | Promise<SelectionDriver>): void {
  describe(`the Comment button and the menu's subject – ${name}`, () => {
    let d: SelectionDriver

    beforeEach(async () => {
      d = await makeDriver()
    })

    afterEach(async () => {
      await d.dispose()
    })

    describe('the Comment button (C-16)', () => {
      beforeEach(() => {
        d.modeOn()
      })

      it(`I-10 (${name}) SEL-01 it waits about 150 ms after a mouse selection, then shows`, async () => {
        d.dragSelect('second', LINE)
        expect(d.commentButton()).toBeNull()
        await d.waitForButton()
        expect(d.commentButton()).not.toBeNull()
      })

      it(`I-10 (${name}) SEL-02 it follows the selection on a scroll`, async () => {
        d.dragSelect('second', LINE)
        await d.waitForButton()
        const before = d.commentButton()?.top ?? 0
        d.scrollSelection(SCROLLED)
        expect(d.commentButton()?.top).toBe(before - SCROLLED_BY)
      })

      it(`I-12 (${name}) SEL-03 it goes while the selection is out of view, and comes back with it`, async () => {
        d.dragSelect('second', LINE)
        await d.waitForButton()
        d.scrollSelection(OUT_OF_VIEW)
        expect(d.commentButton()).toBeNull()
        d.scrollSelection(LINE)
        expect(d.commentButton()).not.toBeNull()
      })

      it(`I-10 (${name}) SEL-04 it goes when a script clears the selection, with no press or scroll`, async () => {
        d.dragSelect('second', LINE)
        await d.waitForButton()
        await d.clearSelectionByScript()
        expect(d.commentButton()).toBeNull()
      })

      it(`I-10 (${name}) SEL-05 a line near the top takes the button below it`, async () => {
        d.dragSelect('second', NEAR_TOP)
        await d.waitForButton()
        expect(d.commentButton()?.below).toBe(true)
      })
    })

    describe('turning the mode on with words selected (C-16, A-12)', () => {
      it(`C-16 (${name}) SEL-06 words in view: the button shows at once`, () => {
        d.selectWords('second', LINE)
        d.modeOn()
        expect(d.commentButton()).not.toBeNull()
      })

      it(`I-12 (${name}) SEL-07 words out of view are ignored: no button, and Enter is not about them`, async () => {
        d.selectWords('second', OUT_OF_VIEW)
        d.modeOn()
        expect(d.commentButton()).toBeNull()
        d.pressEnter()
        expect(await d.lastPickHadWords()).toBe(false)
      })
    })

    describe('the pointer decides the menu (I-22)', () => {
      it(`I-22 (${name}) SEL-08 comment mode: a right-click inside the selection is about the words`, async () => {
        d.selectWords('second', LINE)
        d.modeOn()
        d.rightClick('second')
        expect(await d.menuAboutWords()).toBe(true)
      })

      it(`I-22 (${name}) SEL-09 comment mode: a right-click away from the selection is about what is under the pointer`, async () => {
        d.selectWords('second', LINE)
        d.modeOn()
        d.rightClick('long')
        expect(await d.menuAboutWords()).toBe(false)
      })

      it(`I-22 (${name}) SEL-10 mode off: a right-click inside the selection is about the words`, async () => {
        d.selectWords('second', LINE)
        d.rightClick('second')
        expect(await d.menuAboutWords()).toBe(true)
      })

      it(`I-22 (${name}) SEL-11 mode off: a right-click away from the selection is about what is under the pointer`, async () => {
        d.selectWords('second', LINE)
        d.rightClick('long')
        expect(await d.menuAboutWords()).toBe(false)
      })
    })
  })
}
