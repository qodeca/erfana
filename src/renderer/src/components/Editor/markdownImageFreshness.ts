// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Live follow of the images one Markdown preview shows (#478 plan S18, C3,
 * decision 47): the files a tab depends on, as opposed to its own file.
 *
 * While the preview is visible, up to {@link MARKDOWN_IMAGE_FOLLOW_MAX} image
 * files per document each get a freshness tracker on the window's source
 * (`dependent` profile, so main counts them in the `dependent` bucket: 8 per
 * window, 32 app-wide). A change is read at once – the bytes the tracker read
 * are handed to the store ({@link MarkdownImageFreshnessHost.refreshFile}), so
 * a write costs one read, not two. A hidden preview follows nothing: its
 * subscriptions are given back, and on show each file is followed again from
 * the version it showed, so the new subscription's catch-up reads a change
 * made meanwhile (G3). Past the cap, or while a subscription waits for a slot,
 * the store's directory-signal refresh stays the fallback, and a window focus
 * or a power resume checks every followed file (S1, G8).
 *
 * The adapter supplies only the update rule (decision 41); it never pauses or
 * writes (decision 7).
 *
 * @module components/Editor/markdownImageFreshness
 */
import type { Clock } from '../../../../shared/clock'
import type { Checkable } from '../../../../shared/freshness/freshnessRegistry'
import { FreshnessTracker } from '../../../../shared/freshness/FreshnessTracker'
import type {
  CheckReason,
  FileStamp,
  FreshnessSource,
  FreshnessState,
  ReadOutcome
} from '../../../../shared/freshness/freshnessTypes'
import { WATCH_BUCKETS } from '../../../../shared/freshness/timingProfiles'
import type { MarkdownImageReadResponse } from '../../../../shared/ipc/markdown-image-schema'
import { freshnessEnvironment, registerTracker } from '../../services/freshness/windowFreshness'

/** Image files one preview follows live: the `dependent` bucket's per-owner cap. */
export const MARKDOWN_IMAGE_FOLLOW_MAX = WATCH_BUCKETS.dependent.perOwnerCap ?? 8

/** A read that brought bytes. */
export type MarkdownImageBytes = Extract<MarkdownImageReadResponse, { status: 'ok' }>

/** One image file the store shows, with the stamp of the bytes it shows. */
export interface FollowedImage {
  readonly key: string
  readonly filePath: string
  readonly stamp: FileStamp
}

/** What the adapter needs from the store. */
export interface MarkdownImageFreshnessHost {
  /** Read the file in full (no known version). */
  read(filePath: string): Promise<MarkdownImageReadResponse>
  /** Show bytes the tracker already read. */
  refreshFile(key: string, bytes: MarkdownImageBytes): void
  /** The tracker found the file gone: let the store re-check it (and show it unavailable). */
  recheckFile(key: string): void
}

/** The adapter as the store sees it. */
export interface MarkdownImageFollower {
  /** Follow exactly these files (the first {@link MARKDOWN_IMAGE_FOLLOW_MAX}); an empty list follows nothing. */
  sync(files: readonly FollowedImage[]): void
  /** Ask every followed file to check (the store's directory signal). */
  checkAll(reason: CheckReason): void
  dispose(): void
}

/** Where trackers come from; the window's freshness environment by default. */
export interface MarkdownImageFreshnessEnv {
  readonly source: FreshnessSource
  readonly clock: Clock
  readonly newId: () => string
  readonly register: (member: Checkable) => () => void
}

function windowEnv(): MarkdownImageFreshnessEnv {
  const env = freshnessEnvironment()
  return { source: env.source, clock: env.clock, newId: env.newId, register: registerTracker }
}

/**
 * A stamp from the version token, for an answer from a main process that sent
 * none: equal tokens are equal stamps, which is all a check compares.
 */
function stampOfVersion(version: string): FileStamp {
  return { size: -1, mtimeMs: 0, ctimeMs: 0, ino: version }
}

/** A read answer as the tracker's outcome. */
export function readOutcomeOf(response: MarkdownImageReadResponse): ReadOutcome<MarkdownImageBytes> {
  if (response.status === 'ok') {
    return { status: 'ok', version: response, stamp: response.stamp ?? stampOfVersion(response.version) }
  }
  if (response.status === 'unchanged') return { status: 'failed' }
  if (response.reason === 'not-found') return { status: 'missing' }
  if (response.reason === 'too-large') return { status: 'blocked', reason: 'too-large' }
  return { status: 'failed' }
}

interface Followed {
  readonly filePath: string
  readonly tracker: FreshnessTracker<MarkdownImageBytes>
  readonly unregister: () => void
}

export class MarkdownImageFreshness implements MarkdownImageFollower {
  private readonly followed = new Map<string, Followed>()
  private env: MarkdownImageFreshnessEnv | null

  /** `env` defaults to the window's freshness environment, read at the first follow. */
  constructor(
    private readonly host: MarkdownImageFreshnessHost,
    env?: MarkdownImageFreshnessEnv
  ) {
    this.env = env ?? null
  }

  /** Files followed now. */
  get size(): number {
    return this.followed.size
  }

  /** The state of a followed file (tests, diagnostics). */
  stateOf(key: string): FreshnessState | undefined {
    return this.followed.get(key)?.tracker.getState()
  }

  /** Read a followed file again with a new subscription (a Reload). */
  async reload(key: string): Promise<void> {
    await this.followed.get(key)?.tracker.reload()
  }

  sync(files: readonly FollowedImage[]): void {
    const wanted = new Map(files.slice(0, MARKDOWN_IMAGE_FOLLOW_MAX).map((file) => [file.key, file]))
    for (const [key, entry] of this.followed) {
      const file = wanted.get(key)
      // A watch that stopped for good is tried again with each new version the store shows
      if (!file || file.filePath !== entry.filePath || entry.tracker.getState().watch.kind === 'stopped') {
        this.stop(key, entry)
      }
    }
    for (const file of wanted.values()) {
      if (!this.followed.has(file.key)) this.follow(file)
    }
  }

  checkAll(reason: CheckReason): void {
    for (const { tracker } of this.followed.values()) tracker.check(reason)
  }

  dispose(): void {
    for (const [key, entry] of this.followed) this.stop(key, entry)
  }

  private follow(file: FollowedImage): void {
    this.env ??= windowEnv()
    const { key, filePath } = file
    let previous: FreshnessState['content']['kind'] = 'fresh'
    const tracker = new FreshnessTracker<MarkdownImageBytes>({
      filePath,
      profile: 'dependent',
      source: this.env.source,
      clock: this.env.clock,
      newId: this.env.newId,
      rule: {
        read: async () => readOutcomeOf(await this.host.read(filePath)),
        readNow: () => true,
        apply: (bytes) => {
          this.host.refreshFile(key, bytes)
          return 'applied'
        },
        onState: (state) => {
          if (state.content.kind === 'deleted' && previous !== 'deleted') this.host.recheckFile(key)
          previous = state.content.kind
        }
      }
    })
    this.followed.set(key, { filePath, tracker, unregister: this.env.register(tracker) })
    void tracker.begin(file.stamp)
  }

  private stop(key: string, entry: Followed): void {
    this.followed.delete(key)
    entry.unregister()
    entry.tracker.dispose()
  }
}
