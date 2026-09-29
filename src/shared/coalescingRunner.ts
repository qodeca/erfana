// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Single-flight runner with one trailing run (issue #208).
 *
 * At most one task runs at a time. Calls that arrive while a task runs never
 * join that running task: they all share ONE trailing run that starts only
 * after the running one has settled. So a caller that calls after its own
 * write is always served by a run that started after its call, a burst of any
 * size costs at most two runs, and two runs never overlap.
 *
 * Used by main's `FileService.readDirectory` (one runner per path) and by the
 * renderer's `useProjectManagement.refreshFiles` (one runner per project
 * scope). No imports, on purpose, so both processes run the same code.
 *
 * Ordering guarantees the callers rely on:
 * - `busy` is set BEFORE a task is invoked, so a task that synchronously calls
 *   `run()` again is queued as the trailing run, never started alongside.
 * - The settle bookkeeping is attached to a run's promise before that promise
 *   is handed out, so it runs ahead of every caller's continuation: when a
 *   caller resumes, a queued trailing run has already started.
 * - Errors are per run: a rejected run rejects only its own callers, and a
 *   queued trailing run still starts after it.
 *
 * @see docs/file-watching/technical-details.md
 */

/** What a task is told about the run it is executing. */
export interface CoalescedRunInfo {
  /** true when this run is the trailing run that started after an earlier one settled */
  followUp: boolean
  /** how many run() calls this execution serves (1 for a leading run) */
  callers: number
}

export interface CoalescingRunnerOptions {
  /** Called synchronously when the runner returns to IDLE. Must not throw. */
  onIdle?: () => void
}

export type CoalescedTask<T> = (info: CoalescedRunInfo) => Promise<T>

export interface CoalescingRunner<T> {
  /**
   * Run `task` now if nothing runs, otherwise join the one trailing run.
   *
   * @param task - The work to run. For a trailing run, the task passed by the
   *   most recent joiner is the one that runs.
   * @returns The outcome of the run that serves this call.
   */
  run(task: CoalescedTask<T>): Promise<T>
}

interface TrailingRun<T> {
  task: CoalescedTask<T>
  callers: number
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

/**
 * Create a single-flight runner with one trailing run.
 *
 * @param options - Optional `onIdle` hook, called when the runner goes idle
 * @returns A runner whose `run()` never lets two tasks overlap
 */
export function createCoalescingRunner<T>(options?: CoalescingRunnerOptions): CoalescingRunner<T> {
  let busy = false
  let trailing: TrailingRun<T> | null = null

  const start = (task: CoalescedTask<T>, info: CoalescedRunInfo): Promise<T> => {
    // Before invoking the task: a synchronously re-entrant task must queue.
    busy = true
    let current: Promise<T>
    try {
      current = Promise.resolve(task(info))
    } catch (error) {
      // A task that throws synchronously must not leave the runner stuck busy.
      current = Promise.reject(error)
    }
    const settle = (): void => {
      const next = trailing
      if (next) {
        trailing = null
        start(next.task, { followUp: true, callers: next.callers }).then(next.resolve, next.reject)
      } else {
        busy = false
        options?.onIdle?.()
      }
    }
    // Attached before `current` is returned, so it runs ahead of the callers.
    // It also handles a rejection on this internal branch; the caller holding
    // `current` handles its own.
    current.then(settle, settle)
    return current
  }

  const joinTrailing = (task: CoalescedTask<T>): Promise<T> => {
    if (trailing) {
      trailing.callers++
      trailing.task = task
      return trailing.promise
    }
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })
    trailing = { task, callers: 1, promise, resolve, reject }
    return promise
  }

  return {
    run(task: CoalescedTask<T>): Promise<T> {
      return busy ? joinTrailing(task) : start(task, { followUp: false, callers: 1 })
    }
  }
}
