// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The vocabulary of "follow the file on disk" (#478): the stamp that says
 * which version of a file a tab shows, the one state object every notice reads
 * (plan decision 35), and the ports a tracker talks through (decision 7).
 *
 * Pure types: no Electron, Node, DOM or React import (decision 1). The wire
 * schemas in `src/shared/ipc/file-watch-schema.ts` are checked against these.
 *
 * @module shared/freshness/freshnessTypes
 */
import type { Clock } from '../clock'
import type { TimingProfileName } from './timingProfiles'

export type { Clock }

/**
 * Which version of a file a reader saw (decision 28). `ino` is a decimal
 * string: a Windows file id is 64-bit and would lose digits as a number.
 * `mtimeMs` / `ctimeMs` keep microseconds exactly. `hash` is the SHA-256 (hex)
 * of the bytes when they were hashed (files up to 16 MiB).
 */
export interface FileStamp {
  readonly size: number
  readonly mtimeMs: number
  readonly ctimeMs: number
  readonly ino: string
  readonly hash?: string
}

/** The line ending a text file uses, from its first line break (`none` = no line break). */
export type Eol = 'lf' | 'crlf' | 'none'

/** Whether native events can be trusted for a file (`limited` = network or WSL volume, or a ready timeout). */
export type LiveRefresh = 'full' | 'limited'

/** Why a tab stopped following its file. */
export type WatchStopReason = 'restart-failed' | 'watcher-error' | 'outside-project' | 'unsupported' | 'project-closed'

/** Why a tab cannot show the file's current content. */
export type ContentUnavailableReason =
  | 'too-large'
  | 'binary'
  | 'unsupported-encoding'
  | 'unreadable'
  | 'outside-project'

/** The watch half of the state. */
export type WatchState =
  | { readonly kind: 'active'; readonly live: LiveRefresh }
  | { readonly kind: 'queued' }
  | { readonly kind: 'stopped'; readonly reason: WatchStopReason }

/** How a change the tab has not taken waits: `held` by the rule (edited buffer), `deferred` while hidden. */
export type ChangedMode = 'held' | 'deferred'

/** The content half of the state. */
export type ContentState =
  | { readonly kind: 'fresh' }
  /** `notSaved`: an autosave was given up because of this change (the "Not saved" copy – F16). */
  | { readonly kind: 'changed'; readonly mode: ChangedMode; readonly notSaved?: boolean }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'unavailable'; readonly reason: ContentUnavailableReason }

/** The one state object per tab; every notice and every Reload reads only this (decision 35). */
export interface FreshnessState {
  readonly watch: WatchState
  readonly content: ContentState
}

/** Why main ended a subscription (`file-watch:event` `ended`). */
export type WatchEndReason =
  | 'project-switch'
  | 'project-closed'
  | 'restart-failed'
  | 'watcher-error'
  | 'outside-project'
  | 'unsupported'

/** Why main refused a subscribe. `PAGE_CHANGED` / `PROJECT_CHANGED` are quiet (decision 40). */
export type SubscribeRefusalCode =
  | 'PAGE_CHANGED'
  | 'PROJECT_CHANGED'
  | 'WATCH_FAILED'
  | 'OUTSIDE_PROJECT'
  | 'UNSUPPORTED'
  | 'NOT_FOUND'
  | 'DUPLICATE_ID'

/** What a subscribe asks for. */
export interface SubscribeRequest {
  readonly watchId: string
  readonly filePath: string
  readonly profile: TimingProfileName
}

/** The answer to a subscribe. */
export type SubscribeReply =
  | { readonly status: 'started'; readonly stamp: FileStamp; readonly liveRefresh: LiveRefresh }
  | { readonly status: 'queued' }
  | { readonly status: 'refused'; readonly code: SubscribeRefusalCode }

/**
 * An event for one subscription; it names the subscription, never a path (decision 6).
 * A `changed` marked `forced` did not wait for the writes to settle – the write
 * gate's 5 s cap, or the health round re-arming a file replaced unheard – so the
 * tracker settles before it reads (decision 34, F8). The re-arm after an atomic
 * save is a plain `changed` (a known limit: P3 trade-off, see the file-watching guide).
 * A plain `changed` from the write gate carries `stamp`, the stat-only stamp the
 * writes settled at: the event read that follows must find the file still so,
 * since the event can reach a busy tab after a new writer started (P3).
 */
export type WatchEvent =
  | { readonly watchId: string; readonly kind: 'changed'; readonly forced?: true; readonly stamp?: FileStamp }
  | { readonly watchId: string; readonly kind: 'deleted' | 'restarted' }
  | { readonly watchId: string; readonly kind: 'started'; readonly stamp: FileStamp; readonly liveRefresh: LiveRefresh }
  | { readonly watchId: string; readonly kind: 'ended'; readonly reason: WatchEndReason }

/** The answer to a probe: is the file still the version named? */
export type ProbeReply =
  | { readonly status: 'same' | 'changed'; readonly stamp: FileStamp }
  | { readonly status: 'missing' }
  | { readonly status: 'unreadable' | 'unsupported'; readonly code: string }

/** The answer to a classified text read (decision 31). */
export type TextReadReply =
  | { readonly status: 'ok'; readonly text: string; readonly stamp: FileStamp; readonly eol: Eol }
  | { readonly status: 'too-large'; readonly size: number }
  | {
      readonly status:
        | 'binary'
        | 'unsupported-encoding'
        | 'unsupported'
        | 'missing'
        | 'unreadable'
        | 'busy'
        | 'outside-project'
    }

/** What a checked text write asks for (decision 33). */
export interface WriteTextRequest {
  readonly filePath: string
  readonly content: string
  readonly generation?: number
  readonly createParentDirs?: true
  /** Write only if the file is still this version (autosave only, never in the deleted state – F7). */
  readonly expectedStamp?: FileStamp
}

/**
 * The answer to a checked text write. `changed-on-disk` carries the version
 * found instead, or `null` when the file was gone at the check.
 */
export type WriteTextReply =
  | { readonly status: 'written'; readonly stamp: FileStamp }
  | { readonly status: 'changed-on-disk'; readonly stamp: FileStamp | null }

/** A listener for watch events; returns nothing. */
export type WatchEventListener = (event: WatchEvent) => void

/** A broadcast asking every tracker to check its file (window focus, power resume). */
export type CheckReason = 'shown' | 'focus' | 'resume' | 'save' | 'limited-poll' | 'manual'

/**
 * The port every tracker uses (decision 7): subscriptions, probes, the text
 * read and the event stream. Read-only adapters only ever see this.
 */
export interface FreshnessSource {
  subscribe(request: SubscribeRequest): Promise<SubscribeReply>
  unsubscribe(watchId: string): Promise<void>
  probe(filePath: string, knownHash?: string): Promise<ProbeReply>
  readText(filePath: string): Promise<TextReadReply>
  /** Listen to events of every subscription of this source; returns the unsubscribe. */
  onEvent(listener: WatchEventListener): () => void
}

/** The extra port only the editor's save add-on gets (decision 7). */
export interface PausableSource extends FreshnessSource {
  pause(watchId: string): Promise<void>
  /** Resume; `missed` = a change arrived while paused (or the pause timed out). */
  resumeWatch(watchId: string): Promise<{ readonly missed: boolean }>
  writeText(request: WriteTextRequest): Promise<WriteTextReply>
}

/**
 * The outcome of one read by an adapter's rule. `version` is whatever the tab
 * shows (text, image bytes); `stamp` labels it.
 */
export type ReadOutcome<V> =
  | { readonly status: 'ok'; readonly version: V; readonly stamp: FileStamp }
  | { readonly status: 'missing' }
  | { readonly status: 'busy' }
  | { readonly status: 'failed' }
  | { readonly status: 'blocked'; readonly reason: Exclude<ContentUnavailableReason, 'unreadable'> }

/** What a rule did with a version. */
export type ApplyResult = 'applied' | 'held'

/**
 * The only thing an adapter supplies (decision 41): how to read, whether to
 * read now, how to apply. The core never asks which tab type it serves.
 */
export interface UpdateRule<V> {
  read(): Promise<ReadOutcome<V>>
  /** `false` defers the read while the tab is hidden. */
  readNow(): boolean
  /** Apply a version; `force` = an explicit Reload, which ignores "held". */
  apply(version: V, stamp: FileStamp, force: boolean): ApplyResult
  onState?(state: FreshnessState): void
}
