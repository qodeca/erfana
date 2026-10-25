// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Project scoping for `npm run test:cov` (issue #133).
//
// The three workspace projects, in the same order as the CI Coverage job
// (.github/workflows/checks.yml). `name` is the vitest project name passed to
// `--project`; `config` supplies that project's coverage thresholds.
//
// `--project` stays as a guard: under vitest 3 each per-project config
// auto-discovered `vitest.workspace.ts`, so a bare `--config` run expanded to
// ALL THREE projects and one `test:cov` invocation executed the whole suite
// three times.
//
// Kept in its own side-effect-free module so `scripts/test-cov.test.mjs` can
// assert the scoping without importing — and therefore running — the runner.

export const projects = [
  { name: 'main', config: 'vitest.main.config.ts' },
  { name: 'preload', config: 'vitest.preload.config.ts' },
  { name: 'renderer', config: 'vitest.renderer.config.ts' },
]

/** The vitest argument array for one project's coverage pass. */
export function coverageArgs(project) {
  return ['vitest', '--run', '--config', project.config, '--project', project.name, '--coverage']
}
