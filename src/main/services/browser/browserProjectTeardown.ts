// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Browser teardown when the window's project changes (spec 025, ADR 0009
 * decision 14; solution design § 3.1; panel finding A10).
 *
 * When `ProjectService` commits a switch or a close, the old project's browser
 * work stops in a fixed order:
 *
 * 1. end pick mode (`endPick`);
 * 2. abort a capture write and delete its partial files (`abortCaptureWrites`);
 * 3. close the old project's browser views (`closeViews`).
 *
 * The tab, capture and view owners do not exist yet (commits 7, 14, 15); they
 * register their steps here with {@link BrowserProjectTeardown.onStage}. A step
 * that throws or rejects is logged and the rest still run: a teardown that
 * stopped half-way would leave the old project's pages alive in the new one.
 * Teardowns run one at a time, in commit order.
 */
import type { ProjectSession, ProjectSessionSnapshot } from '../session/ProjectSession'
import { isSamePath } from '../../utils/pathCompare'
import { logger } from '../LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'

export const TEARDOWN_STAGES = ['endPick', 'abortCaptureWrites', 'closeViews'] as const
export type TeardownStage = (typeof TEARDOWN_STAGES)[number]

/** One step; `projectRoot` is the old project's canonical (real) root. */
export type TeardownStep = (projectRoot: string) => void | Promise<void>

/** True when the commit leaves `prev`'s project: a switch to another one, or a close. */
export function leavesProject(prev: ProjectSessionSnapshot | null, next: ProjectSessionSnapshot | null): boolean {
  if (prev === null) return false
  if (next === null) return true
  return !isSamePath(prev.realRoot, next.realRoot, prev.caseSensitive)
}

export class BrowserProjectTeardown {
  private readonly steps = new Map<TeardownStage, Set<TeardownStep>>(
    TEARDOWN_STAGES.map((stage) => [stage, new Set<TeardownStep>()])
  )
  private tail: Promise<void> = Promise.resolve()

  /** Add a step to a stage; the returned function removes it. */
  onStage(stage: TeardownStage, step: TeardownStep): () => void {
    const set = this.steps.get(stage)!
    set.add(step)
    return () => {
      set.delete(step)
    }
  }

  /** Run every stage for `projectRoot`, after any teardown already running. */
  run(projectRoot: string): Promise<void> {
    const run = this.tail.then(() => this.runStages(projectRoot))
    this.tail = run
    return run
  }

  /**
   * Follow `session`: each commit that leaves a project tears that project's
   * browser work down. Returns the unsubscribe function.
   */
  attach(session: Pick<ProjectSession, 'onChange'>): () => void {
    return session.onChange((prev, next) => {
      if (prev !== null && leavesProject(prev, next)) void this.run(prev.realRoot)
    })
  }

  private async runStages(projectRoot: string): Promise<void> {
    for (const stage of TEARDOWN_STAGES) {
      for (const step of [...this.steps.get(stage)!]) {
        try {
          await step(projectRoot)
        } catch (error) {
          logger.error('Browser teardown step failed', redactedLogError(error), { stage })
        }
      }
    }
  }
}
