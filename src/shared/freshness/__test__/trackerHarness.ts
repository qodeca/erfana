// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A text tab on the fake disk, clock and source, for the tracker tests: what
 * it shows, whether its buffer is edited, whether it is visible, and the
 * {@link UpdateRule} an editor-like adapter would supply.
 */
import { FreshnessTracker } from '../FreshnessTracker'
import type { FileStamp, FreshnessState, UpdateRule } from '../freshnessTypes'
import { textReadOutcome, type TextVersion } from '../textOutcome'
import type { TimingProfileName } from '../timingProfiles'
import { createFakeClock, type FakeClock } from './fakeClock'
import { FakeDisk } from './fakeDisk'
import { FakeSource } from './fakeSource'

export const FILE = '/proj/a.md'

export interface TabOptions {
  readonly profile?: TimingProfileName
  /** `true`: a hidden tab defers reads until shown (the image viewer). */
  readonly deferWhenHidden?: boolean
  /** Write the file before the tab opens (default `true`). */
  readonly initialText?: string | null
}

export class TextTab {
  readonly clock: FakeClock
  readonly disk: FakeDisk
  readonly source: FakeSource
  readonly tracker: FreshnessTracker<TextVersion>
  /** What the tab shows. */
  shown: string | undefined
  /** The local buffer when edited; `undefined` = not edited. */
  buffer: string | undefined
  visible = true
  /** Every version applied, in order. */
  readonly applied: string[] = []
  /** Every state the tracker published. */
  readonly states: FreshnessState[] = []
  private ids = 0

  constructor(options: TabOptions = {}) {
    this.clock = createFakeClock()
    this.disk = new FakeDisk(this.clock)
    this.source = new FakeSource(this.disk)
    const initial = options.initialText === undefined ? 'v0' : options.initialText
    if (initial !== null) this.disk.write(FILE, initial, { silent: true })
    const deferWhenHidden = options.deferWhenHidden ?? false
    const rule: UpdateRule<TextVersion> = {
      read: async () => textReadOutcome(await this.source.readText(FILE)),
      readNow: () => !deferWhenHidden || this.visible,
      apply: (version, _stamp, force) => {
        if (this.buffer !== undefined && !force && version.text !== this.buffer) return 'held'
        if (force) this.buffer = undefined
        this.shown = version.text
        this.applied.push(version.text)
        return 'applied'
      },
      onState: (state) => this.states.push(state),
    }
    this.tracker = new FreshnessTracker({
      filePath: FILE,
      profile: options.profile ?? 'editor',
      source: this.source,
      clock: this.clock,
      rule,
      newId: () => `id-${++this.ids}`,
    })
  }

  /** Open: the initial read, then `begin` from its stamp (does not wait for the subscribe reply). */
  async open(): Promise<void> {
    const reply = await this.disk.readText(FILE)
    let baseline: FileStamp | undefined
    if (reply.status === 'ok') {
      this.shown = reply.text
      baseline = reply.stamp
    }
    void this.tracker.begin(baseline)
    await this.clock.flush()
  }

  get state(): FreshnessState {
    return this.tracker.getState()
  }

  /** Edit the buffer (the tab now has local changes). */
  edit(text: string): void {
    this.buffer = text
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.tracker.setVisible(visible)
  }

  /** Text reads made by the tab, the initial read included. */
  get reads(): number {
    return this.disk.reads.get(FILE) ?? 0
  }

  /** Let every timer and continuation due within `ms` run. */
  run(ms: number): Promise<void> {
    return this.clock.run(ms)
  }
}
