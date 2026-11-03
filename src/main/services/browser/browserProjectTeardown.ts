// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Browser teardown when the window's project changes or a window closes
 * (spec 025, ADR 0009 decision 14; solution design § 3.1; panel finding A10).
 *
 * When `ProjectService` commits a switch or a close ({@link BrowserProjectTeardown.run}),
 * or a window closes ({@link BrowserProjectTeardown.runForWindow}), that
 * project's or window's browser work stops in a fixed order:
 *
 * 1. end pick mode (`endPick`, `BrowserPicks.endPicks`);
 * 2. wait for a capture write, which deletes its files as its capture is gone
 *    (`abortCaptureWrites`, `BrowserPicks.abortCaptureWrites`);
 * 3. close the browser views (`closeViews`: the tabs, and for a project its
 *    served local folders and page state).
 *
 * The owners register their steps in `browserAppSetup.ts` and
 * `pick/pickAppSetup.ts` with {@link BrowserProjectTeardown.onStage}; each
 * step gets the {@link TeardownScope} and acts on the tabs inside it. A step
 * that throws or rejects is logged and the rest still run: a teardown that
 * stopped half-way would leave the old project's pages alive in the new one.
 * Teardowns run one at a time, in the order they were asked for.
 */
import type { ProjectSession, ProjectSessionSnapshot } from '../session/ProjectSession'
import { isSamePath } from '../../utils/pathCompare'
import { logger } from '../LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'

export const TEARDOWN_STAGES = ['endPick', 'abortCaptureWrites', 'closeViews'] as const
export type TeardownStage = (typeof TEARDOWN_STAGES)[number]

/** What is torn down: a project (its canonical, real root) or a window. */
export type TeardownScope =
  | { readonly kind: 'project'; readonly projectRoot: string }
  | { readonly kind: 'window'; readonly windowId: number }

/** One step, for the scope being torn down. */
export type TeardownStep = (scope: TeardownScope) => void | Promise<void>

/** Whether a tab of `tab`'s project and window is inside `scope`. */
export function tabInScope(
  scope: TeardownScope,
  tab: { readonly projectRoot: string; readonly caseSensitive: boolean; readonly windowId: number }
): boolean {
  return scope.kind === 'window' ? tab.windowId === scope.windowId : isSamePath(tab.projectRoot, scope.projectRoot, tab.caseSensitive)
}

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

  /** Run every stage for the project at `projectRoot`, after any teardown already running. Never rejects. */
  run(projectRoot: string): Promise<void> {
    return this.enqueue({ kind: 'project', projectRoot })
  }

  /** Run every stage for the window `windowId` that closed, after any teardown already running. Never rejects. */
  runForWindow(windowId: number): Promise<void> {
    return this.enqueue({ kind: 'window', windowId })
  }

  private enqueue(scope: TeardownScope): Promise<void> {
    const run = this.tail.then(() => this.runStages(scope))
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

  private async runStages(scope: TeardownScope): Promise<void> {
    for (const stage of TEARDOWN_STAGES) {
      for (const step of [...this.steps.get(stage)!]) {
        try {
          await step(scope)
        } catch (error) {
          logger.error('Browser teardown step failed', redactedLogError(error), { stage })
        }
      }
    }
  }
}
