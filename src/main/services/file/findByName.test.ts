// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * findByName on a real temp folder: matches, skips, never follows a link, and
 * stops at each of its bounds.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Dirent } from 'node:fs'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  FIND_BY_NAME_CONCURRENCY,
  FIND_BY_NAME_MAX_FOLDERS,
  FIND_BY_NAME_MAX_RESULTS,
  FIND_BY_NAME_TIME_LIMIT_MS,
  createFindByNameGate,
  findByName,
  type FindByNameResult
} from './findByName'

let base: string
let root: string
let outside: string

const touch = (...parts: string[]): void => {
  const target = path.join(root, ...parts)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, '')
}

const noSkip = { baseRel: '', skip: () => false }

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'erfana-find-by-name-')))
  root = path.join(base, 'proj')
  outside = path.join(base, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('findByName', () => {
  it('finds every file of the name below the folder, case-insensitively, sorted', async () => {
    touch('src', 'Button.tsx')
    touch('deep', 'er', 'button.TSX')
    touch('Button.tsx.bak')

    const result = await findByName(root, 'button.tsx', noSkip)

    expect(result).toEqual({
      paths: [path.join(root, 'deep', 'er', 'button.TSX'), path.join(root, 'src', 'Button.tsx')],
      truncated: false
    })
  })

  it('does not enter or answer with what `skip` leaves out, and passes project-relative paths', async () => {
    touch('node_modules', 'x', 'a.md')
    touch('docs', 'a.md')
    const seen: Array<string | null> = []

    const result = await findByName(root, 'a.md', {
      baseRel: '',
      skip: (name, rel) => {
        seen.push(rel)
        return name === 'node_modules'
      }
    })

    expect(result.paths).toEqual([path.join(root, 'docs', 'a.md')])
    expect(seen).toContain('docs/a.md')
    expect(seen).not.toContain('node_modules/x')
  })

  it.skipIf(process.platform === 'win32')('never follows a folder link or answers with a file link', async () => {
    writeFileSync(path.join(outside, 'a.md'), '')
    symlinkSync(outside, path.join(root, 'out'))
    symlinkSync(path.join(outside, 'a.md'), path.join(root, 'a.md'))

    const result = await findByName(root, 'a.md', noSkip)

    expect(result.paths).toEqual([])
  })

  it('stops at the result cap and says so', async () => {
    for (let i = 0; i <= FIND_BY_NAME_MAX_RESULTS + 5; i++) touch(`d${i}`, 'same.md')

    const result = await findByName(root, 'same.md', noSkip)

    expect(result.paths).toHaveLength(FIND_BY_NAME_MAX_RESULTS)
    expect(result.truncated).toBe(true)
  })

  it('stops at the time limit and says so', async () => {
    touch('a', 'b', 'c', 'x.md')
    let clock = 0
    // Every read the search starts moves the clock past the limit
    const now = (): number => (clock += FIND_BY_NAME_TIME_LIMIT_MS)

    const result = await findByName(root, 'x.md', { ...noSkip, now })

    expect(result).toEqual({ paths: [], truncated: true })
  })

  it('never follows a junction (Windows) or a folder link to a folder inside the base', async () => {
    touch('real', 'a.md')
    // 'junction' needs no privilege on Windows; elsewhere it makes a symlink
    symlinkSync(path.join(root, 'real'), path.join(root, 'jn'), 'junction')

    const result = await findByName(root, 'a.md', noSkip)

    expect(result.paths).toEqual([path.join(root, 'real', 'a.md')])
  })
})

const fakeDirent = (name: string, kind: 'dir' | 'file'): Dirent =>
  ({ name, isDirectory: () => kind === 'dir', isFile: () => kind === 'file', isSymbolicLink: () => false }) as Dirent

/** Answers on the next turn of the event loop, as real I/O does. */
const later = <T>(value: T): Promise<T> => new Promise((resolve) => setImmediate(() => resolve(value)))

describe('findByName – bounds (review of #320)', () => {
  it('answers at the deadline with what it found while a read still hangs (a stale mount)', async () => {
    // The deadline is 10 ms after the timer is set; reads before it see the clock unmoved
    const clock = [0, FIND_BY_NAME_TIME_LIMIT_MS - 10]
    const now = (): number => (clock.length > 1 ? clock.shift()! : clock[0])
    const readdir = (dir: string): Promise<Dirent[]> => {
      if (dir === '/r') return later([fakeDirent('stale', 'dir'), fakeDirent('x.md', 'file')])
      return new Promise<Dirent[]>(() => {})
    }

    const result = await findByName('/r', 'x.md', { ...noSkip, now, readdir })

    expect(result).toEqual({ paths: [path.join('/r', 'x.md')], truncated: true })
  })

  it('lists at most FIND_BY_NAME_MAX_FOLDERS folders, however wide the tree', async () => {
    let reads = 0
    const readdir = (dir: string): Promise<Dirent[]> => {
      reads++
      return later(dir === '/r' ? Array.from({ length: FIND_BY_NAME_MAX_FOLDERS * 2 }, (_, i) => fakeDirent(`d${i}`, 'dir')) : [])
    }

    const result = await findByName('/r', 'x.md', { ...noSkip, readdir })

    expect(result.truncated).toBe(true)
    expect(reads).toBe(FIND_BY_NAME_MAX_FOLDERS)
  })

  it('keeps the event loop moving on a wide tree (no turn over 50 ms) and FIND_BY_NAME_CONCURRENCY reads in flight', async () => {
    // 300 × 300 folders: 90,300 in all, far past the folder bound
    let inFlight = 0
    let maxInFlight = 0
    const readdir = async (dir: string): Promise<Dirent[]> => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      const depth = dir.split('/').length - 1
      const entries = await later(depth < 3 ? Array.from({ length: 300 }, (_, i) => fakeDirent(`d${i}`, 'dir')) : [])
      inFlight--
      return entries
    }
    let maxLag = 0
    let last = performance.now()
    const probe = setInterval(() => {
      const t = performance.now()
      maxLag = Math.max(maxLag, t - last - 5)
      last = t
    }, 5)

    const result = await findByName('/r', 'x.md', { ...noSkip, readdir })
    clearInterval(probe)

    expect(result.truncated).toBe(true)
    expect(maxInFlight).toBe(FIND_BY_NAME_CONCURRENCY)
    expect(maxLag).toBeLessThan(50)
  })

  it('ends when the project changes, without reading further', async () => {
    let current = true
    let reads = 0
    const readdir = (dir: string): Promise<Dirent[]> => {
      reads++
      current = false
      return later(dir === '/r' ? [fakeDirent('a', 'dir'), fakeDirent('x.md', 'file')] : [])
    }

    const result = await findByName('/r', 'x.md', { ...noSkip, readdir, isCurrent: () => current })

    expect(result).toEqual({ paths: [], truncated: true })
    expect(reads).toBe(1)
  })

  it('reads nothing when the project changed before it started (it waited for the gate)', async () => {
    let reads = 0
    const readdir = (): Promise<Dirent[]> => (reads++, later([]))

    const result = await findByName('/r', 'x.md', { ...noSkip, readdir, isCurrent: () => false })

    expect(result).toEqual({ paths: [], truncated: true })
    expect(reads).toBe(0)
  })

  it('reads `readBase` and builds the results from `base`', async () => {
    const seen: string[] = []
    const readdir = (dir: string): Promise<Dirent[]> => {
      seen.push(dir)
      return later(dir === '/real' ? [fakeDirent('x.md', 'file')] : [])
    }

    const result = await findByName('/alias', 'x.md', { ...noSkip, readBase: '/real', readdir })

    expect(seen).toEqual(['/real'])
    expect(result.paths).toEqual([path.join('/alias', 'x.md')])
  })
})

describe('createFindByNameGate', () => {
  const deferred = () => {
    let resolve!: (r: FindByNameResult) => void
    const promise = new Promise<FindByNameResult>((r) => (resolve = r))
    return { promise, resolve }
  }
  const done: FindByNameResult = { paths: [], truncated: false }

  it('runs at most two searches at once and the rest in turn', async () => {
    const gate = createFindByNameGate(2, 8)
    const searches = [deferred(), deferred(), deferred()]
    let started = 0
    const results = searches.map((d, i) => gate.run(`k${i}`, () => (started++, d.promise)))
    await Promise.resolve()
    expect(started).toBe(2)
    searches[0].resolve(done)
    await results[0]
    await Promise.resolve()
    expect(started).toBe(3)
    searches[1].resolve(done)
    searches[2].resolve(done)
    await Promise.all(results)
  })

  it('shares a search by key, and runs it again once it has ended', async () => {
    const gate = createFindByNameGate(2, 8)
    let runs = 0
    const search = async (): Promise<FindByNameResult> => (runs++, done)
    await Promise.all([gate.run('k', search), gate.run('k', search)])
    expect(runs).toBe(1)
    await gate.run('k', search)
    expect(runs).toBe(2)
  })

  it('answers truncated at once when too many searches wait', async () => {
    const gate = createFindByNameGate(1, 1)
    const busy = deferred()
    const first = gate.run('a', () => busy.promise)
    const second = gate.run('b', async () => done)
    let ran = false
    const third = await gate.run('c', async () => ((ran = true), done))
    expect(third).toEqual({ paths: [], truncated: true })
    expect(ran).toBe(false)
    busy.resolve(done)
    await Promise.all([first, second])
  })
})
