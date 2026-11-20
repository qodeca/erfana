// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The one timing source for "follow the file on disk" (#478, plan decision 49).
 *
 * Every number the freshness capability waits on lives here, per consumer
 * profile: how long a write must hold still before it counts as finished, how
 * often a burst may reach the tab, how a failed read is retried, how a delete
 * is confirmed, and which watch bucket (cap) the profile draws from. The IPC
 * profile enum is built from {@link TIMING_PROFILES}' keys, so a profile cannot
 * exist on the wire without its timings.
 *
 * Pure data: no Electron, Node, DOM or React import (plan decision 1), so the
 * renderer, main and the fake-clock tests read the same values.
 *
 * @module shared/freshness/timingProfiles
 */

/** A watch bucket: a cap on watches drawn by one kind of consumer (plan decision 9). */
export interface WatchBucket {
  /** Watches allowed for one owner (a preview view, an owner group); `null` = no per-owner cap. */
  readonly perOwnerCap: number | null
  /** Watches allowed in the bucket across every owner. */
  readonly totalCap: number
}

/** The watch buckets. Main counts them from the profile it resolves, never from a renderer-sent number. */
export const WATCH_BUCKETS = {
  /** Editor and image tabs, every window together. */
  tabs: { perOwnerCap: null, totalCap: 100 },
  /** HTML preview page files and their sub-files (CSS, JS, images). */
  preview: { perOwnerCap: 16, totalCap: 64 },
  /** Files a tab depends on (Markdown preview images): per owner group, and app-wide. */
  dependent: { perOwnerCap: 8, totalCap: 32 },
  /** Documents whose comments a drawer shows. */
  comments: { perOwnerCap: null, totalCap: 64 },
} as const satisfies Record<string, WatchBucket>

/** A bucket name. */
export type WatchBucketName = keyof typeof WATCH_BUCKETS

/** The deleted-state probe: first ask, then back off to the slower interval. */
export interface DeletedProbeTiming {
  readonly firstMs: number
  readonly maxMs: number
}

/** The deleted-file probe every tab type shares: 500 ms, backing off to 2 s (plan decision 39). */
export const DELETED_PROBE_BACKOFF: DeletedProbeTiming = { firstMs: 500, maxMs: 2_000 }

/** The retry delays after a failed read, in order: three retries, each longer (L2, plan decision 36). */
export const READ_RETRY_DELAYS_MS: readonly number[] = [100, 300, 900]

/** The timings of one consumer profile (§ 3.4 of the plan). */
export interface TimingProfile {
  /** Write-finish gate: the file must keep one size this long (ms). */
  readonly settleMs: number
  /** Write-finish gate: how often the size is polled (ms). */
  readonly pollMs: number
  /**
   * Write-finish gate cap: past it a still-changing file emits a forced change (never a forced read).
   * Also the longest a tracker read waits for a file to hold still; past it that attempt fails.
   */
  readonly gateCapMs: number
  /** Tracker throttle, leading + trailing (ms); 0 = pass-through. */
  readonly throttleMs: number
  /** The preview pool's change coalesce before a reload (ms); 0 = none (only the preview uses it). */
  readonly poolCoalesceMs: number
  /** Delays before each read retry. */
  readonly readRetryDelaysMs: readonly number[]
  /** How long a missing file must stay missing before the tab shows it deleted; `null` = not applicable. */
  readonly deleteConfirmMs: number | null
  /** The deleted-state probe; `null` = not applicable. */
  readonly deletedProbe: DeletedProbeTiming | null
  /** Safety-net poll while a `limited` tab is visible (ms); `null` = not applicable. */
  readonly limitedPollMs: number | null
  /** Longest a save may pause its subscription before it resumes by itself (ms); `null` = never pauses. */
  readonly pauseMaxMs: number | null
  /** The bucket this profile draws its watches from. */
  readonly bucket: WatchBucketName
}

/** The profiles, one per consumer kind. */
export const TIMING_PROFILES = {
  editor: {
    settleMs: 75,
    pollMs: 25,
    gateCapMs: 5_000,
    throttleMs: 250,
    poolCoalesceMs: 0,
    readRetryDelaysMs: READ_RETRY_DELAYS_MS,
    deleteConfirmMs: 500,
    deletedProbe: DELETED_PROBE_BACKOFF,
    limitedPollMs: 2_000,
    pauseMaxMs: 10_000,
    bucket: 'tabs',
  },
  image: {
    settleMs: 75,
    pollMs: 25,
    gateCapMs: 5_000,
    throttleMs: 250,
    poolCoalesceMs: 0,
    readRetryDelaysMs: READ_RETRY_DELAYS_MS,
    deleteConfirmMs: 500,
    deletedProbe: DELETED_PROBE_BACKOFF,
    limitedPollMs: 2_000,
    pauseMaxMs: null,
    bucket: 'tabs',
  },
  preview: {
    // The preview gate keeps today's 50 / 25 ms; its 30 ms pool coalesce is its only burst control (F21).
    settleMs: 50,
    pollMs: 25,
    gateCapMs: 5_000,
    throttleMs: 0,
    poolCoalesceMs: 30,
    readRetryDelaysMs: READ_RETRY_DELAYS_MS,
    deleteConfirmMs: 500,
    deletedProbe: DELETED_PROBE_BACKOFF,
    limitedPollMs: 2_000,
    pauseMaxMs: null,
    bucket: 'preview',
  },
  dependent: {
    settleMs: 75,
    pollMs: 25,
    gateCapMs: 5_000,
    throttleMs: 250,
    poolCoalesceMs: 0,
    readRetryDelaysMs: READ_RETRY_DELAYS_MS,
    deleteConfirmMs: null,
    deletedProbe: null,
    limitedPollMs: null,
    pauseMaxMs: null,
    bucket: 'dependent',
  },
  comments: {
    settleMs: 75,
    pollMs: 25,
    gateCapMs: 5_000,
    throttleMs: 250,
    poolCoalesceMs: 0,
    readRetryDelaysMs: READ_RETRY_DELAYS_MS,
    deleteConfirmMs: 500,
    deletedProbe: DELETED_PROBE_BACKOFF,
    limitedPollMs: null,
    pauseMaxMs: null,
    bucket: 'comments',
  },
} as const satisfies Record<string, TimingProfile>

/** A profile name – the wire value of `file-watch:subscribe`'s `profile`. */
export type TimingProfileName = keyof typeof TIMING_PROFILES

/** The profile names, in declaration order (the source of the IPC enum). */
export const TIMING_PROFILE_NAMES = Object.keys(TIMING_PROFILES) as [TimingProfileName, ...TimingProfileName[]]

/** Limits that do not vary by profile. */
export const FRESHNESS_LIMITS = {
  /** How long an unlink waits for the file to come back before it counts as a delete (ms). */
  atomicSaveWindowMs: 100,
  /** Subscriptions queued per bucket while it is full. */
  waitlistPerBucket: 200,
  /** Files above this size are compared by stat only, never hashed (bytes). */
  hashMaxBytes: 16 * 1024 * 1024,
  /** Entries in the content-hash cache. */
  hashCacheEntries: 256,
  /** Largest text an editor tab shows, on open and on refresh (bytes; owner decision Q2). */
  editorTextMaxBytes: 10 * 1024 * 1024,
  /** How long a subscribe waits for the native watcher to be ready before it answers `limited` (ms). */
  readyTimeoutMs: 2_000,
  /** Interval of the watch health round (ms). */
  healthRoundMs: 2_000,
  /** Budget for one safety-net check (ms). */
  safetyNetBudgetMs: 200,
  /** Budget for catching up after a power resume (ms). */
  resumeBudgetMs: 2_000,
} as const
