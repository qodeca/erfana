// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// 025-FR-041: each Electron update opens its own pull request the day it appears.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'

const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'dependabot.yml')
const config = yaml.load(readFileSync(configPath, 'utf8'))
const npmBlocks = config.updates.filter(u => u['package-ecosystem'] === 'npm')

/** True when a Dependabot group pattern list would catch the package name. */
function patternCatches(patterns, name) {
  return (patterns ?? []).some(p => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(name))
}

describe('Dependabot rule for Electron', () => {
  it('025-AC-041 keeps electron out of every version-update and security-update group and checks it daily', () => {
    expect(npmBlocks.length).toBeGreaterThan(0)
    for (const block of npmBlocks) {
      // Electron must not be ignored, or no PR would open at all.
      expect((block.ignore ?? []).map(i => i['dependency-name'])).not.toContain('electron')
      expect(block.schedule.interval).toBe('daily')
      for (const [name, group] of Object.entries(block.groups ?? {})) {
        const included = group.patterns ? patternCatches(group.patterns, 'electron') : true
        const excluded = patternCatches(group['exclude-patterns'], 'electron')
        expect({ group: name, groupsElectron: included && !excluded }).toEqual({ group: name, groupsElectron: false })
      }
    }
  })

  it('025-AC-041 pattern matcher treats * as a wildcard', () => {
    expect(patternCatches(['*'], 'electron')).toBe(true)
    expect(patternCatches(['electron*'], 'electron-builder')).toBe(true)
    expect(patternCatches(['@xterm/*'], 'electron')).toBe(false)
  })
})
