// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Test and bench support for pick mode (spec 025 solution design § 12, T3;
 * 025-AC-034, 025-AC-037, 025-AC-049, 025-AC-050, 025-AC-060).
 *
 * - {@link PickFaults}: failures a test hook can force – an empty or failed
 *   screenshot, a slow or throwing hint lookup, a failed file write – and
 *   unique test colours for the live pick outline's ink and paper, so a
 *   screenshot test can tell a leaked live outline from anything the page or
 *   the still image draws (025-AC-034). Inert unless a hook arms them;
 *   production code only asks.
 * - {@link PickBench}: stage timings (hover to highlight, confirm to menu,
 *   send), kept as the last {@link BENCH_SAMPLES} samples per stage for the
 *   bench lane's hooks. Measured on the injected clock.
 */

/** Samples kept per stage. */
export const BENCH_SAMPLES = 500

export type BenchStage = 'highlight' | 'confirmToMenu' | 'send'

export class PickBench {
  private readonly samples = new Map<BenchStage, number[]>()

  record(stage: BenchStage, ms: number): void {
    const list = this.samples.get(stage) ?? []
    list.push(ms)
    if (list.length > BENCH_SAMPLES) list.shift()
    this.samples.set(stage, list)
  }

  read(stage: BenchStage): readonly number[] {
    return [...(this.samples.get(stage) ?? [])]
  }

  clear(): void {
    this.samples.clear()
  }
}

/** A colour as `Overlay.highlightQuad` takes it (0–255 channels, alpha 0–1). */
export interface FaultRgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/** Test colours for the live outline's two tones. */
export interface FaultPair {
  readonly ink: FaultRgba
  readonly paper: FaultRgba
}

export class PickFaults {
  private highlightOutline: FaultPair | null = null
  private emptyCaptures = 0
  private failedCaptures = 0
  private hintsDelay: Promise<void> | null = null
  private hintsError = false
  private writeFailures = 0

  /** The next `count` screenshots come back empty. */
  armEmptyCaptures(count: number): void {
    this.emptyCaptures = count
  }

  /** The next `count` screenshots fail outright. */
  armCaptureFailures(count: number): void {
    this.failedCaptures = count
  }

  /** The React lookup waits for `until` (a forced slow lookup) or throws. */
  armHints(options: { until?: Promise<void>; throws?: boolean }): void {
    this.hintsDelay = options.until ?? null
    this.hintsError = options.throws === true
  }

  /** The next `count` capture writes fail on their first file. */
  armWriteFailures(count: number): void {
    this.writeFailures = count
  }

  /**
   * The live pick outline is drawn in `pair` (unique test colours for its ink
   * and paper; the engine's one-colour fallback takes the ink), or in the
   * product colours again with `null`.
   */
  setHighlightColours(pair: FaultPair | null): void {
    this.highlightOutline = pair === null ? null : Object.freeze({ ink: Object.freeze({ ...pair.ink }), paper: Object.freeze({ ...pair.paper }) })
  }

  /** The live outline's test colours, or `null` for the product colours. */
  highlightColours(): FaultPair | null {
    return this.highlightOutline
  }

  reset(): void {
    this.highlightOutline = null
    this.emptyCaptures = 0
    this.failedCaptures = 0
    this.hintsDelay = null
    this.hintsError = false
    this.writeFailures = 0
  }

  takeEmptyCapture(): boolean {
    if (this.emptyCaptures <= 0) return false
    this.emptyCaptures -= 1
    return true
  }

  takeCaptureFailure(): boolean {
    if (this.failedCaptures <= 0) return false
    this.failedCaptures -= 1
    return true
  }

  /** Runs before the React lookup. */
  async hintsHook(): Promise<void> {
    if (this.hintsDelay !== null) await this.hintsDelay
    if (this.hintsError) throw new Error('forced hint failure')
  }

  /** `CaptureStore`'s write fault: one forced failure per armed write. */
  writeFault(): Error | null {
    if (this.writeFailures <= 0) return null
    this.writeFailures -= 1
    return Object.assign(new Error('forced write failure'), { code: 'EIO' })
  }
}
