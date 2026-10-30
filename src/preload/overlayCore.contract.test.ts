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
import {
  BARE_REQUIRE,
  freeIdentifiers,
  isTypeScriptSourceName,
  loadEffects,
  moduleReferences,
  typeErrors
} from './__tests__/sourceScan'

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

  it('024-AC-028 holds TypeScript sources only, so the bundle cannot load a file the scans never read', () => {
    // Vite would bundle a stray `pinLayout.js` beside `pinLayout.ts` if its
    // extension order ever put `.js` first again; a `.d.ts` could declare host
    // globals. Neither may exist here.
    for (const name of readdirSync(OVERLAY_CORE_DIR)) {
      expect(isTypeScriptSourceName(name), `${name} is not a TypeScript source module`).toBe(true)
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

  it('024-AC-028 every overlayCore file type-checks against the ES2022 library alone', () => {
    for (const [path, errors] of typeErrors(CORE)) {
      expect(errors, path).toEqual([])
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
        'ClassDeclaration (line 5)',
        'a module-level object that is not frozen (LIMIT) (line 7)'
      ])
    })

    it('024-AC-028 allows only primitive literals and Object.freeze of them at module level', () => {
      const sample = [
        "export const FROZEN = Object.freeze({ x: 2, 'y': -22, on: true, none: null } as const)",
        'export const NEG = -1',
        'export const ALIAS = NEG',
        'export const DEEP = Object.freeze({ inner: { x: 1 } })',
        'export const READ = Math.PI',
        'export const AT = LIST[0]',
        'export const SPREAD = Object.freeze({ ...FROZEN })',
        'export const TEXT = `${NEG}`',
        'export const PLAIN = `plain`',
        'export const GETTER = Object.freeze({ get x() { return 1 } })',
        'export const LIST = [1, 2]',
        'export const KEYED = Object.freeze({ [ALIAS]: 1 })',
        'declare const window: unknown',
        'export const { x } = FROZEN',
        'export const OTHER = Other.freeze({ x: 1 })'
      ].join('\n')
      expect(loadEffects('sample.ts', sample)).toEqual([
        'a module-level value computed by running code (DEEP) (line 4)',
        'a module-level value computed by running code (READ) (line 5)',
        'a module-level value computed by running code (AT) (line 6)',
        'a module-level value computed by running code (SPREAD) (line 7)',
        'a module-level value computed by running code (TEXT) (line 8)',
        'a module-level value computed by running code (PLAIN) (line 9)',
        'a module-level value computed by running code (GETTER) (line 10)',
        'a module-level object that is not frozen (LIST) (line 11)',
        'a module-level value computed by running code (KEYED) (line 12)',
        'a `declare` statement (line 13)',
        'a module-level value computed by running code ({ x }) (line 14)',
        'a module-level value computed by running code (OTHER) (line 15)'
      ])
    })

    it('024-AC-028 counts a require that is named but not called', () => {
      const sample = [
        'const r = require',
        'use(require)',
        'export const o = { require }',
        'const member = x.require',
        "const h = require('h')"
      ].join('\n')
      expect(moduleReferences('sample.ts', sample).map(r => [r.specifier, r.line])).toEqual([
        [BARE_REQUIRE, 1],
        [BARE_REQUIRE, 2],
        [BARE_REQUIRE, 3],
        ['h', 5]
      ])
    })

    /** What the free-name scan reports for one sample file named `name`, without line numbers. */
    function freeIn(sample: string, name = '__sample__.ts'): string[] {
      const free = freeIdentifiers(new Map([[join(OVERLAY_CORE_DIR, name), sample]]))
      return [...free.values()][0].map(entry => entry.replace(/ \(line \d+\)$/, ''))
    }

    it('024-AC-028 flags a declare that would make a host global look local, and a declaration file', () => {
      expect(freeIn('declare const window: any\nexport const w = window')).toEqual(['a `declare` statement'])
      expect(freeIn('declare global { var document: any }\nexport const d = document')).toEqual(['a `declare` statement'])
      expect(freeIn('declare var window: any', '__sample__.d.ts')).toEqual(['a declaration file', 'a `declare` statement'])
      expect(freeIn('/// <reference lib="dom" />\nexport const n = 1')).toEqual(['/// <reference dom>'])
    })

    it('024-AC-028 flags a host global copied by a shorthand property', () => {
      expect(freeIn('export function leak(): unknown { return { document } }')).toEqual(['document'])
      expect(freeIn('export function ok(document: number): unknown { return { document } }')).toEqual([])
    })

    it('024-AC-028 flags a climb up the prototype chain and every element access', () => {
      expect(freeIn("export const g = Math.max.constructor('return this')()")).toEqual(['constructor'])
      expect(freeIn('export const p = Math.max.prototype')).toEqual(['prototype'])
      expect(freeIn('export function q(o: { __proto__: unknown }): unknown { return o.__proto__ }')).toEqual(['__proto__', '__proto__'])
      expect(freeIn("export const e = Math.max['constructor']")).toEqual(['an element access'])
      expect(freeIn('export function at(list: readonly number[]): number | undefined { return list[0] }')).toEqual(['an element access'])
    })

    it('024-AC-028 lets Object through for freeze only', () => {
      expect(freeIn('export const F = Object.freeze({ a: 1 })')).toEqual([])
      expect(freeIn('export const k = Object.keys')).toEqual(['Object'])
    })

    it('024-AC-028 reports type errors, including a name that resolves to nothing', () => {
      const errors = typeErrors(new Map([[join(OVERLAY_CORE_DIR, '__sample__.ts'), 'export const w = window\nexport const n: number = "x"']]))
      const found = [...errors.values()][0]
      expect(found).toEqual([
        expect.stringMatching(/Cannot find name 'window'.*\(line 1\)$/),
        expect.stringMatching(/not assignable to type 'number'.*\(line 2\)$/)
      ])
    })

    it('024-AC-028 accepts TypeScript source names only', () => {
      for (const good of ['pinLayout.ts', 'pinLayout.test.ts', 'overlay.conformance.test.ts']) {
        expect(isTypeScriptSourceName(good), good).toBe(true)
      }
      for (const bad of ['pinLayout.js', 'pinLayout.mjs', 'pinLayout.d.ts', 'pinLayout.tsx', 'pin-layout.ts', 'pinLayout.ts.bak', '.ts', 'pinLayout.TS']) {
        expect(isTypeScriptSourceName(bad), bad).toBe(false)
      }
    })
  })
})
