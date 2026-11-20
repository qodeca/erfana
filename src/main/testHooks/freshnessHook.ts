// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The file-freshness test hook (#478 plan step S0): what the gap and latency
 * e2e tests need from main to reproduce a watch that is refused, muted, dead,
 * full or held mid-save.
 *
 * Built by wrapping the `fileWatcherService` singleton and the `textWriter`
 * seam. Plan steps S11 and S16 re-pointed the operations to the watch layer's
 * seams – the watch limit is the `tabs` bucket cap, a simulated wake drives
 * the same `wirePowerResume` the app wires to Electron's `powerMonitor`, a
 * refused subscribe is the next `subscribe`, a held write is the next checked
 * text write (`file-watch:writeText`) – and kept this API, so the e2e tests
 * written against it did not change. Muting still wraps the service's private
 * `deliver` on the instance.
 *
 * Test builds only – reached through `./index`, never from production code.
 */
import { EventEmitter } from 'events'
import type { SubscribeRefusalCode, SubscribeReply } from '../../shared/freshness/freshnessTypes'
import type { PowerEvent, PowerMonitorLike } from '../utils/PowerMonitorLike'
import type { SubscribeInput } from '../services/watcher/watchTypes'
import { wirePowerResume, type WatchWakeTarget } from '../services/freshness/watchOwnerLifecycle'

/** One watch entry of `FileWatcherService`, as far as this hook reads it. */
export interface WatchEntryView {
  watcher: { close(): Promise<void> } | null
}

/** One subscription of `FileWatcherService`, as far as this hook reads it. */
export interface WatchSubscriptionView {
  readonly owner: { readonly kind: 'window' | 'process' }
  /** The entry it is attached to; `null` while it waits for a slot. */
  readonly entryKey: string | null
}

/**
 * `FileWatcherService` seen through what this hook needs. `deliver` is
 * `private` and `subscriptions` `protected` in TypeScript only; the hook
 * replaces `deliver` on the singleton instance and only reads `subscriptions`.
 */
export interface WatcherInternals extends WatchWakeTarget {
  subscribe(input: SubscribeInput): Promise<SubscribeReply>
  getStats(): { totalWatched: number; subscriptions: number; paused: number }
  setBucketCap(bucket: 'tabs', totalCap: number): number
  readonly entries: ReadonlyMap<string, WatchEntryView>
  readonly subscriptions: { all(): readonly WatchSubscriptionView[] }
  deliver(subs: unknown, event: unknown): void
}

/** The checked text write the hook can hold (`textWriter` in `services/freshness/textWrite`). */
export interface WritableFiles {
  write(filePath: string, content: string, options?: unknown): Promise<unknown>
}

/** A power monitor a test can drive: `PowerMonitorLike` plus `emit`. */
export interface DrivablePowerMonitor extends PowerMonitorLike {
  emit(event: PowerEvent): boolean
}

/** What the hook works on; the defaults are the app's singletons (`./index`). */
export interface FreshnessHookDeps {
  readonly watcher: WatcherInternals
  readonly files: WritableFiles
  readonly powerMonitor: DrivablePowerMonitor
}

/** The watch layer's counts. */
export interface FreshnessWatchStats {
  /** Watched files (native watches), whoever follows them. */
  totalWatched: number
  /** Subscriptions over every file and owner (windows and main's in-process owners). */
  subscriptions: number
  /** Subscriptions that are paused now. */
  paused: number
  /**
   * Files a window (an editor or image tab) follows. Main's own owners – the
   * comment watch on a Markdown tab's document, the HTML preview – also
   * subscribe, so `totalWatched` is not the tab count (#478 S19).
   */
  tabWatches: number
  /** Window subscriptions attached to a file – what a reload leak grows (G2). */
  tabSubscriptions: number
}

/** What a test reaches as `__erfanaTestHooks.freshness`. */
export interface FreshnessTestHook {
  watchStats(): FreshnessWatchStats
  /** Sets the editor and image tabs' watch limit (the `tabs` bucket cap); returns the previous one. */
  setWatchLimit(limit: number): number
  /**
   * The next subscribe from a window (a tab) is refused with `code`; main's
   * in-process owners (comment watches, the HTML preview) pass through.
   */
  failNextSubscribe(code: string): void
  /** The failure `failNextSubscribe` armed and no subscribe used yet, or `null`. */
  pendingSubscribeFailure(): string | null
  /** While on, every main→window watch message is dropped. */
  muteWatchEvents(on: boolean): void
  /** Closes every native watcher and tells nobody – each watch is dead but still listed. Resolves the count. */
  killWatchesSilently(): Promise<number>
  /** Emits `resume` on the hook's power monitor, wired to the watch layer as Electron's is. */
  simulateResume(): void
  /** The next text write waits inside main until {@link releaseWrite}. */
  holdNextWrite(): void
  /** True while a write is held. */
  writeHeld(): boolean
  /** Lets a held write finish, or disarms a hold no write reached yet. */
  releaseWrite(): void
}

/** The power monitor the hook drives; the hook wires it to the watch layer (#478 G8). */
export const freshnessPowerMonitor: DrivablePowerMonitor = new EventEmitter()

/** Builds the hook over `deps` and installs its wrappers on the instances there. */
export function createFreshnessTestHook(deps: FreshnessHookDeps): FreshnessTestHook {
  const { watcher, files, powerMonitor } = deps
  wirePowerResume(powerMonitor, watcher)

  let failure: SubscribeRefusalCode | null = null
  const subscribe = watcher.subscribe.bind(watcher)
  watcher.subscribe = async input => {
    if (failure !== null && input.owner.kind === 'window') {
      const code = failure
      failure = null
      return { status: 'refused', code }
    }
    return subscribe(input)
  }

  let muted = false
  const deliver = watcher.deliver.bind(watcher)
  watcher.deliver = (subs, event) => {
    if (!muted) deliver(subs, event)
  }

  const hold = createWriteHold(files)

  return {
    watchStats: () => {
      const { totalWatched, subscriptions, paused } = watcher.getStats()
      const tabSubs = watcher.subscriptions.all().filter(sub => sub.owner.kind === 'window' && sub.entryKey !== null)
      return {
        totalWatched,
        subscriptions,
        paused,
        tabWatches: new Set(tabSubs.map(sub => sub.entryKey)).size,
        tabSubscriptions: tabSubs.length
      }
    },
    setWatchLimit: limit => {
      if (!Number.isInteger(limit) || limit < 0) throw new Error(`Invalid watch limit: ${limit}`)
      return watcher.setBucketCap('tabs', limit)
    },
    failNextSubscribe: code => {
      if (!REFUSAL_CODES.has(code)) throw new Error(`Unknown subscribe refusal code: ${code}`)
      failure = code as SubscribeRefusalCode
    },
    pendingSubscribeFailure: () => failure,
    muteWatchEvents: on => {
      muted = on
    },
    killWatchesSilently: async () => {
      const entries = [...watcher.entries.values()]
      await Promise.all(entries.map(entry => entry.watcher?.close().catch(() => undefined)))
      return entries.length
    },
    simulateResume: () => {
      powerMonitor.emit('resume')
    },
    holdNextWrite: hold.arm,
    writeHeld: hold.isHolding,
    releaseWrite: hold.release
  }
}

const REFUSAL_CODES: ReadonlySet<string> = new Set<SubscribeRefusalCode>([
  'PAGE_CHANGED',
  'PROJECT_CHANGED',
  'WATCH_FAILED',
  'OUTSIDE_PROJECT',
  'UNSUPPORTED',
  'NOT_FOUND',
  'DUPLICATE_ID'
])

/** Wraps `files.write` so one armed call waits for a release. */
function createWriteHold(files: WritableFiles): {
  arm(): void
  isHolding(): boolean
  release(): void
} {
  let armed = false
  let releaseHeld: (() => void) | null = null
  const write = files.write.bind(files)
  files.write = async (filePath, content, options) => {
    if (armed) {
      armed = false
      await new Promise<void>(resolve => {
        releaseHeld = resolve
      })
    }
    return write(filePath, content, options)
  }
  return {
    arm: () => {
      armed = true
    },
    isHolding: () => releaseHeld !== null,
    release: () => {
      armed = false
      const release = releaseHeld
      releaseHeld = null
      release?.()
    }
  }
}
