// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The unlink branch driven straight through its port.
 *
 * `atomicRearm`'s module doc claims the {@link AtomicRearmDeps} seam exists so
 * this branch can be exercised without a chokidar instance. This file is that
 * claim: a hand-built port whose `rearm` answers as scripted, and a real temp
 * file so the existence checks answer honestly. The re-arm itself (close
 * before create, confinement, one arm at a time) is `armWatch.test.ts`;
 * `FileWatcherService.atomicSave.test.ts` covers the branch wired to the
 * service.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveDeletedWatch, type AtomicRearmDeps } from './atomicRearm'
import type { ArmOutcome, WatchEntry } from './watchTypes'
import type { WatchEndReason } from '../../../shared/freshness/freshnessTypes'

interface Harness {
  deps: AtomicRearmDeps
  /** Every port call in order, so ordering claims can be asserted. */
  events: string[]
  deadReasons: WatchEndReason[]
  entry: WatchEntry
  state: {
    held: WatchEntry | undefined
    disposing: boolean
    outcome: ArmOutcome
    /** Runs inside `rearm`, after the outcome is decided. */
    duringRearm: () => void
  }
}

function createHarness(filePath: string): Harness {
  const events: string[] = []
  const deadReasons: WatchEndReason[] = []
  const entry: WatchEntry = {
    key: filePath,
    filePath,
    profile: 'editor',
    watcher: null,
    suspended: false,
    identity: null,
    arming: null,
    ready: null,
    subs: new Set()
  }
  const state = {
    held: entry as WatchEntry | undefined,
    disposing: false,
    outcome: 'armed' as ArmOutcome,
    duringRearm: () => {}
  }
  const deps: AtomicRearmDeps = {
    isDisposing: () => state.disposing,
    getWatch: key => (key === filePath ? state.held : undefined),
    rearm: async () => {
      events.push('rearm')
      state.duringRearm()
      return state.outcome
    },
    discardWatch: () => {
      events.push('discard')
      state.held = undefined
    },
    notifyDeleted: () => events.push('deleted'),
    notifyWatchDead: (_entry, reason) => {
      events.push('dead')
      deadReasons.push(reason)
    },
    emitChange: () => events.push('change'),
    log: () => {}
  }
  return { deps, events, deadReasons, entry, state }
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
  it('re-arms through the port and re-enters the change path', async () => {
    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.events).toEqual(['rearm', 'change'])
  })

  it('re-arms when the detector said "gone" but the rename has landed by now', async () => {
    await resolveDeletedWatch(file, false, harness.deps)

    expect(harness.events).toEqual(['rearm', 'change'])
  })
})

describe('resolveDeletedWatch - genuine delete', () => {
  it('reports the delete and drops the entry without re-arming', async () => {
    unlinkSync(file)

    await resolveDeletedWatch(file, false, harness.deps)

    expect(harness.events).toEqual(['deleted', 'discard'])
  })

  it('drops the entry when the file vanishes between the re-arm and the check after it', async () => {
    // TOCTOU: the replacement watcher is already bound to nothing.
    harness.state.duringRearm = () => unlinkSync(file)

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.events).toEqual(['rearm', 'deleted', 'discard'])
  })

  it('reports a delete when the re-arm found the file missing', async () => {
    harness.state.outcome = 'missing'
    harness.state.duringRearm = () => unlinkSync(file)

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.events).toEqual(['rearm', 'deleted', 'discard'])
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

  it('leaves a watch suspended for a project switch to its resume', async () => {
    harness.entry.suspended = true

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.events).toEqual([])
  })

  it('ends the watch when the file no longer resolves inside the project', async () => {
    // The file was replaced by someone else, so it may now be a symlink out of
    // the project - re-arming would point an automatic re-read at the target.
    harness.state.outcome = 'outside-project'

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.deadReasons).toEqual(['outside-project'])
    expect(harness.events).toEqual(['rearm', 'dead', 'discard'])
  })

  it('reports a delete, not an escape, when an unresolvable file is gone', async () => {
    harness.state.outcome = 'outside-project'
    harness.state.duringRearm = () => unlinkSync(file)

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.deadReasons).toEqual([])
    expect(harness.events).toEqual(['rearm', 'deleted', 'discard'])
  })

  it('ends the watch when the file is no longer a regular file', async () => {
    harness.state.outcome = 'unsupported'

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.deadReasons).toEqual(['unsupported'])
  })

  it('announces the dead watch when a replacement watcher cannot be created', async () => {
    harness.state.outcome = 'failed'

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.deadReasons).toEqual(['restart-failed'])
    expect(harness.events).toEqual(['rearm', 'dead', 'discard'])
  })

  it('stops when the re-arm says the entry is stale', async () => {
    harness.state.outcome = 'stale'

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.events).toEqual(['rearm'])
  })

  it('leaves a newer entry on the path alone', async () => {
    // The record was swapped while the re-arm ran: its verdict belongs to nobody
    harness.state.duringRearm = () => {
      harness.state.held = { ...harness.entry }
    }

    await resolveDeletedWatch(file, true, harness.deps)

    expect(harness.events).toEqual(['rearm'])
  })
})
