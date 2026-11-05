// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createManualClock, realClock } from '../../../../shared/clock'
import {
  collectSourceHints,
  isResolvableSourcePath,
  locationFromAttributes,
  parseReactAnswer,
  resolveSourcePath,
  SOURCE_HINTS_BUDGET_MS
} from './sourceHints'

describe('sourceHints', () => {
  let root: string
  let outside: string

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'erfana-hints-')))
    outside = await realpath(await mkdtemp(path.join(tmpdir(), 'erfana-hints-out-')))
    await mkdir(path.join(root, 'src', 'components'), { recursive: true })
    await writeFile(path.join(root, 'src', 'components', 'Hero.tsx'), 'export {}')
    await writeFile(path.join(root, 'package.json'), '{}')
    await writeFile(path.join(outside, 'Secret.tsx'), 'export {}')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  describe('parseReactAnswer', () => {
    it('keeps only strings of the expected shape, cut to 500 code units, at most 5 owners', () => {
      const got = parseReactAnswer({
        component: 'x'.repeat(600),
        owners: ['A', 7, 'B', 'C', 'D', 'E', 'F'],
        source: { file: 'src/App.tsx', line: 12, column: 3 }
      })
      expect(got?.hints.component).toHaveLength(500)
      expect(got?.hints.ownerChain).toEqual(['A', 'B', 'C', 'D', 'E'])
      expect(got?.hints.source).toBe('src/App.tsx:12')
      expect(got?.location).toEqual({ path: 'src/App.tsx', line: 12 })
    })

    it('takes a source without a usable line as a path only', () => {
      expect(parseReactAnswer({ source: { file: 'a.tsx', line: -1 } })?.hints.source).toBe('a.tsx')
      expect(parseReactAnswer({ source: { file: 'a.tsx', line: '7' } })?.location).toEqual({ path: 'a.tsx', line: 7 })
    })

    it('gives null for a non-object or an answer with nothing in it', () => {
      expect(parseReactAnswer(null)).toBeNull()
      expect(parseReactAnswer('Hero')).toBeNull()
      expect(parseReactAnswer({ component: 5, owners: 'A', source: { file: '' } })).toBeNull()
    })
  })

  describe('locationFromAttributes', () => {
    it('prefers the inspector attributes, then data-source, data-source-file, data-component-path', () => {
      expect(locationFromAttributes([['data-inspector-relative-path', 'src/a.tsx'], ['data-inspector-line', '4']])).toEqual({ path: 'src/a.tsx', line: 4 })
      expect(locationFromAttributes([['data-inspector-relative-path', 'src/a.tsx']])).toEqual({ path: 'src/a.tsx' })
      expect(locationFromAttributes([['data-source', 'src/b.tsx:12:5']])).toEqual({ path: 'src/b.tsx', line: 12 })
      expect(locationFromAttributes([['data-source-file', 'src/c.tsx']])).toEqual({ path: 'src/c.tsx' })
      expect(locationFromAttributes([['data-component-path', 'src/d.tsx:3']])).toEqual({ path: 'src/d.tsx', line: 3 })
      expect(locationFromAttributes([['data-other', 'x']])).toBeNull()
    })
  })

  describe('isResolvableSourcePath (S-13)', () => {
    it.each([
      ['src/components/Hero.tsx', true],
      ['app/page.vue', true],
      ['styles/site.scss', true],
      ['.github/workflows/ci.js', false],
      ['src/.hidden.tsx', false],
      ['node_modules/react/index.js', false],
      ['CLAUDE.md', false],
      ['package.json', false],
      ['pnpm-lock.yaml', false],
      ['README.md', false],
      ['src//a.tsx', false],
      ['../a.tsx', false]
    ])('%s → %s', (rel, ok) => {
      expect(isResolvableSourcePath(rel)).toBe(ok)
    })
  })

  describe('resolveSourcePath', () => {
    it('accepts project-relative, absolute and file:// paths that name a real source file in the project', async () => {
      const file = path.join(root, 'src', 'components', 'Hero.tsx')
      expect(await resolveSourcePath(root, 'src/components/Hero.tsx')).toBe('src/components/Hero.tsx')
      expect(await resolveSourcePath(root, file)).toBe('src/components/Hero.tsx')
      expect(await resolveSourcePath(root, pathToFileURL(file).href)).toBe('src/components/Hero.tsx')
    })

    it('refuses a missing file, a folder, a refused name, a path outside, control characters and a link out of the project', async () => {
      expect(await resolveSourcePath(root, 'src/components/Missing.tsx')).toBeNull()
      expect(await resolveSourcePath(root, 'src/components')).toBeNull()
      expect(await resolveSourcePath(root, 'package.json')).toBeNull()
      expect(await resolveSourcePath(root, path.join(outside, 'Secret.tsx'))).toBeNull()
      expect(await resolveSourcePath(root, '../' + path.basename(outside) + '/Secret.tsx')).toBeNull()
      expect(await resolveSourcePath(root, 'src/a\u0007.tsx')).toBeNull()
      expect(await resolveSourcePath(root, '')).toBeNull()
      expect(await resolveSourcePath(root, 'file://%zz')).toBeNull()
      await symlink(path.join(outside, 'Secret.tsx'), path.join(root, 'src', 'Linked.tsx'))
      expect(await resolveSourcePath(root, 'src/Linked.tsx')).toBeNull()
    })
  })

  describe('collectSourceHints (025-FR-037)', () => {
    it('stops at the nearest element with source attributes and resolves its path; the React lookup does not run', async () => {
      let looked = false
      const hints = await collectSourceHints({
        attributesNearestFirst: [[], [['data-source', 'src/components/Hero.tsx:42']], [['data-source', 'src/Other.tsx']]],
        reactLookup: async () => {
          looked = true
          return null
        },
        projectRoot: root,
        clock: realClock
      })
      expect(looked).toBe(false)
      expect(hints).toEqual({
        sourceAttributes: [['data-source', 'src/components/Hero.tsx:42']],
        react: null,
        sourceNotFound: false,
        resolvedSource: { path: 'src/components/Hero.tsx', line: 42 }
      })
    })

    it('keeps attributes whose path does not resolve, with no resolved source', async () => {
      const hints = await collectSourceHints({ attributesNearestFirst: [[['data-source', 'nope.tsx:1']]], projectRoot: root, clock: realClock })
      expect(hints.resolvedSource).toBeUndefined()
      expect(hints.sourceNotFound).toBe(false)
      const noProject = await collectSourceHints({ attributesNearestFirst: [[['data-source', 'src/components/Hero.tsx']]], projectRoot: null, clock: realClock })
      expect(noProject.resolvedSource).toBeUndefined()
    })

    it('falls back to the React lookup, and resolves its source', async () => {
      const hints = await collectSourceHints({
        attributesNearestFirst: [[], []],
        reactLookup: async () => ({ component: 'Hero', owners: ['App'], source: { file: 'src/components/Hero.tsx', line: 3 } }),
        projectRoot: root,
        clock: realClock
      })
      expect(hints.react).toEqual({ component: 'Hero', ownerChain: ['App'], source: 'src/components/Hero.tsx:3' })
      expect(hints.resolvedSource).toEqual({ path: 'src/components/Hero.tsx', line: 3 })
      expect(hints.sourceNotFound).toBe(false)
    })

    it('says source not found for a component without a source, a junk answer, a throwing lookup, or no lookup while frozen', async () => {
      const base = { attributesNearestFirst: [[]], projectRoot: root, clock: realClock }
      expect((await collectSourceHints({ ...base, reactLookup: async () => ({ component: 'Hero' }) })).sourceNotFound).toBe(true)
      expect((await collectSourceHints({ ...base, reactLookup: async () => 42 })).sourceNotFound).toBe(true)
      expect((await collectSourceHints({ ...base, reactLookup: async () => Promise.reject(new Error('page')) })).sourceNotFound).toBe(true)
      expect(await collectSourceHints(base)).toEqual({ sourceAttributes: [], react: null, sourceNotFound: true })
    })

    describe('React 19 source lookup (owner decision 2026-11-05)', () => {
      const react19 = async () => ({ component: 'ItemRow', owners: ['App'], source: null })
      const base = { attributesNearestFirst: [[]], reactLookup: react19, clock: realClock }

      it('names the first candidate that resolves in the project, as source and resolved source', async () => {
        const hints = await collectSourceHints({
          ...base,
          projectRoot: root,
          reactSourceLookup: async () => [
            { path: 'Users/me/src/components/Hero.tsx', line: 9 },
            { path: path.join(root, 'src', 'components', 'Hero.tsx'), line: 9 }
          ]
        })
        expect(hints.react).toEqual({ component: 'ItemRow', ownerChain: ['App'], source: 'src/components/Hero.tsx:9' })
        expect(hints.resolvedSource).toEqual({ path: 'src/components/Hero.tsx', line: 9 })
        expect(hints.sourceNotFound).toBe(false)
      })

      it('reports a mapped source outside the project in the untrusted block only, never as resolved source', async () => {
        const hints = await collectSourceHints({
          ...base,
          projectRoot: root,
          reactSourceLookup: async () => [{ path: path.join(outside, 'Secret.tsx'), line: 3 }]
        })
        expect(hints.react?.source).toBe(`${path.join(outside, 'Secret.tsx')}:3`)
        expect(hints.resolvedSource).toBeUndefined()
        const noProject = await collectSourceHints({ ...base, projectRoot: null, reactSourceLookup: async () => [{ path: 'src/components/Hero.tsx' }] })
        expect(noProject.react?.source).toBe('src/components/Hero.tsx')
        expect(noProject.resolvedSource).toBeUndefined()
      })

      it('says source not found when the lookup finds nothing, rejects, or is absent', async () => {
        for (const reactSourceLookup of [async () => [], async () => Promise.reject(new Error('page')), undefined]) {
          const hints = await collectSourceHints({ ...base, projectRoot: root, reactSourceLookup })
          expect(hints.sourceNotFound).toBe(true)
          expect(hints.react?.source).toBeNull()
        }
      })

      it('does not run when the React lookup already gave a source (React 18)', async () => {
        let ran = false
        const hints = await collectSourceHints({
          ...base,
          reactLookup: async () => ({ component: 'Hero', source: { file: 'src/components/Hero.tsx', line: 3 } }),
          projectRoot: root,
          reactSourceLookup: async () => {
            ran = true
            return []
          }
        })
        expect(ran).toBe(false)
        expect(hints.resolvedSource).toEqual({ path: 'src/components/Hero.tsx', line: 3 })
      })

      it('aborts its reads when the 750 ms budget ends, and gives source not found', async () => {
        const clock = createManualClock()
        let signal: AbortSignal | null = null
        const pending = collectSourceHints({
          ...base,
          projectRoot: root,
          clock,
          reactSourceLookup: (s) => {
            signal = s
            return new Promise(() => undefined)
          }
        })
        await vi.waitFor(() => expect(signal).not.toBeNull())
        expect(signal!.aborted).toBe(false)
        clock.advance(SOURCE_HINTS_BUDGET_MS)
        await expect(pending).resolves.toEqual({ sourceAttributes: [], react: null, sourceNotFound: true })
        expect(signal!.aborted).toBe(true)
      })
    })

    it('gives source not found when the search runs past the 750 ms budget, and never rejects', async () => {
      const clock = createManualClock()
      let finish: (v: unknown) => void = () => undefined
      const pending = collectSourceHints({
        attributesNearestFirst: [[]],
        reactLookup: () => new Promise((resolve) => (finish = resolve)),
        projectRoot: root,
        clock
      })
      clock.advance(SOURCE_HINTS_BUDGET_MS - 1)
      clock.advance(1)
      await expect(pending).resolves.toEqual({ sourceAttributes: [], react: null, sourceNotFound: true })
      finish({ component: 'Late' })
      expect(SOURCE_HINTS_BUDGET_MS).toBe(750)
    })
  })
})
