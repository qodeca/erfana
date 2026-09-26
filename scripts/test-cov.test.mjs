// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Regression guard for issue #133: each per-project vitest config auto-discovers
// `vitest.workspace.ts`, so a coverage pass without `--project <name>` silently
// expands to all three projects and the suite runs about three times per
// `npm run test:cov`. These assertions fail the moment the flag is dropped from
// either the runner's passes or the per-area npm scripts.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { projects, coverageArgs } from './lib/test-cov-projects.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const projectNames = ['main', 'preload', 'renderer']

describe('test-cov project scoping (issue #133)', () => {
  it('covers each workspace project exactly once, with its own config', () => {
    expect(projects.map((project) => project.name)).toEqual(projectNames)
    expect(projects.map((project) => project.config)).toEqual(
      projectNames.map((name) => `vitest.${name}.ts`)
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

  it('scopes the per-area npm scripts with the same --project flag', () => {
    for (const name of projectNames) {
      expect(pkg.scripts[`test:${name}`]).toContain(`--project ${name}`)
    }
  })
})
