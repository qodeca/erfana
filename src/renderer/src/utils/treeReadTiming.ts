// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * How long a project-tree read takes, smoothed – read by useDirectoryWatcher
 * to space out forced refreshes on a slow project (finding [29], PR #316).
 *
 * Fed with the read alone (`api.file.readDirectory`), not the time a caller
 * spent queued behind another read. One renderer process shows one project,
 * so one module-level value is enough; it is reset when the project changes.
 */

/** Weight of the newest sample in the moving average. */
const SMOOTHING = 0.5

let smoothedMs = 0

/** Record one completed tree read. */
export function recordTreeReadMs(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return
  smoothedMs = smoothedMs === 0 ? durationMs : SMOOTHING * durationMs + (1 - SMOOTHING) * smoothedMs
}

/** The smoothed read time; 0 before the first read. */
export function getTreeReadMs(): number {
  return smoothedMs
}

/** Forget the samples (a new project, or a test). */
export function resetTreeReadTiming(): void {
  smoothedMs = 0
}
