// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * watchTypes - the records `FileWatcherService` keeps (#478, plan S9).
 *
 * A **subscription** is one consumer following one file: a window's tab (keyed
 * by `webContents.id` + `watchId`) or an in-process owner such as the HTML
 * preview (keyed by its owner id + `watchId`), plan decisions 4 and 8. A
 * **watch entry** is the one native watcher on one real file, keyed by
 * `pathKey(realPath)` (decision 10), shared by every subscription on it.
 */
import type { FSWatcher } from 'chokidar'
import type {
  FileStamp,
  LiveRefresh,
  WatchEndReason,
  WatchEvent
} from '../../../shared/freshness/freshnessTypes'
import type { TimingProfileName, WatchBucketName } from '../../../shared/freshness/timingProfiles'

/** Who holds a subscription (plan decision 8). */
export type WatchOwner =
  | { readonly kind: 'window'; readonly webContentsId: number }
  | {
      readonly kind: 'process'
      readonly ownerId: string
      /** Called with every event of this owner's subscriptions, never with a path. */
      readonly onEvent: (event: WatchEvent) => void
      /** Called after a power resume, as windows get `file-watch:check` (decision 22). */
      readonly onCheck?: () => void
    }

/** The key subscriptions of one owner share: `w:<webContentsId>` or `p:<ownerId>`. */
export function ownerKeyOf(owner: WatchOwner): string {
  return owner.kind === 'window' ? `w:${owner.webContentsId}` : `p:${owner.ownerId}`
}

/**
 * Where a subscription is: `pending` while its subscribe is still answering
 * (it already hears events, the tracker buffers them – decision 6), `active`
 * once answered, `waiting` on a bucket's waitlist with no watch (decision 20).
 */
export type SubscriptionState = 'pending' | 'active' | 'waiting'

export interface WatchSubscription {
  /** `ownerKey` + NUL + `watchId`: unique per owner (decision 4, F23). */
  readonly key: string
  readonly watchId: string
  readonly owner: WatchOwner
  readonly ownerKey: string
  readonly profile: TimingProfileName
  readonly bucket: WatchBucketName
  /** The path as the subscriber spelled it. */
  readonly requestedPath: string
  /** The real path the subscribe resolved; a waitlisted subscription is armed on it later. */
  readonly realPath: string
  /** The session generation when the subscribe began (decision 15). */
  readonly generation: number
  /** The window's page generation when the subscribe began; `null` for an in-process owner. */
  readonly pageGeneration: number | null
  /** The entry it is attached to; `null` while waiting. */
  entryKey: string | null
  state: SubscriptionState
  /** Paused for an own save: changes are not sent, only remembered (decision 16). */
  paused: boolean
  /** A change arrived while paused, or the pause ran out. */
  missed: boolean
  pauseTimer: ReturnType<typeof setTimeout> | null
}

/** A file's identity on disk; a change means the path names another file now (decision 21). */
export interface WatchIdentity {
  readonly dev: number
  readonly ino: number
  readonly birthtimeMs: number
}

/** What arming a native watcher concluded (`armWatch`, decision 12). */
export type ArmOutcome = 'armed' | 'missing' | 'outside-project' | 'unsupported' | 'failed' | 'stale'

/** One native watcher on one real file, shared by its subscriptions. */
export interface WatchEntry {
  /** `pathKey(filePath)`. */
  readonly key: string
  /** The real path the watcher is bound to. */
  readonly filePath: string
  /** The profile whose gate timings the watcher uses (the one that created the entry). */
  readonly profile: TimingProfileName
  /** `null` while suspended for a project switch, or before the first arm. */
  watcher: FSWatcher | null
  /** Closed for a project switch; `resumeSuspended` re-arms it (decision 18). */
  suspended: boolean
  /** The identity it was armed on; `null` when the disk reports none. */
  identity: WatchIdentity | null
  /** The arm in flight: a second request folds into it (F22, F46). */
  arming: Promise<ArmOutcome> | null
  /** Resolves `true` on the watcher's `ready` (G3). */
  ready: Promise<boolean> | null
  /** Keys of the subscriptions attached to it. */
  readonly subs: Set<string>
}

/** What `FileWatcherService.subscribe` is asked. */
export interface SubscribeInput {
  readonly owner: WatchOwner
  /** Minted by the subscriber, fresh per subscribe (plan decision 4). */
  readonly watchId: string
  readonly filePath: string
  readonly profile: TimingProfileName
}

/** An event for the subscriptions of one entry, before the `watchId` is added. */
export type EntryEvent =
  | { readonly kind: 'changed'; readonly forced?: true; readonly stamp?: FileStamp }
  | { readonly kind: 'deleted' | 'restarted' }
  | { readonly kind: 'started'; readonly stamp: FileStamp; readonly liveRefresh: LiveRefresh }
  | { readonly kind: 'ended'; readonly reason: WatchEndReason }
