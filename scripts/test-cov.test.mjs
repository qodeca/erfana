// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Regression guard for issue #133: under vitest 3 each per-project config
// auto-discovered `vitest.workspace.ts`, so a coverage pass without
// `--project <name>` silently expanded to all three projects and the suite ran
// about three times per `npm run test:cov`. The flag stays as a guard: these
// assertions fail the moment it is dropped from either the runner's passes or
// the per-area npm scripts.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { projects, coverageArgs, projectScope } from './lib/test-cov-projects.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
const checksWorkflow = readFileSync(join(here, '..', '.github', 'workflows', 'checks.yml'), 'utf8')

const projectNames = ['main', 'preload', 'renderer']

describe('test-cov project scoping (issue #133)', () => {
  it('covers each workspace project exactly once, with its own config', () => {
    expect(projects.map((project) => project.name)).toEqual(projectNames)
    expect(projects.map((project) => project.config)).toEqual(
      projectNames.map((name) => `vitest.${name}.config.ts`)
    )
  })

  it('scopes every coverage pass with --project <name>', () => {
    for (const project of projects) {
      const args = coverageArgs(project)
      const flagIndex = args.indexOf('--project')
      expect(flagIndex, `${project.name} pass must carry --project`).toBeGreaterThanOrEqual(0)
      expect(args[flagIndex + 1]).toBe(project.name)
      expect(args).toContain('--coverage')
    }
  })

  it('starts vitest through node, never npx, and leaves out/ in place', () => {
    // Node refuses to spawn `npx.cmd` without a shell on Windows (EINVAL), so
    // an npx-based runner fails every pass there before a test runs. And a
    // moved `out/` cannot be moved back while anything watches it.
    const runner = readFileSync(join(here, 'test-cov.mjs'), 'utf8')
    expect(runner).toContain('process.execPath')
    expect(runner).not.toMatch(/['"]npx(\.cmd)?['"]/)
    expect(runner).not.toMatch(/renameSync/)
    expect(existsSync(join(here, '..', 'node_modules', 'vitest', 'vitest.mjs'))).toBe(true)
  })

  it('runs main-perf, the timing-budget suites, in the main pass and no other', () => {
    // Owner decision 2026-10-27, "run speed tests alone": main-perf runs after
    // main, one file at a time, and its coverage merges into coverage/main.
    expect(projects.map((project) => project.vitestProjects)).toEqual([['main', 'main-perf'], ['preload'], ['renderer']])
  })

  it('scopes the per-area npm scripts with the same --project flags', () => {
    for (const project of projects) {
      expect(pkg.scripts[`test:${project.name}`]).toContain(projectScope(project).join(' '))
    }
  })

  it('scopes the CI Coverage steps exactly as this runner does', () => {
    // The Coverage job runs the three passes itself rather than through this
    // runner, so a pass that changes here must change there too.
    for (const project of projects) {
      expect(checksWorkflow).toContain(`run: npx ${coverageArgs(project).join(' ')}`)
    }
  })
})
