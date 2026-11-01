// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment window's shared suites: its rules and its focus-return table,
 * one behaviour in both previews (spec 024, 024-FR-001, 024-FR-015,
 * 024-FR-022). Split out of `overlay.suite.ts`, which holds the overlay's own
 * behaviour; the drivers are in `overlayDriver.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FocusClose, FocusHome, FocusOpener, FocusTableDriver, WindowRulesDriver, WindowRulesSetup, WindowRulesThread } from './overlayDriver'

/**
 * The comment window's rules, one behaviour in both previews (024-FR-001,
 * 024-FR-015, 024-FR-022; plan step 2). Every case runs with no mouse.
 *
 * @param name - The preview, as every case title names it.
 * @param makeDriver - A fresh driver, nothing open. Called once per test.
 */
export function runWindowRulesSuite(name: string, makeDriver: () => WindowRulesDriver): void {
  describe(`comment window rules – ${name}`, () => {
    let d: WindowRulesDriver

    beforeEach(() => {
      d = makeDriver()
    })

    afterEach(async () => {
      await d.dispose()
    })

    it(`024-FR-022 (${name}) WIN-01 a first Reply asks for the name, then sends itself`, async () => {
      await d.open({ identity: 'none' })
      await d.replyByKeys('Looks right')
      expect(d.view()).toBe('identity')
      expect(d.writes()).toEqual([])
      await d.continueByKeys('Grace Hopper')
      expect(d.view()).toBe('threads')
      expect(d.writes()).toEqual(['reply'])
      expect(d.replyText()).toBe('')
      expect(d.focusInWindow()).toBe(true)
    })

    it(`024-FR-022 (${name}) WIN-02 a first Resolve asks first too, then resolves`, async () => {
      await d.open({ identity: 'none' })
      await d.resolveByKeys()
      expect(d.view()).toBe('identity')
      expect(d.writes()).toEqual([])
      await d.continueByKeys('Grace Hopper')
      expect(d.writes()).toEqual(['setStatus'])
    })

    it(`024-FR-022 (${name}) WIN-03 a name already in Settings still shows the notice once before a Reply`, async () => {
      await d.open({ identity: 'notice-unseen' })
      await d.replyByKeys('Looks right')
      expect(d.view()).toBe('identity')
      expect(d.writes()).toEqual([])
    })

    it(`024-FR-022 (${name}) WIN-04 Esc at the step goes back to the thread: nothing written, the text kept`, async () => {
      await d.open({ identity: 'none' })
      await d.replyByKeys('Looks right')
      await d.pressEscape()
      expect(d.view()).toBe('threads')
      expect(d.writes()).toEqual([])
      expect(d.replyText()).toBe('Looks right')
      expect(d.focusInWindow()).toBe(true)
    })

    it(`024-FR-022 (${name}) WIN-05 a known reader writes straight away`, async () => {
      await d.open({ identity: 'ready' })
      await d.replyByKeys('Looks right')
      expect(d.view()).toBe('threads')
      expect(d.writes()).toEqual(['reply'])
    })

    it(`024-FR-015 (${name}) WIN-06 unsaved edits: no reply box, and the banner's Save works`, async () => {
      await d.open({ identity: 'ready', editor: 'dirty' })
      expect(d.replyText()).toBeNull()
      expect(d.bannerButtons()).toEqual(['Go to tab', `Save ${d.fileName}`])
      await d.saveFromBannerByKeys()
      expect(d.editorSaves()).toBe(1)
    })

    it(`024-FR-015 (${name}) WIN-07 changed on disk too: Go to tab only, never a Save that overwrites`, async () => {
      await d.open({ identity: 'ready', editor: 'conflict' })
      expect(d.replyText()).toBeNull()
      expect(d.bannerButtons()).toEqual(['Go to tab'])
    })

    it(`024-FR-015 (${name}) WIN-08 a refusal with no tab here says so in one sentence, with no buttons`, async () => {
      await d.open({ identity: 'ready', refusedUnsaved: true })
      await d.replyByKeys('Looks right')
      expect(d.bannerButtons()).toEqual([])
      expect(d.bannerText()).toMatch(d.seesOtherWindows ? /in another window/ : /in another tab/)
      expect(d.replyText()).toBe('Looks right')
    })

    it(`S-03 (${name}) WIN-09 a Changed thread opens on Resolve`, async () => {
      await d.open({ identity: 'ready', threads: ['changed'] })
      expect(d.focused()).toBe('resolve')
    })

    it(`S-03 (${name}) WIN-10 a Changed thread with no Resolve opens on the title: read-only file`, async () => {
      await d.open({ identity: 'ready', threads: ['changed'], readOnly: true })
      expect(d.focused()).toBe('title')
    })

    it(`S-03 (${name}) WIN-11 a Changed thread with no Resolve opens on the title: paused by unsaved edits`, async () => {
      await d.open({ identity: 'ready', threads: ['changed'], editor: 'dirty' })
      expect(d.focused()).toBe('title')
    })

    it(`S-03 (${name}) WIN-12 a step lands by the same rule: onto a Changed thread, on Resolve and next`, async () => {
      await d.open({ identity: 'ready', threads: ['open', 'changed'] })
      await d.stepByKeys()
      expect(d.focused()).toBe('resolve-next')
    })

    it(`S-03 (${name}) WIN-13 a step lands by the same rule: onto an open thread, on the title`, async () => {
      await d.open({ identity: 'ready', threads: ['changed', 'open'] })
      await d.stepByKeys()
      expect(d.focused()).toBe('title')
    })

    it(`S-03 (${name}) WIN-14 a step lands by the same rule: onto a Changed thread on a read-only file, on the title`, async () => {
      await d.open({ identity: 'ready', threads: ['open', 'changed'], readOnly: true })
      await d.stepByKeys()
      expect(d.focused()).toBe('title')
    })

    it.each(WINDOW_ACTIONS)(`024-FR-006 (${name}) WIN-15 same actions: $state`, async ({ setup, expected, step, remove }) => {
      await d.open({ identity: 'ready', ...setup })
      if (step === true) await d.stepByKeys()
      if (remove === true) await d.removeShown()
      expect((await d.actions()).map(action => action.replace(/^New comment on .+$/, NEW_ON_KIND))).toEqual(expected)
    })
  })
}

/** The removed-outside button, whichever kind word the preview puts in it (D-04). */
const NEW_ON_KIND = 'New comment on {kind}'
const OPEN = { opened: 'target' } as const
const TWO: readonly WindowRulesThread[] = ['open', 'open']

/**
 * What the window offers in each state, one list for both previews (plan step
 * 5, "Done when"). "New comment" needs a target in the preview, and a file that
 * takes one; a step leaves that target.
 */
const WINDOW_ACTIONS: ReadonlyArray<{
  readonly state: string
  readonly setup: Partial<WindowRulesSetup>
  readonly expected: readonly string[]
  readonly step?: boolean
  readonly remove?: boolean
}> = [
  { state: 'on its target', setup: OPEN, expected: ['Open in file', 'New comment', 'Close'] },
  { state: 'on its target, more comments to step to', setup: { ...OPEN, threads: TWO }, expected: ['Close', 'Resolve and next', 'New comment', 'Open in file'] },
  { state: 'opened elsewhere', setup: {}, expected: ['Open in file', 'Close'] },
  { state: 'opened elsewhere, more comments to step to', setup: { threads: TWO }, expected: ['Close', 'Resolve and next', 'Open in file'] },
  { state: 'after a step', setup: { ...OPEN, threads: TWO }, step: true, expected: ['Close', 'Resolve and next', 'Open in file'] },
  { state: 'unsaved edits', setup: { ...OPEN, editor: 'dirty' }, expected: ['Open in file', 'Close'] },
  { state: 'read-only file', setup: { ...OPEN, readOnly: true }, expected: ['Open in file', 'Close'] },
  { state: 'file at its comment limit', setup: { ...OPEN, full: true }, expected: ['Open in file', 'Close'] },
  { state: 'removed while open', setup: OPEN, remove: true, expected: ['Copy text', NEW_ON_KIND, 'Close'] },
  { state: 'removed while open, opened elsewhere', setup: {}, remove: true, expected: ['Copy text', 'Close'] }
]

/** Where each opener takes focus back to, on a close that leaves it to the window. */
const FOCUS_HOME: Readonly<Record<FocusOpener, FocusHome>> = {
  'drawer-row': 'opener',
  'gone-row': 'drawer',
  toolbar: 'opener',
  target: 'preview',
  'gone-target': 'preview',
  nothing: 'preview'
}
const FOCUS_CLOSES: readonly FocusClose[] = ['escape', 'close-button', 'saved', 'thread-gone', 'go-to-tab']

/**
 * The focus-return table: every opener against every close reason, with no
 * mouse (plan step 3, differences D-59). Focus never falls to `<body>`.
 *
 * @param name - The preview, as every case title names it.
 * @param makeDriver - A fresh driver, nothing open. Called once per test.
 */
export function runFocusTableSuite(name: string, makeDriver: () => FocusTableDriver): void {
  describe(`comment window focus return – ${name}`, () => {
    let d: FocusTableDriver

    beforeEach(() => {
      d = makeDriver()
    })

    afterEach(async () => {
      await d.dispose()
    })

    const rows = (Object.keys(FOCUS_HOME) as FocusOpener[]).flatMap(opener => FOCUS_CLOSES.map(close => ({ opener, close })))
    it.each(rows)(`D-59 (${name}) FOC opener $opener, closed by $close`, async ({ opener, close }) => {
      await d.open(opener, close)
      await d.close(close)
      expect(d.home()).toBe(close === 'go-to-tab' ? 'editor' : FOCUS_HOME[opener])
    })
  })
}
