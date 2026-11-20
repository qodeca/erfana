// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * One tab's freshness tracker, as a React hook (#478, plan S12).
 *
 * The hook owns the tracker's life: it is built once the tab knows what it
 * shows (`ready`, with the stamp of its initial read as the baseline – G3),
 * registered with the window (focus and power-resume checks), told when the
 * tab is shown or hidden (a shown tab checks – S1), and disposed with the tab
 * or when the path changes. The state reaches React through
 * `useSyncExternalStore`, so every notice renders from the one state object
 * (decision 35) without an effect copying it into `useState`.
 *
 * The adapter's {@link UpdateRule} is read through a ref: a new rule object
 * on every render never rebuilds the tracker.
 *
 * @module hooks/useFreshness
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { FreshnessTracker } from '../../../shared/freshness/FreshnessTracker'
import type { FileStamp, FreshnessState, UpdateRule } from '../../../shared/freshness/freshnessTypes'
import type { TimingProfileName } from '../../../shared/freshness/timingProfiles'
import { freshnessEnvironment, registerTracker } from '../services/freshness/windowFreshness'

/** The state shown before a tracker exists: following, nothing to say. */
export const IDLE_FRESHNESS_STATE: FreshnessState = {
  watch: { kind: 'active', live: 'full' },
  content: { kind: 'fresh' }
}

/** Options of {@link useFreshness}. */
export interface UseFreshnessOptions<V> {
  /** The file to follow; `null` follows nothing. */
  readonly filePath: string | null
  /** The profile the tab subscribes with (window profiles only). */
  readonly profile: Extract<TimingProfileName, 'editor' | 'image' | 'dependent'>
  /** How to read, whether to read now, how to apply (decision 41). */
  readonly rule: UpdateRule<V>
  /** The tab has its initial content: the tracker starts from `baseline`. */
  readonly ready: boolean
  /** The stamp of the initial read; read once, when the tracker starts. */
  readonly baseline?: FileStamp
  /** The tab is shown: a hidden tab defers where its rule says so, a shown one checks. */
  readonly visible: boolean
}

/** What {@link useFreshness} returns. */
export interface UseFreshnessResult<V> {
  /** The one state object every notice reads. */
  readonly state: FreshnessState
  /** The live tracker, or `null` before `ready` / without a path. */
  readonly tracker: FreshnessTracker<V> | null
}

/** Holds the current tracker for `useSyncExternalStore`; one per hook instance. */
class TrackerSlot<V> {
  current: FreshnessTracker<V> | null = null
  private readonly listeners = new Set<() => void>()
  private stopTracker: (() => void) | null = null
  /**
   * The tracker and its state as one snapshot, rebuilt on every change. The
   * tracker is part of it: a new tracker can start in a state equal to the
   * old one's, and the render must still hand out the new tracker.
   */
  private snapshot: UseFreshnessResult<V> = { state: IDLE_FRESHNESS_STATE, tracker: null }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): UseFreshnessResult<V> => this.snapshot

  attach(tracker: FreshnessTracker<V>): void {
    this.current = tracker
    this.stopTracker = tracker.subscribe(this.notify)
    this.notify()
  }

  detach(tracker: FreshnessTracker<V>): void {
    if (this.current !== tracker) return
    this.stopTracker?.()
    this.stopTracker = null
    this.current = null
    this.notify()
  }

  private readonly notify = (): void => {
    const state = this.current?.getState() ?? IDLE_FRESHNESS_STATE
    if (state !== this.snapshot.state || this.current !== this.snapshot.tracker) {
      this.snapshot = { state, tracker: this.current }
    }
    for (const listener of [...this.listeners]) listener()
  }
}

/**
 * Follow `filePath` with a tracker built from `rule`.
 *
 * @example
 * ```ts
 * const { state, tracker } = useFreshness({ filePath, profile: 'image', rule, ready: loaded, baseline, visible })
 * if (state.content.kind === 'deleted') showDeletedBanner()
 * ```
 */
export function useFreshness<V>(options: UseFreshnessOptions<V>): UseFreshnessResult<V> {
  const { filePath, profile, ready, visible } = options
  const [slot] = useState(() => new TrackerSlot<V>())

  const ruleRef = useRef(options.rule)
  const baselineRef = useRef(options.baseline)
  const visibleRef = useRef(visible)
  useEffect(() => {
    ruleRef.current = options.rule
    baselineRef.current = options.baseline
    visibleRef.current = visible
  })

  useEffect(() => {
    if (!filePath || !ready) return
    const env = freshnessEnvironment()
    const tracker = new FreshnessTracker<V>({
      filePath,
      profile,
      source: env.source,
      clock: env.clock,
      newId: env.newId,
      rule: {
        read: () => ruleRef.current.read(),
        readNow: () => ruleRef.current.readNow(),
        apply: (version, stamp, force) => ruleRef.current.apply(version, stamp, force),
        onState: (state) => ruleRef.current.onState?.(state)
      }
    })
    tracker.setVisible(visibleRef.current)
    slot.attach(tracker)
    const unregister = registerTracker(tracker)
    void tracker.begin(baselineRef.current)
    return () => {
      unregister()
      slot.detach(tracker)
      tracker.dispose()
    }
  }, [filePath, profile, ready, slot])

  useEffect(() => {
    slot.current?.setVisible(visible)
  }, [visible, slot])

  return useSyncExternalStore(slot.subscribe, slot.getSnapshot)
}
