// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The images one Markdown preview shows, read through the main process (#71).
 *
 * A project-relative image cannot be loaded by the page itself (its base is the
 * app bundle), so each one is read over `markdown-image:read` – confined to the
 * project main-side – and shown as a `data:` URL. This store holds those URLs
 * for one preview panel.
 *
 * Two levels of key:
 * - a **spelling** is a `src` as written (`./a.png`, `a.png`, `./x/../a.png`);
 *   image elements subscribe by spelling;
 * - a **file** is the project path a spelling resolves to, case-folded where
 *   the file system usually is case-insensitive (macOS, Windows). Every
 *   spelling of one file shares one read, one `data:` URL and one slot of
 *   {@link MAX_MARKDOWN_IMAGES_PER_DOCUMENT}.
 *
 * Refresh, without a watch of its own:
 * - It listens to the signals the link checks already use
 *   (`linkTargetCache.ts`): every `directory-watch:changed` batch – content
 *   edits included, since an image rewritten in place is exactly the case –
 *   and this window's own file operations (`fileStructureSignal.ts`). No file
 *   watch is added per image, so the per-file watcher budget is untouched.
 * - A burst of events is settled ({@link MARKDOWN_IMAGE_SETTLE_MS}, at most
 *   {@link MARKDOWN_IMAGE_MAX_WAIT_MS}), then every file is asked again WITH
 *   the version of the last bytes received for it – also when those bytes did
 *   not decode. The main process answers `unchanged` after an `fstat`, so only
 *   files whose bytes changed are read, encoded and sent again.
 * - A hidden preview does nothing; it catches up once when shown
 *   ({@link MarkdownImageStore.setVisible}).
 *
 * Bounds: {@link MAX_MARKDOWN_IMAGES_PER_DOCUMENT} files per preview; at most
 * {@link MARKDOWN_IMAGE_MAX_CONCURRENT_READS} reads in flight and at most one
 * waiting per file; and a byte budget for the `data:` URLs shared by every
 * preview in the window, hidden ones included ({@link ImageByteBudget},
 * {@link MARKDOWN_IMAGE_BYTE_BUDGET}). A file that does not fit keeps its
 * version, so a re-check is one `fstat`; it is read in full again only when
 * the budget announces a release that makes room for it.
 *
 * New bytes are decoded off the DOM before they replace what is shown, so a
 * half-written file keeps the last good image instead of a broken one. A
 * shown image whose re-read fails for a passing reason (locked by another
 * program, unreadable for a moment, not decodable yet) also stays, and is
 * re-tried with a bounded back-off ({@link MARKDOWN_IMAGE_RETRY_FIRST_MS},
 * doubling, for at most {@link MARKDOWN_IMAGE_RETRY_WINDOW_MS}) or at the next
 * change event. Only a first load shows the placeholder; a file that is gone
 * or moved out of the project is still removed.
 *
 * @module components/Editor/markdownImageStore
 */

import {
  MARKDOWN_IMAGE_BYTE_BUDGET,
  MAX_MARKDOWN_IMAGES_PER_DOCUMENT,
  isMarkdownImagePath,
  type MarkdownImageReadRequest,
  type MarkdownImageReadResponse,
  type MarkdownImageRefusal
} from '../../../../shared/ipc/markdown-image-schema'
import { onFileStructureChanged } from '../../services/fileStructureSignal'
import { fileGateway } from '../../services/fileGateway'
import { directoryWatchGateway } from '../../services/directoryWatchGateway'
import { hasBridge, hasBridgeMethod } from '../../services/bridgePresence'
import { markdownImageGateway } from '../../services/markdownImageGateway'
import { resolveDocumentRelativePath } from '../../utils/markdownLinkResolver'
import { getRendererPlatform } from '../../utils/platform'
import { logger } from '../../utils/logger'

/** Quiet period (ms) after the last change event before images are re-checked. */
export const MARKDOWN_IMAGE_SETTLE_MS = 300
/** Longest (ms) a burst of change events postpones the re-check. */
export const MARKDOWN_IMAGE_MAX_WAIT_MS = 2_000
/** Image reads one preview keeps in flight at once. */
export const MARKDOWN_IMAGE_MAX_CONCURRENT_READS = 4
/** First wait (ms) before re-trying a shown image whose re-read failed; doubles each time. */
export const MARKDOWN_IMAGE_RETRY_FIRST_MS = 1_000
/** Re-tries of one failure stop once they would run past this (ms) from the first. */
export const MARKDOWN_IMAGE_RETRY_WINDOW_MS = 30_000
/** How long (ms) an image no element shows is kept, so a re-render does not re-read it. */
export const MARKDOWN_IMAGE_RELEASE_GRACE_MS = 2_000

/** Why an image is shown as its alt text instead. */
export type MarkdownImageUnavailableReason =
  | MarkdownImageRefusal
  /** Past {@link MAX_MARKDOWN_IMAGES_PER_DOCUMENT} */
  | 'limit'
  /** The window's previews already hold {@link MARKDOWN_IMAGE_BYTE_BUDGET} of images */
  | 'budget'
  /** The bytes arrived but could not be decoded as an image */
  | 'undecodable'

/** What an image element shows. Objects are replaced, never mutated (`useSyncExternalStore`). */
export type MarkdownImageView =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'unavailable'; reason: MarkdownImageUnavailableReason }

/** Shown for a spelling nobody has asked about yet, or not resolved yet. */
export const LOADING_VIEW: MarkdownImageView = Object.freeze({ status: 'loading' })

/**
 * `data:` URL characters held by every preview of a window. Counting the URL
 * length rather than the file size is deliberate: the URL is what is held.
 */
export class ImageByteBudget {
  private used = 0
  private readonly releaseListeners = new Set<() => void>()

  constructor(private readonly limit: number) {}

  /** Characters held now (for tests and measurements). */
  get held(): number {
    return this.used
  }

  /** Characters still free. */
  get remaining(): number {
    return this.limit - this.used
  }

  /**
   * Hear about every release, so an image waiting for room can be read once
   * there is some – rather than on every refresh.
   *
   * @returns The function that stops listening
   */
  onRelease(listener: () => void): () => void {
    this.releaseListeners.add(listener)
    return () => {
      this.releaseListeners.delete(listener)
    }
  }

  /** Take `amount` if it fits; false (and nothing taken) when it does not. */
  reserve(amount: number): boolean {
    if (amount <= 0) return true
    if (this.used + amount > this.limit) return false
    this.used += amount
    return true
  }

  /** Give back what {@link reserve} took. */
  release(amount: number): void {
    if (amount <= 0) return
    this.used = Math.max(0, this.used - amount)
    for (const listener of [...this.releaseListeners]) listener()
  }
}

/** One budget per window: every preview panel, hidden ones included, draws from it. */
export const sharedImageByteBudget = new ImageByteBudget(MARKDOWN_IMAGE_BYTE_BUDGET)

/** Collaborators, injectable for tests. */
export interface MarkdownImageStoreDeps {
  read: (request: MarkdownImageReadRequest) => Promise<MarkdownImageReadResponse>
  getProjectPath: () => Promise<string | null>
  /** Resolves once `url` decodes as an image; rejects when it does not */
  decode: (url: string) => Promise<void>
  onDirectoryChanged: (callback: () => void) => () => void
  onFileStructureChanged: (callback: () => void) => () => void
  platform: () => NodeJS.Platform
  budget: ImageByteBudget
}

/** Decode off the DOM where the engine can; jsdom cannot, and is trusted. */
async function decodeImage(url: string): Promise<void> {
  const image = new Image()
  image.src = url
  if (typeof image.decode === 'function') await image.decode()
}

const defaultDeps: MarkdownImageStoreDeps = {
  // A test renderer often installs no bridge (or a mock that answers nothing); then nothing loads.
  read: (request) =>
    (hasBridge('markdownImage') ? markdownImageGateway.read(request) : undefined) ??
    Promise.resolve({ status: 'refused', reason: 'unreadable' }),
  getProjectPath: () => fileGateway.getProjectPath(),
  decode: decodeImage,
  // Likewise: without a directory-watch bridge (or an unsubscribe from its mock), nothing is heard.
  onDirectoryChanged: (callback) =>
    (hasBridgeMethod('directoryWatch', 'onDirectoryChanged')
      ? directoryWatchGateway.onDirectoryChanged(() => callback())
      : undefined) ?? (() => {}),
  onFileStructureChanged,
  platform: getRendererPlatform,
  budget: sharedImageByteBudget
}

/**
 * The key one file is held under. macOS and Windows volumes are usually
 * case-insensitive, so spellings that differ only in case share an entry; on
 * macOS a composed and a decomposed name do too.
 */
function fileKeyOf(filePath: string, platform: NodeJS.Platform): string {
  if (platform === 'darwin') return filePath.normalize('NFC').toLowerCase()
  if (platform === 'win32') return filePath.toLowerCase()
  return filePath
}

interface FileEntry {
  readonly key: string
  readonly filePath: string
  view: MarkdownImageView
  /** Version of the last bytes received – decoded or not – echoed back on the next read */
  version?: string
  /** Budget characters this entry holds (its `data:` URL length) */
  bytes: number
  /** `data:` URL length of the last answer that did not fit the budget; 0 otherwise */
  wantBytes: number
  readonly spellings: Set<Spelling>
  /** Bumped per read; an answer for an older read is dropped */
  token: number
  /** A read for this file is waiting for a slot */
  queued: boolean
  /** Bounded back-off re-try after a failed re-read of a shown image */
  retryTimer: ReturnType<typeof setTimeout> | null
  retryDelay: number
  retryStartedAt: number | null
}

interface Spelling {
  readonly key: string
  /** Shown while not bound to a file (resolving, or refused before any read) */
  view: MarkdownImageView
  file: FileEntry | null
  refs: number
  readonly listeners: Set<() => void>
  releaseTimer: ReturnType<typeof setTimeout> | null
}

export class MarkdownImageStore {
  private readonly deps: MarkdownImageStoreDeps
  private readonly spellings = new Map<string, Spelling>()
  private readonly files = new Map<string, FileEntry>()
  private documentPath: string | undefined
  /** Bumped when the document changes; work started before is stale */
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

  /** The view for a spelling (a document-relative path as classified). */
  readonly getView = (key: string): MarkdownImageView => {
    const spelling = this.spellings.get(key)
    if (!spelling) return LOADING_VIEW
    return spelling.file ? spelling.file.view : spelling.view
  }

  /** Distinct files held (for tests and measurements). */
  get size(): number {
    return this.files.size
  }

  /**
   * Point the store at a document. A different path forgets every file and
   * resolves the spellings on screen again, relative to the new document.
   */
  setDocument(documentPath: string | undefined): void {
    if (documentPath === this.documentPath) return
    this.documentPath = documentPath
    this.generation += 1
    this.projectRoot = null
    for (const file of [...this.files.values()]) this.dropFile(file)
    for (const spelling of this.spellings.values()) {
      spelling.file = null
      spelling.view = LOADING_VIEW
      if (spelling.refs > 0) this.bind(spelling)
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
   * Show a spelling in one more element; the first one resolves it and, for a
   * new file, starts the read. Shaped for `useSyncExternalStore`.
   */
  subscribe(key: string, listener: () => void): () => void {
    let spelling = this.spellings.get(key)
    if (!spelling) {
      spelling = { key, view: LOADING_VIEW, file: null, refs: 0, listeners: new Set(), releaseTimer: null }
      this.spellings.set(key, spelling)
      this.bind(spelling)
    }
    const held = spelling
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
      if (held.refs === 0) this.scheduleRelease(held)
      if (this.subscribers === 0 && this.detach) {
        this.detach()
        this.detach = null
      }
    }
  }

  /** Re-check every file now (debounce and visibility bypassed). */
  refresh(): void {
    this.clearSettle()
    this.pending = false
    for (const file of this.files.values()) this.load(file)
    // A spelling refused for the cap gets another chance once files went away
    for (const spelling of this.spellings.values()) {
      if (spelling.refs > 0 && !spelling.file && isReason(spelling.view, 'limit')) this.bind(spelling)
    }
  }

  /** A change event: settle the burst, then re-check – or owe it while hidden. */
  requestRefresh(): void {
    // A change event replaces any back-off: the refresh re-reads those files
    for (const file of this.files.values()) this.clearRetry(file)
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
    const offBudget = this.deps.budget.onRelease(() => this.retryOverBudget())
    this.detach = () => {
      offWatcher()
      offOwn()
      offBudget()
      this.clearSettle()
      this.pending = false
    }
  }

  /** Room was freed: read the files waiting for it that now fit. */
  private retryOverBudget(): void {
    for (const file of this.files.values()) {
      if (this.isWaitingForRoom(file) && file.wantBytes <= this.deps.budget.remaining) this.load(file)
    }
  }

  private isWaitingForRoom(file: FileEntry): boolean {
    return isReason(file.view, 'budget')
  }

  /** Resolve a spelling to its file, sharing the entry with other spellings of it. */
  private bind(spelling: Spelling): void {
    const generation = this.generation
    void this.getProjectRoot().then((root) => {
      if (generation !== this.generation || this.spellings.get(spelling.key) !== spelling) return
      if (spelling.file) return
      const documentPath = this.documentPath
      const platform = this.deps.platform()
      const filePath =
        documentPath && root ? resolveDocumentRelativePath(spelling.key, documentPath, root, platform) : null
      if (!filePath) return this.setSpellingView(spelling, unavailable('outside-project'))
      if (!isMarkdownImagePath(filePath)) return this.setSpellingView(spelling, unavailable('unsupported-type'))

      const key = fileKeyOf(filePath, platform)
      let file = this.files.get(key)
      const isNew = !file
      if (!file) {
        if (this.files.size >= MAX_MARKDOWN_IMAGES_PER_DOCUMENT) {
          return this.setSpellingView(spelling, unavailable('limit'))
        }
        file = {
          key,
          filePath,
          view: LOADING_VIEW,
          bytes: 0,
          wantBytes: 0,
          spellings: new Set(),
          token: 0,
          queued: false,
          retryTimer: null,
          retryDelay: 0,
          retryStartedAt: null
        }
        this.files.set(key, file)
      }
      file.spellings.add(spelling)
      spelling.file = file
      this.notify(spelling)
      if (isNew) this.load(file)
    })
  }

  private scheduleRelease(spelling: Spelling): void {
    spelling.releaseTimer = setTimeout(() => {
      spelling.releaseTimer = null
      if (spelling.refs > 0 || this.spellings.get(spelling.key) !== spelling) return
      this.spellings.delete(spelling.key)
      const { file } = spelling
      spelling.file = null
      if (file) {
        file.spellings.delete(spelling)
        if (file.spellings.size === 0) this.dropFile(file)
      }
    }, MARKDOWN_IMAGE_RELEASE_GRACE_MS)
  }

  /** Forget a file and give its bytes back; a read in flight for it is dropped. */
  private dropFile(file: FileEntry): void {
    this.clearRetry(file)
    if (this.files.get(file.key) === file) this.files.delete(file.key)
    file.token += 1
    file.wantBytes = 0
    const held = file.bytes
    file.bytes = 0
    this.deps.budget.release(held)
  }

  private notify(spelling: Spelling): void {
    for (const listener of [...spelling.listeners]) listener()
  }

  private setSpellingView(spelling: Spelling, view: MarkdownImageView): void {
    if (sameView(spelling.view, view)) return
    spelling.view = view
    this.notify(spelling)
  }

  private setFileView(file: FileEntry, view: MarkdownImageView): void {
    if (sameView(file.view, view)) return
    file.view = view
    for (const spelling of file.spellings) this.notify(spelling)
  }

  private getProjectRoot(): Promise<string | null> {
    this.projectRoot ??= this.deps.getProjectPath().catch(() => null)
    return this.projectRoot
  }

  /** Run `task` when a read slot is free. */
  private enqueue(task: () => Promise<void>): void {
    const run = (): void => {
      this.inFlight += 1
      void task().finally(() => {
        this.inFlight -= 1
        this.queue.shift()?.()
      })
    }
    if (this.inFlight < MARKDOWN_IMAGE_MAX_CONCURRENT_READS) run()
    else this.queue.push(run)
  }

  /** Read (or re-check) one file; at most one read per file waits for a slot. */
  private load(file: FileEntry): void {
    if (!this.visible) {
      // Read once shown: a hidden preview costs no main-process encode
      this.pending = true
      return
    }
    if (file.queued) return
    file.queued = true
    this.enqueue(async () => {
      file.queued = false
      // The file may have been released, or the document changed, while waiting
      if (this.files.get(file.key) !== file) return
      const token = ++file.token
      const isStale = (): boolean => file.token !== token || this.files.get(file.key) !== file
      try {
        await this.read(file, isStale)
      } catch (error) {
        logger.warn('Markdown image read failed', { error: String(error) })
        if (isStale()) return
        // A transport failure keeps the last good image rather than blanking it
        if (file.view.status === 'ready') this.scheduleRetry(file)
        else this.setFileView(file, unavailable('unreadable'))
      }
    })
  }

  private async read(file: FileEntry, isStale: () => boolean): Promise<void> {
    // A file waiting for room is read in full only once its bytes would fit;
    // until then a re-check is an `fstat` that answers `unchanged`
    const fullRead = this.isWaitingForRoom(file) && file.wantBytes <= this.deps.budget.remaining
    const knownVersion = fullRead ? undefined : file.version
    const response = await this.deps.read({ filePath: file.filePath, knownVersion })
    if (isStale()) return
    if (response.status === 'unchanged') {
      this.clearRetry(file)
      return
    }

    // A shown image whose re-read failed for a passing reason (the file is
    // locked or being written) keeps the last good image and re-tries; only a
    // first load shows the placeholder. Gone or moved still removes it.
    if (response.status === 'refused' && response.reason === 'unreadable' && file.view.status === 'ready') {
      this.scheduleRetry(file)
      return
    }

    if (response.status === 'refused') {
      this.clearRetry(file)
      file.version = undefined
      file.wantBytes = 0
      this.giveBack(file, file.bytes)
      this.setFileView(file, unavailable(response.reason))
      return
    }

    // Remembered whatever happens next, so the same bytes are not asked for
    // again – except when a shown image is kept over bytes that do not decode
    // (half-written): then its own version stays, so the re-try reads again
    const shownVersion = file.version
    file.version = response.version

    // Reserved before the decode: the size is known from the answer
    const size = response.dataUrl.length
    const delta = size - file.bytes
    if (!this.deps.budget.reserve(delta)) {
      // Over the window's budget: show the alt text and wait for room
      file.wantBytes = size
      this.giveBack(file, file.bytes)
      this.setFileView(file, unavailable('budget'))
      return
    }
    file.wantBytes = 0

    try {
      await this.deps.decode(response.dataUrl)
    } catch {
      if (delta > 0) this.deps.budget.release(delta)
      if (isStale()) return
      // Half-written or corrupt: keep what is shown and re-try
      if (file.view.status === 'ready') {
        file.version = shownVersion
        this.scheduleRetry(file)
      } else {
        this.setFileView(file, unavailable('undecodable'))
      }
      return
    }
    if (isStale()) {
      if (delta > 0) this.deps.budget.release(delta)
      return
    }

    if (delta < 0) this.deps.budget.release(-delta)
    file.bytes = size
    this.clearRetry(file)
    this.setFileView(file, { status: 'ready', url: response.dataUrl })
  }

  /**
   * Re-try a shown image after 1 s, 2 s, 4 s… until the next change event or
   * {@link MARKDOWN_IMAGE_RETRY_WINDOW_MS} after the first failure, so a file
   * that is unlocked without a further event is still caught.
   */
  private scheduleRetry(file: FileEntry): void {
    if (file.retryTimer) return
    const now = Date.now()
    file.retryStartedAt ??= now
    const delay = file.retryDelay > 0 ? file.retryDelay * 2 : MARKDOWN_IMAGE_RETRY_FIRST_MS
    if (now + delay - file.retryStartedAt > MARKDOWN_IMAGE_RETRY_WINDOW_MS) {
      this.clearRetry(file)
      return
    }
    file.retryDelay = delay
    file.retryTimer = setTimeout(() => {
      file.retryTimer = null
      if (this.files.get(file.key) === file) this.load(file)
    }, delay)
  }

  private clearRetry(file: FileEntry): void {
    if (file.retryTimer) clearTimeout(file.retryTimer)
    file.retryTimer = null
    file.retryDelay = 0
    file.retryStartedAt = null
  }

  /** Release `amount` of what `file` holds. */
  private giveBack(file: FileEntry, amount: number): void {
    file.bytes -= amount
    this.deps.budget.release(amount)
  }

  private clearSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = null
    this.burstStartedAt = null
  }
}

function unavailable(reason: MarkdownImageUnavailableReason): MarkdownImageView {
  return { status: 'unavailable', reason }
}

function isReason(view: MarkdownImageView, reason: MarkdownImageUnavailableReason): boolean {
  return view.status === 'unavailable' && view.reason === reason
}

/** The same refusal again is no change: nothing re-renders for it. */
function sameView(a: MarkdownImageView, b: MarkdownImageView): boolean {
  return a === b || (a.status === 'unavailable' && b.status === 'unavailable' && a.reason === b.reason)
}
