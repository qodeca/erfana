// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A fake window freshness environment for the renderer adapter suites (#478):
 * the core's {@link FakeDisk}, {@link FakeSource} and fake clock installed with
 * `setFreshnessEnvironmentForTests`, so a hook test drives the disk and the
 * watch layer by hand and never touches `window.api.fileWatch`.
 *
 * Call {@link installFakeFreshness} once at module scope; it registers its own
 * `beforeEach` / `afterEach` and returns a handle whose fields are rebuilt for
 * every test (read them inside `it`, not at module scope).
 */
import { act } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

import { createFakeClock, type FakeClock } from '../../../../../shared/freshness/__test__/fakeClock'
import { FakeDisk } from '../../../../../shared/freshness/__test__/fakeDisk'
import { FakeSource } from '../../../../../shared/freshness/__test__/fakeSource'
import { setFreshnessEnvironmentForTests, setPausableSourceForTests } from '../windowFreshness'

export interface FakeFreshness {
  disk: FakeDisk
  source: FakeSource
  clock: FakeClock
  /** Fire main's `file-watch:check` broadcast (power resume). */
  check(): void
  /** Move the fake clock by `ms`, inside `act`, draining promises. */
  run(ms?: number): Promise<void>
  /** Drain promises inside `act` (no time passes). */
  flush(): Promise<void>
}

export function installFakeFreshness(): FakeFreshness {
  const handle = {} as FakeFreshness
  let restore: (() => void) | null = null

  beforeEach(() => {
    const clock = createFakeClock()
    const disk = new FakeDisk(clock)
    const source = new FakeSource(disk)
    const checkListeners = new Set<() => void>()
    let nextId = 0
    const restorePausable = setPausableSourceForTests(source)
    const restoreEnvironment = setFreshnessEnvironmentForTests({
      source,
      clock,
      newId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
      onCheck: (listener) => {
        checkListeners.add(listener)
        return () => checkListeners.delete(listener)
      }
    })
    restore = () => {
      restoreEnvironment()
      restorePausable()
    }
    Object.assign(handle, {
      disk,
      source,
      clock,
      check: () => {
        for (const listener of [...checkListeners]) listener()
      },
      run: async (ms = 0) => {
        await act(async () => {
          await clock.run(ms)
        })
      },
      flush: async () => {
        await act(async () => {
          await clock.flush()
        })
      }
    })
  })

  afterEach(() => {
    restore?.()
    restore = null
  })

  return handle
}
