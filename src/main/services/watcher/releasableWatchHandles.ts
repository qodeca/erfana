// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * releasableWatchHandles - the native directory watcher's `fs.watch` handles,
 * each of which can be let go for a while and opened again (#486).
 *
 * On Windows any handle below a folder blocks renaming the folder, which is
 * how the Recycle Bin moves it. `NativeRecursiveWatcher` opens handles below a
 * folder when the folder is split (it holds an excluded, hidden or ignored
 * path, so its children are watched one by one), so such a folder could not be
 * trashed from the project tree. This module is the watcher's `fsWatch`: every
 * handle it returns wraps the real one, so a delete can close the real handles
 * strictly below a folder and open them again afterwards, without the watcher
 * (and its records) noticing. A handle on the folder itself does not block the
 * move and is kept, so the folder's own removal is still heard.
 *
 * When a release ends, a folder that is gone stays closed quietly – its
 * removal reaches the watcher through the folder above, as for any delete. A
 * folder still there is opened again and reported as a lost-events signal (a
 * `null` file name), so the watcher re-lists or resyncs what it may have
 * missed meanwhile. Any other failure to open reaches the watcher as the
 * handle's `error`, which it already recovers from.
 */
import fs from 'fs'
import { isInsideRoot, isSamePath, normaliseResolved } from '../../utils/pathCompare'
import type { NativeFsWatch, NativeWatchHandle, NativeWatchListener } from './NativeRecursiveWatcher'

type WatchOptions = Parameters<NativeFsWatch>[1]

/** Codes that mean the folder is no longer there. */
const GONE_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])

const openNative: NativeFsWatch = (target, options, listener) => fs.watch(target, options, listener)

/** One release in force: the folder and the handles it closed. */
interface Hold {
  readonly root: string
  readonly caseSensitive: boolean
  readonly handles: Set<ReleasableHandle>
}

/** A handle the watcher holds; the real one behind it may be let go. */
class ReleasableHandle implements NativeWatchHandle {
  private inner: NativeWatchHandle | null = null
  private readonly errorListeners: Array<(error: Error) => void> = []
  private holds = 0
  private closed = false

  constructor(
    readonly path: string,
    private readonly options: WatchOptions,
    private readonly listener: NativeWatchListener,
    private readonly openReal: NativeFsWatch,
    private readonly onClose: (handle: ReleasableHandle) => void
  ) {}

  /** A real handle is open now. */
  get isOpen(): boolean {
    return this.inner !== null
  }

  /** Open the real handle; throws as `fs.watch` does. */
  open(): void {
    const inner = this.openReal(this.path, this.options, this.listener)
    inner.on('error', error => this.fail(error))
    this.inner = inner
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.closeInner()
    this.onClose(this)
  }

  on(_event: 'error', listener: (error: Error) => void): this {
    this.errorListeners.push(listener)
    return this
  }

  hold(): void {
    this.holds++
    if (this.holds === 1) this.closeInner()
  }

  unhold(): void {
    this.holds--
    if (this.holds > 0 || this.closed) return
    try {
      this.open()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code
      if (code === undefined || !GONE_CODES.has(code)) this.fail(error)
      return
    }
    // Nothing in the folder was heard while it was let go
    this.listener('rename', null)
  }

  private fail(error: unknown): void {
    const failure = error instanceof Error ? error : new Error('watch failed')
    for (const listener of [...this.errorListeners]) listener(failure)
  }

  private closeInner(): void {
    const inner = this.inner
    this.inner = null
    try {
      inner?.close()
    } catch {
      // A handle that refuses to close is gone for our purposes
    }
  }
}

export class ReleasableWatchHandles {
  private readonly handles = new Set<ReleasableHandle>()
  private readonly holds = new Set<Hold>()

  constructor(private readonly openReal: NativeFsWatch = openNative) {}

  /**
   * The watcher's `fsWatch`. Under a release in force the real handle opens
   * only when the release ends; otherwise at once, throwing as `fs.watch` does.
   */
  readonly fsWatch: NativeFsWatch = (target, options, listener) => {
    const handle = new ReleasableHandle(target, options, listener, this.openReal, closed => this.forget(closed))
    const covering = [...this.holds].filter(hold => isBelow(target, hold))
    if (covering.length === 0) handle.open()
    for (const hold of covering) {
      hold.handles.add(handle)
      handle.hold()
    }
    this.handles.add(handle)
    return handle
  }

  /**
   * Close every real handle strictly below `realPath` until the returned
   * function runs (it is safe to call more than once).
   */
  releaseBelow(realPath: string, caseSensitive: boolean): () => void {
    const hold: Hold = { root: normaliseResolved(realPath), caseSensitive, handles: new Set() }
    this.holds.add(hold)
    for (const handle of this.handles) {
      if (!isBelow(handle.path, hold)) continue
      hold.handles.add(handle)
      handle.hold()
    }
    let ended = false
    return () => {
      if (ended) return
      ended = true
      this.holds.delete(hold)
      for (const handle of hold.handles) handle.unhold()
    }
  }

  /** Real handles open strictly below `realPath` now. */
  openBelow(realPath: string, caseSensitive: boolean): number {
    const hold: Hold = { root: normaliseResolved(realPath), caseSensitive, handles: new Set() }
    let open = 0
    for (const handle of this.handles) {
      if (handle.isOpen && isBelow(handle.path, hold)) open++
    }
    return open
  }

  private forget(handle: ReleasableHandle): void {
    this.handles.delete(handle)
    for (const hold of this.holds) hold.handles.delete(handle)
  }
}

function isBelow(target: string, hold: Hold): boolean {
  const path = normaliseResolved(target)
  return isInsideRoot(path, hold.root, hold.caseSensitive) && !isSamePath(path, hold.root, hold.caseSensitive)
}
