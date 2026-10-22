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
 * A remembered answer is forgotten – all of them at once – when the file
 * structure may have changed: a directory-watcher event other than a plain
 * content change (a file or folder added or removed, or a catch-up refresh),
 * or one of this window's own file operations ({@link onFileStructureChanged},
 * since the watcher is paused for those). Listeners then re-check, so a link
 * to a file created a moment ago stops being shown as broken.
 *
 * One cache per preview panel: it lives as long as the panel and holds only
 * the paths the panel's latest link check asked about ({@link sweep}).
 *
 * @module components/Editor/linkTargetCache
 */

import { fileGateway } from '../../services/fileGateway'
import { onFileStructureChanged } from '../../services/fileStructureSignal'

/** The payload of `directory-watch:changed`, as far as this module reads it. */
export interface DirectoryChange {
  /** Event counts by chokidar type (`add`, `unlink`, `addDir`, `unlinkDir`, `change`) */
  summary?: Record<string, number>
  /** A refresh for changes dropped during a pause: anything may have changed */
  catchUp?: boolean
}

/**
 * Whether a directory change can have changed which files exist. Only a batch
 * of nothing but `change` events (file contents rewritten) cannot; a payload
 * without a summary is treated as structural, to stay on the safe side.
 */
export function isStructuralChange(change: DirectoryChange): boolean {
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

export class LinkTargetCache {
  private readonly answers = new Map<string, Promise<boolean>>()
  /** Paths asked about since the last {@link sweep} */
  private readonly asked = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private notifyQueued = false
  private currentGeneration = 0
  private detach: (() => void) | null = null

  /** Bumped on every invalidation; a check started under an older one is stale. */
  get generation(): number {
    return this.currentGeneration
  }

  /**
   * Whether `filePath` exists – remembered, or asked once over IPC. Callers
   * asking for the same path while the first answer is in flight share it. A
   * failed check is not remembered.
   */
  readonly exists = (filePath: string): Promise<boolean> => {
    this.asked.add(filePath)
    const known = this.answers.get(filePath)
    if (known) return known
    const answer = fileGateway.exists({ filePath })
    this.answers.set(filePath, answer)
    answer.catch(() => {
      if (this.answers.get(filePath) === answer) this.answers.delete(filePath)
    })
    return answer
  }

  /** Forget every answer and tell the listeners (once per burst of invalidations). */
  invalidate(): void {
    this.answers.clear()
    this.currentGeneration += 1
    if (this.notifyQueued) return
    this.notifyQueued = true
    queueMicrotask(() => {
      this.notifyQueued = false
      for (const listener of [...this.listeners]) listener()
    })
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
   * Listen for invalidations. The first listener connects the cache to the
   * directory watcher and to this window's own file operations; the last one
   * leaving disconnects it. Shaped for `useSyncExternalStore`.
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
    }
  }
}
