// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * FileService tree walk and the `files.exclude` list (issue #211, design D1,
 * section 5 and W3).
 *
 * The walk must never read an excluded folder (AC1: that is where a large
 * project's first tree spent its time), must leave excluded files out, must
 * apply the filter it had when the walk began, and must leave reads outside
 * the project alone. A completed walk of the project root records the walk
 * hints the Windows watcher plans around – the topmost hidden, ignored or
 * excluded folders at two or more segments – capped, and never from a
 * sub-folder walk. The `completed` log line carries counts only.
 *
 * Runs on a real temp folder; `fs/promises.readdir` is a pass-through spy, so
 * the folders a walk read are exactly its recorded calls. Split from the main
 * FileService suite because the mocks hoist to module scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { tmpdir } from 'os'
import { dirname, join, relative, sep } from 'path'

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('./LoggingService', () => ({ logger: mockLogger }))

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return { ...actual, readdir: vi.fn(actual.readdir) }
})

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { FileService, type FileNode } from './FileService'
import { MAX_SPLIT_DEPTH, MAX_WALK_HINTS, ProjectPathFilter } from '../utils/projectPathFilter'
import type { ExcludeMatcher } from '../utils/excludeMatcher'
import { DEFAULT_TREE_HIDDEN_PATTERNS } from '../../shared/constants'

const readdirMock = readdir as unknown as Mock
const STARTED = 'FileService: readDirectory started'
const COMPLETED = 'FileService: readDirectory completed'

let root: string
let outside: string

interface FilterOptions {
  exclude?: string[]
  ignore?: string[]
  hidden?: string[]
}

/** Create files, and folders for entries ending in `/`, under `base`. */
async function createTree(base: string, entries: readonly string[]): Promise<void> {
  for (const entry of entries) {
    const target = join(base, ...entry.split('/').filter(Boolean))
    if (entry.endsWith('/')) {
      await mkdir(target, { recursive: true })
    } else {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, '')
    }
  }
  // Only the walk under test may appear in the spy's calls.
  vi.clearAllMocks()
}

function relativeTo(base: string, absPath: string): string {
  const rel = relative(base, absPath)
  return sep === '/' ? rel : rel.split(sep).join('/')
}

/** Every folder a walk read, relative to `base` (`''` is `base` itself). */
function foldersRead(base = root): string[] {
  return readdirMock.mock.calls.map(([dirPath]) => relativeTo(base, String(dirPath))).sort()
}

/** Every node of a tree, relative to `base`, sorted. */
function treePaths(nodes: FileNode[], base = root): string[] {
  const paths: string[] = []
  const visit = (items: FileNode[]): void => {
    for (const node of items) {
      paths.push(relativeTo(base, node.path))
      if (node.children) visit(node.children)
    }
  }
  visit(nodes)
  return paths.sort()
}

function makeFilter(options: FilterOptions = {}, filterRoot = root): ProjectPathFilter {
  return new ProjectPathFilter(filterRoot, {
    exclude: options.exclude ?? [],
    hiddenPatterns: options.hidden ?? [...DEFAULT_TREE_HIDDEN_PATTERNS],
    ignorePatterns: options.ignore ?? [],
    caseSensitive: true
  })
}

function makeService(filter: ProjectPathFilter | null, projectPath: string | null = root): FileService {
  const service = new FileService()
  if (projectPath !== null) service.setProjectPath(projectPath)
  service.setPathFilter(filter)
  return service
}

function completedLines(): Array<Record<string, unknown>> {
  return mockLogger.info.mock.calls
    .filter(([message]) => message === COMPLETED)
    .map(([, context]) => context as Record<string, unknown>)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'erfana-exclude-root-'))
  outside = await mkdtemp(join(tmpdir(), 'erfana-exclude-outside-'))
  vi.clearAllMocks()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('FileService.readDirectory – files.exclude (#211)', () => {
  it('never reads an excluded folder and leaves it out of the tree', async () => {
    await createTree(root, ['docs/a.md', 'scratch/deep/b.md', 'scratch/c.md', 'keep.md'])
    const service = makeService(makeFilter({ exclude: ['scratch'] }))

    const tree = await service.readDirectory(root)

    expect(treePaths(tree)).toEqual(['docs', 'docs/a.md', 'keep.md'])
    expect(foldersRead()).toEqual(['', 'docs'])
  })

  it('skips pattern entries anywhere they match and excluded files', async () => {
    await createTree(root, [
      'a/b/test-tmp/x.md',
      'test-tmp/y.md',
      'x.log',
      'sub/y.log',
      'docs/secret.md',
      'docs/public.md'
    ])
    const service = makeService(
      makeFilter({ exclude: ['**/test-tmp', '*.log', 'docs/secret.md'] })
    )

    const tree = await service.readDirectory(root)

    // `*.log` is root-level only; `**/test-tmp` matches at any depth.
    expect(treePaths(tree)).toEqual(['a', 'a/b', 'docs', 'docs/public.md', 'sub', 'sub/y.log'])
    expect(foldersRead()).toEqual(['', 'a', 'a/b', 'docs', 'sub'])
    expect(completedLines()[0]).toMatchObject({ excludedEntryCount: 4 })
  })

  it('leaves a read outside the project unaffected', async () => {
    await createTree(outside, ['scratch/a.md', 'node_modules/x.js'])
    const service = makeService(makeFilter({ exclude: ['scratch'] }))

    const tree = await service.readDirectory(outside)

    // Hidden names still apply, as they always have; the exclude list does not.
    expect(treePaths(tree, outside)).toEqual(['scratch', 'scratch/a.md'])
    expect(foldersRead(outside)).toEqual(['', 'scratch'])
    expect(completedLines()[0]).toMatchObject({
      excludePatternCount: 0,
      excludedEntryCount: 0,
      walkHintCount: 0,
      matcherBudgetExceeded: 0
    })
  })

  it.each([
    ['no project is open', null],
    ['the filter belongs to another project', 'outside'],
    ['the project was closed', '']
  ])('applies no exclusion when %s', async (_case, projectPath) => {
    await createTree(root, ['scratch/a.md'])
    const resolvedProject = projectPath === 'outside' ? outside : projectPath
    const service = makeService(makeFilter({ exclude: ['scratch'] }), resolvedProject)

    const tree = await service.readDirectory(root)

    expect(treePaths(tree)).toEqual(['scratch', 'scratch/a.md'])
  })

  it('does not read a sub-folder walk whose base is itself excluded', async () => {
    await createTree(root, ['scratch/a.md'])
    const service = makeService(makeFilter({ exclude: ['scratch'] }))

    await expect(service.readDirectory(join(root, 'scratch'))).resolves.toEqual([])

    expect(readdirMock).not.toHaveBeenCalled()
    expect(completedLines()[0]).toMatchObject({ excludedEntryCount: 1, walkHintCount: 0 })
  })

  it('keeps the running walk on its start-time filter; the next walk uses the new one', async () => {
    await createTree(root, ['scratch/a.md', 'docs/b.md'])
    const service = makeService(makeFilter({ exclude: ['scratch'] }))
    const passThrough = readdirMock.getMockImplementation()
    let releaseRoot!: () => void
    const rootGate = new Promise<void>((resolve) => {
      releaseRoot = resolve
    })
    readdirMock.mockImplementationOnce(async (...args: unknown[]) => {
      await rootGate
      return passThrough?.(...args)
    })

    const first = service.readDirectory(root)
    await vi.waitFor(() => expect(readdirMock).toHaveBeenCalledTimes(1))
    service.setPathFilter(makeFilter({ exclude: ['docs'] }))
    releaseRoot()

    expect(treePaths(await first)).toEqual(['docs', 'docs/b.md'])
    expect(treePaths(await service.readDirectory(root))).toEqual(['scratch', 'scratch/a.md'])
  })
})

describe('FileService.readDirectory – unreadable sub-folder', () => {
  it('shows a sub-folder it cannot read as empty, logs a warning and completes the walk', async () => {
    await createTree(root, ['locked/a.md', 'open/b.md'])
    const service = makeService(makeFilter())
    const passThrough = readdirMock.getMockImplementation()
    readdirMock.mockImplementation(async (...args: unknown[]) => {
      if (relativeTo(root, String(args[0])) === 'locked') {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
      }
      return passThrough?.(...args)
    })

    try {
      const tree = await service.readDirectory(root)

      expect(treePaths(tree)).toEqual(['locked', 'open', 'open/b.md'])
      expect(tree.find((node) => node.name === 'locked')?.children).toEqual([])
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'FileService: readDirectory error recovered',
        expect.objectContaining({ error: 'EPERM: operation not permitted' })
      )
      expect(completedLines()).toHaveLength(1)
    } finally {
      if (passThrough) readdirMock.mockImplementation(passThrough)
    }
  })
})

describe('FileService.readDirectory – walk hints (#211, D1)', () => {
  it('records the topmost nested hidden, excluded and ignored folders of a root walk', async () => {
    await createTree(root, [
      // Top level: the plan already leaves these out, so no hint.
      'node_modules/pkg/index.js',
      'dist/sub/deeper/z.js',
      'dist/sub/node_modules/q.js',
      // Nested: one hint each.
      'packages/a/node_modules/dep/index.js',
      'a/b/test-tmp/x.md',
      'src/dist/out.js',
      // Below a hint: not recorded again.
      'src/dist/nested/node_modules/y.js',
      'src/app.md'
    ])
    const filter = makeFilter({ exclude: ['**/test-tmp'], ignore: ['dist'] })
    const service = makeService(filter)

    const tree = await service.readDirectory(root)

    expect(filter.getWalkHints().sort()).toEqual([
      'a/b/test-tmp',
      'packages/a/node_modules',
      'src/dist'
    ])
    // An ignored folder is still shown and read; only the watcher drops it.
    expect(treePaths(tree)).toEqual(expect.arrayContaining(['src/dist', 'src/dist/out.js']))
    expect(foldersRead()).not.toContain('a/b/test-tmp')
    expect(completedLines()[0]).toMatchObject({ walkHintCount: 3, excludedEntryCount: 1 })
  })

  it('leaves the hints alone on a sub-folder walk and on a failed root walk', async () => {
    await createTree(root, ['packages/a/node_modules/x.js', 'packages/a/scratch/y.md'])
    const filter = makeFilter({ exclude: ['packages/a/scratch'] })
    filter.replaceWalkHints(['stale/hint'])
    const service = makeService(filter)

    // A sub-folder walk still applies the list, against project-relative paths.
    const subTree = await service.readDirectory(join(root, 'packages'))
    expect(treePaths(subTree)).toEqual(['packages/a'])
    expect(foldersRead()).toEqual(['packages', 'packages/a'])
    expect(completedLines()[0]).toMatchObject({ excludedEntryCount: 1, walkHintCount: 0 })
    expect(filter.getWalkHints()).toEqual(['stale/hint'])

    readdirMock.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    await expect(service.readDirectory(root)).rejects.toThrow('EACCES')
    expect(filter.getWalkHints()).toEqual(['stale/hint'])

    await service.readDirectory(root)
    expect(filter.getWalkHints().sort()).toEqual(['packages/a/node_modules', 'packages/a/scratch'])
  })

  it('caps the hints and collects a bounded list on a tree with many nested dropped folders', async () => {
    const hintCount = MAX_WALK_HINTS + 6
    await createTree(
      root,
      Array.from({ length: hintCount }, (_, index) => `p${index}/node_modules/`)
    )
    const filter = makeFilter()
    const replaceSpy = vi.spyOn(filter, 'replaceWalkHints')
    const service = makeService(filter)

    await service.readDirectory(root)

    expect(replaceSpy).toHaveBeenCalledTimes(1)
    expect(replaceSpy.mock.calls[0][0].length).toBeLessThanOrEqual(MAX_WALK_HINTS + 2)
    expect(filter.getWalkHints()).toHaveLength(MAX_WALK_HINTS)
    expect(filter.splitInputsCapped).toBe(true)
    expect(completedLines()[0]).toMatchObject({ walkHintCount: MAX_WALK_HINTS })
  })

  it('keeps a hint at the depth cap and reports a deeper one as capped', async () => {
    const atCap = [...Array.from({ length: MAX_SPLIT_DEPTH - 1 }, () => 'd'), 'node_modules']
    const tooDeep = [...Array.from({ length: MAX_SPLIT_DEPTH }, () => 'e'), 'node_modules']
    await createTree(root, [`${atCap.join('/')}/`, `${tooDeep.join('/')}/`])
    const filter = makeFilter()
    const service = makeService(filter)

    await service.readDirectory(root)

    expect(filter.getWalkHints()).toEqual([atCap.join('/')])
    expect(filter.splitInputsCapped).toBe(true)
  })
})

describe('FileService.readDirectory – exclude log fields (#211)', () => {
  it('logs pattern, excluded-entry and hint counts, and no path', async () => {
    await createTree(root, ['scratch/a.md', 'x/tmp/b.md', 'c.md'])
    const service = makeService(makeFilter({ exclude: ['scratch', '**/tmp'] }))

    await service.readDirectory(root)

    const [completed] = completedLines()
    expect(completed).toMatchObject({
      excludePatternCount: 2,
      excludedEntryCount: 2,
      walkHintCount: 1,
      matcherBudgetExceeded: 0,
      fileCount: 1,
      dirCount: 1
    })
    const started = mockLogger.info.mock.calls.filter(([message]) => message === STARTED)
    const serialized = JSON.stringify([...started, completed])
    for (const fragment of ['scratch', 'tmp', 'erfana-exclude', '.md']) {
      expect(serialized).not.toContain(fragment)
    }
  })

  it('logs only the match-budget overruns of its own walk', async () => {
    await createTree(root, ['a.md', 'b/c.md'])
    const filter = makeFilter({ exclude: ['**/*.md'] })
    // Overruns from earlier walks must not be counted again.
    let overruns = 3
    const overrunningMatcher: ExcludeMatcher = {
      size: 1,
      pathEntries: [],
      isExcluded: () => false,
      isEntryExcluded: () => {
        overruns++
        return false
      },
      get budgetExceeded() {
        return overruns
      },
      patternsDisabled: false
    }
    Object.defineProperty(filter, 'excludeMatcher', { value: overrunningMatcher })
    const service = makeService(filter)

    await service.readDirectory(root)

    // One matcher call per entry: `a.md`, `b`, `b/c.md`.
    expect(completedLines()[0]).toMatchObject({ matcherBudgetExceeded: 3, excludePatternCount: 1 })
  })
})
