// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tracking of preview work that finishes after React commits – today, Mermaid
 * diagrams drawing asynchronously – so `MarkdownPreview.flush()` can wait for
 * a preview that is complete, not merely committed (PDF / DOCX export).
 *
 * @module components/Editor/previewWork
 */

import { createContext } from 'react'

/**
 * Counts pieces of outstanding preview work and tells waiters when none is left.
 *
 * @example
 * ```ts
 * const tracker = new PreviewWorkTracker()
 * const done = tracker.begin()   // a diagram starts drawing
 * const idle = tracker.whenIdle(5000)
 * done()                         // drawn – `idle` resolves
 * ```
 */
export class PreviewWorkTracker {
  private busy = 0
  private readonly waiters = new Set<() => void>()

  /** Pieces of work begun and not yet ended. */
  get pending(): number {
    return this.busy
  }

  /**
   * Note a piece of work as started.
   *
   * @returns The function that ends it; calling it more than once is harmless
   */
  begin(): () => void {
    this.busy += 1
    let ended = false
    return () => {
      if (ended) return
      ended = true
      this.busy -= 1
      if (this.busy === 0) this.notify()
    }
  }

  /**
   * Resolve once no work is outstanding, or after `timeoutMs` at the latest –
   * a diagram that never finishes must not hang an export.
   *
   * @param timeoutMs - Upper bound on the wait
   * @returns A promise that never rejects
   */
  whenIdle(timeoutMs: number): Promise<void> {
    if (this.busy === 0) return Promise.resolve()
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        this.waiters.delete(done)
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      this.waiters.add(done)
    })
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) waiter()
  }
}

/** What the preview hands to work that finishes after commit. */
export interface PreviewWorkContextValue {
  /** Where to register outstanding work; `null` outside a preview */
  tracker: PreviewWorkTracker | null
  /**
   * Incremented by `flush()`: anything holding back work (a debounced diagram
   * redraw) should do it now.
   */
  flushEpoch: number
}

/** Provided by `MarkdownPreview`; Mermaid diagrams read it. */
export const PreviewWorkContext = createContext<PreviewWorkContextValue>({ tracker: null, flushEpoch: 0 })
