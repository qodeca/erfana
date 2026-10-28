// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One async lock per file for comment writes
 * (docs/designs/comments/html-preview-comments.md §7.6, threat S10, M-012, M-063).
 *
 * Two saves on one file run one after the other, in arrival order, so the
 * second re-reads the bytes the first wrote; saves on different files run in
 * parallel. Keys are compared EXACTLY. The writer takes two keys per save:
 *  - the confined real path, which `realpath` spells as on disk, so on Windows
 *    and macOS two spellings of one file meet on one key – while on Linux
 *    `Index.html` and `index.html` are two files and keep two locks (R16).
 *    It stays the same when a save replaces the file by rename, which gives
 *    the file a new inode;
 *  - the file's `dev:ino`, so two different real paths of one file (another
 *    mount or share name of the same volume) meet too.
 * {@link KeyedAsyncLock.runAll} joins the queue of every key at once, so a
 * save only ever waits for saves that arrived before it, and two saves that
 * share keys can never wait for each other.
 *
 * The lock serialises Erfana's own writes only; an outside writer is caught by
 * the hash compare before the rename (`atomicWriteBytesStrict`).
 */

/** Runs tasks one at a time per key; different keys never wait for each other. */
export class KeyedAsyncLock {
  private readonly tails = new Map<string, Promise<void>>()
  private readonly counts = new Map<string, number>()

  /**
   * Run `task` once every earlier task for `key` has settled. A task that
   * throws releases the lock like one that returns.
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    return this.runAll([key], task)
  }

  /**
   * Run `task` holding every key in `keys` (a repeated key counts once): once
   * every earlier task on any of them has settled. The task joins all the
   * queues in one synchronous step, so it waits only for tasks that joined
   * before it – which rules out a deadlock.
   */
  async runAll<T>(keys: readonly string[], task: () => Promise<T>): Promise<T> {
    const held = [...new Set(keys)]
    let release!: () => void
    const done = new Promise<void>(resolve => {
      release = resolve
    })
    const previous = held.map(key => {
      const before = this.tails.get(key) ?? Promise.resolve()
      this.tails.set(key, before.then(() => done))
      this.counts.set(key, (this.counts.get(key) ?? 0) + 1)
      return before
    })
    try {
      await Promise.all(previous)
      return await task()
    } finally {
      release()
      for (const key of held) this.leave(key)
    }
  }

  /** Tasks running or waiting for `key` (0 when it is free). */
  queued(key: string): number {
    return this.counts.get(key) ?? 0
  }

  private leave(key: string): void {
    // Set by runAll for this very task, so present until its own decrement
    const left = this.counts.get(key)! - 1
    if (left === 0) {
      this.counts.delete(key)
      this.tails.delete(key)
    } else {
      this.counts.set(key, left)
    }
  }
}

/** The process-wide lock every comment write takes, whichever writer instance runs it. */
export const commentFileLock = new KeyedAsyncLock()
