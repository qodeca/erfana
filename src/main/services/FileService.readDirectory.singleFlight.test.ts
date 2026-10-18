// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * FileService.readDirectory per-path single-flight (issue #208).
 *
 * Overlapping full-tree walks of one churning project ran main out of heap on
 * Windows. These tests pin that no two walks of the same path overlap, that N
 * overlapping callers cost at most one extra walk, that a mid-flight caller is
 * served by a walk that started after its call, and the `main.log` lines that
 * let the overlap be checked in the field (pair by `readId`, group by
 * `pathDigest`).
 *
 * The root `readdir` of each walk is a deferred the test settles; sub-directory
 * reads resolve empty at once. No wall-clock waits: fake timers appear only in
 * the slow-walk block, where the timer is the subject. Split from the main
 * FileService suite because the mocks hoist to module scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('./LoggingService', () => ({ logger: mockLogger }))

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return { ...actual, readdir: vi.fn() }
})

import { readdir } from 'fs/promises'
import { FileService, READ_DIRECTORY_SLOW_WARN_MS } from './FileService'

interface FakeDirent {
  name: string
  isDirectory: () => boolean
  isFile: () => boolean
  isSymbolicLink: () => boolean
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

interface RootCall {
  path: string
  gate: Deferred<FakeDirent[]>
}

const file = (name: string): FakeDirent => ({
  name,
  isDirectory: () => false,
  isFile: () => true,
  isSymbolicLink: () => false
})

const dir = (name: string): FakeDirent => ({
  name,
  isDirectory: () => true,
  isFile: () => false,
  isSymbolicLink: () => false
})

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

/** Root paths whose `readdir` the test settles by hand. */
const ROOT_PATHS = new Set(['/proj', '/proj/', '/proj/sub/..', '/Proj', '/other'])

const STARTED = 'FileService: readDirectory started'
const COMPLETED = 'FileService: readDirectory completed'
const FAILED = 'FileService: readDirectory failed'
const JOINED = 'FileService: readDirectory joined follow-up read'
const STILL_RUNNING = 'FileService: readDirectory still running'

let rootCalls: RootCall[]
let activeWalksByDigest: Map<string, number>
let maxActiveWalksPerDigest: number

/** Context objects of every call to `logger[level]` with `message`. */
function logContexts(level: 'info' | 'warn' | 'debug', message: string): Array<Record<string, unknown>> {
  return mockLogger[level].mock.calls
    .filter(([logged]) => logged === message)
    .map(([, context]) => context as Record<string, unknown>)
}

/** Drain queued promise reactions without touching any clock. */
async function flushMicrotasks(ticks = 20): Promise<void> {
  for (let tick = 0; tick < ticks; tick++) {
    await Promise.resolve()
  }
}

/**
 * Track walks per `pathDigest` from the log lines themselves – the same
 * recipe a reader of `main.log` uses to prove no two walks of one project
 * overlapped.
 */
function trackWalksFromLogs(): void {
  const adjust = (context: unknown, delta: number): void => {
    const digest = (context as { pathDigest: string }).pathDigest
    const active = (activeWalksByDigest.get(digest) ?? 0) + delta
    activeWalksByDigest.set(digest, active)
    maxActiveWalksPerDigest = Math.max(maxActiveWalksPerDigest, active)
  }
  mockLogger.info.mockImplementation((message: string, context?: unknown) => {
    if (message === STARTED) adjust(context, 1)
    if (message === COMPLETED) adjust(context, -1)
  })
  mockLogger.warn.mockImplementation((message: string, context?: unknown) => {
    if (message === FAILED) adjust(context, -1)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  rootCalls = []
  activeWalksByDigest = new Map()
  maxActiveWalksPerDigest = 0
  trackWalksFromLogs()
  ;(readdir as unknown as Mock).mockImplementation((path: string) => {
    if (!ROOT_PATHS.has(path)) return Promise.resolve([])
    const gate = deferred<FakeDirent[]>()
    rootCalls.push({ path, gate })
    return gate.promise
  })
})

describe('FileService.readDirectory single-flight per path', () => {
  it('AC2: never walks one path twice at once – a concurrent call waits for the running walk', async () => {
    const svc = new FileService()

    const first = svc.readDirectory('/proj')
    const second = svc.readDirectory('/proj')
    await flushMicrotasks()

    expect(rootCalls).toHaveLength(1)

    rootCalls[0].gate.resolve([file('a.md')])
    await first
    expect(rootCalls).toHaveLength(2)

    rootCalls[1].gate.resolve([file('a.md')])
    await second
    expect(maxActiveWalksPerDigest).toBe(1)
  })

  it('AC2: five calls during a walk cost exactly one follow-up walk', async () => {
    const svc = new FileService()

    const first = svc.readDirectory('/proj')
    const joiners = Array.from({ length: 5 }, () => svc.readDirectory('/proj'))
    rootCalls[0].gate.resolve([file('a.md')])
    await first
    rootCalls[1].gate.resolve([file('a.md')])
    await Promise.all(joiners)

    expect(rootCalls).toHaveLength(2)
    expect(maxActiveWalksPerDigest).toBe(1)
    const started = logContexts('info', STARTED)
    expect(started.map(({ followUp, callers }) => ({ followUp, callers }))).toEqual([
      { followUp: false, callers: 1 },
      { followUp: true, callers: 5 }
    ])
  })

  it('AC3: a mid-flight caller gets a walk that started after its call and sees the new entry', async () => {
    const svc = new FileService()

    const first = svc.readDirectory('/proj')
    const joinerA = svc.readDirectory('/proj')
    const joinerB = svc.readDirectory('/proj')

    rootCalls[0].gate.resolve([file('a.md')])
    const firstTree = await first
    // Created while the first walk ran; only the follow-up walk can see it.
    rootCalls[1].gate.resolve([file('a.md'), file('new.md')])
    const [treeA, treeB] = await Promise.all([joinerA, joinerB])

    expect(firstTree.map((node) => node.name)).toEqual(['a.md'])
    expect(treeA.map((node) => node.name)).toEqual(['a.md', 'new.md'])
    expect(treeB).toBe(treeA)
  })

  it('AC6: sequential calls each walk at once as leading walks', async () => {
    const svc = new FileService()

    for (let call = 0; call < 3; call++) {
      const read = svc.readDirectory('/proj')
      expect(rootCalls).toHaveLength(call + 1)
      rootCalls[call].gate.resolve([file('a.md')])
      await read
    }

    const started = logContexts('info', STARTED)
    expect(started.map(({ followUp, callers }) => ({ followUp, callers }))).toEqual([
      { followUp: false, callers: 1 },
      { followUp: false, callers: 1 },
      { followUp: false, callers: 1 }
    ])
    expect(logContexts('info', JOINED)).toHaveLength(0)
  })

  it('coalesces a path with a trailing separator or a relative segment', async () => {
    const svc = new FileService()

    const first = svc.readDirectory('/proj')
    const second = svc.readDirectory('/proj/')
    const third = svc.readDirectory('/proj/sub/..')
    await flushMicrotasks()
    expect(rootCalls).toHaveLength(1)

    rootCalls[0].gate.resolve([])
    await first
    expect(rootCalls).toHaveLength(2)
    // The follow-up walk uses the most recent joiner's string.
    expect(rootCalls[1].path).toBe('/proj/sub/..')
    rootCalls[1].gate.resolve([])
    await Promise.all([second, third])
    expect(maxActiveWalksPerDigest).toBe(1)
  })

  it('does not coalesce paths that differ only in case (SEC-002)', async () => {
    // On a case-sensitive volume these are two folders; folding them would
    // hand one caller the other folder's tree.
    const svc = new FileService()

    const lower = svc.readDirectory('/proj')
    const upper = svc.readDirectory('/Proj')
    await flushMicrotasks()
    expect(rootCalls.map((call) => call.path)).toEqual(['/proj', '/Proj'])

    rootCalls[0].gate.resolve([file('lower.md')])
    rootCalls[1].gate.resolve([file('upper.md')])
    const [lowerTree, upperTree] = await Promise.all([lower, upper])

    expect(lowerTree.map((node) => node.name)).toEqual(['lower.md'])
    expect(upperTree.map((node) => node.name)).toEqual(['upper.md'])
    expect(logContexts('info', JOINED)).toHaveLength(0)
    const digests = logContexts('info', STARTED).map((context) => context.pathDigest)
    expect(digests[0]).not.toBe(digests[1])
  })

  it('rejects only the failed walk, still serves its joiners, then starts fresh', async () => {
    const svc = new FileService()
    const failure = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })

    const first = svc.readDirectory('/proj')
    const joiner = svc.readDirectory('/proj')
    rootCalls[0].gate.reject(failure)
    await expect(first).rejects.toBe(failure)

    const failed = logContexts('warn', FAILED)
    const started = logContexts('info', STARTED)
    expect(failed).toHaveLength(1)
    expect(failed[0]).toEqual({
      readId: started[0].readId,
      pathDigest: started[0].pathDigest,
      durationMs: expect.any(Number)
    })

    rootCalls[1].gate.resolve([file('a.md')])
    await expect(joiner).resolves.toHaveLength(1)

    // The runner went idle, so the next call is a fresh leading walk.
    const fresh = svc.readDirectory('/proj')
    expect(rootCalls).toHaveLength(3)
    rootCalls[2].gate.resolve([])
    await fresh
    expect(logContexts('info', STARTED)[2]).toMatchObject({ followUp: false, callers: 1 })
    expect(logContexts('info', JOINED)).toHaveLength(1)
  })

  it('does not coalesce different paths and gives each its own pathDigest', async () => {
    const svc = new FileService()

    const proj = svc.readDirectory('/proj')
    const other = svc.readDirectory('/other')
    await flushMicrotasks()
    expect(rootCalls.map((call) => call.path)).toEqual(['/proj', '/other'])

    rootCalls[0].gate.resolve([])
    rootCalls[1].gate.resolve([])
    await Promise.all([proj, other])

    const digests = logContexts('info', STARTED).map((context) => context.pathDigest)
    expect(digests[0]).toMatch(/^[0-9a-f]{16}$/)
    expect(digests[1]).toMatch(/^[0-9a-f]{16}$/)
    expect(digests[0]).not.toBe(digests[1])
    expect(maxActiveWalksPerDigest).toBe(1)
  })

  it('keeps the running walk on its start-time hidden patterns; the follow-up walk uses the new ones', async () => {
    const svc = new FileService()

    const first = svc.readDirectory('/proj')
    svc.setHiddenPatterns(['secret'])
    const joiner = svc.readDirectory('/proj')

    rootCalls[0].gate.resolve([dir('secret'), dir('node_modules'), file('a.md')])
    const firstTree = await first
    rootCalls[1].gate.resolve([dir('secret'), dir('node_modules'), file('a.md')])
    const followUpTree = await joiner

    expect(firstTree.map((node) => node.name)).toEqual(['secret', 'a.md'])
    expect(followUpTree.map((node) => node.name)).toEqual(['node_modules', 'a.md'])
    // The one-time debug line reports the snapshot the walk actually used.
    expect(logContexts('debug', 'FileService: hidden patterns active')).toEqual([
      { patterns: ['node_modules', '.git'] }
    ])
    const completed = logContexts('info', COMPLETED)
    expect(completed.map((context) => context.hiddenPatternCount)).toEqual([2, 1])
  })

  it('logs started, completed and joined lines with readId, pathDigest, followUp and callers', async () => {
    const svc = new FileService()

    const first = svc.readDirectory('/proj')
    const joiners = Array.from({ length: 5 }, () => svc.readDirectory('/proj'))
    rootCalls[0].gate.resolve([file('a.md')])
    await first
    rootCalls[1].gate.resolve([file('a.md'), file('b.md')])
    await Promise.all(joiners)

    const started = logContexts('info', STARTED)
    const completed = logContexts('info', COMPLETED)
    const joined = logContexts('info', JOINED)
    const digest = started[0].pathDigest

    expect(started).toEqual([
      { readId: expect.any(Number), pathDigest: digest, followUp: false, callers: 1 },
      { readId: expect.any(Number), pathDigest: digest, followUp: true, callers: 5 }
    ])
    expect(started[1].readId).not.toBe(started[0].readId)
    expect(completed).toEqual([
      expect.objectContaining({ readId: started[0].readId, pathDigest: digest, followUp: false, callers: 1, fileCount: 1 }),
      expect.objectContaining({ readId: started[1].readId, pathDigest: digest, followUp: true, callers: 5, fileCount: 2 })
    ])
    expect(completed[0]).toEqual(
      expect.objectContaining({
        durationMs: expect.any(Number),
        dirCount: 0,
        hiddenPatternCount: 2,
        maxDepth: 0
      })
    )
    // Every joiner waited behind the first walk.
    expect(joined).toHaveLength(5)
    for (const context of joined) {
      expect(context).toEqual({ pathDigest: digest, behindReadId: started[0].readId })
    }
    // No readable path reaches any of these lines.
    const serialized = JSON.stringify([...started, ...completed, ...joined])
    expect(serialized).not.toContain('proj')
  })

  it('names the walk now running in behindReadId when a call arrives during a follow-up walk', async () => {
    const svc = new FileService()

    const first = svc.readDirectory('/proj')
    const second = svc.readDirectory('/proj')
    rootCalls[0].gate.resolve([])
    await first
    const third = svc.readDirectory('/proj')
    rootCalls[1].gate.resolve([])
    await second
    rootCalls[2].gate.resolve([])
    await third

    const started = logContexts('info', STARTED)
    expect(logContexts('info', JOINED).map((context) => context.behindReadId)).toEqual([
      started[0].readId,
      started[1].readId
    ])
    expect(maxActiveWalksPerDigest).toBe(1)
  })
})

describe('FileService.readDirectory slow-walk warning', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('warns exactly once when a walk is still running after the threshold', async () => {
    const svc = new FileService()

    const read = svc.readDirectory('/proj')
    vi.advanceTimersByTime(READ_DIRECTORY_SLOW_WARN_MS - 1)
    expect(logContexts('warn', STILL_RUNNING)).toHaveLength(0)

    vi.advanceTimersByTime(1)
    const started = logContexts('info', STARTED)
    expect(logContexts('warn', STILL_RUNNING)).toEqual([
      { readId: started[0].readId, pathDigest: started[0].pathDigest, elapsedMs: expect.any(Number) }
    ])

    vi.advanceTimersByTime(READ_DIRECTORY_SLOW_WARN_MS * 5)
    expect(logContexts('warn', STILL_RUNNING)).toHaveLength(1)

    rootCalls[0].gate.resolve([])
    await read
  })

  it('logs no warning for a walk that settles before the threshold and leaves no timer behind', async () => {
    const svc = new FileService()

    const read = svc.readDirectory('/proj')
    expect(vi.getTimerCount()).toBe(1)
    rootCalls[0].gate.resolve([])
    await read

    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(READ_DIRECTORY_SLOW_WARN_MS * 2)
    expect(logContexts('warn', STILL_RUNNING)).toHaveLength(0)
  })

  it('clears the warning timer when a walk fails', async () => {
    const svc = new FileService()

    const read = svc.readDirectory('/proj')
    rootCalls[0].gate.reject(new Error('ENOENT'))
    await expect(read).rejects.toThrow('ENOENT')

    expect(vi.getTimerCount()).toBe(0)
  })
})
