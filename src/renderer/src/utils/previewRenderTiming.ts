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

import { COMMENT_TIMING_MARKS, markCommentTiming } from '../components/Comments/overlay/commentTiming'

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
 * Count a preview body render pass that has started (committed or not).
 *
 * @example
 * ```tsx
 * const startedAt = performance.now()
 * notePreviewRenderStart()
 * useLayoutEffect(() => notePreviewRenderCommit(startedAt, performance.now()))
 * ```
 */
export function notePreviewRenderStart(): void {
  const sink = getSink()
  if (sink) sink.starts += 1
}

/**
 * Record a committed preview body render, when recording is on. Always puts
 * the `erfana:comments:preview-rendered` mark on the timeline (one entry,
 * replaced each time): the start of "pins visible" in the comment timing
 * (spec 024 024-NFR-001, `e2e/markdown-comments.timing.e2e.ts`).
 *
 * @param startedAt - `performance.now()` taken when the render pass began
 * @param committedAt - `performance.now()` taken in the commit's layout effect
 */
export function notePreviewRenderCommit(startedAt: number, committedAt: number): void {
  markCommentTiming(COMMENT_TIMING_MARKS.previewRendered)
  getSink()?.samples.push({ startedAt, committedAt, duration: committedAt - startedAt })
}
