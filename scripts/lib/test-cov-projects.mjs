// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Project scoping for `npm run test:cov` (issue #133).
//
// The three coverage passes, in the same order as the CI Coverage job
// (.github/workflows/checks.yml). `name` names the pass and its project;
// `config` supplies its coverage thresholds; `vitestProjects` are the vitest
// projects it runs, each passed as `--project <name>`. The main pass also runs
// `main-perf`, the timing-budget suites: vitest.main.config.ts starts them once
// `main` is done, one at a time, and their coverage lands in the same
// coverage/main report (owner decision 2026-10-27, "run speed tests alone").
//
// `--project` stays as a guard: under vitest 3 each per-project config
// auto-discovered `vitest.workspace.ts`, so a bare `--config` run expanded to
// ALL THREE projects and one `test:cov` invocation executed the whole suite
// three times.
//
// Kept in its own side-effect-free module so `scripts/test-cov.test.mjs` can
// assert the scoping without importing — and therefore running — the runner.

export const projects = [
  { name: 'main', config: 'vitest.main.config.ts', vitestProjects: ['main', 'main-perf'] },
  { name: 'preload', config: 'vitest.preload.config.ts', vitestProjects: ['preload'] },
  { name: 'renderer', config: 'vitest.renderer.config.ts', vitestProjects: ['renderer'] },
]

/** The `--project` flags that scope one pass: `--project <name>` per vitest project. */
export function projectScope(project) {
  return project.vitestProjects.flatMap((name) => ['--project', name])
}

/** The vitest argument array for one project's coverage pass. */
export function coverageArgs(project) {
  return ['vitest', '--run', '--config', project.config, ...projectScope(project), '--coverage']
}
