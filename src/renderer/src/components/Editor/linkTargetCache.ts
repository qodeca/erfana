// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Remembered `file.exists` answers for the preview's link checks (finding [31]).
 *
 * The preview re-resolves its internal links whenever the set of links changes;
 * without this, adding one link to a document with 300 of them asked the main
 * process about all 300 again (1–3 IPC round trips each). With it, only paths
 * not asked about before cross IPC.
 *
 * When answers are forgotten:
 * - All at once, when the file structure may have changed: a directory-watcher
 *   event other than a plain content change (a file or folder added or
 *   removed, or a catch-up refresh), or one of this window's own file
 *   operations ({@link onFileStructureChanged}, since the watcher is paused for
 *   those).
 * - One by one, {@link LINK_TARGET_TTL_MS} after they were asked. A panel that
 *   holds a "missing" answer re-checks when it expires, so a change no event
 *   reported still shows up within about that long.
 *
 * Listeners (the preview) are told to re-check {@link LINK_TARGET_SETTLE_MS}
 * after the last invalidation, at most {@link LINK_TARGET_MAX_WAIT_MS} after
 * the first, so an agent writing many files costs a few re-checks, not one per
 * file. A hidden panel ({@link setVisible}) is not told at all; it re-checks
 * once when shown, if anything happened or expired meanwhile.
 *
 * Remaining limit: a file added or removed where no event reaches this window
 * (a folder the watcher skips – hidden, excluded or git-ignored – another
 * window's file operation inside its own pause, #210) is noticed only by the
 * age limit: within about {@link LINK_TARGET_TTL_MS} for a link shown as
 * missing, and on the next re-check after expiry for one shown as found.
 *
 * One cache per preview panel: it lives as long as the panel and holds only
 * the paths the panel's latest link check asked about ({@link sweep}).
 *
 * @module components/Editor/linkTargetCache
 */

import { fileGateway } from '../../services/fileGateway'
import { onFileStructureChanged } from '../../services/fileStructureSignal'

/** How long (ms) an answer is trusted without a structural event. */
export const LINK_TARGET_TTL_MS = 30_000
/** Quiet period (ms) after the last invalidation before listeners re-check. */
export const LINK_TARGET_SETTLE_MS = 400
/** Longest (ms) a burst of invalidations postpones the re-check. */
export const LINK_TARGET_MAX_WAIT_MS = 2_000

/** The `directory-watch:changed` payload, as the preload declares it. */
type DirectoryChangedPayload = Parameters<
  Parameters<Window['api']['directoryWatch']['onDirectoryChanged']>[0]
>[0]

/**
 * The payload plus `structural`, which the main process may set to say outright
 * whether the batch added or removed anything (read when present).
 */
export type DirectoryChange = Partial<DirectoryChangedPayload> & { structural?: boolean }

/**
 * Whether a directory change can have changed which files exist. An explicit
 * `structural` flag wins; otherwise only a batch of nothing but `change`
 * events (file contents rewritten) cannot, and a payload without a summary is
 * treated as structural, to stay on the safe side.
 */
export function isStructuralChange(change: DirectoryChange): boolean {
  if (typeof change.structural === 'boolean') return change.structural || change.catchUp === true
  if (change.catchUp) return true
  if (!change.summary) return true
  return Object.entries(change.summary).some(([type, count]) => type !== 'change' && count > 0)
}

/**
 * Listen for `directory-watch:changed`. Optional chaining because a test
 * renderer often installs no directory-watch bridge; then nothing is heard.
 */
function onDirectoryChanged(callback: (change: DirectoryChange) => void): () => void {
  return window.api?.directoryWatch?.onDirectoryChanged?.(callback) ?? (() => {})
}

interface Answer {
  value: Promise<boolean>
  /** `Date.now()` when asked */
  askedAt: number
  /** Settled as "missing" – such an answer schedules its own re-check */
  missing: boolean
}

export class LinkTargetCache {
  // Keys are the resolver's absolute paths, compared only with each other –
  // never with watcher paths. Matching them against event paths would need the
  // case-folding helpers in utils/fileUtils (Windows, macOS).
  private readonly answers = new Map<string, Answer>()
  /** Paths asked about since the last {@link sweep} */
  private readonly asked = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private currentGeneration = 0
  private publishedVersion = 0
  private visible = true
  /** Something wants a re-check that a hidden panel has not done yet */
  private pending = false
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private burstStartedAt: number | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private detach: (() => void) | null = null

  /** Bumped on every invalidation, at once; a check started under an older one is stale. */
  get generation(): number {
    return this.currentGeneration
  }

  /**
   * Bumped when listeners are told to re-check (debounced, never while
   * hidden). The snapshot for `useSyncExternalStore`.
   */
  readonly getVersion = (): number => this.publishedVersion

  /**
   * Whether `filePath` exists – remembered, or asked once over IPC. Callers
   * asking for the same path while the first answer is in flight share it. A
   * failed check is not remembered; an expired one is asked again.
   */
  readonly exists = (filePath: string): Promise<boolean> => {
    this.asked.add(filePath)
    const known = this.answers.get(filePath)
    if (known && Date.now() - known.askedAt < LINK_TARGET_TTL_MS) return known.value
    const value = fileGateway.exists({ filePath })
    const entry: Answer = { value, askedAt: Date.now(), missing: false }
    this.answers.set(filePath, entry)
    value.then(
      (found) => {
        if (!found && this.answers.get(filePath) === entry) {
          entry.missing = true
          this.scheduleExpiry()
        }
      },
      () => {
        // Only this entry: a newer one asked after an invalidation stays
        if (this.answers.get(filePath) === entry) this.answers.delete(filePath)
      }
    )
    return value
  }

  /** Forget every answer now; tell the listeners once the burst settles. */
  invalidate(): void {
    this.answers.clear()
    this.currentGeneration += 1
    this.requestRecheck()
  }

  /**
   * Tell the cache whether its panel is on screen. A hidden panel's re-checks
   * wait; on showing, it drops expired answers and re-checks if anything
   * happened or expired while it was hidden.
   */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    if (!visible) return
    if (this.dropExpired()) this.pending = true
    if (this.pending) this.publish()
  }

  /** Forget answers for paths not asked about since the previous sweep, so the cache tracks the current links only. */
  sweep(): void {
    for (const path of this.answers.keys()) {
      if (!this.asked.has(path)) this.answers.delete(path)
    }
    this.asked.clear()
  }

  /** Remembered answers (for tests and measurements). */
  get size(): number {
    return this.answers.size
  }

  /**
   * Listen for re-check requests. The first listener connects the cache to the
   * directory watcher and to this window's own file operations; the last one
   * leaving disconnects it and forgets every answer. Shaped for
   * `useSyncExternalStore`.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (!this.detach) this.attach()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.detach) {
        this.detach()
        this.detach = null
      }
    }
  }

  private attach(): void {
    const offOwn = onFileStructureChanged(() => this.invalidate())
    const offWatcher = onDirectoryChanged((change) => {
      if (isStructuralChange(change)) this.invalidate()
    })
    this.detach = () => {
      offOwn()
      offWatcher()
      this.clearTimers()
      this.answers.clear()
      this.asked.clear()
      this.pending = false
    }
  }

  /** Trailing debounce with a max wait; a hidden panel only notes the request. */
  private requestRecheck(): void {
    this.pending = true
    if (!this.visible) {
      this.clearSettle()
      return
    }
    const now = Date.now()
    this.burstStartedAt ??= now
    if (this.settleTimer) clearTimeout(this.settleTimer)
    const wait = Math.min(LINK_TARGET_SETTLE_MS, this.burstStartedAt + LINK_TARGET_MAX_WAIT_MS - now)
    this.settleTimer = setTimeout(() => this.publish(), Math.max(0, wait))
  }

  private publish(): void {
    this.clearSettle()
    this.pending = false
    this.publishedVersion += 1
    for (const listener of [...this.listeners]) listener()
  }

  /** Drop expired answers; true when any was dropped. */
  private dropExpired(): boolean {
    const now = Date.now()
    let dropped = false
    for (const [path, entry] of this.answers) {
      if (now - entry.askedAt >= LINK_TARGET_TTL_MS) {
        this.answers.delete(path)
        dropped = true
      }
    }
    return dropped
  }

  /** Re-check when the oldest "missing" answer expires. */
  private scheduleExpiry(): void {
    if (this.expiryTimer) return
    let oldest = Infinity
    for (const entry of this.answers.values()) {
      if (entry.missing) oldest = Math.min(oldest, entry.askedAt)
    }
    if (oldest === Infinity) return
    const wait = Math.max(0, oldest + LINK_TARGET_TTL_MS - Date.now())
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null
      if (this.dropExpired()) this.requestRecheck()
      this.scheduleExpiry()
    }, wait)
  }

  private clearSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = null
    this.burstStartedAt = null
  }

  private clearTimers(): void {
    this.clearSettle()
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = null
  }
}
