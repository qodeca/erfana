// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLAIMS, checkClaims, main, readManifestVersions } from './check-version-drift.mjs'

// One line per CLAIMS entry, worded as the real docs word it today.
const DOCS = {
  'CLAUDE.md': [
    '- **Node Version**: 24+ (development), Electron 44 bundles Node.js 24.22.0',
    '- **Current version**: v0.21.0 (see [docs/CHANGELOG.md](docs/CHANGELOG.md); bump this line at release)',
  ].join('\n'),
  'SDLC.md': '| Product | Erfana |\n| Stack | Electron 44, TypeScript strict, React and Zustand |\n',
  'CONTRIBUTING.md': '- **Node.js 24+** (Electron 44 bundles Node.js 24.22.0; the build toolchain needs 24+).\n',
  'docs/getting-started.md': '- **Node.js**: 24+ — pinned in `.nvmrc` (Electron 44.9.0 bundles Node.js 24.22.0)\n',
  'docs/security.md': [
    '# Security Guidelines',
    '',
    '**Last Updated**: October 2026 (Electron 44)',
    '**Status**: stable (recorded under Electron 39; the app now runs Electron 44)',
    '- ✅ Full support for Electron 44.x (`^44.9.0` in `package.json`, 44.9.0 in the lockfile)',
  ].join('\r\n'),
  'docs/ui-style-guide.md': 'Erfana ships on Chromium 152 via Electron 44.x and unprefixed `user-select` works.\n',
  'docs/terminal/flickering-prevention.md': '> Written against Electron 39. The app now runs Electron 44 (Chromium 152).\n',
}

const quiet = { log: () => {}, error: () => {} }

let dir

function put(rel, content) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), content)
}

function manifests({ version = '0.21.0', electron = '^44.9.0', locked = '44.9.0' } = {}) {
  put('package.json', JSON.stringify({ name: 'erfana', version, devDependencies: { electron } }))
  const lockPackages = locked === null ? {} : { 'node_modules/electron': { version: locked } }
  put('package-lock.json', JSON.stringify({ version, packages: lockPackages }))
}

function capture() {
  const lines = []
  const sink = (...args) => lines.push(args.join(' '))
  return { lines, log: { log: sink, error: sink } }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'erfana-version-drift-'))
  for (const [rel, text] of Object.entries(DOCS)) put(rel, text)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readManifestVersions', () => {
  it('reads the app version, the Electron major, range and locked version', () => {
    manifests()
    expect(readManifestVersions(dir)).toEqual({ app: '0.21.0', electron: '44', range: '44.9.0', locked: '44.9.0' })
  })

  it('accepts a ~ range and an electron entry under dependencies', () => {
    put('package.json', JSON.stringify({ version: '1.2.3', dependencies: { electron: '~45.1.0' } }))
    put('package-lock.json', JSON.stringify({ packages: { 'node_modules/electron': { version: '45.1.2' } } }))
    expect(readManifestVersions(dir)).toEqual({ app: '1.2.3', electron: '45', range: '45.1.0', locked: '45.1.2' })
  })

  it('refuses a version that is not X.Y.Z', () => {
    manifests({ version: '0.21.0-beta.1' })
    expect(() => readManifestVersions(dir)).toThrow(/"version" is not X\.Y\.Z/)
  })

  it('refuses an electron range it cannot read', () => {
    manifests({ electron: '>=44' })
    expect(() => readManifestVersions(dir)).toThrow(/"electron" is not/)
  })

  it('refuses a lockfile without a resolved electron', () => {
    manifests({ locked: null })
    expect(() => readManifestVersions(dir)).toThrow(/no resolved electron version/)
  })
})

describe('CLAIMS', () => {
  it('gives every claim a pattern with exactly one capture group', () => {
    for (const claim of CLAIMS) {
      const groups = new RegExp(`${claim.pattern.source}|`).exec('').length - 1
      expect(groups, claim.pattern.source).toBe(1)
    }
  })

  it('matches each documented line, on its own line number', () => {
    manifests()
    const results = checkClaims(CLAIMS, readManifestVersions(dir), (rel) => DOCS[rel] ?? null)
    expect(results.filter((r) => !r.ok)).toEqual([])
    const banner = results.find((r) => r.claim.source === 'app')
    expect(banner).toMatchObject({ found: '0.21.0', line: 2 })
  })
})

describe('check-version-drift main', () => {
  it('passes when every documented version matches the manifests', () => {
    manifests()
    const { lines, log } = capture()
    expect(main(dir, CLAIMS, log)).toBe(0)
    expect(lines.join('\n')).toContain(`All ${CLAIMS.length} documented versions match`)
  })

  it('fails on a stale app version and names the file and line', () => {
    manifests({ version: '0.22.0' })
    const { lines, log } = capture()
    expect(main(dir, CLAIMS, log)).toBe(1)
    const out = lines.join('\n')
    expect(out).toContain('Version drift in 1 of')
    expect(out).toContain('CLAUDE.md:2 says 0.21.0; expected 0.22.0 (app)')
  })

  it('fails every Electron claim after an Electron upgrade the docs missed', () => {
    manifests({ electron: '^45.0.0', locked: '45.0.1' })
    const { lines, log } = capture()
    expect(main(dir, CLAIMS, log)).toBe(1)
    const out = lines.join('\n')
    expect(out).toContain(`Version drift in ${CLAIMS.length - 1} of ${CLAIMS.length}`)
    expect(out).toContain('SDLC.md:2 says 44; expected 45 (electron)')
    expect(out).toContain('docs/security.md:5 says 44.9.0; expected 45.0.0 (range)')
    expect(out).toContain('docs/getting-started.md:1 says 44.9.0; expected 45.0.1 (locked)')
  })

  it('fails when a claimed phrase was reworded away', () => {
    manifests()
    put('SDLC.md', '| Stack | TypeScript strict, React |\n')
    const { lines, log } = capture()
    expect(main(dir, CLAIMS, log)).toBe(1)
    expect(lines.join('\n')).toMatch(/SDLC\.md: phrase not found/)
  })

  it('fails when a claimed file is missing', () => {
    manifests()
    rmSync(path.join(dir, 'CONTRIBUTING.md'))
    const { lines, log } = capture()
    expect(main(dir, CLAIMS, log)).toBe(1)
    expect(lines.join('\n')).toMatch(/CONTRIBUTING\.md: file not found/)
  })

  it('fails without throwing when the manifests cannot be read', () => {
    const { lines, log } = capture()
    expect(main(dir, CLAIMS, log)).toBe(1)
    expect(lines.join('\n')).toContain('could not read the manifests')
  })

  it('takes a custom claim list', () => {
    manifests()
    put('notes.md', 'Built with Electron 39.\n')
    const claims = [{ file: 'notes.md', source: 'electron', pattern: /Electron (\d+)\./ }]
    expect(main(dir, claims, quiet)).toBe(1)
    put('notes.md', 'Built with Electron 44.\n')
    expect(main(dir, claims, quiet)).toBe(0)
  })
})
