// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A main tracked watch (`mainTrackedWatch.ts`) over the freshness core's
 * fakes (#478 plan § 5.2): the fake disk, the fake source standing in for
 * `FileWatcherService`, a fake clock, and a registry the window-focus check
 * goes through. The consumer re-reads the file on every `onChange` (the
 * preview reloads it, the comment drawer lists it), so what it "shows" is the
 * disk's text at its last change.
 *
 * Call {@link installTrackedWatchHarness} at module scope; its fields are
 * rebuilt for every test (read them inside `it`).
 */
import { afterEach, beforeEach } from 'vitest'
import type { Checkable } from '../../../../shared/freshness/freshnessRegistry'
import type { FileStamp, ReadOutcome } from '../../../../shared/freshness/freshnessTypes'
import { createFakeClock, type FakeClock } from '../../../../shared/freshness/__test__/fakeClock'
import { FakeDisk } from '../../../../shared/freshness/__test__/fakeDisk'
import { FakeSource } from '../../../../shared/freshness/__test__/fakeSource'
import type { ContractEnvironment } from '../../../../shared/freshness/__test__/freshnessContract'
import type { MainFreshnessSource } from '../mainFreshnessSource'
import {
  createTrackedFileWatch,
  type MainTrackedProfile,
  type TrackedWatchHandle,
  type TrackedWatchProblem
} from '../mainTrackedWatch'

export const TRACKED_PATH = '/proj/page.html'

/** One opened watch and what its consumer heard. */
export interface OpenedTrackedWatch {
  readonly handle: TrackedWatchHandle
  /** The disk text when the consumer last re-read the file. */
  shown(): string | undefined
  readonly changes: number
  readonly deletes: number
  readonly problems: readonly TrackedWatchProblem[]
  /** The watch's source was disposed (its owner left the watch layer). */
  readonly sourceDisposed: boolean
}

export interface TrackedWatchHarness {
  readonly disk: FakeDisk
  readonly source: FakeSource
  readonly clock: FakeClock
  /** Members registered for the window-focus check now. */
  readonly registered: number
  /** A power resume: the watch layer asks each in-process owner to check. */
  wake(): void
  /** Window focus: every registered member checks. */
  focus(): void
  /** The contract's environment over these fakes. */
  env(): ContractEnvironment
  /** Open a watch on `filePath` (already on the fake disk) and let it start. */
  open(profile: MainTrackedProfile, filePath?: string): Promise<OpenedTrackedWatch>
}

/** The fake disk's text read as a stamp: the version a main tracker follows. */
export async function readStamp(disk: FakeDisk, path: string): Promise<ReadOutcome<FileStamp>> {
  const reply = await disk.readText(path)
  switch (reply.status) {
    case 'ok':
      return { status: 'ok', version: reply.stamp, stamp: reply.stamp }
    case 'missing':
      return { status: 'missing' }
    case 'busy':
      return { status: 'busy' }
    case 'too-large':
      return { status: 'blocked', reason: 'too-large' }
    case 'binary':
    case 'unsupported-encoding':
      return { status: 'blocked', reason: reply.status }
    default:
      return { status: 'failed' }
  }
}

/** The fake source as a main source: the same object, plus an owner id and a dispose. */
export function asMainSource(source: FakeSource, ownerName: string, onDispose: () => void): MainFreshnessSource {
  return {
    readStamp: async (filePath) => {
      const reply = await source.readText(filePath)
      if (reply.status === 'ok') return { status: 'ok', version: reply.stamp, stamp: reply.stamp }
      return reply.status === 'missing' || reply.status === 'busy' ? { status: reply.status } : { status: 'failed' }
    },
    ownerId: `${ownerName}:test`,
    subscribe: (request) => source.subscribe(request),
    unsubscribe: (watchId) => source.unsubscribe(watchId),
    probe: (filePath, knownHash) => source.probe(filePath, knownHash),
    readText: (filePath) => source.readText(filePath),
    onEvent: (listener) => source.onEvent(listener),
    dispose: async () => onDispose()
  }
}

export function installTrackedWatchHarness(): TrackedWatchHarness {
  const members = new Set<Checkable>()
  const ownerChecks = new Set<() => void>()
  const opened: TrackedWatchHandle[] = []
  let world: { disk: FakeDisk; source: FakeSource; clock: FakeClock } | null = null
  const current = (): { disk: FakeDisk; source: FakeSource; clock: FakeClock } => {
    if (!world) throw new Error('trackedWatchHarness: used outside a test')
    return world
  }

  beforeEach(() => {
    const clock = createFakeClock()
    const disk = new FakeDisk(clock)
    world = { clock, disk, source: new FakeSource(disk) }
    members.clear()
    ownerChecks.clear()
  })

  afterEach(async () => {
    await Promise.all(opened.splice(0).map((handle) => handle.close()))
    world = null
  })

  const harness: TrackedWatchHarness = {
    get disk() {
      return current().disk
    },
    get source() {
      return current().source
    },
    get clock() {
      return current().clock
    },
    get registered() {
      return members.size
    },
    wake: () => {
      for (const check of [...ownerChecks]) check()
    },
    focus: () => {
      for (const member of [...members]) member.check('focus')
    },
    env: () => ({
      disk: current().disk,
      source: current().source,
      run: (ms = 0) => current().clock.run(ms),
      check: () => harness.focus(),
      act: (fn) => fn()
    }),
    async open(profile, filePath = TRACKED_PATH) {
      const { disk, source, clock } = current()
      let shown = disk.content(filePath)
      let changes = 0
      let deletes = 0
      let sourceDisposed = false
      const problems: TrackedWatchProblem[] = []
      let nextId = 0
      const handle = createTrackedFileWatch(
        filePath,
        {
          onChange: () => {
            changes += 1
            shown = disk.content(filePath)
          },
          onDeleted: () => {
            deletes += 1
          },
          onProblem: (problem) => problems.push(problem)
        },
        {
          profile,
          clock,
          newId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
          read: (path) => readStamp(disk, path),
          register: (member) => {
            members.add(member)
            return () => members.delete(member)
          },
          createSource: (options) => {
            if (options.onCheck) ownerChecks.add(options.onCheck)
            return asMainSource(source, options.ownerName, () => {
              sourceDisposed = true
              if (options.onCheck) ownerChecks.delete(options.onCheck)
            })
          }
        }
      )
      opened.push(handle)
      await clock.run(0)
      return {
        handle,
        shown: () => shown,
        get changes() {
          return changes
        },
        get deletes() {
          return deletes
        },
        problems,
        get sourceDisposed() {
          return sourceDisposed
        }
      }
    }
  }
  return harness
}
