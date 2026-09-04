// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview failure log (Issue #74, work item 15).
 *
 * A bounded, per-view ring buffer of the diagnostic failures a previewed page
 * produces (blocked hosts, insecure schemes, path escapes, script errors, …).
 * Every entry is treated as untrusted DATA: the page authors most of the
 * strings that flow in here, so `record()`:
 *
 *  1. strips every Unicode `Cf` (bidi / zero-width / other format) and `Cc`
 *     (C0/C1 control) code point from `resourceUrlOrHost`, so a hostile page
 *     cannot smuggle bidi-override or zero-width characters into a value that
 *     is later rendered in Erfana's own chrome; and
 *  2. rings the buffer at `PREVIEW.MAX_FAILURES`, dropping the oldest entry and
 *     latching `truncated` so the renderer can show a "…and older" affordance.
 *
 * Emission is **coalesced** (design §1.3): a burst of `record()` calls — a page
 * running `while(1) fetch(bad)` — produces at most one `onEmit` per
 * `PREVIEW.FAILURE_COALESCE_MS` (250 ms), always with a trailing emit carrying
 * the latest snapshot, so the log can never become a denial-of-service channel
 * against the IPC bridge.
 *
 * @see docs/designs/sd-074-html-preview.md §1.3, §0 (diagnostic-signal bounds)
 */
import { PREVIEW } from '../../../shared/constants'
import type { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput, PreviewFailureType } from '../../../shared/ipc/preview-types'

/**
 * A recorded failure. Extends {@link PreviewFailureInput} with the `timestamp`
 * stamped at `record()` time; the entry is structurally assignable to
 * `PreviewFailureInput`, so it flows through {@link PreviewEmitters.failuresChanged}
 * unchanged (the `id` the IPC schema adds is minted at the emit boundary).
 */
export interface PreviewFailureEntry {
  readonly type: PreviewFailureType
  readonly resourceUrlOrHost: string
  readonly reasonCode: ErrorCode
  readonly timestamp: number
}

/** Called with the latest snapshot on each coalesced emission. */
export type PreviewFailureEmit = (
  failures: readonly PreviewFailureEntry[],
  truncated: boolean
) => void

/** Injectable dependencies (all defaulted; tests override `now`). */
export interface PreviewFailureLogDeps {
  /** Invoked at most once per {@link PREVIEW.FAILURE_COALESCE_MS} with a trailing emit. */
  onEmit: PreviewFailureEmit
  /** Monotonic-enough clock for entry timestamps (defaults to `Date.now`). */
  now?: () => number
  /** Coalesce window in ms (defaults to {@link PREVIEW.FAILURE_COALESCE_MS}). */
  coalesceMs?: number
  /** Ring-buffer capacity (defaults to {@link PREVIEW.MAX_FAILURES}). */
  capacity?: number
}

export interface IPreviewFailureLog {
  /** Record a failure: strips Cf/Cc, rings the buffer, schedules a coalesced emit. */
  record(input: PreviewFailureInput): void
  /** A copy of the current entries, oldest first. */
  list(): readonly PreviewFailureEntry[]
  /** Empty the buffer and emit an empty snapshot (used on the approve-path reload). */
  clear(): void
  /** Tear down: cancel any pending emit and drop all entries WITHOUT emitting. */
  drop(): void
}

/**
 * Matches every Unicode format (`Cf`) and control (`Cc`) code point in one pass.
 * `Cf` covers the bidi overrides (U+202A–U+202E, U+2066–U+2069), the zero-width
 * family (U+200B–U+200D, U+FEFF) and friends; `Cc` covers C0/C1 controls
 * including NUL, TAB, CR and LF. The `u` flag makes `\p{…}` legal.
 */
const CF_CC_PATTERN = /[\p{Cf}\p{Cc}]/gu

/** Remove all Cf/Cc code points from an untrusted, page-authored string. */
function stripFormatAndControl(value: string): string {
  return value.replace(CF_CC_PATTERN, '')
}

/**
 * Bounded, coalescing failure log for a single preview view.
 *
 * Coalescing is a leading-window collapse: the FIRST record after an idle period
 * arms a timer for `coalesceMs`; every record inside that window mutates the
 * buffer but does NOT re-arm; when the timer fires it emits the latest snapshot.
 * The result is "≤ 1 emit per window, always trailing the latest state".
 */
export class PreviewFailureLog implements IPreviewFailureLog {
  private readonly onEmit: PreviewFailureEmit
  private readonly now: () => number
  private readonly coalesceMs: number
  private readonly capacity: number

  private entries: PreviewFailureEntry[] = []
  private truncated = false
  private pendingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: PreviewFailureLogDeps) {
    this.onEmit = deps.onEmit
    this.now = deps.now ?? Date.now
    this.coalesceMs = deps.coalesceMs ?? PREVIEW.FAILURE_COALESCE_MS
    this.capacity = deps.capacity ?? PREVIEW.MAX_FAILURES
  }

  record(input: PreviewFailureInput): void {
    const entry: PreviewFailureEntry = {
      type: input.type,
      resourceUrlOrHost: stripFormatAndControl(input.resourceUrlOrHost),
      reasonCode: input.reasonCode,
      timestamp: this.now()
    }

    this.entries.push(entry)
    if (this.entries.length > this.capacity) {
      // Drop the oldest; latch `truncated` so the renderer knows entries were lost.
      this.entries.shift()
      this.truncated = true
    }

    this.scheduleEmit()
  }

  list(): readonly PreviewFailureEntry[] {
    return this.entries.slice()
  }

  clear(): void {
    this.entries = []
    this.truncated = false
    // An explicit clear must reach the renderer immediately (it is the
    // approve-path retry signal), so cancel any pending coalesced emit and
    // emit the empty snapshot synchronously.
    this.cancelPending()
    this.onEmit([], false)
  }

  drop(): void {
    this.cancelPending()
    this.entries = []
    this.truncated = false
  }

  /** Arm the coalesce timer if one is not already pending. */
  private scheduleEmit(): void {
    if (this.pendingTimer !== null) {
      return
    }
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      this.onEmit(this.list(), this.truncated)
    }, this.coalesceMs)
  }

  private cancelPending(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
  }
}

/** Factory mirroring the project's interface + class + factory convention. */
export function createPreviewFailureLog(deps: PreviewFailureLogDeps): IPreviewFailureLog {
  return new PreviewFailureLog(deps)
}
