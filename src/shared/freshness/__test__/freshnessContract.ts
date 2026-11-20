// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The shared freshness contract (#478 plan § 5.2, D2, F4): one scenario list
 * every tab type's adapter must pass, run over the core's fakes. A runner
 * supplies a harness – how to open a tab, what it shows, how to reload it –
 * and names each scenario it skips with the reason.
 *
 * Runners: `hooks/editorFreshness.contract.test.ts`,
 * `components/Panels/ImageViewerPanel/imageFreshness.contract.test.ts`,
 * `components/Editor/markdownImageFreshness.contract.test.ts` (renderer);
 * `services/preview/previewFreshness.contract.test.ts`,
 * `services/preview/previewWatchPool.contract.test.ts`,
 * `services/comments/commentFreshness.contract.test.ts` (main).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import type { FreshnessState } from '../freshnessTypes'
import { TIMING_PROFILES, type TimingProfileName } from '../timingProfiles'
import type { FakeDisk } from './fakeDisk'
import type { FakeSource } from './fakeSource'

/** The fake world a runner installs (structurally the renderer's `FakeFreshness`). */
export interface ContractEnvironment {
  readonly disk: FakeDisk
  readonly source: FakeSource
  /** Move fake time by `ms`, draining promises (inside React's `act` where needed). */
  run(ms?: number): Promise<void>
  /** Fire the window's "check every tracker" broadcast. */
  check(): void
  /** Run `fn` inside the runner's `act` (React state updates). */
  act(fn: () => void): void
}

/** One open tab, as the contract sees it. */
export interface ContractTab {
  /** What the tab shows now, in the runner's terms ({@link ContractHarness.shows}). */
  shown(): string | undefined
  /** How many times the adapter put a new version on screen. */
  applyCount(): number
  state(): FreshnessState
  /** The tab's Reload. */
  reload(): Promise<void>
  /** Show or hide the tab. */
  setVisible(visible: boolean): Promise<void>
}

export type ContractScenario =
  | '1-catch-up'
  | '1b-changed-before-started'
  | '2-applied-once'
  | '3-deleted-and-back'
  | '3b-back-found-by-probe'
  | '3c-back-refused'
  | '4-ended-restart'
  | '5-queued'
  | '6-check-no-change'
  | '7-mtime-preserving-copy'
  | '8-read-retries'
  | '9-content-refusal'
  | '10-hidden-deferred'
  | '11-delete-recreate'
  | '12-late-event'
  | '13-no-save-port'

export interface ContractHarness {
  /** The fake world, rebuilt per test (read inside `it`). */
  env(): ContractEnvironment
  readonly filePath: string
  readonly profile: TimingProfileName
  /** Open the tab on the file now on the fake disk, and let it start. */
  open(): Promise<ContractTab>
  /** What a tab shows for this disk text. */
  shows(text: string): string
  /** The adapter's module (repo-relative), for the import scenario. */
  readonly adapterModule: string
  /** The adapter can save (the editor); a read-only adapter must not import the save port. */
  readonly editable: boolean
  /** Scenarios this adapter skips, each with its reason. */
  readonly skips?: Partial<Record<ContractScenario, string>>
}

/** Past the throttle, the delete confirmation and the read retries (100 + 300 + 900 ms). */
const SETTLED_MS = 3_000
/** Long enough for the deleted-state probe's back-off (0.5 s up to 2 s) to look a few times. */
const PROBED_MS = 8_000
/** The read retries in the profiles: three after the first read. */
const RETRIES = 3

export function describeFreshnessContract(name: string, harness: ContractHarness): void {
  const scenario = (id: ContractScenario, title: string, body: () => Promise<void>): void => {
    const skip = harness.skips?.[id]
    if (skip) {
      it.skip(`${id}: ${title} – skipped: ${skip}`, () => {})
      return
    }
    it(`${id}: ${title}`, body)
  }
  const file = harness.filePath
  const write = (text: string, options?: { silent?: boolean; keepMtime?: boolean }): void =>
    harness.env().disk.write(file, text, options)
  const lastWatchId = (): string | undefined => harness.env().source.subscribeCalls.at(-1)?.watchId

  async function opened(text = 'v1'): Promise<ContractTab> {
    write(text, { silent: true })
    const tab = await harness.open()
    expect(tab.shown(), 'setup: the tab shows the file it opened').toBe(harness.shows(text))
    return tab
  }

  describe(`freshness contract – ${name}`, () => {
    scenario('1-catch-up', 'a write made before the watch was live is shown', async () => {
      write('v1', { silent: true })
      harness.env().source.scriptSubscribe({ kind: 'hold' })
      const tab = await harness.open()
      write('before ready', { silent: true })
      harness.env().act(() => harness.env().source.releaseHeld())
      await harness.env().run(SETTLED_MS)
      expect(tab.shown()).toBe(harness.shows('before ready'))
    })

    scenario('1b-changed-before-started', 'a change before `started` is folded into the catch-up, applied once', async () => {
      write('v1', { silent: true })
      harness.env().source.scriptSubscribe({ kind: 'hold' })
      const tab = await harness.open()
      write('early')
      harness.env().act(() => harness.env().source.releaseHeld())
      await harness.env().run(SETTLED_MS)
      expect(tab.shown()).toBe(harness.shows('early'))
      expect(tab.applyCount()).toBe(1)
    })

    scenario('2-applied-once', 'a change is applied once; a burst ends on the final version', async () => {
      const tab = await opened()
      write('one')
      await harness.env().run(SETTLED_MS)
      expect(tab.applyCount()).toBe(1)
      for (let i = 0; i < 5; i++) write(`burst ${i}`)
      await harness.env().run(SETTLED_MS)
      expect(tab.shown()).toBe(harness.shows('burst 4'))
      expect(tab.applyCount()).toBeLessThanOrEqual(3)
    })

    scenario('3-deleted-and-back', 'a confirmed delete is `deleted`; the file back follows again with a new id', async () => {
      const tab = await opened()
      const firstId = lastWatchId()
      harness.env().disk.remove(file)
      await harness.env().run(SETTLED_MS)
      expect(tab.state().content).toEqual({ kind: 'deleted' })
      write('back', { silent: true })
      await harness.env().run(PROBED_MS)
      expect(tab.state().content.kind).not.toBe('deleted')
      expect(tab.shown()).toBe(harness.shows('back'))
      expect(lastWatchId()).not.toBe(firstId)
    })

    scenario('3b-back-found-by-probe', 'a file back found by the probe is followed: a later write is applied', async () => {
      const tab = await opened()
      harness.env().disk.remove(file)
      await harness.env().run(SETTLED_MS)
      write('back', { silent: true })
      await harness.env().run(PROBED_MS)
      write('after')
      await harness.env().run(SETTLED_MS)
      expect(tab.shown()).toBe(harness.shows('after'))
    })

    scenario('3c-back-refused', 'back with the subscribe refused → stopped(restart-failed); Reload recovers', async () => {
      const tab = await opened()
      harness.env().disk.remove(file)
      await harness.env().run(SETTLED_MS)
      harness.env().source.scriptSubscribe({ kind: 'refused', code: 'WATCH_FAILED' })
      write('back', { silent: true })
      await harness.env().run(PROBED_MS)
      expect(tab.state().watch).toEqual({ kind: 'stopped', reason: 'restart-failed' })
      await tab.reload()
      await harness.env().run(SETTLED_MS)
      expect(tab.state().watch).toEqual({ kind: 'active', live: 'full' })
    })

    scenario('4-ended-restart', 'an `ended` watch gets one restart; a failing restart is `stopped`', async () => {
      const tab = await opened()
      const subscribes = (): number => harness.env().source.subscribeCalls.length
      const first = lastWatchId() as string
      const before = subscribes()
      harness.env().act(() => harness.env().source.emit({ watchId: first, kind: 'ended', reason: 'watcher-error' }))
      await harness.env().run(SETTLED_MS)
      expect(lastWatchId()).not.toBe(first)
      expect(subscribes(), 'exactly one automatic restart').toBe(before + 1)
      expect(tab.state().watch).toEqual({ kind: 'active', live: 'full' })

      harness.env().source.scriptSubscribe({ kind: 'refused', code: 'WATCH_FAILED' })
      const second = lastWatchId() as string
      harness.env().act(() => harness.env().source.emit({ watchId: second, kind: 'ended', reason: 'watcher-error' }))
      await harness.env().run(SETTLED_MS)
      expect(tab.state().watch.kind).toBe('stopped')
      // Stopped is final until Reload: no restart loop behind the notice
      expect(subscribes(), 'the one restart was used: no second one').toBe(before + 1)
      await harness.env().run(SETTLED_MS * 4)
      expect(subscribes(), 'no subscribe after stopped').toBe(before + 1)
    })

    scenario('5-queued', 'a queued tab is caught by the safety net; `started` catches up and clears quietly', async () => {
      write('v1', { silent: true })
      harness.env().source.scriptSubscribe({ kind: 'queued' })
      const tab = await harness.open()
      expect(tab.state().watch).toEqual({ kind: 'queued' })
      write('while queued', { silent: true })
      harness.env().act(() => harness.env().check())
      await harness.env().run(SETTLED_MS)
      expect(tab.shown()).toBe(harness.shows('while queued'))

      write('before started', { silent: true })
      harness.env().act(() => harness.env().source.promote(lastWatchId() as string))
      await harness.env().run(SETTLED_MS)
      expect(tab.state().watch).toEqual({ kind: 'active', live: 'full' })
      expect(tab.shown()).toBe(harness.shows('before started'))
    })

    scenario('6-check-no-change', 'a check with no change applies nothing and changes no state', async () => {
      const tab = await opened()
      const before = tab.state()
      harness.env().act(() => harness.env().check())
      await harness.env().run(SETTLED_MS)
      expect(tab.applyCount()).toBe(0)
      expect(tab.state()).toEqual(before)
    })

    scenario('7-mtime-preserving-copy', 'a check after an mtime-preserving copy applies it (L4)', async () => {
      const tab = await opened()
      write('copied over', { silent: true, keepMtime: true })
      harness.env().act(() => harness.env().check())
      await harness.env().run(SETTLED_MS)
      expect(tab.shown()).toBe(harness.shows('copied over'))
    })

    scenario('8-read-retries', 'a read failing 3× then succeeding is applied; failing 4× is unavailable (L2)', async () => {
      const tab = await opened()
      harness.env().disk.failNextReads(file, RETRIES)
      write('after retries')
      await harness.env().run(SETTLED_MS)
      expect(tab.shown()).toBe(harness.shows('after retries'))

      harness.env().disk.failNextReads(file, RETRIES + 1)
      write('never read')
      await harness.env().run(SETTLED_MS)
      expect(tab.state().content).toEqual({ kind: 'unavailable', reason: 'unreadable' })
    })

    scenario('9-content-refusal', 'refused content is unavailable(reason); a later good write is fresh (C1)', async () => {
      const tab = await opened()
      harness.env().disk.block(file, 'too-large')
      write('huge')
      await harness.env().run(SETTLED_MS)
      expect(tab.state().content).toEqual({ kind: 'unavailable', reason: 'too-large' })

      harness.env().disk.block(file, undefined)
      write('small again')
      await harness.env().run(SETTLED_MS)
      expect(tab.state().content).toEqual({ kind: 'fresh' })
      expect(tab.shown()).toBe(harness.shows('small again'))
    })

    scenario('10-hidden-deferred', 'a hidden tab marks the change deferred and applies it when shown', async () => {
      const tab = await opened()
      await tab.setVisible(false)
      write('while hidden')
      await harness.env().run(SETTLED_MS)
      expect(tab.state().content).toEqual({ kind: 'changed', mode: 'deferred' })
      expect(tab.applyCount()).toBe(0)
      await tab.setVisible(true)
      await harness.env().run(SETTLED_MS)
      expect(tab.shown()).toBe(harness.shows('while hidden'))
    })

    scenario('11-delete-recreate', 'a delete and recreate inside the confirm window is never `deleted` (G4)', async () => {
      const tab = await opened()
      const seen: string[] = []
      harness.env().disk.remove(file)
      write('recreated')
      // A profile with no confirm window (null) is watched for the settle time instead
      const confirmMs = TIMING_PROFILES[harness.profile].deleteConfirmMs ?? SETTLED_MS
      const steps = Math.ceil((confirmMs * 4) / 50)
      for (let i = 0; i < steps; i++) {
        await harness.env().run(50)
        seen.push(tab.state().content.kind)
      }
      expect(seen).not.toContain('deleted')
      expect(tab.shown()).toBe(harness.shows('recreated'))
    })

    scenario('12-late-event', 'a late event for a replaced id is dropped (F25)', async () => {
      const tab = await opened()
      const old = lastWatchId() as string
      harness.env().act(() => harness.env().source.emit({ watchId: old, kind: 'ended', reason: 'watcher-error' }))
      await harness.env().run(SETTLED_MS)
      expect(lastWatchId()).not.toBe(old)

      harness.env().act(() => harness.env().source.emit({ watchId: old, kind: 'deleted' }))
      await harness.env().run(SETTLED_MS)
      expect(tab.state().content.kind).not.toBe('deleted')
    })

    scenario('13-no-save-port', 'a read-only adapter does not import the save port', async () => {
      const source = readFileSync(join(process.cwd(), harness.adapterModule), 'utf8')
      const importsSavePort = /import[^;]*\b(saveAddOn|PausableSource)\b/.test(source)
      expect(importsSavePort).toBe(harness.editable)
    })
  })
}
