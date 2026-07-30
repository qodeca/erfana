// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for the graph engine's project-switch hook
 *
 * Consumed by `ProjectService` ONLY, as a seventh optional constructor
 * parameter — additive, so the existing six-argument call site is untouched,
 * and narrow, so `ProjectService` depends on one method rather than the whole
 * engine.
 *
 * @see GraphLifecycle for implementation (#23); wired by #32
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-db-contracts.md §5.2 - close-then-open sequence
 */

export interface IGraphProjectLifecycle {
  /**
   * React to a project switch.
   *
   * MUST be synchronous and O(1): `ProjectService.updateServices` is a
   * synchronous `void` method, so nothing here may block it. The implementation
   * bumps the switch version, aborts pending timers, drops queued batches and
   * detaches the reader, then **enqueues** close-then-open and returns — the
   * database work happens off the switch path, in the worker.
   *
   * @param newPath - Absolute path of the newly opened project, or null when
   *                  the last project closed
   */
  onProjectPathChanged(newPath: string | null): void
}
