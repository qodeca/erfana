// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The drawer's review loop, one behaviour in both previews (spec 024
 * 024-FR-028, 024-AC-039, plan step 13; P-F21, P-F23, P-F24). Split out of
 * `overlay.suite.ts` as its siblings are: that suite is the overlay's own
 * behaviour, and the drawer is shared renderer code behind each preview's
 * words. Every case runs with no mouse. The writes themselves, and each check
 * they pass, run against both file kinds in `CommentWriter.bulk.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/** One comment of the fixture. */
export type BulkThreadState = 'open' | 'changed' | 'words' | 'not-found' | 'resolved'

/** What a test opens the drawer on. */
export interface DrawerBulkSetup {
  /** One list per file: the second is a frame's (HTML) or stands for a second write. */
  readonly files: readonly (readonly BulkThreadState[])[]
  readonly identity?: 'none' | 'ready'
  readonly readOnly?: boolean
  readonly editor?: 'clean' | 'dirty'
  /** Main refuses this file, by its place in `files`. */
  readonly refuseFile?: number
  /** The file at this place landed, then changed before main could read it back (L-1). */
  readonly changedFile?: number
  /** The file at this place outlasts its answer: main says "still saving" for it (L-2). */
  readonly pendingFile?: number
  /** The drawer is opened on a filter other than Open. */
  readonly filter?: 'open' | 'resolved'
  readonly canTurnOnMode?: boolean
}

/** A bulk request as it reached main: per file, how many threads, by the fixture's place. */
export interface SentBulk {
  readonly change: 'resolve' | 'deleteResolved'
  readonly threads: readonly (readonly string[])[]
}

/** One preview's drawer. */
export interface DrawerBulkDriver {
  open(setup: DrawerBulkSetup): Promise<void>
  /** The bulk action the drawer offers, or `null`. */
  action(): string | null
  /** Why it is held back, or `null`. */
  pausedText(): string | null
  /** Press the action with the keyboard. */
  openReview(): Promise<void>
  /** The states of the comments listed, in order. */
  reviewed(): readonly string[]
  /** Was and Now as the review shows them, per comment. */
  wasNow(): readonly string[]
  /** What holds focus: the review's Cancel, its action, the drawer's action, or elsewhere. */
  focused(): 'cancel' | 'confirm' | 'action' | 'close' | 'other'
  cancelByKeys(): Promise<void>
  escape(): Promise<void>
  confirmByKeys(): Promise<void>
  /** The review shows the identity step. */
  asksName(): boolean
  answerName(name: string): Promise<void>
  sent(): readonly SentBulk[]
  outcome(): string | null
  /** Main says how the pending file ended (L-2): landed, or refused. */
  settleLate(ending: 'landed' | 'refused'): Promise<void>
  /** The empty drawer's button: its name, or `null`. */
  turnOnMode(): string | null
  turnOnModeByKeys(): Promise<void>
  /** Times the host turned the mode on. */
  modeTurnedOn(): number
  dispose(): Promise<void> | void
}

/**
 * Run the drawer's review-loop suite against one preview.
 *
 * @param name - The preview, as every case title names it.
 * @param makeDriver - A fresh driver, nothing open. Called once per test.
 */
export function runDrawerBulkSuite(name: string, makeDriver: () => DrawerBulkDriver): void {
  describe(`drawer review loop – ${name}`, () => {
    let d: DrawerBulkDriver
    const MIXED: readonly BulkThreadState[] = ['open', 'changed', 'words', 'not-found', 'resolved']

    beforeEach(() => {
      d = makeDriver()
    })
    afterEach(async () => {
      await d.dispose()
    })

    it(`024-AC-039 (${name}) BLK-01 the review lists only Changed and Words changed, with Was and Now; Cancel sends nothing; confirming sends those`, async () => {
      await d.open({ files: [MIXED], identity: 'ready' })
      expect(d.action()).toBe('Resolve all changed comments')
      await d.openReview()
      expect(d.reviewed()).toEqual(['changed', 'words'])
      expect(d.wasNow()).toEqual(['Was Buy now Now Buy today', 'Was old words Now new words'])
      expect(d.focused()).toBe('cancel')
      await d.cancelByKeys()
      expect(d.sent()).toEqual([])
      expect(d.focused()).toBe('action')
      await d.openReview()
      await d.confirmByKeys()
      expect(d.sent()).toEqual([{ change: 'resolve', threads: [['changed', 'words']] }])
      expect(d.outcome()).toBe('Resolved 2 comments.')
    })

    it(`024-AC-039 (${name}) BLK-02 Esc backs out of the review, and focus returns to the action`, async () => {
      await d.open({ files: [MIXED], identity: 'ready' })
      await d.openReview()
      await d.escape()
      expect(d.reviewed()).toEqual([])
      expect(d.sent()).toEqual([])
      expect(d.focused()).toBe('action')
    })

    it(`024-FR-028 (${name}) BLK-03 nothing changed: nothing is offered`, async () => {
      await d.open({ files: [['open', 'not-found']], identity: 'ready' })
      expect(d.action()).toBeNull()
    })

    it(`024-FR-028 (${name}) BLK-04 a file that cannot be written offers neither action`, async () => {
      await d.open({ files: [MIXED], identity: 'ready', readOnly: true })
      expect(d.action()).toBeNull()
    })

    it(`024-FR-028 (${name}) BLK-05 unsaved edits hold the action back, in a sentence`, async () => {
      await d.open({ files: [MIXED], identity: 'ready', editor: 'dirty' })
      expect(d.action()).toBeNull()
      expect(d.pausedText()).toMatch(/has unsaved changes/)
    })

    it(`024-FR-022 (${name}) BLK-06 a resolve with no name asks first, then goes by itself`, async () => {
      await d.open({ files: [MIXED], identity: 'none' })
      await d.openReview()
      await d.confirmByKeys()
      expect(d.asksName()).toBe(true)
      expect(d.sent()).toEqual([])
      await d.answerName('Grace Hopper')
      expect(d.sent()).toHaveLength(1)
    })

    it(`P-F23 (${name}) BLK-07 Delete all resolved comments lists only resolved ones, and a delete needs no name`, async () => {
      await d.open({ files: [MIXED], identity: 'none', filter: 'resolved' })
      expect(d.action()).toBe('Delete all resolved comments')
      await d.openReview()
      expect(d.reviewed()).toEqual(['resolved'])
      expect(d.focused()).toBe('cancel')
      await d.confirmByKeys()
      expect(d.asksName()).toBe(false)
      expect(d.sent()).toEqual([{ change: 'deleteResolved', threads: [['resolved']] }])
      expect(d.outcome()).toBe('Deleted 1 comment.')
    })

    it(`P-F23 (${name}) BLK-08 no action removes open comments: Open offers only the resolve`, async () => {
      await d.open({ files: [['open', 'open']], identity: 'ready' })
      expect(d.action()).toBeNull()
      await d.dispose()
      d = makeDriver()
      await d.open({ files: [['open']], identity: 'ready', filter: 'resolved' })
      expect(d.action()).toBeNull()
    })

    it(`024-FR-028 (${name}) BLK-09 one request names each file once: one write per file`, async () => {
      await d.open({ files: [['changed', 'changed'], ['words']], identity: 'ready' })
      await d.openReview()
      await d.confirmByKeys()
      expect(d.sent()).toEqual([{ change: 'resolve', threads: [['changed', 'changed'], ['words']] }])
    })

    it(`024-FR-028 (${name}) BLK-10 a partial failure says how many and why, and leaves the refused comments listed`, async () => {
      await d.open({ files: [['changed', 'changed'], ['words']], identity: 'ready', refuseFile: 1 })
      await d.openReview()
      await d.confirmByKeys()
      expect(d.outcome()).toMatch(/^Resolved 2 of 3 comments\. .+/)
      expect(d.action()).toBe('Resolve all changed comments')
      await d.openReview()
      expect(d.reviewed()).toEqual(['words'])
    })

    it(`L-1 (${name}) BLK-13 a file that changed right after its write landed counts as done, with a warning`, async () => {
      await d.open({ files: [['changed']], identity: 'ready', changedFile: 0 })
      await d.openReview()
      await d.confirmByKeys()
      expect(d.outcome()).toMatch(/^Resolved 1 comment\. .*index\.html.*changed during the save/)
    })

    it(`L-2 (${name}) BLK-14 a refusal past the time limit replaces "still saving": the reader hears why`, async () => {
      await d.open({ files: [['changed']], identity: 'ready', pendingFile: 0 })
      await d.openReview()
      await d.confirmByKeys()
      const waiting = d.outcome()
      await d.settleLate('refused')
      expect(d.outcome()).not.toBe(waiting)
      expect(d.outcome()).not.toMatch(/saving/i)
    })

    it(`L-2 (${name}) BLK-15 a landing past the time limit says the comments changed`, async () => {
      await d.open({ files: [['changed', 'changed']], identity: 'ready', pendingFile: 0 })
      await d.openReview()
      await d.confirmByKeys()
      await d.settleLate('landed')
      expect(d.outcome()).toBe('Resolved 2 comments.')
    })

    it(`P-F21 (${name}) BLK-11 the empty drawer's button turns comment mode on, by keys, and keeps focus in the drawer`, async () => {
      await d.open({ files: [[]], identity: 'ready', canTurnOnMode: true })
      expect(d.turnOnMode()).toBe('Turn on comment mode')
      await d.turnOnModeByKeys()
      expect(d.modeTurnedOn()).toBe(1)
      expect(d.focused()).toBe('close')
    })

    it(`P-F21 (${name}) BLK-12 no button where the mode cannot turn on`, async () => {
      await d.open({ files: [[]], identity: 'ready', canTurnOnMode: false })
      expect(d.turnOnMode()).toBeNull()
    })
  })
}
