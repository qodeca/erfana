// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * findByName on a real temp folder: matches, skips, never follows a link, and
 * stops at each of its bounds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  startFindByName,
  type FindByNameResult,
  type FindByNameRun
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
/** For tests that count reads: a clock that never moves and a limit no run reaches, so only the count bounds apply */
const unhurried = { ...noSkip, now: () => 0, timeLimitMs: 10 * 60_000 }

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

  it('takes its deadline from `timeLimitMs`, and FIND_BY_NAME_TIME_LIMIT_MS when none is given', async () => {
    touch('a', 'b', 'c', 'x.md')
    // Every read of the clock moves it a second on
    const ticking = (): (() => number) => {
      let clock = 0
      return () => (clock += 1_000)
    }

    const byDefault = await findByName(root, 'x.md', { ...noSkip, now: ticking() })
    const generous = await findByName(root, 'x.md', { ...noSkip, now: ticking(), timeLimitMs: 60_000 })

    expect(byDefault).toEqual({ paths: [], truncated: true })
    expect(generous).toEqual({ paths: [path.join(root, 'a', 'b', 'c', 'x.md')], truncated: false })
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

    // A frozen clock and a generous limit: the folder cap, not the timer, ends the walk however loaded the machine
    const result = await findByName('/r', 'x.md', { ...unhurried, readdir })

    expect(result.truncated).toBe(true)
    expect(reads).toBe(FIND_BY_NAME_MAX_FOLDERS)
  })

  it('yields to the event loop between batches of reads on a wide tree, with FIND_BY_NAME_CONCURRENCY reads in flight', async () => {
    // 300 × 300 folders: 90,300 in all, far past the folder bound
    const WIDTH = 300
    let inFlight = 0
    let maxInFlight = 0
    // A turn of the event loop: a self-rescheduling setImmediate runs once per turn (its re-arm lands in the next one)
    let turn = 0
    let ticking = true
    const tick = (): void => {
      turn++
      if (ticking) setImmediate(tick)
    }
    setImmediate(tick)
    const readsPerTurn = new Map<number, number>()
    const entriesPerTurn = new Map<number, number>()
    const bump = (counts: Map<number, number>): void => void counts.set(turn, (counts.get(turn) ?? 0) + 1)
    const readdir = async (dir: string): Promise<Dirent[]> => {
      bump(readsPerTurn)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      const depth = dir.split('/').length - 1
      const entries = await later(depth < 3 ? Array.from({ length: WIDTH }, (_, i) => fakeDirent(`d${i}`, 'dir')) : [])
      inFlight--
      return entries
    }
    // `skip` sees every entry the search handles: a count of its synchronous work
    const skip = (): boolean => (bump(entriesPerTurn), false)

    const result = await findByName('/r', 'x.md', { ...unhurried, skip, readdir })
    ticking = false

    expect(result.truncated).toBe(true)
    expect(maxInFlight).toBe(FIND_BY_NAME_CONCURRENCY)
    const reads = [...readsPerTurn.values()].reduce((a, b) => a + b, 0)
    expect(reads).toBe(FIND_BY_NAME_MAX_FOLDERS)
    // Each turn starts at most one pool's worth of reads (two when a pool straddles the tick) and handles
    // at most that many folders' entries – never the whole tree in one go, however many turns that takes
    expect(Math.max(...readsPerTurn.values())).toBeLessThanOrEqual(2 * FIND_BY_NAME_CONCURRENCY)
    expect(Math.max(...entriesPerTurn.values())).toBeLessThanOrEqual(2 * FIND_BY_NAME_CONCURRENCY * WIDTH)
    expect(readsPerTurn.size).toBeGreaterThanOrEqual(FIND_BY_NAME_MAX_FOLDERS / (2 * FIND_BY_NAME_CONCURRENCY))
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
  const done: FindByNameResult = { paths: [], truncated: false }
  /** A search whose answer and whose last read the test settles */
  const controlled = () => {
    let answer!: (r: FindByNameResult) => void
    let settle!: () => void
    const run: FindByNameRun = {
      result: new Promise<FindByNameResult>((r) => (answer = r)),
      idle: new Promise<void>((r) => (settle = r))
    }
    return { run, answer, settle }
  }
  const instant = (): FindByNameRun => ({ result: Promise.resolve(done), idle: Promise.resolve() })
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  it('runs at most two searches at once and the rest in turn', async () => {
    const gate = createFindByNameGate({ maxSearches: 2, maxWaiting: 8 })
    const searches = [controlled(), controlled(), controlled()]
    let started = 0
    const results = searches.map((c, i) => gate.run(`k${i}`, () => (started++, c.run)))
    expect(started).toBe(2)
    searches[0].answer(done)
    searches[0].settle()
    await results[0]
    await flush()
    expect(started).toBe(3)
    for (const c of searches.slice(1)) {
      c.answer(done)
      c.settle()
    }
    await Promise.all(results)
  })

  it('keeps a slot taken after the answer while a read of the search is in flight (review of #320, round 3)', async () => {
    const gate = createFindByNameGate({ maxSearches: 1, maxWaiting: 8, waitLimitMs: 10_000 })
    const hung = controlled()
    const first = gate.run('a', () => hung.run)
    hung.answer(done)
    await first
    await flush()
    expect(gate.running).toBe(1)
    let started = false
    const second = gate.run('b', () => ((started = true), instant()))
    await flush()
    expect(started).toBe(false)

    hung.settle()
    await expect(second).resolves.toEqual(done)
    expect(started).toBe(true)
  })

  it('answers a waiting call truncated at its own deadline, and never starts its search', async () => {
    const gate = createFindByNameGate({ maxSearches: 1, maxWaiting: 8, waitLimitMs: 20 })
    const hung = controlled()
    void gate.run('a', () => hung.run)
    let started = false
    const start = performance.now()

    const waited = await gate.run('b', () => ((started = true), instant()))

    expect(waited).toEqual({ paths: [], truncated: true })
    expect(performance.now() - start).toBeLessThan(1_000)
    hung.settle()
    await flush()
    expect(started).toBe(false)
    expect(gate.running).toBe(0)
  })

  it('bounds hung reads on a stale mount: two searches hold their slots, later calls answer truncated', async () => {
    let hungReads = 0
    const readdir = (dir: string): Promise<Dirent[]> => {
      if (dir === '/r') return later(Array.from({ length: 40 }, (_, i) => fakeDirent(`d${i}`, 'dir')))
      hungReads++
      return new Promise<Dirent[]>(() => {})
    }
    // Each search's deadline is 10 ms after its timer is set; its reads start before that
    const clock = (): (() => number) => {
      const ticks = [0, FIND_BY_NAME_TIME_LIMIT_MS - 10]
      return () => (ticks.length > 1 ? ticks.shift()! : ticks[0])
    }
    const gate = createFindByNameGate({ maxSearches: 2, maxWaiting: 8, waitLimitMs: 20 })
    const search = () => startFindByName('/r', 'x.md', { ...noSkip, readdir, now: clock() })

    const answers: Awaited<ReturnType<typeof gate.run>>[] = []
    for (let i = 0; i < 6; i++) answers.push(await gate.run(`k${i}`, search))

    expect(gate.running).toBe(2)
    expect(hungReads).toBeLessThanOrEqual(2 * FIND_BY_NAME_CONCURRENCY)
    expect(answers.slice(2)).toEqual(Array(4).fill({ paths: [], truncated: true }))
  })

  it('frees the slot of a search that throws before it starts (round 4, item 5)', async () => {
    const gate = createFindByNameGate({ maxSearches: 1 })
    await expect(
      gate.run('a', () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(gate.running).toBe(0)
    await expect(gate.run('b', instant)).resolves.toEqual(done)
  })

  it('tells, once and with counts only, about a slot held past the long-hold time (round 4, item 4)', async () => {
    const onLongHold = vi.fn()
    const gate = createFindByNameGate({ maxSearches: 2, longHoldMs: 10, onLongHold })
    const hung = controlled()
    void gate.run('a', () => hung.run)
    const quick = controlled()
    void gate.run('b', () => quick.run)
    quick.answer(done)
    quick.settle()

    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(onLongHold).toHaveBeenCalledTimes(1)
    expect(onLongHold).toHaveBeenCalledWith({ heldMs: expect.any(Number), running: 1 })
    hung.settle()
  })

  it('shares a search by key, and runs it again once it has answered', async () => {
    const gate = createFindByNameGate({ maxSearches: 2, maxWaiting: 8 })
    let runs = 0
    const search = (): FindByNameRun => (runs++, instant())
    await Promise.all([gate.run('k', search), gate.run('k', search)])
    expect(runs).toBe(1)
    await gate.run('k', search)
    expect(runs).toBe(2)
  })

  it('answers truncated at once when too many calls wait', async () => {
    const gate = createFindByNameGate({ maxSearches: 1, maxWaiting: 1, waitLimitMs: 10_000 })
    const busy = controlled()
    const first = gate.run('a', () => busy.run)
    const second = gate.run('b', instant)
    let ran = false
    const third = await gate.run('c', () => ((ran = true), instant()))
    expect(third).toEqual({ paths: [], truncated: true })
    expect(ran).toBe(false)
    busy.answer(done)
    busy.settle()
    await Promise.all([first, second])
  })
})

describe('startFindByName', () => {
  it('is idle only once no read is in flight, and answers before that at the deadline', async () => {
    const clock = [0, FIND_BY_NAME_TIME_LIMIT_MS - 10]
    const now = (): number => (clock.length > 1 ? clock.shift()! : clock[0])
    let release!: () => void
    const readdir = (dir: string): Promise<Dirent[]> =>
      dir === '/r'
        ? later([fakeDirent('slow', 'dir')])
        : new Promise<Dirent[]>((resolve) => (release = () => resolve([])))
    const run = startFindByName('/r', 'x.md', { ...noSkip, now, readdir })
    let idle = false
    void run.idle.then(() => (idle = true))

    await expect(run.result).resolves.toEqual({ paths: [], truncated: true })
    await later(null)
    expect(idle).toBe(false)

    release()
    await run.idle
    expect(idle).toBe(true)
  })
})
