// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared overlay core stays pure (spec 024 § 2 overlay decision C, § 8
 * C15, 024-NFR-005 item 1; docs/adrs/0006-overlay-core-in-the-sealed-preload.md).
 *
 * `src/shared/comments/overlayCore/` is the one folder outside its own entry
 * that the sealed preview-page preload may import, and the preload runs
 * inside the untrusted page and every frame of it. What keeps that safe is
 * that the folder can do nothing but compute: these rules fail the moment a
 * file there imports anything, touches a host global (DOM, Node, Electron)
 * or runs code on load. Each rule reads the TypeScript syntax tree
 * (`__tests__/sourceScan.ts`), and each is proved against a bad sample, so it
 * cannot pass by finding nothing.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { freeIdentifiers, loadEffects, moduleReferences } from './__tests__/sourceScan'

const OVERLAY_CORE_DIR = join(__dirname, '..', 'shared', 'comments', 'overlayCore')

/** Every non-test module of the core, path → text. */
const CORE: ReadonlyMap<string, string> = new Map(
  readdirSync(OVERLAY_CORE_DIR)
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map(name => [join(OVERLAY_CORE_DIR, name), readFileSync(join(OVERLAY_CORE_DIR, name), 'utf8')])
)

/** Host globals the core must never reach (the list the ADR names, and their neighbours). */
const HOST_GLOBALS = [
  'window',
  'document',
  'globalThis',
  'self',
  'navigator',
  'location',
  'localStorage',
  'process',
  'require',
  'module',
  'Buffer',
  'ipcRenderer',
  'electron',
  'setTimeout',
  'fetch',
  'Date',
  'Element'
] as const

describe('overlayCore contract (024-AC-028 trust boundaries)', () => {
  it('024-AC-028 scans the three overlay rules, and only modules (no subfolder is importable)', () => {
    const names = [...CORE.keys()].map(path => path.slice(OVERLAY_CORE_DIR.length + 1)).sort()
    expect(names).toEqual(expect.arrayContaining(['gesture.ts', 'modeState.ts', 'pinLayout.ts']))
    for (const entry of readdirSync(OVERLAY_CORE_DIR, { withFileTypes: true })) {
      expect(entry.isFile(), `${entry.name} must be a file: the preload may import the folder's modules only`).toBe(true)
    }
  })

  it('024-AC-028 no overlayCore file imports, re-exports, requires or loads a module', () => {
    for (const [path, text] of CORE) {
      expect(moduleReferences(path, text), path).toEqual([])
    }
  })

  it('024-AC-028 no overlayCore file touches a DOM, Node or Electron global', () => {
    for (const [path, free] of freeIdentifiers(CORE)) {
      expect(free, path).toEqual([])
    }
  })

  it('024-AC-028 no overlayCore file runs code on load or keeps module state', () => {
    for (const [path, text] of CORE) {
      expect(loadEffects(path, text), path).toEqual([])
    }
  })

  describe('the scans catch what they ban', () => {
    it('024-AC-028 counts every way to load a module, and nothing in a comment or a string', () => {
      const sample = [
        "import { a } from './a'",
        "import type { B } from '../b'",
        "import * as c from 'c'",
        "export { d as e } from './d'",
        "export * from './f'",
        "import g = require('g')",
        "const h = require('h')",
        "const i = import('i')",
        "type J = import('j').J",
        '// import x from "comment"',
        "const k = \"import y from 'string'\"",
        "import 'side-effect'"
      ].join('\n')
      expect(moduleReferences('sample.ts', sample).map(r => [r.specifier, r.names, r.line])).toEqual([
        ['./a', ['a'], 1],
        ['../b', ['B'], 2],
        ['c', ['*'], 3],
        ['./d', ['d'], 4],
        ['./f', ['*'], 5],
        ['g', ['default'], 6],
        ['h', [], 7],
        ['i', [], 8],
        ['j', [], 9],
        ['side-effect', [], 12]
      ])
    })

    it('024-AC-028 flags every host global, and Math.random, but not a local of the same name', () => {
      const bad = HOST_GLOBALS.map((name, i) =>
        name === 'Element' ? `export type T${i} = Element` : `export const v${i} = ${name}`
      )
      const sample = [
        ...bad,
        'export const r = Math.random()',
        'export function ok(window: number): number { return Math.max(window, 0) }'
      ].join('\n')
      const free = freeIdentifiers(new Map([[join(OVERLAY_CORE_DIR, '__sample__.ts'), sample]]))
      const names = [...free.values()][0].map(entry => entry.replace(/ \(line \d+\)$/, ''))
      expect(names).toEqual([...HOST_GLOBALS, 'Math.random'])
    })

    it('024-AC-028 flags code that runs on load and module state', () => {
      const sample = [
        'console.log(1)',
        'let counter = 0',
        'export const made = make()',
        'export const built = new Map()',
        'class Holder {}',
        'export const later = () => make()',
        'export const LIMIT = { x: 1 } as const',
        'function make(): number { return 1 }'
      ].join('\n')
      expect(loadEffects('sample.ts', sample)).toEqual([
        'ExpressionStatement (line 1)',
        'a module-level `let` or `var` (line 2)',
        'a module-level value computed by running code (made) (line 3)',
        'a module-level value computed by running code (built) (line 4)',
        'ClassDeclaration (line 5)'
      ])
    })
  })
})
