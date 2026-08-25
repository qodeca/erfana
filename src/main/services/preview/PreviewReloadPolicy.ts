// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure reload-policy classify + coalesce for the HTML preview (Issue #74, work
 * item 32; design §1.4, §5(b)).
 *
 * When a watched subresource changes, the preview either hot-swaps a single
 * stylesheet (no reload, no flash) or performs a full page reload. The rule:
 *
 *   - a coalesced burst that touched exactly ONE file, and that file is a
 *     stylesheet (`.css`) ⇒ SWAP that stylesheet in place
 *   - anything else — an HTML change, a JS change, any other asset, OR a mixed
 *     burst that touched more than one file ⇒ FULL RELOAD
 *
 * The classifier is pure. The coalescer buffers rapid `change` events over a
 * short window (default `PREVIEW.WATCH_COALESCE_MS`) into one decision, so an
 * editor's save-storm collapses to a single swap/reload. Timer functions are
 * injectable so the coalescer is testable without wall-clock waits or global
 * fake timers.
 *
 * Files are DATA: a changed path only classifies a decision, it is never
 * executed here.
 */
import { PREVIEW } from '../../../shared/constants'

/** The extension that qualifies a single-file change for an in-place swap. */
const CSS_EXTENSION = '.css'

/** The outcome of classifying a coalesced change burst. */
export type ReloadDecision =
  | { readonly action: 'swap'; readonly changedPath: string }
  | { readonly action: 'reload' }

function isCssPath(path: string): boolean {
  return path.toLowerCase().endsWith(CSS_EXTENSION)
}

/**
 * Classify a coalesced burst of changed paths into a single reload decision.
 *
 * Pure and deterministic: a burst of exactly one `.css` file swaps; every other
 * shape (empty, non-CSS, multiple files) reloads.
 *
 * @param changedPaths - the DEDUPLICATED paths that changed in one burst
 */
export function classifyReload(changedPaths: readonly string[]): ReloadDecision {
  if (changedPaths.length === 1 && isCssPath(changedPaths[0])) {
    return { action: 'swap', changedPath: changedPaths[0] }
  }
  return { action: 'reload' }
}

/** The coalescing reload policy for a single previewed page. */
export interface IPreviewReloadPolicy {
  /** Record a changed path; schedules a coalesced decision if not already pending. */
  record(changedPath: string): void
  /** Emit the decision for the buffered burst now, cancelling the pending timer. */
  flush(): void
  /** Drop the buffered burst and the pending timer without emitting. */
  cancel(): void
  /** Release the pending timer; the policy must not be used afterwards. */
  dispose(): void
}

export interface PreviewReloadPolicyOptions {
  /** Called once per coalesced burst with the classified decision. */
  readonly onDecision: (decision: ReloadDecision) => void
  /** Coalesce window in ms; defaults to `PREVIEW.WATCH_COALESCE_MS`. */
  readonly coalesceMs?: number
  /** Timer scheduler; defaults to the global `setTimeout`. Injected for tests. */
  readonly setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  /** Timer canceller; defaults to the global `clearTimeout`. Injected for tests. */
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

/**
 * Create a coalescing reload policy. Buffers `record` calls (deduplicated) over
 * the coalesce window, then classifies the burst and invokes `onDecision` once.
 */
export function createPreviewReloadPolicy(
  options: PreviewReloadPolicyOptions
): IPreviewReloadPolicy {
  const coalesceMs = options.coalesceMs ?? PREVIEW.WATCH_COALESCE_MS
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout

  const pending = new Set<string>()
  let handle: ReturnType<typeof setTimeout> | null = null

  const clearPendingTimer = (): void => {
    if (handle !== null) {
      clearTimer(handle)
      handle = null
    }
  }

  const emit = (): void => {
    clearPendingTimer()
    if (pending.size === 0) return
    const burst = [...pending]
    pending.clear()
    options.onDecision(classifyReload(burst))
  }

  return {
    record(changedPath: string): void {
      pending.add(changedPath)
      if (handle === null) {
        handle = setTimer(emit, coalesceMs)
      }
    },
    flush(): void {
      emit()
    },
    cancel(): void {
      clearPendingTimer()
      pending.clear()
    },
    dispose(): void {
      clearPendingTimer()
      pending.clear()
    }
  }
}
