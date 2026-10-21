// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Opt-in timing of the Markdown preview's body render, for the typing benchmark.
 *
 * Off by default: nothing is recorded until something assigns a sink to
 * `window.__erfanaPreviewRenderTiming`. The benchmark
 * (`e2e/preview-typing.bench.ts`) does that from Playwright before it opens the
 * document, so the cost in normal use is one property read per body render.
 *
 * Production React builds disable `<Profiler>` callbacks, so the timing is taken
 * by hand: a start stamp when the body subtree begins rendering and a commit
 * stamp from a layout effect, which runs after every child in the subtree has
 * rendered and been written to the DOM. The span therefore covers the
 * remark/rehype pipeline, React reconciliation and the DOM commit – not the
 * browser's own layout and paint afterwards.
 *
 * @see docs/performance/2026-10-21-deferred-preview.md
 * @module utils/previewRenderTiming
 */

/** One committed render of the preview body. */
export interface PreviewRenderSample {
  /** `performance.now()` when the body subtree started rendering */
  startedAt: number
  /** `performance.now()` when the body's layout effect ran (DOM committed) */
  committedAt: number
  /** `committedAt - startedAt`, in milliseconds */
  duration: number
}

/** The sink the benchmark installs on `window` to switch recording on. */
export interface PreviewRenderTimingSink {
  /**
   * Body render passes started, committed or not. Under concurrent rendering a
   * pass can be abandoned for a newer keystroke, so this can exceed
   * `samples.length`.
   */
  starts: number
  /** One entry per committed body render, in commit order */
  samples: PreviewRenderSample[]
}

declare global {
  interface Window {
    /** Set by the typing benchmark to record preview render timing. */
    __erfanaPreviewRenderTiming?: PreviewRenderTimingSink
  }
}

function getSink(): PreviewRenderTimingSink | undefined {
  return typeof window === 'undefined' ? undefined : window.__erfanaPreviewRenderTiming
}

/**
 * Note that a preview body render pass has started.
 *
 * @returns The start stamp to hand to {@link notePreviewRenderCommit}, or
 *   `null` when recording is off
 *
 * @example
 * ```tsx
 * const startedAt = notePreviewRenderStart()
 * useLayoutEffect(() => notePreviewRenderCommit(startedAt))
 * ```
 */
export function notePreviewRenderStart(): number | null {
  const sink = getSink()
  if (!sink) return null
  sink.starts += 1
  return performance.now()
}

/**
 * Record a committed preview body render.
 *
 * A `null` start (recording was off when the pass began) records nothing, so
 * switching recording on mid-render never produces a half-measured sample.
 *
 * @param startedAt - The stamp returned by {@link notePreviewRenderStart}
 */
export function notePreviewRenderCommit(startedAt: number | null): void {
  const sink = getSink()
  if (!sink || startedAt === null) return
  const committedAt = performance.now()
  sink.samples.push({ startedAt, committedAt, duration: committedAt - startedAt })
}
