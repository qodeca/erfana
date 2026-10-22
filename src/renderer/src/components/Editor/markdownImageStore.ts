// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The images one Markdown preview shows, read through the main process (#71).
 *
 * A project-relative image cannot be loaded by the page itself (its base is the
 * app bundle), so each one is read over `markdown-image:read` – confined to the
 * project main-side – and shown as a `data:` URL. This store holds those URLs
 * for one preview panel, keyed by the document-relative path as written.
 *
 * Refresh, without a watch of its own:
 * - It listens to the signals the link checks already use
 *   (`linkTargetCache.ts`): every `directory-watch:changed` batch – content
 *   edits included, since an image rewritten in place is exactly the case –
 *   and this window's own file operations (`fileStructureSignal.ts`). No file
 *   watch is added per image, so the per-file watcher budget is untouched.
 * - A burst of events is settled ({@link MARKDOWN_IMAGE_SETTLE_MS}, at most
 *   {@link MARKDOWN_IMAGE_MAX_WAIT_MS}), then every image on screen is asked
 *   again WITH the version it shows. The main process answers `unchanged`
 *   after a `stat`, so only images whose bytes changed are read, encoded and
 *   sent again. The batch carries no paths, which is why the check is per
 *   image rather than per event.
 * - A hidden preview does nothing; it catches up once when shown
 *   ({@link MarkdownImageStore.setVisible}).
 *
 * Bounds: at most {@link MAX_MARKDOWN_IMAGES_PER_DOCUMENT} distinct images per
 * preview (the rest show their alt text), at most
 * {@link MARKDOWN_IMAGE_MAX_CONCURRENT_READS} reads in flight, and the main
 * process's 50 MB cap per image.
 *
 * New bytes are decoded off the DOM before they replace what is shown, so a
 * half-written file keeps the last good image instead of a broken one.
 *
 * @module components/Editor/markdownImageStore
 */

import {
  MAX_MARKDOWN_IMAGES_PER_DOCUMENT,
  isMarkdownImagePath,
  type MarkdownImageReadRequest,
  type MarkdownImageReadResponse,
  type MarkdownImageRefusal
} from '../../../../shared/ipc/markdown-image-schema'
import { onFileStructureChanged } from '../../services/fileStructureSignal'
import { fileGateway } from '../../services/fileGateway'
import { resolveDocumentRelativePath } from '../../utils/markdownLinkResolver'
import { getRendererPlatform } from '../../utils/platform'
import { logger } from '../../utils/logger'

/** Quiet period (ms) after the last change event before images are re-checked. */
export const MARKDOWN_IMAGE_SETTLE_MS = 300
/** Longest (ms) a burst of change events postpones the re-check. */
export const MARKDOWN_IMAGE_MAX_WAIT_MS = 2_000
/** Image reads one preview keeps in flight at once. */
export const MARKDOWN_IMAGE_MAX_CONCURRENT_READS = 4
/** How long (ms) an image no element shows is kept, so a re-render does not re-read it. */
export const MARKDOWN_IMAGE_RELEASE_GRACE_MS = 2_000

/** Why an image is shown as its alt text instead. */
export type MarkdownImageUnavailableReason =
  | MarkdownImageRefusal
  /** Past {@link MAX_MARKDOWN_IMAGES_PER_DOCUMENT} */
  | 'limit'
  /** The bytes arrived but could not be decoded as an image */
  | 'undecodable'

/** What an image element shows. Objects are replaced, never mutated (`useSyncExternalStore`). */
export type MarkdownImageView =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'unavailable'; reason: MarkdownImageUnavailableReason }

/** Shown for a key nobody has asked about yet. */
export const LOADING_VIEW: MarkdownImageView = Object.freeze({ status: 'loading' })

/** Collaborators, injectable for tests. */
export interface MarkdownImageStoreDeps {
  read: (request: MarkdownImageReadRequest) => Promise<MarkdownImageReadResponse>
  getProjectPath: () => Promise<string | null>
  /** Resolves once `url` decodes as an image; rejects when it does not */
  decode: (url: string) => Promise<void>
  onDirectoryChanged: (callback: () => void) => () => void
  onFileStructureChanged: (callback: () => void) => () => void
  platform: () => NodeJS.Platform
}

/** Decode off the DOM where the engine can; jsdom cannot, and is trusted. */
async function decodeImage(url: string): Promise<void> {
  const image = new Image()
  image.src = url
  if (typeof image.decode === 'function') await image.decode()
}

const defaultDeps: MarkdownImageStoreDeps = {
  // Optional chaining: a test renderer often installs no bridge; then nothing loads.
  read: (request) =>
    window.api?.markdownImage?.read(request) ??
    Promise.resolve({ status: 'refused', reason: 'unreadable' }),
  getProjectPath: () => fileGateway.getProjectPath(),
  decode: decodeImage,
  onDirectoryChanged: (callback) =>
    window.api?.directoryWatch?.onDirectoryChanged?.(() => callback()) ?? (() => {}),
  onFileStructureChanged,
  platform: getRendererPlatform
}

interface Entry {
  /** The document-relative path, as classified */
  readonly key: string
  view: MarkdownImageView
  /** Version of the bytes in a `ready` view, echoed back on the next read */
  version?: string
  /** Elements showing this image */
  refs: number
  readonly listeners: Set<() => void>
  /** Bumped per load; an answer for an older load is dropped */
  token: number
  releaseTimer: ReturnType<typeof setTimeout> | null
}

export class MarkdownImageStore {
  private readonly deps: MarkdownImageStoreDeps
  private readonly entries = new Map<string, Entry>()
  private documentPath: string | undefined
  /** Bumped when the document changes; every load started before is stale */
  private generation = 0
  private projectRoot: Promise<string | null> | null = null
  private visible = true
  /** A re-check is owed (requested while hidden, or not yet settled) */
  private pending = false
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private burstStartedAt: number | null = null
  private detach: (() => void) | null = null
  private subscribers = 0
  private inFlight = 0
  private readonly queue: Array<() => void> = []

  constructor(deps: Partial<MarkdownImageStoreDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps }
  }

  /** The view for `key` (a document-relative path as classified). */
  readonly getView = (key: string): MarkdownImageView => this.entries.get(key)?.view ?? LOADING_VIEW

  /** Number of images held (for tests and measurements). */
  get size(): number {
    return this.entries.size
  }

  /**
   * Point the store at a document. A different path forgets every image and
   * reads the ones on screen again, relative to the new document.
   */
  setDocument(documentPath: string | undefined): void {
    if (documentPath === this.documentPath) return
    this.documentPath = documentPath
    this.generation += 1
    this.projectRoot = null
    for (const entry of this.entries.values()) {
      entry.version = undefined
      if (entry.refs > 0) this.load(entry)
    }
  }

  /**
   * Whether the preview is on screen. While hidden nothing is read; on
   * showing, an owed re-check runs once.
   */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    if (visible && this.pending) this.refresh()
  }

  /**
   * Show `key` in one more element; the first one starts its read. Shaped for
   * `useSyncExternalStore` with a per-key subscribe.
   */
  subscribe(key: string, listener: () => void): () => void {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { key, view: LOADING_VIEW, refs: 0, listeners: new Set(), token: 0, releaseTimer: null }
      this.entries.set(key, entry)
      if (this.liveCount() >= MAX_MARKDOWN_IMAGES_PER_DOCUMENT) {
        entry.view = { status: 'unavailable', reason: 'limit' }
      } else {
        this.load(entry)
      }
    }
    const held = entry
    if (held.releaseTimer) {
      clearTimeout(held.releaseTimer)
      held.releaseTimer = null
    }
    held.refs += 1
    held.listeners.add(listener)
    this.subscribers += 1
    if (!this.detach) this.attach()

    let active = true
    return () => {
      if (!active) return
      active = false
      held.refs -= 1
      held.listeners.delete(listener)
      this.subscribers -= 1
      if (held.refs === 0) this.scheduleRelease(key, held)
      if (this.subscribers === 0 && this.detach) {
        this.detach()
        this.detach = null
      }
    }
  }

  /** Re-check every image on screen now (debounce and visibility bypassed). */
  refresh(): void {
    this.clearSettle()
    this.pending = false
    for (const entry of this.entries.values()) {
      if (entry.refs > 0 && !this.isOverLimit(entry)) this.load(entry)
    }
  }

  /** A change event: settle the burst, then re-check – or owe it while hidden. */
  requestRefresh(): void {
    this.pending = true
    if (!this.visible) {
      this.clearSettle()
      return
    }
    const now = Date.now()
    this.burstStartedAt ??= now
    if (this.settleTimer) clearTimeout(this.settleTimer)
    const wait = Math.min(MARKDOWN_IMAGE_SETTLE_MS, this.burstStartedAt + MARKDOWN_IMAGE_MAX_WAIT_MS - now)
    this.settleTimer = setTimeout(() => this.refresh(), Math.max(0, wait))
  }

  private attach(): void {
    const offWatcher = this.deps.onDirectoryChanged(() => this.requestRefresh())
    const offOwn = this.deps.onFileStructureChanged(() => this.requestRefresh())
    this.detach = () => {
      offWatcher()
      offOwn()
      this.clearSettle()
      this.pending = false
    }
  }

  private isOverLimit(entry: Entry): boolean {
    return entry.view.status === 'unavailable' && entry.view.reason === 'limit'
  }

  /** Images that count against the per-document cap: shown, and not over it. */
  private liveCount(): number {
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.refs > 0 && !this.isOverLimit(entry)) count += 1
    }
    return count
  }

  private scheduleRelease(key: string, entry: Entry): void {
    if (this.isOverLimit(entry)) {
      this.entries.delete(key)
      return
    }
    entry.releaseTimer = setTimeout(() => {
      entry.releaseTimer = null
      if (entry.refs === 0 && this.entries.get(key) === entry) this.entries.delete(key)
    }, MARKDOWN_IMAGE_RELEASE_GRACE_MS)
  }

  private setView(entry: Entry, view: MarkdownImageView, version?: string): void {
    entry.version = view.status === 'ready' ? version : undefined
    const current = entry.view
    // The same refusal again is no change: nothing re-renders for it
    if (
      current === view ||
      (current.status === 'unavailable' && view.status === 'unavailable' && current.reason === view.reason)
    ) {
      return
    }
    entry.view = view
    for (const listener of [...entry.listeners]) listener()
  }

  private getProjectRoot(): Promise<string | null> {
    this.projectRoot ??= this.deps.getProjectPath().catch(() => null)
    return this.projectRoot
  }

  /** Run `task` when a read slot is free. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        this.inFlight += 1
        task()
          .then(resolve, reject)
          .finally(() => {
            this.inFlight -= 1
            this.queue.shift()?.()
          })
      }
      if (this.inFlight < MARKDOWN_IMAGE_MAX_CONCURRENT_READS) run()
      else this.queue.push(run)
    })
  }

  /** Read (or re-check) one image and publish what it should show. */
  private load(entry: Entry): void {
    const { key } = entry
    if (!this.visible) {
      // Read once shown: a hidden preview costs no main-process encode
      this.pending = true
      return
    }
    const token = ++entry.token
    const generation = this.generation
    const documentPath = this.documentPath
    const isStale = (): boolean =>
      entry.token !== token || this.generation !== generation || this.entries.get(key) !== entry

    void (async () => {
      const root = await this.getProjectRoot()
      if (isStale()) return
      const filePath =
        documentPath && root
          ? resolveDocumentRelativePath(key, documentPath, root, this.deps.platform())
          : null
      if (!filePath) {
        this.setView(entry, { status: 'unavailable', reason: 'outside-project' })
        return
      }
      if (!isMarkdownImagePath(filePath)) {
        this.setView(entry, { status: 'unavailable', reason: 'unsupported-type' })
        return
      }

      const shown = entry.view.status === 'ready'
      let response: MarkdownImageReadResponse
      try {
        response = await this.enqueue(() =>
          this.deps.read({ filePath, knownVersion: shown ? entry.version : undefined })
        )
      } catch (error) {
        if (isStale()) return
        logger.warn('Markdown image read failed', { error: String(error) })
        // A transport failure keeps the last good image rather than blanking it
        if (!shown) this.setView(entry, { status: 'unavailable', reason: 'unreadable' })
        return
      }
      if (isStale()) return

      if (response.status === 'unchanged') return
      if (response.status === 'refused') {
        this.setView(entry, { status: 'unavailable', reason: response.reason })
        return
      }
      try {
        await this.deps.decode(response.dataUrl)
      } catch {
        if (isStale()) return
        // Half-written or corrupt: keep what is shown; the next change re-checks
        if (!shown) this.setView(entry, { status: 'unavailable', reason: 'undecodable' })
        return
      }
      if (isStale()) return
      this.setView(entry, { status: 'ready', url: response.dataUrl }, response.version)
    })()
  }

  private clearSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = null
    this.burstStartedAt = null
  }
}
