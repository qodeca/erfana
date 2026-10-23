// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * unseenWatchProbe (#252): the watched files the project watcher cannot see
 * are re-checked on a slow timer. The timer is faked and the existence test
 * injected, except for `pathIsPresent`, which runs against a real temp folder.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('../LoggingService', () => ({ logger }))

import {
  UNSEEN_PROBE_INTERVAL_MS,
  UnseenWatchProbe,
  pathIsPresent,
  reportMissingPaths,
  type UnseenWatchProbeDeps
} from './unseenWatchProbe'

const ROOT = path.join(path.sep, 'proj')
const at = (...segments: string[]): string => path.join(ROOT, ...segments)
const HIDDEN = at('.github', 'workflows', 'ci.yml')
const VISIBLE = at('docs', 'open.md')

interface Harness {
  probe: UnseenWatchProbe
  watched: Set<string>
  gone: Set<string>
  missing: string[]
  exists: ReturnType<typeof vi.fn>
}

function makeProbe(overrides: Partial<UnseenWatchProbeDeps> = {}): Harness {
  const watched = new Set([HIDDEN, VISIBLE])
  const gone = new Set<string>()
  const missing: string[] = []
  const exists = vi.fn(async (filePath: string) => !gone.has(filePath))
  const probe = new UnseenWatchProbe({
    watchedPaths: () => watched,
    isCovered: filePath => filePath === VISIBLE,
    onMissing: filePath => missing.push(filePath),
    exists,
    ...overrides
  })
  return { probe, watched, gone, missing, exists }
}

describe('UnseenWatchProbe', () => {
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
    for (const probe of probes.splice(0)) probe.stop()
    vi.useRealTimers()
  })

  it('checks only the files the project watcher cannot see, and reports the missing ones', async () => {
    const { probe, gone, missing, exists } = track(makeProbe())
    gone.add(HIDDEN)
    gone.add(VISIBLE)

    probe.schedule()
    await vi.advanceTimersByTimeAsync(UNSEEN_PROBE_INTERVAL_MS)

    expect(exists.mock.calls.map(call => call[0])).toEqual([HIDDEN])
    expect(missing).toEqual([HIDDEN])
  })

  it('does nothing before the interval, then keeps checking while a file is watched', async () => {
    const { probe, gone, missing, exists } = track(makeProbe())

    probe.schedule()
    await vi.advanceTimersByTimeAsync(UNSEEN_PROBE_INTERVAL_MS - 1)
    expect(exists).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(exists).toHaveBeenCalledTimes(1)
    expect(missing).toEqual([])

    // The folder goes away later: the next round notices
    gone.add(HIDDEN)
    await vi.advanceTimersByTimeAsync(UNSEEN_PROBE_INTERVAL_MS)
    expect(missing).toEqual([HIDDEN])
  })

  it('stops once nothing is watched, and starts again when asked', async () => {
    const { probe, watched, exists } = track(makeProbe())
    probe.schedule()
    await vi.advanceTimersByTimeAsync(UNSEEN_PROBE_INTERVAL_MS)
    expect(exists).toHaveBeenCalledTimes(1)

    watched.clear()
    await vi.advanceTimersByTimeAsync(UNSEEN_PROBE_INTERVAL_MS)
    expect(vi.getTimerCount()).toBe(0)

    watched.add(HIDDEN)
    probe.schedule()
    await vi.advanceTimersByTimeAsync(UNSEEN_PROBE_INTERVAL_MS)
    expect(exists).toHaveBeenCalledTimes(2)
  })

  it('arms one timer however often it is asked', () => {
    const { probe } = track(makeProbe())

    probe.schedule()
    probe.schedule()
    probe.schedule()

    expect(vi.getTimerCount()).toBe(1)
  })

  it('runs one stat at a time and never starts a round while one is in flight', async () => {
    let release: () => void = () => {}
    let inFlight = 0
    let maxInFlight = 0
    const exists = vi.fn(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise<void>(resolve => {
        release = resolve
      })
      inFlight--
      return true
    })
    const { probe } = track(makeProbe({ isCovered: () => false, exists }))

    probe.schedule()
    await vi.advanceTimersByTimeAsync(UNSEEN_PROBE_INTERVAL_MS)
    // The first stat hangs (a network drive that stopped answering)
    probe.schedule()
    await vi.advanceTimersByTimeAsync(UNSEEN_PROBE_INTERVAL_MS * 3)
    expect(exists).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    release()
    await vi.advanceTimersByTimeAsync(0)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(exists).toHaveBeenCalledTimes(2)
    expect(maxInFlight).toBe(1)
    // The round is over: the next one is armed
    expect(vi.getTimerCount()).toBe(1)
  })

  it('stop() cancels the armed round', async () => {
    const { probe, exists } = track(makeProbe())
    probe.schedule()

    probe.stop()
    probe.schedule()
    await vi.advanceTimersByTimeAsync(UNSEEN_PROBE_INTERVAL_MS * 2)

    expect(exists).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stop() during a round checks no further file and arms no next round', async () => {
    const harness = makeProbe({ isCovered: () => false })
    track(harness)
    harness.exists.mockImplementationOnce(async () => {
      harness.probe.stop()
      return true
    })

    harness.probe.schedule()
    await vi.advanceTimersByTimeAsync(UNSEEN_PROBE_INTERVAL_MS)

    expect(harness.exists).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('logs a failing round and still arms the next one', async () => {
    const isCovered = vi.fn(() => {
      throw new Error('boom')
    })
    const { probe } = track(makeProbe({ isCovered }))

    probe.schedule()
    await vi.advanceTimersByTimeAsync(UNSEEN_PROBE_INTERVAL_MS)

    expect(logger.error).toHaveBeenCalledWith('Unseen file watch probe failed', expect.any(Error))
    expect(vi.getTimerCount()).toBe(1)
  })
})

describe('reportMissingPaths', () => {
  it('reports each missing path in order and stops early when cancelled', async () => {
    const missing: string[] = []
    const exists = vi.fn(async (filePath: string) => filePath === VISIBLE)
    await reportMissingPaths([HIDDEN, VISIBLE, at('gone.md')], p => missing.push(p), exists)
    expect(missing).toEqual([HIDDEN, at('gone.md')])

    const cancelled = vi.fn(async () => false)
    await reportMissingPaths([HIDDEN], p => missing.push(p), cancelled, () => true)
    expect(cancelled).not.toHaveBeenCalled()
  })
})

describe('pathIsPresent', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'erfana-unseen-probe-'))
    await writeFile(path.join(dir, 'file.md'), '# here')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('is true for a file on disk', async () => {
    expect(await pathIsPresent(path.join(dir, 'file.md'))).toBe(true)
  })

  it('is false when the file or its folder is gone (ENOENT)', async () => {
    expect(await pathIsPresent(path.join(dir, 'missing.md'))).toBe(false)
    expect(await pathIsPresent(path.join(dir, 'gone-folder', 'file.md'))).toBe(false)
  })

  it('is false when a folder on the way is now a file (ENOTDIR)', async () => {
    expect(await pathIsPresent(path.join(dir, 'file.md', 'child.md'))).toBe(false)
  })

  // A folder the user may not read is still there: no false banner. POSIX modes
  // only, and root ignores them.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'is true when the path cannot be read for now (EACCES)',
    async () => {
      const locked = path.join(dir, 'locked')
      await mkdir(locked)
      await writeFile(path.join(locked, 'file.md'), '# locked')
      await chmod(locked, 0o000)
      try {
        expect(await pathIsPresent(path.join(locked, 'file.md'))).toBe(true)
      } finally {
        await chmod(locked, 0o700)
      }
    }
  )
})
