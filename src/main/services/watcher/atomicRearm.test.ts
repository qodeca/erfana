// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The unlink branch driven straight through its port.
 *
 * `atomicRearm`'s module doc claims the {@link AtomicRearmDeps} seam exists so
 * this branch can be exercised without a chokidar instance. This file is that
 * claim: a hand-built port, fake watcher objects, and a real temp file so the
 * existence checks answer honestly. `FileWatcherService.atomicSave.test.ts`
 * covers the same branch wired to the service; this one pins the branch itself,
 * including the two states the service cannot easily produce (a port that
 * refuses the swap, a `createWatcher` that throws).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FSWatcher } from 'chokidar'
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  resolveDeletedWatch,
  WATCH_DEAD_OUTSIDE_PROJECT,
  WATCH_DEAD_REARM_FAILED,
  WATCH_DEAD_SESSION_ENDED,
  type AtomicRearmDeps,
  type RearmableWatch
} from './atomicRearm'

interface FakeWatcher {
  close: ReturnType<typeof vi.fn>
}

const makeWatcher = (onClose?: () => void): FakeWatcher => ({
  close: vi.fn(async () => {
    onClose?.()
  })
})

const asFsWatcher = (watcher: FakeWatcher): FSWatcher => watcher as unknown as FSWatcher

interface Harness {
  deps: AtomicRearmDeps
  /** Every port call in order, so ordering claims can be asserted. */
  events: string[]
  createdWatchers: FakeWatcher[]
  deadReasons: string[]
  firstWatcher: FakeWatcher
  record: RearmableWatch
  state: {
    held: RearmableWatch | undefined
    version: number
    disposing: boolean
    confined: boolean
    createThrows: boolean
    acceptReplacement: boolean
  }
}

function createHarness(filePath: string): Harness {
  const events: string[] = []
  const createdWatchers: FakeWatcher[] = []
  const deadReasons: string[] = []

  const firstWatcher = makeWatcher(() => events.push('close-stale'))
  const record: RearmableWatch = {
    filePath,
    watcher: asFsWatcher(firstWatcher),
    version: 1,
    debounceTimer: null
  }

  const state = {
    held: record as RearmableWatch | undefined,
    version: 1,
    disposing: false,
    confined: true,
    createThrows: false,
    acceptReplacement: true
  }

  const deps: AtomicRearmDeps = {
    isDisposing: () => state.disposing,
    currentVersion: () => state.version,
    getWatch: path => (path === filePath ? state.held : undefined),
    isPathConfined: async () => state.confined,
    createWatcher: () => {
      if (state.createThrows) {
        throw new Error('EMFILE: too many open files')
      }
      const watcher = makeWatcher(() => events.push('close-replacement'))
      createdWatchers.push(watcher)
      events.push('create')
      return asFsWatcher(watcher)
    },
    replaceWatcher: (path, watcher) => {
      if (!state.acceptReplacement || path !== filePath || !state.held) return false
      state.held.watcher = watcher
      events.push('replace')
      return true
    },
    discardWatch: () => {
      events.push('discard')
      state.held = undefined
    },
    notifyDeleted: () => events.push('deleted'),
    notifyWatchDead: (_path, reason) => {
      events.push('dead')
      deadReasons.push(reason)
    },
    emitChange: () => events.push('change'),
    log: () => {}
  }

  return { deps, events, createdWatchers, deadReasons, firstWatcher, record, state }
}

let dir: string
let file: string
let harness: Harness

/** Put the watched file back on disk (an atomic save's second half). */
const writeFile = (): void => writeFileSync(file, '<svg/>')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'erfana-rearm-'))
  file = join(dir, 'icon.svg')
  writeFile()
  harness = createHarness(file)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('resolveDeletedWatch - atomic save', () => {
  it('closes the stale watcher, binds a replacement and re-enters the change path', async () => {
    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.events).toEqual(['close-stale', 'create', 'replace', 'change'])
    expect(harness.record.watcher).toBe(asFsWatcher(harness.createdWatchers[0]))
  })

  it('closes the stale watcher BEFORE creating its replacement', async () => {
    // Fire-and-forget close would overlap two chokidar watchers on one path,
    // and this app has a file-descriptor budget to respect (issue #70, LOW-2).
    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.events.indexOf('close-stale')).toBeLessThan(harness.events.indexOf('create'))
    expect(harness.firstWatcher.close).toHaveBeenCalledTimes(1)
  })

  it('re-arms when the detector said "gone" but the rename has landed by now', async () => {
    await resolveDeletedWatch(file, false, harness.deps)

    expect(harness.events).toContain('create')
    expect(harness.events).not.toContain('deleted')
  })
})

describe('resolveDeletedWatch - genuine delete', () => {
  it('reports the delete and drops the entry without creating a watcher', async () => {
    unlinkSync(file)

    await resolveDeletedWatch(file, false, harness.deps)

    expect(harness.events).toEqual(['deleted', 'discard'])
    expect(harness.createdWatchers).toHaveLength(0)
  })

  it('drops the entry when the file vanishes between the check and the new watcher', async () => {
    // TOCTOU: the replacement watcher is already bound to nothing.
    harness.state.confined = true
    const originalCreate = harness.deps.createWatcher
    harness.deps.createWatcher = path => {
      const watcher = originalCreate(path)
      unlinkSync(file)
      return watcher
    }

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.events).toEqual(['close-stale', 'create', 'replace', 'deleted', 'discard'])
  })
})

describe('resolveDeletedWatch - bail-outs', () => {
  it('does nothing at all once the service is disposing', async () => {
    harness.state.disposing = true

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.events).toEqual([])
  })

  it('does nothing when the entry is already gone', async () => {
    harness.state.held = undefined

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.events).toEqual([])
  })

  it('announces the dead watch when the session moved on', async () => {
    harness.state.version = 2

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.deadReasons).toEqual([WATCH_DEAD_SESSION_ENDED])
    expect(harness.events).toEqual(['dead', 'discard'])
  })

  it('refuses to re-arm a path that no longer resolves inside the project', async () => {
    // The file was replaced by someone else, so it may now be a symlink out of
    // the project - re-arming would point an automatic re-read at the target.
    harness.state.confined = false

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.deadReasons).toEqual([WATCH_DEAD_OUTSIDE_PROJECT])
    expect(harness.events).toEqual(['dead', 'discard'])
    expect(harness.createdWatchers).toHaveLength(0)
  })

  it('announces the dead watch when a replacement watcher cannot be created', async () => {
    harness.state.createThrows = true

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.deadReasons).toEqual([WATCH_DEAD_REARM_FAILED])
    expect(harness.events).toEqual(['close-stale', 'dead', 'discard'])
  })

  it('closes the replacement when the service no longer accepts it', async () => {
    // The record was swapped or dropped while the stale watcher was closing;
    // the new watcher belongs to nobody and must not be left running.
    harness.state.acceptReplacement = false

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.events).toEqual(['close-stale', 'create', 'close-replacement'])
    expect(harness.events).not.toContain('change')
  })
})
