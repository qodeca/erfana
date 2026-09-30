// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project path filter (issue #211, design D4/D14, work item W4): relative
 * paths against the project root, the hidden and ignore rules on those paths,
 * exclude delegation, and the split-plan inputs with their caps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EXCLUDE_BUDGET_TRIPWIRE } from './excludeMatcher'
import {
  MAX_SPLIT_DEPTH,
  MAX_SPLIT_PATHS,
  MAX_WALK_HINTS,
  ProjectPathFilter,
  toRootRelative,
  type ProjectPathFilterOptions
} from './projectPathFilter'
import { logger } from '../services/LoggingService'

vi.mock('../services/LoggingService', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

const DEFAULT_HIDDEN = ['node_modules', '.git']
const DEFAULT_IGNORE = ['node_modules', '.yarn/cache', '.git/objects', 'dist', 'build', 'out']

function makeFilter(
  root: string,
  options: Partial<ProjectPathFilterOptions> = {}
): ProjectPathFilter {
  return new ProjectPathFilter(root, {
    hiddenPatterns: DEFAULT_HIDDEN,
    ignorePatterns: DEFAULT_IGNORE,
    caseSensitive: true,
    ...options
  })
}

/** `n` distinct paths, each `depth` segments deep. */
function nestedPaths(n: number, depth = 2): string[] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: depth }, (_, d) => (d === 0 ? `p${i}` : `s${d}`)).join('/')
  )
}

describe('toRootRelative – host path rules', () => {
  // POSIX-style input works on every host: Windows resolves `/proj` onto the
  // current drive for both the root and the path.
  it('gives the root as an empty string and a descendant with / separators', () => {
    expect(toRootRelative('/proj', '/proj')).toBe('')
    expect(toRootRelative('/proj', '/proj/src/a.ts')).toBe('src/a.ts')
    expect(toRootRelative('/proj/', '/proj/src/')).toBe('src')
  })

  it('resolves dot segments before deciding', () => {
    expect(toRootRelative('/proj', '/proj/a/../b')).toBe('b')
    expect(toRootRelative('/proj', '/proj/../etc/passwd')).toBeNull()
  })

  it('returns null outside the project, including a sibling that extends the name', () => {
    expect(toRootRelative('/proj', '/proj-x/a')).toBeNull()
    expect(toRootRelative('/proj', '/other/a')).toBeNull()
  })
})

describe('toRootRelative – Windows path rules on any host', () => {
  let winToRootRelative: typeof toRootRelative

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('path', async () => {
      const actual = await vi.importActual<typeof import('path')>('path')
      return { ...actual.win32, default: actual.win32 }
    })
    ;({ toRootRelative: winToRootRelative } = await import('./projectPathFilter'))
  })

  afterEach(() => {
    vi.doUnmock('path')
    vi.resetModules()
  })

  it('turns backslash input into a /-separated relative path', () => {
    expect(winToRootRelative('C:\\proj', 'C:\\proj')).toBe('')
    expect(winToRootRelative('C:\\proj', 'C:\\proj\\src\\a.ts')).toBe('src/a.ts')
    expect(winToRootRelative('C:\\proj', 'C:\\proj/src/mixed.ts')).toBe('src/mixed.ts')
  })

  it('does not count C:\\proj-x as inside C:\\proj', () => {
    expect(winToRootRelative('C:\\proj', 'C:\\proj-x')).toBeNull()
    expect(winToRootRelative('C:\\proj', 'C:\\proj-x\\a.ts')).toBeNull()
    expect(winToRootRelative('C:\\proj', 'D:\\proj\\a.ts')).toBeNull()
  })
})

describe('ProjectPathFilter – drop rules', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear()
  })

  it('drops a path outside the project and never the root', () => {
    const filter = makeFilter('/proj', { ignorePatterns: ['proj'], hiddenPatterns: ['proj'] })

    expect(filter.shouldDrop(toRootRelative('/proj', '/elsewhere/a.md'))).toBe(true)
    expect(filter.shouldDrop(null)).toBe(true)
    expect(filter.shouldDrop('')).toBe(false)
    expect(filter.shouldDrop(toRootRelative('/proj', '/proj'))).toBe(false)
  })

  it('hides a path when any segment equals a hidden name, exactly', () => {
    const filter = makeFilter('/proj', { caseSensitive: false })

    expect(filter.isHidden('.git')).toBe(true)
    expect(filter.isHidden('.git/index.lock')).toBe(true)
    expect(filter.isHidden('packages/a/node_modules/x')).toBe(true)
    expect(filter.isHidden('.github/workflows')).toBe(false)
    expect(filter.isHidden('a/node_modules_x')).toBe(false)
    // The tree's rule is exact, whatever the platform folds for exclude.
    expect(filter.isHidden('Node_Modules')).toBe(false)
    expect(filter.isHidden('')).toBe(false)
    expect(filter.shouldDrop('.git/index.lock')).toBe(true)
  })

  it('applies the ignore rule to the project-relative path, not the absolute one', () => {
    const root = '/x/build/proj'
    const filter = makeFilter(root)
    const drop = (abs: string): boolean => filter.shouldDrop(toRootRelative(root, abs))

    expect(drop('/x/build/proj/src/a.ts')).toBe(false)
    expect(drop('/x/build/proj/build/a.js')).toBe(true)
    expect(drop('/x/build/proj/packages/a/dist/x.js')).toBe(true)
    expect(drop('/x/build/proj/.yarn/cache/pkg.zip')).toBe(true)
    expect(drop('/x/build/proj/.git/objects/ab/cd')).toBe(true)
    expect(filter.isIgnored('')).toBe(false)
  })

  it('keeps the existing substring rule, so out still matches outline (design §10)', () => {
    const filter = makeFilter('/proj')

    expect(filter.isIgnored('outline.md')).toBe(true)
    expect(filter.isIgnored('src/about.md')).toBe(false)
  })

  it('skips an empty ignore pattern instead of ignoring everything', () => {
    const filter = makeFilter('/proj', { ignorePatterns: [''], hiddenPatterns: [] })

    expect(filter.shouldDrop('src/a.ts')).toBe(false)
  })

  it('takes paths from a subfolder watch against the project root', () => {
    const root = '/proj'
    const filter = makeFilter(root, { exclude: ['sub/tmp'] })
    const fromSubfolderWatch = '/proj/sub/tmp/scratch.txt'

    expect(toRootRelative(root, fromSubfolderWatch)).toBe('sub/tmp/scratch.txt')
    expect(filter.shouldDrop(toRootRelative(root, fromSubfolderWatch))).toBe(true)
    // Relative to the watch root the entry would have missed.
    expect(filter.shouldDrop(toRootRelative('/proj/sub', fromSubfolderWatch))).toBe(false)
  })
})

describe('ProjectPathFilter – exclude delegation', () => {
  it('asks the compiled matcher, for the path and for the entry alone', () => {
    const filter = makeFilter('/proj', { exclude: ['tmp', '**/test-tmp', '../bad'] })

    expect(filter.excludeMatcher.size).toBe(2)
    expect(filter.isExcluded('tmp/a/b')).toBe(true)
    expect(filter.isEntryExcluded('tmp')).toBe(true)
    expect(filter.isEntryExcluded('tmp/a')).toBe(false)
    expect(filter.shouldDrop('a/b/test-tmp/c.txt')).toBe(true)
    expect(filter.shouldDrop('src/a.ts')).toBe(false)
  })

  it('never excludes .erfana', () => {
    const filter = makeFilter('/proj', { exclude: ['.erfana', '.*'] })

    expect(filter.shouldDrop('.erfana/settings.json')).toBe(false)
    expect(filter.shouldDrop('.vscode/settings.json')).toBe(true)
  })

  it('folds the exclude list with the case rule it is given', () => {
    expect(
      makeFilter('/proj', { exclude: ['Tmp'], caseSensitive: false }).isExcluded('TMP/a')
    ).toBe(true)
    expect(makeFilter('/proj', { exclude: ['Tmp'], caseSensitive: true }).isExcluded('TMP/a')).toBe(
      false
    )
  })

  it('treats a missing exclude list as empty', () => {
    const filter = makeFilter('/proj')

    expect(filter.excludeMatcher.size).toBe(0)
    expect(filter.isExcluded('tmp')).toBe(false)
  })

  it('logs one warning with counts only when the tripwire switches patterns off', () => {
    vi.mocked(logger.warn).mockClear()
    const filter = makeFilter('/proj', { exclude: [`**/*${'a'.repeat(100)}b`] })
    const hostile = Array.from({ length: 3 }, () => 'a'.repeat(255)).join('/')

    for (let i = 0; i < EXCLUDE_BUDGET_TRIPWIRE + 5; i++) filter.isExcluded(hostile)

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith('Exclude patterns disabled: match budget exceeded', {
      budgetExceeded: EXCLUDE_BUDGET_TRIPWIRE,
      patternEntryCount: 1
    })
    expect(filter.excludeMatcher.patternsDisabled).toBe(true)
  })
})

describe('ProjectPathFilter – split plan inputs', () => {
  it('offers the path entries only, de-duplicated, never .erfana', () => {
    const filter = makeFilter('/proj', {
      exclude: ['tmp', 'packages/a/node_modules', '**/cache', 'TMP', '.erfana/x'],
      caseSensitive: false
    })

    expect(filter.splitPaths()).toEqual(['tmp', 'packages/a/node_modules'])
    expect(filter.splitInputsCapped).toBe(false)
  })

  it(`caps split paths at ${MAX_SPLIT_PATHS} and ${MAX_SPLIT_DEPTH} segments`, () => {
    const tooDeep = nestedPaths(1, MAX_SPLIT_DEPTH + 1)[0].replace('p0', 'deep')
    const exclude = [tooDeep, ...nestedPaths(MAX_SPLIT_PATHS + 5, MAX_SPLIT_DEPTH)]
    const filter = makeFilter('/proj', { exclude })

    const splits = filter.splitPaths()
    expect(splits).toHaveLength(MAX_SPLIT_PATHS)
    expect(splits).not.toContain(tooDeep)
    expect(splits[0]).toBe(exclude[1])
    expect(filter.splitInputsCapped).toBe(true)
    // Past the cap the entries still exclude: only the plan leaves them out.
    expect(filter.isExcluded(`${tooDeep}/x`)).toBe(true)
  })

  it('starts with no walk hints, and replaces them wholesale', () => {
    const filter = makeFilter('/proj')
    expect(filter.getWalkHints()).toEqual([])

    filter.replaceWalkHints(['packages/a/node_modules', 'src/dist'])
    expect(filter.getWalkHints()).toEqual(['packages/a/node_modules', 'src/dist'])

    filter.replaceWalkHints(['a/b/test-tmp'])
    expect(filter.getWalkHints()).toEqual(['a/b/test-tmp'])
  })

  it(`caps walk hints at ${MAX_WALK_HINTS}, skipping any deeper than ${MAX_SPLIT_DEPTH}`, () => {
    const filter = makeFilter('/proj')
    const tooDeep = nestedPaths(1, MAX_SPLIT_DEPTH + 1)[0]
    const hints = nestedPaths(MAX_WALK_HINTS + 10)

    filter.replaceWalkHints([tooDeep, ...hints])

    expect(filter.getWalkHints()).toEqual(hints.slice(0, MAX_WALK_HINTS))
    expect(filter.splitInputsCapped).toBe(true)

    filter.replaceWalkHints(hints.slice(0, 3))
    expect(filter.splitInputsCapped).toBe(false)
  })

  it('de-duplicates hints by the folded form when case-insensitive, and drops the root', () => {
    const filter = makeFilter('/proj', { caseSensitive: false })

    filter.replaceWalkHints(['a/Node_Modules', 'a/node_modules', ''])
    expect(filter.getWalkHints()).toEqual(['a/Node_Modules'])
  })

  it('hands out a copy of the hints', () => {
    const filter = makeFilter('/proj')
    filter.replaceWalkHints(['a/b'])

    filter.getWalkHints().push('c/d')
    expect(filter.getWalkHints()).toEqual(['a/b'])
  })
})
