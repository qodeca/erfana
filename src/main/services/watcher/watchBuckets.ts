// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * watchBuckets - the watch caps and their waitlists (#478, plan decisions 9, 20).
 *
 * A cap is per bucket, in profile data (`WATCH_BUCKETS`): `tabs` 100;
 * `preview` 16 per owner, 64 in all; `dependent` 8 per owner, 32 in all;
 * `comments` 64. A slot is one watched file in one bucket – a second
 * subscription on a file the bucket already counts takes no new slot, so
 * joining an existing watch never fails on the cap (issue #70, D3).
 *
 * A subscribe refused for want of a slot is queued, first in first out, up to
 * `waitlistPerBucket`; when a slot frees, the service arms the first queued
 * subscription that fits (G9). An owner that goes away, or a queued
 * subscription that is unsubscribed, leaves the queue.
 */
import {
  FRESHNESS_LIMITS,
  WATCH_BUCKETS,
  type WatchBucket,
  type WatchBucketName
} from '../../../shared/freshness/timingProfiles'
import type { FileWatchBucketStats } from '../../../shared/ipc/file-watch-schema'
import type { WatchSubscription } from './watchTypes'

const BUCKET_NAMES = Object.keys(WATCH_BUCKETS) as WatchBucketName[]

export class WatchBuckets {
  private readonly caps = new Map<WatchBucketName, WatchBucket>(
    BUCKET_NAMES.map(name => [name, WATCH_BUCKETS[name]])
  )
  private readonly waitlists = new Map<WatchBucketName, string[]>(BUCKET_NAMES.map(name => [name, []]))

  constructor(private readonly waitlistMax: number = FRESHNESS_LIMITS.waitlistPerBucket) {}

  /** A bucket's total cap. */
  totalCap(bucket: WatchBucketName): number {
    return this.caps.get(bucket)?.totalCap ?? 0
  }

  /** Change a bucket's total cap (the e2e watch-limit hook); returns the previous one. */
  setTotalCap(bucket: WatchBucketName, totalCap: number): number {
    const previous = this.totalCap(bucket)
    const cap = this.caps.get(bucket) ?? WATCH_BUCKETS[bucket]
    this.caps.set(bucket, { ...cap, totalCap })
    return previous
  }

  /**
   * May `sub` attach to the file under `entryKey` (or a new one, `null`)?
   * `held` are the subscriptions that hold slots now: attached ones, pending or
   * active.
   */
  hasSlot(sub: WatchSubscription, entryKey: string | null, held: Iterable<WatchSubscription>): boolean {
    const files = new Set<string>()
    const ownerFiles = new Set<string>()
    for (const other of held) {
      if (other === sub || other.bucket !== sub.bucket || other.entryKey === null) continue
      files.add(other.entryKey)
      if (other.ownerKey === sub.ownerKey) ownerFiles.add(other.entryKey)
    }
    if (entryKey !== null && ownerFiles.has(entryKey)) return true
    const cap = this.caps.get(sub.bucket) ?? WATCH_BUCKETS[sub.bucket]
    const newFile = entryKey === null || !files.has(entryKey)
    if (newFile && files.size >= cap.totalCap) return false
    return cap.perOwnerCap === null || ownerFiles.size < cap.perOwnerCap
  }

  /** Queue `sub` for a slot; false when its bucket's queue is full. */
  enqueue(sub: WatchSubscription): boolean {
    const queue = this.queueOf(sub.bucket)
    if (queue.length >= this.waitlistMax) return false
    queue.push(sub.key)
    return true
  }

  /** Take a subscription off its queue (armed, unsubscribed, or its owner went away). */
  remove(sub: WatchSubscription): void {
    const queue = this.queueOf(sub.bucket)
    const at = queue.indexOf(sub.key)
    if (at !== -1) queue.splice(at, 1)
  }

  /** The queued subscription keys of a bucket, first in line first. */
  queued(bucket: WatchBucketName): readonly string[] {
    return [...this.queueOf(bucket)]
  }

  /** Every bucket that has someone waiting. */
  bucketsWithQueue(): WatchBucketName[] {
    return BUCKET_NAMES.filter(name => this.queueOf(name).length > 0)
  }

  /** Per-bucket counts for `file-watch:stats` (plan § 3.3). */
  stats(held: Iterable<WatchSubscription>): Record<WatchBucketName, FileWatchBucketStats> {
    const files = new Map<WatchBucketName, Set<string>>(BUCKET_NAMES.map(name => [name, new Set()]))
    for (const sub of held) {
      if (sub.entryKey !== null) files.get(sub.bucket)?.add(sub.entryKey)
    }
    const result = {} as Record<WatchBucketName, FileWatchBucketStats>
    for (const name of BUCKET_NAMES) {
      result[name] = { active: files.get(name)?.size ?? 0, waiting: this.queueOf(name).length }
    }
    return result
  }

  /** Subscriptions queued in every bucket together. */
  get waitingCount(): number {
    let count = 0
    for (const queue of this.waitlists.values()) count += queue.length
    return count
  }

  private queueOf(bucket: WatchBucketName): string[] {
    let queue = this.waitlists.get(bucket)
    if (!queue) {
      queue = []
      this.waitlists.set(bucket, queue)
    }
    return queue
  }
}
