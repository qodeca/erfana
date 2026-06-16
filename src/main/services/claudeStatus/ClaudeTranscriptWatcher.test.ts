// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import {
  ClaudeTranscriptWatcher,
  shouldIgnoreTranscriptPath
} from './ClaudeTranscriptWatcher'

/** Build a fake chokidar FSWatcher that records handlers for manual triggering. */
function makeMockWatcher() {
  const handlers: Record<string, ((arg?: unknown) => void) | undefined> = {}
  const w = {
    on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
      handlers[event] = cb
      return w
    }),
    close: vi.fn().mockResolvedValue(undefined),
    _emit: (event: string, arg?: unknown) => handlers[event]?.(arg)
  }
  return w
}

type MockWatcher = ReturnType<typeof makeMockWatcher>

describe('shouldIgnoreTranscriptPath', () => {
  it('ignores any path under a subagents/ segment', () => {
    expect(shouldIgnoreTranscriptPath('/root/ENC/subagents/abc.jsonl')).toBe(true)
    expect(shouldIgnoreTranscriptPath('/root/ENC/subagents/nested/x.jsonl')).toBe(true)
    expect(shouldIgnoreTranscriptPath('C:\\root\\ENC\\subagents\\x.jsonl')).toBe(true)
  })

  it('ignores non-.jsonl files', () => {
    expect(shouldIgnoreTranscriptPath('/root/ENC/session.txt')).toBe(true)
    expect(shouldIgnoreTranscriptPath('/root/ENC/session.json')).toBe(true)
    expect(shouldIgnoreTranscriptPath('/root/ENC/notes.md')).toBe(true)
  })

  it('allows .jsonl files', () => {
    expect(shouldIgnoreTranscriptPath('/root/ENC/session.jsonl')).toBe(false)
  })

  it('allows extension-less entries (dirs) so chokidar can watch the dir', () => {
    expect(shouldIgnoreTranscriptPath('/root/ENC')).toBe(false)
  })
})

describe('ClaudeTranscriptWatcher', () => {
  let watchFn: ReturnType<typeof vi.fn>
  let createdWatchers: MockWatcher[]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    createdWatchers = []
    watchFn = vi.fn(() => {
      const w = makeMockWatcher()
      createdWatchers.push(w)
      return w
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeWatcher(): ClaudeTranscriptWatcher {
    return new ClaudeTranscriptWatcher({ watch: watchFn as never })
  }

  it('creates exactly one chokidar watcher for the first consumer of a dir', () => {
    const w = makeWatcher()
    w.watchDir('/dir/A', 'term-1')

    expect(watchFn).toHaveBeenCalledTimes(1)
    expect(watchFn).toHaveBeenCalledWith(
      '/dir/A',
      expect.objectContaining({
        persistent: true,
        ignoreInitial: true,
        usePolling: false,
        disableGlobbing: true,
        followSymlinks: false,
        depth: 0,
        ignored: expect.any(Function)
      })
    )
  })

  it('does NOT create a second watcher for a second consumer of the same dir', () => {
    const w = makeWatcher()
    w.watchDir('/dir/A', 'term-1')
    w.watchDir('/dir/A', 'term-2')

    expect(watchFn).toHaveBeenCalledTimes(1)
  })

  it('passes shouldIgnoreTranscriptPath as the chokidar ignored predicate', () => {
    const w = makeWatcher()
    w.watchDir('/dir/A', 'term-1')

    const options = watchFn.mock.calls[0][1] as { ignored: (p: string) => boolean }
    expect(options.ignored('/dir/A/subagents/x.jsonl')).toBe(true)
    expect(options.ignored('/dir/A/x.txt')).toBe(true)
    expect(options.ignored('/dir/A/x.jsonl')).toBe(false)
  })

  it('closes the watcher only when the LAST consumer leaves', () => {
    const w = makeWatcher()
    w.watchDir('/dir/A', 'term-1')
    w.watchDir('/dir/A', 'term-2')
    const watcher = createdWatchers[0]

    w.unwatchDir('/dir/A', 'term-1')
    expect(watcher.close).not.toHaveBeenCalled()

    w.unwatchDir('/dir/A', 'term-2')
    expect(watcher.close).toHaveBeenCalledTimes(1)
  })

  it('unwatchDir is idempotent for unknown dir / unknown consumer', () => {
    const w = makeWatcher()
    expect(() => w.unwatchDir('/nope', 'term-x')).not.toThrow()

    w.watchDir('/dir/A', 'term-1')
    expect(() => w.unwatchDir('/dir/A', 'term-unknown')).not.toThrow()
    expect(createdWatchers[0].close).not.toHaveBeenCalled()
  })

  it('fires onChange(dir) once per coalesced burst', () => {
    const w = makeWatcher()
    const onChange = vi.fn()
    w.onChange(onChange)
    w.watchDir('/dir/A', 'term-1')

    const watcher = createdWatchers[0]
    watcher._emit('change', '/dir/A/s.jsonl')
    watcher._emit('change', '/dir/A/s.jsonl')
    watcher._emit('add', '/dir/A/s2.jsonl')

    // Nothing yet — still inside the coalesce window.
    expect(onChange).not.toHaveBeenCalled()

    vi.advanceTimersByTime(250)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('/dir/A')
  })

  it('does not fire onChange after the dir was unwatched mid-burst', () => {
    const w = makeWatcher()
    const onChange = vi.fn()
    w.onChange(onChange)
    w.watchDir('/dir/A', 'term-1')

    const watcher = createdWatchers[0]
    watcher._emit('change', '/dir/A/s.jsonl')
    w.unwatchDir('/dir/A', 'term-1')

    vi.advanceTimersByTime(250)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closeAll closes all watchers and is safe to call twice', async () => {
    const w = makeWatcher()
    w.watchDir('/dir/A', 'term-1')
    w.watchDir('/dir/B', 'term-2')

    await w.closeAll()
    expect(createdWatchers[0].close).toHaveBeenCalledTimes(1)
    expect(createdWatchers[1].close).toHaveBeenCalledTimes(1)

    await expect(w.closeAll()).resolves.toBeUndefined()
    // No further close calls — map already emptied.
    expect(createdWatchers[0].close).toHaveBeenCalledTimes(1)
  })

  it('swallows a watchFn that throws (never throws outward)', () => {
    const throwing = vi.fn(() => {
      throw new Error('boom')
    })
    const w = new ClaudeTranscriptWatcher({ watch: throwing as never })
    expect(() => w.watchDir('/dir/A', 'term-1')).not.toThrow()
  })
})
