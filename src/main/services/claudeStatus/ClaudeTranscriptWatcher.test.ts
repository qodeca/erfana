// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

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
  REARM_DELAY_MS,
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
  let watchFn: Mock
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

  describe('a dead or missing watch (Node closes the handle before `error`)', () => {
    const enoent = (): never => {
      throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    }

    it('drops the dead handle on error, keeps the consumers, and re-arms after the back-off', () => {
      const w = makeWatcher()
      const onChange = vi.fn()
      w.onChange(onChange)
      w.watchDir('/dir/A', 'term-1')

      expect(() => createdWatchers[0]._error(new Error('EPERM'))).not.toThrow()
      expect(watchFn).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(REARM_DELAY_MS)
      expect(watchFn).toHaveBeenCalledTimes(2)
      // The new watch reports one change: transcripts may have moved meanwhile
      vi.advanceTimersByTime(250)
      expect(onChange).toHaveBeenCalledWith('/dir/A')

      // Events reach the consumer through the new handle
      onChange.mockClear()
      createdWatchers[1]._emit('change', 's.jsonl')
      vi.advanceTimersByTime(250)
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('re-arms on the next watchDir without waiting for the back-off', () => {
      const w = makeWatcher()
      w.watchDir('/dir/A', 'term-1')
      createdWatchers[0]._error(new Error('EPERM'))

      w.watchDir('/dir/A', 'term-1')
      expect(watchFn).toHaveBeenCalledTimes(2)

      // A live watch: watchDir again is a no-op
      w.watchDir('/dir/A', 'term-1')
      expect(watchFn).toHaveBeenCalledTimes(2)
    })

    it('watches a folder that appears after the first watchDir', () => {
      const w = makeWatcher()
      const onChange = vi.fn()
      w.onChange(onChange)
      watchFn.mockImplementationOnce(enoent)

      w.watchDir('/dir/New', 'term-1')
      expect(createdWatchers).toHaveLength(0)

      // Folder created; the service's next refresh calls watchDir again
      w.watchDir('/dir/New', 'term-1')
      expect(createdWatchers).toHaveLength(1)
      vi.advanceTimersByTime(250)
      expect(onChange).toHaveBeenCalledWith('/dir/New')
    })

    it('backs off between attempts while the folder stays missing, and stops when unwatched', () => {
      const w = makeWatcher()
      watchFn.mockImplementation(enoent)

      w.watchDir('/dir/Gone', 'term-1')
      vi.advanceTimersByTime(REARM_DELAY_MS)
      expect(watchFn).toHaveBeenCalledTimes(2)
      // Doubled: nothing at one more base delay, a third try at two
      vi.advanceTimersByTime(REARM_DELAY_MS)
      expect(watchFn).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(REARM_DELAY_MS)
      expect(watchFn).toHaveBeenCalledTimes(3)

      w.unwatchDir('/dir/Gone', 'term-1')
      vi.advanceTimersByTime(REARM_DELAY_MS * 20)
      expect(watchFn).toHaveBeenCalledTimes(3)
    })

    it('re-arms a silent watch whose folder was replaced (inode changed), checked from watchDir', async () => {
      let ino = 1
      const stat = vi.fn(async () => ({ ino }))
      const w = new ClaudeTranscriptWatcher({ watch: watchFn as never, stat })
      const onChange = vi.fn()
      w.onChange(onChange)
      w.watchDir('/dir/A', 'term-1')
      await vi.advanceTimersByTimeAsync(0)

      // Within the check interval: no stat, no re-arm
      w.watchDir('/dir/A', 'term-1')
      expect(stat).toHaveBeenCalledTimes(1)

      // Deleted and re-created: a new inode, and no `error` from the old handle
      ino = 2
      await vi.advanceTimersByTimeAsync(REARM_DELAY_MS)
      w.watchDir('/dir/A', 'term-1')
      await vi.advanceTimersByTimeAsync(0)

      expect(watchFn).toHaveBeenCalledTimes(2)
      expect(createdWatchers[0].close).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(250)
      expect(onChange).toHaveBeenCalledWith('/dir/A')
    })

    it('re-arms when the folder is gone, and keeps a healthy watch as it is', async () => {
      let gone = false
      const stat = vi.fn(async () => {
        if (gone) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return { ino: 7 }
      })
      const w = new ClaudeTranscriptWatcher({ watch: watchFn as never, stat })
      w.watchDir('/dir/A', 'term-1')
      await vi.advanceTimersByTimeAsync(REARM_DELAY_MS)

      w.watchDir('/dir/A', 'term-1')
      await vi.advanceTimersByTimeAsync(0)
      expect(watchFn).toHaveBeenCalledTimes(1)

      gone = true
      await vi.advanceTimersByTimeAsync(REARM_DELAY_MS)
      w.watchDir('/dir/A', 'term-1')
      await vi.advanceTimersByTimeAsync(0)
      expect(createdWatchers[0].close).toHaveBeenCalledTimes(1)
      expect(watchFn).toHaveBeenCalledTimes(2)
    })

    it('does not keep the process alive with a pending re-arm', () => {
      const w = makeWatcher()
      const unref = vi.fn()
      const realSetTimeout = globalThis.setTimeout
      const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
        const timer = realSetTimeout(fn, ms) as unknown as { unref?: () => void }
        timer.unref = unref
        return timer
      }) as never)
      try {
        w.watchDir('/dir/A', 'term-1')
        createdWatchers[0]._error(new Error('EPERM'))
        expect(unref).toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })

    it('closes nothing twice: unwatch after a dead watch closes only the live one', () => {
      const w = makeWatcher()
      w.watchDir('/dir/A', 'term-1')
      createdWatchers[0]._error(new Error('EPERM'))
      vi.advanceTimersByTime(REARM_DELAY_MS)

      w.unwatchDir('/dir/A', 'term-1')
      expect(createdWatchers[0].close).toHaveBeenCalledTimes(1) // when it died
      expect(createdWatchers[1].close).toHaveBeenCalledTimes(1)
    })
  })
})
