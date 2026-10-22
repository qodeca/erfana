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
  isTranscriptEventName,
  shouldIgnoreTranscriptPath
} from './ClaudeTranscriptWatcher'

type FolderListener = (eventType: string, filename: string | null) => void

/** Build a fake folder watch that records its listener for manual triggering. */
function makeMockWatcher(listener: FolderListener) {
  const handlers: Record<string, ((arg?: unknown) => void) | undefined> = {}
  const w = {
    on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
      handlers[event] = cb
      return w
    }),
    close: vi.fn(),
    /** A folder event, named relative to the watched folder as fs.watch does. */
    _emit: (eventType: string, filename: string | null) => listener(eventType, filename),
    _error: (error: unknown) => handlers.error?.(error)
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

  it('allows extension-less entries (dirs) through the path predicate', () => {
    expect(shouldIgnoreTranscriptPath('/root/ENC')).toBe(false)
  })
})

describe('isTranscriptEventName', () => {
  it('accepts a .jsonl name and a missing name', () => {
    expect(isTranscriptEventName('session.jsonl')).toBe(true)
    expect(isTranscriptEventName(null)).toBe(true)
  })

  it('rejects other names, folders and subagent paths', () => {
    expect(isTranscriptEventName('notes.md')).toBe(false)
    expect(isTranscriptEventName('subagents')).toBe(false)
    expect(isTranscriptEventName('subagents/x.jsonl')).toBe(false)
  })
})

describe('ClaudeTranscriptWatcher', () => {
  let watchFn: ReturnType<typeof vi.fn>
  let createdWatchers: MockWatcher[]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    createdWatchers = []
    watchFn = vi.fn((_dir: string, listener: FolderListener) => {
      const w = makeMockWatcher(listener)
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

  it('creates exactly one folder watch for the first consumer of a dir', () => {
    const w = makeWatcher()
    w.watchDir('/dir/A', 'term-1')

    expect(watchFn).toHaveBeenCalledTimes(1)
    expect(watchFn).toHaveBeenCalledWith('/dir/A', expect.any(Function))
  })

  it('opens no further watch as transcripts appear and change (one handle per folder)', () => {
    const w = makeWatcher()
    w.watchDir('/dir/A', 'term-1')
    const watcher = createdWatchers[0]

    for (let i = 0; i < 50; i++) {
      watcher._emit('rename', `s${i}.jsonl`)
      watcher._emit('change', `s${i}.jsonl`)
    }

    expect(watchFn).toHaveBeenCalledTimes(1)
  })

  it('does NOT create a second watcher for a second consumer of the same dir', () => {
    const w = makeWatcher()
    w.watchDir('/dir/A', 'term-1')
    w.watchDir('/dir/A', 'term-2')

    expect(watchFn).toHaveBeenCalledTimes(1)
  })

  it('ignores events for non-transcript names', () => {
    const w = makeWatcher()
    const onChange = vi.fn()
    w.onChange(onChange)
    w.watchDir('/dir/A', 'term-1')

    const watcher = createdWatchers[0]
    watcher._emit('change', 'x.txt')
    watcher._emit('rename', 'subagents')
    vi.advanceTimersByTime(250)

    expect(onChange).not.toHaveBeenCalled()
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
    watcher._emit('change', 's.jsonl')
    watcher._emit('change', 's.jsonl')
    watcher._emit('rename', 's2.jsonl')

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
    watcher._emit('change', 's.jsonl')
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

  it('swallows a watch error event and keeps the watch', () => {
    const w = makeWatcher()
    w.watchDir('/dir/A', 'term-1')

    expect(() => createdWatchers[0]._error(new Error('EPERM'))).not.toThrow()
    w.unwatchDir('/dir/A', 'term-1')
    expect(createdWatchers[0].close).toHaveBeenCalledTimes(1)
  })
})
