// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The shared freshness contract (#478 plan § 5.2, § 5.6, F4) run against the
 * HTML preview's sub-file watches: `PreviewWatchPool`, whose every file is a
 * tracker on the pool's one source. Over the core's fakes; what the page
 * "shows" of the file is the disk text when the pool last reported it changed
 * (the page reloads and re-reads it). The page file itself is
 * `previewFreshness.contract.test.ts`.
 */
import { afterEach, beforeEach, vi } from 'vitest'

vi.mock('electron', () => ({ app: undefined, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../LoggingService', () => ({ logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import type { Checkable } from '../../../shared/freshness/freshnessRegistry'
import { createFakeClock, type FakeClock } from '../../../shared/freshness/__test__/fakeClock'
import { FakeDisk } from '../../../shared/freshness/__test__/fakeDisk'
import { FakeSource } from '../../../shared/freshness/__test__/fakeSource'
import { describeFreshnessContract } from '../../../shared/freshness/__test__/freshnessContract'
import { asMainSource, readStamp } from '../freshness/__test__/trackedWatchHarness'
import { createPreviewWatchPool, type IPreviewWatchPool } from './PreviewWatchPool'

const FILE = '/proj/style.css'

let world: { clock: FakeClock; disk: FakeDisk; source: FakeSource; members: Set<Checkable> }
const pools: IPreviewWatchPool[] = []

beforeEach(() => {
  const clock = createFakeClock()
  const disk = new FakeDisk(clock)
  world = { clock, disk, source: new FakeSource(disk), members: new Set() }
})

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()))
})

function makePool(): IPreviewWatchPool {
  const { clock, disk, source, members } = world
  let nextId = 0
  const pool = createPreviewWatchPool({
    clock,
    newId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
    read: (path) => readStamp(disk, path),
    register: (member) => {
      members.add(member)
      return () => members.delete(member)
    },
    createSource: (options) => asMainSource(source, options.ownerName, () => {})
  })
  pools.push(pool)
  return pool
}

describeFreshnessContract('HTML preview sub-files (PreviewWatchPool, preview profile)', {
  env: () => ({
    disk: world.disk,
    source: world.source,
    run: (ms = 0) => world.clock.run(ms),
    check: () => {
      for (const member of [...world.members]) member.check('focus')
    },
    act: (fn) => fn()
  }),
  filePath: FILE,
  profile: 'preview',
  open: async () => {
    const pool = makePool()
    let shown = world.disk.content(FILE)
    let changes = 0
    const onChange = (): void => {
      changes += 1
      shown = world.disk.content(FILE)
    }
    pool.acquire(FILE, onChange)
    await world.clock.run(0)
    return {
      shown: () => shown,
      applyCount: () => changes,
      state: () => pool.state(FILE) ?? { watch: { kind: 'stopped', reason: 'project-closed' }, content: { kind: 'fresh' } },
      // The page's Reload reaches a sub-file as a new watch set: the watch is followed afresh
      reload: async () => {
        await pool.release(FILE)
        pool.acquire(FILE, onChange)
        await world.clock.run(0)
      },
      setVisible: async (visible) => {
        if (visible) pool.recheck()
        await world.clock.run(0)
      }
    }
  },
  shows: (text) => text,
  adapterModule: 'src/main/services/preview/PreviewWatchPool.ts',
  editable: false,
  skips: {
    '9-content-refusal':
      'C1 is N/A for the preview (plan § 5.6): its version is the stamp, and the page renders whatever bytes it loads',
    '10-hidden-deferred':
      'the pool reports at once; a hidden view defers its reload in the pipeline (isWanted), not in the tracker'
  }
})
