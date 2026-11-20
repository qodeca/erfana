// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A project session for watch-layer tests: a real `ProjectSessionStore`
 * committed at `root` (its own real root), which a test can switch or close
 * the way `ProjectService` does.
 */
import { ProjectSessionStore } from '../../session/ProjectSession'

export interface TestSession extends ProjectSessionStore {
  /** Commit another project (or the same one again); resolves the new generation. */
  switchTo(root: string): number
}

/** A session open at `root`; names compare by case unless `caseSensitive` is false. */
export function testSession(root: string, caseSensitive = true): TestSession {
  const store = new ProjectSessionStore() as TestSession
  store.switchTo = (next: string) =>
    store.commit({ root: next, realRoot: next, caseSensitive, ownerWebContentsId: null })
  store.switchTo(root)
  return store
}
