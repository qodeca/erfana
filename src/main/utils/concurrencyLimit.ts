// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * concurrencyLimit – run async tasks with at most `max` of them in flight.
 *
 * Tasks start in the order they were handed in. A slot is held only while the
 * task's own promise is pending, so a task that waits on tasks it queued
 * itself must hand those in from outside its slot (the tree walk takes a slot
 * for one `readdir` only, never while it waits on its sub-folders).
 */

export interface ConcurrencyLimit {
  /** Run `task` once a slot is free; settles as the task settles. */
  run<T>(task: () => Promise<T>): Promise<T>
}

/**
 * @param max - The most tasks in flight at once; at least 1
 * @returns A limiter whose slots are shared by every `run` call on it
 */
export function createConcurrencyLimit(max: number): ConcurrencyLimit {
  if (!Number.isInteger(max) || max < 1) throw new Error('Invalid concurrency limit')
  let active = 0
  const waiting: Array<() => void> = []

  const release = (): void => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active < max) active++
      // The slot is handed over directly by `release`, so `active` stays counted
      else await new Promise<void>((resolve) => waiting.push(resolve))
      try {
        return await task()
      } finally {
        release()
      }
    }
  }
}
