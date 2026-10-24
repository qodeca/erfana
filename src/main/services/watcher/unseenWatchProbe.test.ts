// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * unseenWatchProbe (#252): the watched files the project watcher cannot see
 * are re-checked on a slow timer. The timer is faked, and the existence test
 * and the project watcher's coverage are injected. `pathIsPresent` itself is
 * covered by `pathPresence.test.ts` and `pathPresence.codes.test.ts`.
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const logger = vi.hoisted(() => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('../LoggingService', () => ({ logger }))

import {
  MISSING_ROUNDS_TO_REPORT,
  UNSEEN_PROBE_INTERVAL_MS,
  UNSEEN_STAT_TIMEOUT_MS,
  UnseenWatchProbe,
  type RemovalCoverage
} from './unseenWatchProbe'

const ROOT = path.resolve(path.sep, 'proj')
const at = (...segments: string[]): string => path.join(ROOT, ...segments)
const HIDDEN = at('.github', 'workflows', 'ci.yml')
const DIST = at('dist', 'notes.md')
const VISIBLE = at('docs', 'open.md')
const ROUND = UNSEEN_PROBE_INTERVAL_MS

interface FakeCoverage extends RemovalCoverage {
  reportsRemovalsAbove: Mock<(filePath: string) => boolean>
  isOwnRemoval: Mock<(filePath: string) => boolean>
  fireChange(): void
  listenerCount(): number
}

function makeCoverage(covered: (filePath: string) => boolean): FakeCoverage {
  const listeners = new Set<() => void>()
  return {
    reportsRemovalsAbove: vi.fn(covered),
    isOwnRemoval: vi.fn(() => false),
    onCoverageChanged: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    fireChange: () => {
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size
  }
}

interface Harness {
  probe: UnseenWatchProbe
  watched: Set<string>
  gone: Set<string>
  missing: string[]
  exists: Mock<(filePath: string) => Promise<boolean>>
  coverage: FakeCoverage
}

interface HarnessOptions {
  watched?: string[]
  covered?: (filePath: string) => boolean
  exists?: (filePath: string) => Promise<boolean>
}

/** A probe over HIDDEN (unseen) and VISIBLE (covered) unless told otherwise; armed by its coverage. */
function makeProbe(options: HarnessOptions = {}): Harness {
  const watched = new Set(options.watched ?? [HIDDEN, VISIBLE])
  const gone = new Set<string>()
  const missing: string[] = []
  const exists = vi.fn(options.exists ?? (async (filePath: string) => !gone.has(filePath)))
  const probe = new UnseenWatchProbe({
    probeablePaths: () => [...watched],
    onMissing: filePath => missing.push(filePath),
    exists
  })
  const coverage = makeCoverage(options.covered ?? (filePath => filePath === VISIBLE))
  probe.setCoverage(coverage)
  return { probe, watched, gone, missing, exists, coverage }
}

const checked = (exists: Harness['exists']): string[] => exists.mock.calls.map(call => call[0])

/** A promise that never settles: a `stat` on a drive that stopped answering. */
const never = (): Promise<boolean> => new Promise<boolean>(() => {})

describe('UnseenWatchProbe – rounds', () => {
  const probes: UnseenWatchProbe[] = []
  const track = (harness: Harness): Harness => {
    probes.push(harness.probe)
    return harness
  }

  beforeEach(() => {
    vi.useFakeTimers()
    logger.error.mockClear()
  })

  afterEach(() => {
    for (const probe of probes.splice(0)) probe.dispose()
    vi.useRealTimers()
  })

  it('checks only the unseen files, and reports one gone two rounds in a row', async () => {
    const { gone, missing, exists } = track(makeProbe())
    gone.add(HIDDEN)
    gone.add(VISIBLE)

    await vi.advanceTimersByTimeAsync(ROUND - 1)
    expect(exists).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(checked(exists)).toEqual([HIDDEN])
    expect(missing).toEqual([])

    await vi.advanceTimersByTimeAsync(ROUND * (MISSING_ROUNDS_TO_REPORT - 1))
    expect(missing).toEqual([HIDDEN])
    expect(checked(exists)).not.toContain(VISIBLE)
  })

  it('starts the count over when the file is back in between', async () => {
    const { gone, missing } = track(makeProbe())

    gone.add(HIDDEN)
    await vi.advanceTimersByTimeAsync(ROUND)
    gone.delete(HIDDEN)
    await vi.advanceTimersByTimeAsync(ROUND)
    gone.add(HIDDEN)
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(missing).toEqual([])

    await vi.advanceTimersByTimeAsync(ROUND)
    expect(missing).toEqual([HIDDEN])
  })

  it('never reports a file the app’s own operation is removing', async () => {
    const { gone, missing, coverage } = track(makeProbe())
    gone.add(HIDDEN)
    coverage.isOwnRemoval.mockImplementation(filePath => filePath === HIDDEN)

    await vi.advanceTimersByTimeAsync(ROUND * 3)
    expect(missing).toEqual([])

    // The operation's pause ended and the file is still gone: two fresh rounds
    coverage.isOwnRemoval.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(missing).toEqual([])
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(missing).toEqual([HIDDEN])
  })

  it('arms no timer while every watched file is covered, and arms one when that changes', () => {
    let hiddenCovered = true
    const { coverage } = track(makeProbe({ covered: filePath => filePath === VISIBLE || hiddenCovered }))
    expect(vi.getTimerCount()).toBe(0)

    hiddenCovered = false
    coverage.fireChange()

    expect(vi.getTimerCount()).toBe(1)
  })

  it('keeps the covered verdict per path until the coverage or that watch changes', async () => {
    const { probe, coverage } = track(makeProbe())

    await vi.advanceTimersByTimeAsync(ROUND * 3)
    expect(coverage.reportsRemovalsAbove.mock.calls.map(call => call[0]).sort()).toEqual([HIDDEN, VISIBLE].sort())

    // Asked again at the next round, not at once: a round is already armed
    coverage.fireChange()
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(coverage.reportsRemovalsAbove).toHaveBeenCalledTimes(4)

    probe.pathChanged(VISIBLE)
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(coverage.reportsRemovalsAbove).toHaveBeenCalledTimes(5)
    expect(coverage.reportsRemovalsAbove).toHaveBeenLastCalledWith(VISIBLE)
  })

  it('stops arming once nothing is unseen, and starts again when a watch is added', async () => {
    const { probe, watched, exists } = track(makeProbe())
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(exists).toHaveBeenCalledTimes(1)

    watched.delete(HIDDEN)
    probe.pathChanged(HIDDEN)
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(vi.getTimerCount()).toBe(0)

    watched.add(DIST)
    probe.pathChanged(DIST)
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(checked(exists)).toEqual([HIDDEN, DIST])
  })

  it('arms one timer however often it is asked', () => {
    const { probe } = track(makeProbe())

    probe.schedule()
    probe.pathChanged(HIDDEN)
    probe.schedule()

    expect(vi.getTimerCount()).toBe(1)
  })

  it('times out a stat that never answers, does not ask that path again until it does, and backs off', async () => {
    let hang = true
    let answer: (present: boolean) => void = () => {}
    const exists = async (filePath: string): Promise<boolean> =>
      filePath === HIDDEN && hang ? new Promise<boolean>(resolve => (answer = resolve)) : true
    const { exists: spy, missing } = track(makeProbe({ watched: [HIDDEN, DIST], covered: () => false, exists }))

    // Round 1: HIDDEN hangs for the whole time box, then DIST is checked
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(checked(spy)).toEqual([HIDDEN])
    await vi.advanceTimersByTimeAsync(UNSEEN_STAT_TIMEOUT_MS)
    expect(checked(spy)).toEqual([HIDDEN, DIST])

    // The next round waits the interval plus the last round's duration
    await vi.advanceTimersByTimeAsync(ROUND + UNSEEN_STAT_TIMEOUT_MS - 1)
    expect(spy).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    // HIDDEN's first stat is still out: only DIST is asked
    expect(checked(spy)).toEqual([HIDDEN, DIST, DIST])

    // Once it answers - even "gone", too late to count - HIDDEN is asked again
    hang = false
    answer(false)
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(checked(spy)).toEqual([HIDDEN, DIST, DIST, HIDDEN, DIST])
    expect(missing).toEqual([])
  })

  it('runs the rounds and checkNow through one queue, one stat at a time', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const exists = async (): Promise<boolean> => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, UNSEEN_STAT_TIMEOUT_MS / 2))
      inFlight--
      return true
    }
    const { probe, exists: spy } = track(makeProbe({ watched: [HIDDEN, DIST], covered: () => false, exists }))

    await vi.advanceTimersByTimeAsync(ROUND)
    const lostCheck = probe.checkNow([VISIBLE, HIDDEN], () => false)
    // Four stats of half a time box each; the next round is not due yet
    await vi.advanceTimersByTimeAsync(UNSEEN_STAT_TIMEOUT_MS * 2)
    await lostCheck

    expect(checked(spy)).toEqual([HIDDEN, DIST, VISIBLE, HIDDEN])
    expect(maxInFlight).toBe(1)
  })

  it('logs a coverage test that throws, and checks the file anyway', async () => {
    const { exists } = track(
      makeProbe({
        covered: () => {
          throw new Error('boom')
        }
      })
    )

    await vi.advanceTimersByTimeAsync(ROUND)

    expect(logger.error).toHaveBeenCalledWith('Unseen file watch probe failed', expect.any(Error))
    expect(checked(exists)).toEqual([HIDDEN, VISIBLE])
  })

  it('logs a failing existence test and still arms the next round', async () => {
    const { exists } = track(
      makeProbe({
        exists: async () => {
          throw new Error('bridge down')
        }
      })
    )

    await vi.advanceTimersByTimeAsync(ROUND)

    expect(exists).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('Unseen file watch probe failed', expect.any(Error))
    expect(vi.getTimerCount()).toBe(1)
  })
})

describe('UnseenWatchProbe – checkNow, reset and dispose', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('checkNow reports a gone file at once, except the ones the app removed itself', async () => {
    const { probe, gone, missing, exists } = makeProbe()
    gone.add(HIDDEN)
    gone.add(VISIBLE)
    gone.add(DIST)

    await probe.checkNow([HIDDEN, VISIBLE, DIST], filePath => filePath === DIST)

    expect(checked(exists)).toEqual([HIDDEN, VISIBLE, DIST])
    expect(missing).toEqual([HIDDEN, VISIBLE])
    probe.dispose()
  })

  it('a hung stat, then a project switch: the old round reports nothing and the new project is probed', async () => {
    const watched = new Set([HIDDEN])
    const gone = new Set([HIDDEN])
    const missing: string[] = []
    const exists = vi.fn(async (filePath: string) => (filePath === HIDDEN ? never() : !gone.has(filePath)))
    const probe = new UnseenWatchProbe({ probeablePaths: () => [...watched], onMissing: p => missing.push(p), exists })
    probe.setCoverage(makeCoverage(() => false))

    // The old project's round is stuck on its stat
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(checked(exists)).toEqual([HIDDEN])

    // Project switch (FileWatcherService.stopAll), then the new project opens a tab
    probe.reset()
    watched.clear()
    watched.add(DIST)
    gone.add(DIST)
    probe.pathChanged(DIST)
    const lostCheck = probe.checkNow([DIST], () => false)

    // The stuck stat holds the queue only for its time box; then the new
    // project's check runs, and its rounds report on their own
    await vi.advanceTimersByTimeAsync(UNSEEN_STAT_TIMEOUT_MS)
    await lostCheck
    expect(missing).toEqual([DIST])
    await vi.advanceTimersByTimeAsync((ROUND + UNSEEN_STAT_TIMEOUT_MS) + ROUND * MISSING_ROUNDS_TO_REPORT)
    expect(missing).toEqual([DIST, DIST])
    expect(missing).not.toContain(HIDDEN)
    expect(checked(exists).filter(p => p === HIDDEN)).toHaveLength(1)
    probe.dispose()
  })

  it('reset() drops a round’s late answer: "gone" after the switch is not counted', async () => {
    let answer: (present: boolean) => void = () => {}
    const exists = vi.fn(async (): Promise<boolean> => new Promise<boolean>(resolve => (answer = resolve)))
    const { probe, missing } = makeProbe({ watched: [HIDDEN], covered: () => false, exists })

    await vi.advanceTimersByTimeAsync(ROUND)
    expect(exists).toHaveBeenCalledTimes(1)
    probe.reset()
    answer(false)

    // The same path is still watched after the switch, and is gone: its first
    // miss in the new session must not be its second
    exists.mockImplementation(async () => false)
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(exists).toHaveBeenCalledTimes(2)
    expect(missing).toEqual([])
    probe.dispose()
  })

  it('reset() drops a checkNow’s late answer', async () => {
    let answer: (present: boolean) => void = () => {}
    const exists = vi.fn(async (): Promise<boolean> => new Promise<boolean>(resolve => (answer = resolve)))
    const { probe, missing } = makeProbe({ watched: [HIDDEN], covered: () => true, exists })

    const lostCheck = probe.checkNow([HIDDEN], () => false)
    await vi.waitFor(() => expect(exists).toHaveBeenCalledTimes(1))
    probe.reset()
    answer(false)
    await lostCheck

    expect(missing).toEqual([])
    probe.dispose()
  })

  it('counts a stat slower than the time box as present, even when it says "gone" later', async () => {
    const slowGone = (): Promise<boolean> =>
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), UNSEEN_STAT_TIMEOUT_MS + 500))
    const { probe, missing, exists } = makeProbe({ watched: [HIDDEN], covered: () => false, exists: slowGone })

    await vi.advanceTimersByTimeAsync((ROUND + UNSEEN_STAT_TIMEOUT_MS) * 4)

    expect(exists.mock.calls.length).toBeGreaterThanOrEqual(MISSING_ROUNDS_TO_REPORT + 1)
    expect(missing).toEqual([])
    probe.dispose()
  })

  it('reset() cancels the armed round and forgets the missed rounds', async () => {
    const { probe, gone, missing, exists } = makeProbe()
    gone.add(HIDDEN)
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(exists).toHaveBeenCalledTimes(1)

    probe.reset()
    expect(vi.getTimerCount()).toBe(0)

    probe.schedule()
    await vi.advanceTimersByTimeAsync(ROUND)
    // The miss before the reset does not count towards this one
    expect(missing).toEqual([])
    probe.dispose()
  })

  it('dispose() stops for good and lets go of the coverage', async () => {
    const { probe, coverage, exists } = makeProbe()
    expect(coverage.listenerCount()).toBe(1)

    probe.dispose()
    probe.schedule()
    coverage.fireChange()
    await vi.advanceTimersByTimeAsync(ROUND * 2)
    await probe.checkNow([HIDDEN], () => false)

    expect(coverage.listenerCount()).toBe(0)
    expect(exists).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a newer coverage replaces the older one', async () => {
    const { probe, coverage, exists } = makeProbe()
    const next = makeCoverage(() => true)

    probe.setCoverage(next)

    expect(coverage.listenerCount()).toBe(0)
    expect(next.listenerCount()).toBe(1)
    // Everything is covered now: the armed round checks nothing and arms no next one
    await vi.advanceTimersByTimeAsync(ROUND)
    expect(exists).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    probe.dispose()
  })
})
