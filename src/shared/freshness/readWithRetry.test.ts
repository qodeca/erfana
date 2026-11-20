// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'

import { createFakeClock } from './__test__/fakeClock'
import type { ReadOutcome } from './freshnessTypes'
import { readWithRetry } from './readWithRetry'
import { READ_RETRY_DELAYS_MS } from './timingProfiles'

const OK: ReadOutcome<string> = { status: 'ok', version: 'v', stamp: { size: 1, mtimeMs: 1, ctimeMs: 1, ino: '1' } }
const FAILED: ReadOutcome<string> = { status: 'failed' }

/** An attempt that fails `failures` times, then succeeds; records when each attempt ran. */
function scripted(clock: { now(): number }, failures: number) {
  const at: number[] = []
  const attempt = async (): Promise<ReadOutcome<string>> => {
    at.push(clock.now())
    return at.length <= failures ? FAILED : OK
  }
  return { at, attempt }
}

describe('readWithRetry (L2)', () => {
  it('retries a failed read after 100, 300 and 900 ms, then succeeds', async () => {
    const clock = createFakeClock(0)
    const { at, attempt } = scripted(clock, 3)
    let outcome: ReadOutcome<string> | null | undefined
    void readWithRetry(attempt, { clock, delaysMs: READ_RETRY_DELAYS_MS }).then((o) => (outcome = o))

    await clock.run(1_400)
    expect(outcome).toEqual(OK)
    expect(at).toEqual([0, 100, 400, 1_300])
  })

  it('gives up after the fourth failure: the outcome stays failed', async () => {
    const clock = createFakeClock(0)
    const { at, attempt } = scripted(clock, 4)
    let outcome: ReadOutcome<string> | null | undefined
    void readWithRetry(attempt, { clock, delaysMs: READ_RETRY_DELAYS_MS }).then((o) => (outcome = o))

    await clock.run(5_000)
    expect(outcome).toEqual(FAILED)
    expect(at).toHaveLength(4)
  })

  it('does not retry an answer: ok, missing and blocked return at once', async () => {
    const clock = createFakeClock(0)
    for (const answer of [OK, { status: 'missing' }, { status: 'blocked', reason: 'binary' }] as ReadOutcome<string>[]) {
      let calls = 0
      const outcome = await readWithRetry(
        async () => {
          calls += 1
          return answer
        },
        { clock, delaysMs: READ_RETRY_DELAYS_MS }
      )
      expect(outcome).toEqual(answer)
      expect(calls).toBe(1)
    }
  })

  it('stops with null when cancelled between retries', async () => {
    const clock = createFakeClock(0)
    const { at, attempt } = scripted(clock, 10)
    let cancelled = false
    let outcome: ReadOutcome<string> | null | undefined
    void readWithRetry(attempt, { clock, delaysMs: READ_RETRY_DELAYS_MS, isCancelled: () => cancelled }).then(
      (o) => (outcome = o)
    )
    await clock.run(50)
    cancelled = true
    await clock.run(2_000)
    expect(outcome).toBeNull()
    expect(at).toHaveLength(1)
  })
})
