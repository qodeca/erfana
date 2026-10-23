// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * FileService tree walk – lazy folders, parallel reads, the entry cap and the
 * sort order (review finding 32).
 *
 * An ignored folder (`watcher.ignoreList`, on whole segments) is shown but not
 * read: its row carries `lazy: 'ignored'` and an empty `children`, and a walk of
 * that folder on its own lists one level of it. Sub-folders are read with at
 * most {@link WALK_READ_CONCURRENCY} `readdir` calls in flight, a walk past
 * {@link MAX_WALK_ENTRIES} rows leaves the rest of its folders lazy, and the
 * order stays folders first, then `localeCompare` order.
 *
 * `fs/promises` is mocked per test: by folder path, with an optional delay, so
 * the walk's parallelism is observable. Split from the main FileService suite
 * because the mocks hoist to module scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import path from 'path'

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('./LoggingService', () => ({ logger: mockLogger }))

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return { ...actual, readdir: vi.fn(), stat: vi.fn(), realpath: vi.fn() }
})

import { readdir, realpath, stat } from 'fs/promises'
import {
  FileService,
  MAX_WALK_ENTRIES,
  WALK_READ_CONCURRENCY,
  compareTreeNodes,
  type FileNode
} from './FileService'
import { ProjectPathFilter } from '../utils/projectPathFilter'

const readdirMock = readdir as unknown as Mock
const statMock = stat as unknown as Mock
const realpathMock = realpath as unknown as Mock
const COMPLETED = 'FileService: readDirectory completed'

type Kind = 'dir' | 'file' | 'link'
const dirent = (name: string, kind: Kind) => ({
  name,
  isDirectory: () => kind === 'dir',
  isFile: () => kind === 'file',
  isSymbolicLink: () => kind === 'link'
})

const abs = (...parts: string[]): string => path.resolve(path.sep, ...parts)
const ROOT = abs('proj')
const at = (...parts: string[]): string => abs('proj', ...parts)

/** readdir answers by folder path; stat/realpath answer by link path */
let listing: Record<string, ReturnType<typeof dirent>[]>
let statDir: Record<string, boolean>
let real: Record<string, string>
let inFlight: number
let maxInFlight: number

/** Let the event loop turn, so overlapping reads really overlap. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function makeService(ignore: string[] = ['dist', '.venv', '.yarn/cache']): FileService {
  const service = new FileService()
  service.setProjectPath(ROOT)
  service.setPathFilter(
    new ProjectPathFilter(ROOT, {
      exclude: [],
      hiddenPatterns: ['node_modules', '.git'],
      ignorePatterns: ignore,
      caseSensitive: true
    })
  )
  service.bindSession({
    current: () =>
      ({ root: ROOT, realRoot: ROOT, caseSensitive: true, generation: 1, ownerWebContentsId: null }) as never
  })
  return service
}

/** Every folder the walk listed, relative to the project root. */
const foldersRead = (): string[] =>
  readdirMock.mock.calls.map(([dir]) => path.relative(ROOT, path.resolve(String(dir))).split(path.sep).join('/')).sort()

const byName = (nodes: FileNode[]): Record<string, FileNode> =>
  Object.fromEntries(nodes.map((node) => [node.name, node]))

const countRows = (nodes: FileNode[]): number =>
  nodes.reduce((sum, node) => sum + 1 + (node.children ? countRows(node.children) : 0), 0)

function completedLine(): Record<string, unknown> {
  const call = mockLogger.info.mock.calls.find(([message]) => message === COMPLETED)
  return (call?.[1] ?? {}) as Record<string, unknown>
}

beforeEach(() => {
  vi.resetAllMocks()
  listing = {}
  statDir = {}
  real = {}
  inFlight = 0
  maxInFlight = 0
  readdirMock.mockImplementation(async (dir: string) => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await tick()
    inFlight--
    return listing[path.resolve(dir)] ?? []
  })
  statMock.mockImplementation(async (p: string) => {
    const key = path.resolve(p)
    if (!(key in statDir)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return { isDirectory: () => statDir[key] }
  })
  realpathMock.mockImplementation(async (p: string) => {
    await tick()
    return real[path.resolve(p)] ?? path.resolve(p)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FileService.readDirectory – lazy ignored folders (finding 32)', () => {
  it('shows an ignored folder as a lazy row and never reads it', async () => {
    listing[ROOT] = [dirent('dist', 'dir'), dirent('docs', 'dir'), dirent('a.md', 'file')]
    listing[at('dist')] = [dirent('bundle.js', 'file'), dirent('chunks', 'dir')]
    listing[at('docs')] = [dirent('b.md', 'file')]

    const tree = await makeService().readDirectory(ROOT)

    const nodes = byName(tree)
    expect(nodes.dist).toEqual({ name: 'dist', path: at('dist'), type: 'directory', children: [], lazy: 'ignored' })
    expect(nodes.docs.lazy).toBeUndefined()
    expect(nodes.docs.children?.map((c) => c.name)).toEqual(['b.md'])
    expect(foldersRead()).toEqual(['', 'docs'])
    expect(completedLine()).toMatchObject({ folderReadCount: 2, lazyFolderCount: 1, entryCapReached: false })
  })

  it('leaves nested and multi-segment ignored folders lazy, on whole segments only', async () => {
    listing[ROOT] = [dirent('packages', 'dir'), dirent('.yarn', 'dir'), dirent('outline', 'dir')]
    listing[at('packages')] = [dirent('app', 'dir')]
    listing[at('packages', 'app')] = [dirent('dist', 'dir'), dirent('src', 'dir')]
    listing[at('.yarn')] = [dirent('cache', 'dir'), dirent('releases', 'dir')]
    listing[at('outline')] = [dirent('plan.md', 'file')]

    const tree = await makeService(['dist', 'out', '.yarn/cache']).readDirectory(ROOT)

    const app = byName(byName(byName(tree).packages.children!).app.children!)
    expect(app.dist.lazy).toBe('ignored')
    expect(app.src.lazy).toBeUndefined()
    const yarn = byName(byName(tree)['.yarn'].children!)
    expect(yarn.cache.lazy).toBe('ignored')
    expect(yarn.releases.lazy).toBeUndefined()
    // `out` is ignored, but `outline` only contains it – still read in full
    expect(byName(tree).outline.children?.map((c) => c.name)).toEqual(['plan.md'])
    expect(foldersRead()).toEqual(['', '.yarn', '.yarn/releases', 'outline', 'packages', 'packages/app', 'packages/app/src'])
  })

  it('reads one level of an ignored folder when it is walked on its own, its sub-folders lazy', async () => {
    listing[at('dist')] = [dirent('chunks', 'dir'), dirent('bundle.js', 'file')]
    listing[at('dist', 'chunks')] = [dirent('c1.js', 'file')]

    const tree = await makeService().readDirectory(at('dist'))

    expect(tree.map((n) => [n.name, n.lazy])).toEqual([
      ['chunks', 'ignored'],
      ['bundle.js', undefined]
    ])
    expect(foldersRead()).toEqual(['dist'])
  })

  it('reads every folder when no project filter applies', async () => {
    listing[ROOT] = [dirent('dist', 'dir')]
    listing[at('dist')] = [dirent('bundle.js', 'file')]
    const service = makeService()
    service.setPathFilter(null)

    const tree = await service.readDirectory(ROOT)

    expect(tree[0].lazy).toBeUndefined()
    expect(tree[0].children?.map((c) => c.name)).toEqual(['bundle.js'])
  })

  it('leaves a link to an ignored folder lazy instead of entering it', async () => {
    listing[ROOT] = [dirent('built', 'link'), dirent('dist', 'dir')]
    listing[at('dist')] = [dirent('bundle.js', 'file')]
    statDir[at('built')] = true
    real[at('built')] = at('dist')

    const tree = await makeService().readDirectory(ROOT)

    const built = byName(tree).built
    expect(built).toMatchObject({ type: 'directory', isSymlink: true, children: [], lazy: 'ignored' })
    expect(foldersRead()).toEqual([''])
  })
})

describe('FileService.readDirectory – parallel reads (finding 32)', () => {
  it('reads sibling folders in parallel, never more than the limit at once', async () => {
    const names = Array.from({ length: WALK_READ_CONCURRENCY * 3 }, (_, i) => `d${i}`)
    listing[ROOT] = names.map((name) => dirent(name, 'dir'))
    for (const name of names) listing[at(name)] = [dirent('a.md', 'file'), dirent('sub', 'dir')]

    const tree = await makeService().readDirectory(ROOT)

    // The finding asks for 16–32 reads in flight; the walk fills every slot
    expect(WALK_READ_CONCURRENCY).toBeGreaterThanOrEqual(16)
    expect(WALK_READ_CONCURRENCY).toBeLessThanOrEqual(32)
    expect(maxInFlight).toBe(WALK_READ_CONCURRENCY)
    expect(readdirMock).toHaveBeenCalledTimes(1 + names.length * 2)
    expect(countRows(tree)).toBe(names.length * 3)
  })

  it('leaves a link past the walk\'s link bound `capped`, not `linked` (review of #320, item 5)', async () => {
    const targets = 201
    listing[ROOT] = [dirent('links', 'dir'), ...Array.from({ length: targets }, (_, i) => dirent(`t${i}`, 'dir'))]
    listing[at('links')] = Array.from({ length: targets }, (_, i) => dirent(`l${i}`, 'link'))
    for (let i = 0; i < targets; i++) {
      listing[at(`t${i}`)] = [dirent('x.md', 'file')]
      statDir[at('links', `l${i}`)] = true
      real[at('links', `l${i}`)] = at(`t${i}`)
    }

    const tree = await makeService().readDirectory(ROOT)

    const links = byName(tree).links.children!
    expect(links.filter((link) => link.lazy === 'capped')).toHaveLength(1)
    expect(links.filter((link) => link.lazy === undefined && link.children!.length === 1)).toHaveLength(targets - 1)
  })

  it('enters a folder reached by two links at once only once per walk', async () => {
    listing[ROOT] = [dirent('a', 'dir'), dirent('b', 'dir'), dirent('docs', 'dir')]
    listing[at('a')] = [dirent('toDocs', 'link')]
    listing[at('b')] = [dirent('toDocs', 'link')]
    listing[at('docs')] = [dirent('x.md', 'file')]
    for (const parent of ['a', 'b']) {
      statDir[at(parent, 'toDocs')] = true
      real[at(parent, 'toDocs')] = at('docs')
    }

    const tree = await makeService().readDirectory(ROOT)

    const links = ['a', 'b'].map((parent) => byName(tree)[parent].children![0])
    // Both links resolve in parallel; exactly one of them enters the folder
    expect(links.map((link) => link.children!.length).sort()).toEqual([0, 1])
    // The other is not a loop: it stays expandable, as a `linked` lazy row – its files are in the tree via docs (review of #320, item 5)
    expect(links.map((link) => link.lazy ?? null).sort()).toEqual(['linked', null])
  })

  it('keeps a link back to its own ancestor an empty row, not a lazy one', async () => {
    listing[ROOT] = [dirent('docs', 'dir')]
    listing[at('docs')] = [dirent('up', 'link')]
    statDir[at('docs', 'up')] = true
    real[at('docs', 'up')] = ROOT

    const tree = await makeService().readDirectory(ROOT)

    const up = tree[0].children![0]
    expect(up).toMatchObject({ type: 'directory', children: [] })
    expect(up.lazy).toBeUndefined()
  })

  it('resolves folder links within the same limit as the folder reads', async () => {
    // Every stat, realpath and readdir counts against one in-flight total
    const counted = <T extends unknown[], R>(fn: (...args: T) => Promise<R>) => async (...args: T): Promise<R> => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        await tick()
        return await fn(...args)
      } finally {
        inFlight--
      }
    }
    const names = Array.from({ length: WALK_READ_CONCURRENCY * 3 }, (_, i) => `l${i}`)
    listing[ROOT] = [...names.map((name) => dirent(name, 'link')), dirent('docs', 'dir')]
    for (const name of names) {
      statDir[at(name)] = true
      real[at(name)] = at('docs')
    }
    const statImpl = statMock.getMockImplementation()!
    const realImpl = realpathMock.getMockImplementation()!
    readdirMock.mockImplementation(counted(async (dir: string) => listing[path.resolve(dir)] ?? []))
    statMock.mockImplementation(counted(statImpl))
    realpathMock.mockImplementation(counted(realImpl))

    await makeService().readDirectory(ROOT)

    expect(maxInFlight).toBeGreaterThan(1)
    expect(maxInFlight).toBeLessThanOrEqual(WALK_READ_CONCURRENCY)
  })
})

describe('FileService.readDirectory – shallow expand reads (review item 5)', () => {
  it('lists one level only, leaving every sub-folder lazy with its reason', async () => {
    listing[at('docs')] = [dirent('a', 'dir'), dirent('dist', 'dir'), dirent('x.md', 'file')]
    listing[at('docs', 'a')] = [dirent('deep.md', 'file')]

    const tree = await makeService().readDirectory(at('docs'), { shallow: true })

    expect(tree.map((n) => [n.name, n.lazy])).toEqual([
      ['a', 'capped'],
      ['dist', 'ignored'],
      ['x.md', undefined]
    ])
    expect(foldersRead()).toEqual(['docs'])
    expect(completedLine()).toMatchObject({ shallow: true, entryCapReached: false, lazyFolderCount: 2 })
  })

  it('never replaces the walk hints from a shallow read of the root', async () => {
    listing[ROOT] = [dirent('packages', 'dir')]
    listing[at('packages')] = [dirent('a', 'dir')]
    listing[at('packages', 'a')] = [dirent('dist', 'dir')]
    const service = makeService()
    await service.readDirectory(ROOT)
    const filter = (service as unknown as { pathFilter: ProjectPathFilter }).pathFilter
    expect(filter.getWalkHints()).toEqual(['packages/a/dist'])

    await service.readDirectory(ROOT, { shallow: true })

    expect(filter.getWalkHints()).toEqual(['packages/a/dist'])
  })

  it('runs a shallow and a full read of one path separately', async () => {
    listing[at('docs')] = [dirent('a', 'dir')]
    listing[at('docs', 'a')] = [dirent('deep.md', 'file')]
    const service = makeService()

    const [shallow, full] = await Promise.all([
      service.readDirectory(at('docs'), { shallow: true }),
      service.readDirectory(at('docs'))
    ])

    expect(shallow[0]).toMatchObject({ lazy: 'capped', children: [] })
    expect(full[0].lazy).toBeUndefined()
    expect(full[0].children?.map((c) => c.name)).toEqual(['deep.md'])
  })
})

describe('FileService.readDirectory – entry cap (finding 32)', () => {
  /** `folders` folders of `perFolder` files each under the root. */
  function wideTree(folders: number, perFolder: number): void {
    listing[ROOT] = Array.from({ length: folders }, (_, i) => dirent(`f${String(i).padStart(3, '0')}`, 'dir'))
    for (let i = 0; i < folders; i++) {
      listing[at(`f${String(i).padStart(3, '0')}`)] = Array.from({ length: perFolder }, (_, j) =>
        dirent(`n${j}.md`, 'file')
      )
    }
  }

  it('leaves the folders past the cap lazy, so a huge tree still opens bounded', async () => {
    const perFolder = 2_000
    const folders = Math.ceil((MAX_WALK_ENTRIES * 2) / perFolder)
    wideTree(folders, perFolder)

    const tree = await makeService().readDirectory(ROOT)

    const lazy = tree.filter((node) => node.lazy === 'capped')
    expect(lazy.length).toBeGreaterThan(0)
    expect(lazy.every((node) => node.children?.length === 0)).toBe(true)
    // Reads in flight when the cap is reached still finish
    expect(countRows(tree)).toBeLessThanOrEqual(MAX_WALK_ENTRIES + folders + WALK_READ_CONCURRENCY * perFolder)
    expect(countRows(tree)).toBeGreaterThanOrEqual(MAX_WALK_ENTRIES)
    expect(completedLine()).toMatchObject({ entryCapReached: true, lazyFolderCount: lazy.length })

    // A capped folder is read on its own when expanded
    readdirMock.mockClear()
    const expanded = await makeService().readDirectory(lazy[0].path)
    expect(expanded).toHaveLength(perFolder)
  })

  it('always reads the base folder, however many entries it has', async () => {
    listing[ROOT] = Array.from({ length: MAX_WALK_ENTRIES + 10 }, (_, i) => dirent(`n${i}.md`, 'file'))

    const tree = await makeService().readDirectory(ROOT)

    expect(tree).toHaveLength(MAX_WALK_ENTRIES + 10)
    expect(completedLine()).toMatchObject({ entryCapReached: false })
  })
})

describe('FileService.readDirectory – sort order (finding 32)', () => {
  const NAMES = [
    'b.md', 'B.md', 'a.md', 'A.md', 'ä.md', 'Ä.md', 'z.md', 'Z.md', 'ł.md', 'l.md', 'é.md', 'e.md',
    '10.md', '2.md', '1.md', '_x.md', '-x.md', '.hidden', '~tmp', 'ß.md', 'ss.md', 'Ω.md', '中.md',
    'résumé.md', 'resume.md', 'Resume.md', 'a b.md', 'a-b.md', 'a_b.md', 'ab.md', 'a.b.md'
  ]

  /** The comparison the walk used before finding 32 – kept here as the reference. */
  const previousCompare = (a: FileNode, b: FileNode): number => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  }

  it('keeps folders first, then the previous localeCompare order', async () => {
    listing[ROOT] = [
      ...NAMES.map((name) => dirent(name, 'file')),
      ...NAMES.map((name) => dirent(`dir ${name}`, 'dir'))
    ]

    const tree = await makeService([]).readDirectory(ROOT)

    const expected = [...tree].sort(previousCompare).map((node) => node.name)
    expect(tree.map((node) => node.name)).toEqual(expected)
    expect(tree.slice(0, NAMES.length).every((node) => node.type === 'directory')).toBe(true)
    expect([...tree].sort(compareTreeNodes).map((node) => node.name)).toEqual(expected)
  })

  it('sorts with one shared collator, not a localeCompare per comparison', async () => {
    listing[ROOT] = NAMES.map((name) => dirent(name, 'file'))
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare')

    await makeService([]).readDirectory(ROOT)

    expect(localeCompare).not.toHaveBeenCalled()
  })
})

describe('FileService.findByName – the tree rules and the session (review of #320)', () => {
  it('does not search an ignored folder, as the walk does not read it (item 3)', async () => {
    listing[ROOT] = [dirent('dist', 'dir'), dirent('src', 'dir')]
    listing[at('dist')] = [dirent('a.md', 'file')]
    listing[at('src')] = [dirent('a.md', 'file')]

    const result = await makeService().findByName(ROOT, 'a.md')

    expect(result).toEqual({ paths: [at('src', 'a.md')], truncated: false })
    expect(foldersRead()).toEqual(['', 'src'])
  })

  it('reads the real path and answers with the requested one (item 9)', async () => {
    const alias = abs('alias')
    listing[ROOT] = [dirent('a.md', 'file')]

    const result = await makeService().findByName(alias, 'a.md', ROOT)

    expect(result.paths).toEqual([path.join(alias, 'a.md')])
    expect(foldersRead()).toEqual([''])
  })

  it('ends a search once the project changes (item 1)', async () => {
    listing[ROOT] = [dirent('a', 'dir'), dirent('b', 'dir')]
    listing[at('a')] = [dirent('deep', 'dir')]
    listing[at('a', 'deep')] = [dirent('x.md', 'file')]
    const service = makeService()
    let generation = 1
    service.bindSession({
      current: () =>
        ({ root: ROOT, realRoot: ROOT, caseSensitive: true, generation, ownerWebContentsId: null }) as never
    })
    readdirMock.mockImplementation(async (dir: string) => {
      await tick()
      // The project is switched while the first level is read
      generation = 2
      return listing[path.resolve(dir)] ?? []
    })

    const result = await service.findByName(ROOT, 'x.md')

    expect(result).toEqual({ paths: [], truncated: true })
    expect(foldersRead()).toEqual([''])
  })

  it('shares one search between calls for the same folder and name (item 1)', async () => {
    listing[ROOT] = [dirent('a.md', 'file')]
    const service = makeService()

    const [first, second] = await Promise.all([service.findByName(ROOT, 'a.md'), service.findByName(ROOT, 'A.MD')])

    expect(first).toEqual(second)
    expect(readdirMock).toHaveBeenCalledTimes(1)
  })
})

describe('FileService.findByName – the caller\'s session and spelling (review of #320, round 3, item 4)', () => {
  it('uses the generation the handler checked: a search asked under an older one reads nothing', async () => {
    listing[ROOT] = [dirent('a.md', 'file')]

    const result = await makeService().findByName(ROOT, 'a.md', undefined, 0)

    expect(result).toEqual({ paths: [], truncated: true })
    expect(readdirMock).not.toHaveBeenCalled()
  })

  it('does not share a search between two spellings of one root: each answers in its own', async () => {
    const alias = abs('alias')
    listing[ROOT] = [dirent('a.md', 'file')]
    const service = makeService()

    const [viaRoot, viaAlias] = await Promise.all([
      service.findByName(ROOT, 'a.md', ROOT),
      service.findByName(alias, 'a.md', ROOT)
    ])

    expect(viaRoot.paths).toEqual([at('a.md')])
    expect(viaAlias.paths).toEqual([path.join(alias, 'a.md')])
  })
})
