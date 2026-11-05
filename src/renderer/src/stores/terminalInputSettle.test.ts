// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ENTER_HARD_MAX_DELAY_MS,
  ENTER_MAX_DELAY_MS,
  ENTER_MIN_QUIET_MS,
  ENTER_NO_OUTPUT_DELAY_MS,
  ENTER_POLL_MS,
  waitForInputToSettle,
  type InputSettleReason
} from './terminalInputSettle'

/**
 * Direct tests of the Enter timing rule (#449), at the exact limits.
 *
 * The wait polls every ENTER_POLL_MS from ENTER_MIN_DELAY_MS (200 ms) on, so
 * the poll instants are 200, 250, 300 … ms after the paste. Every output and
 * every limit below sits on one of those instants, so "not yet at limit − 1 ms,
 * resolved at the limit" checks the limit itself, not the poll rounding.
 */

/** One wait under test, with a terminal whose output time the test sets. */
function startWait() {
  const writtenAt = Date.now()
  let last: number | undefined
  let reason: InputSettleReason | undefined
  void waitForInputToSettle(() => last, writtenAt).then((r) => {
    reason = r
  })

  return {
    /** Advance fake time to `ms` after the paste. */
    at: async (ms: number) => {
      await vi.advanceTimersByTimeAsync(writtenAt + ms - Date.now())
    },
    /** The terminal printed something now. */
    output: () => {
      last = Date.now()
    },
    /** Pretend the terminal last printed at `ms` after the paste (negative: before it). */
    setLast: (ms: number) => {
      last = writtenAt + ms
    },
    reason: () => reason
  }
}

describe('waitForInputToSettle (#449)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('no output at all', () => {
    it('resolves "no-output" at exactly ENTER_NO_OUTPUT_DELAY_MS, not a millisecond sooner', async () => {
      const wait = startWait()

      await wait.at(ENTER_NO_OUTPUT_DELAY_MS - 1)
      expect(wait.reason()).toBeUndefined()

      await wait.at(ENTER_NO_OUTPUT_DELAY_MS)
      expect(wait.reason()).toBe('no-output')
    })

    it('treats output from before the paste as no output', async () => {
      const wait = startWait()
      wait.setLast(-5)

      await wait.at(ENTER_NO_OUTPUT_DELAY_MS - 1)
      expect(wait.reason()).toBeUndefined()
      await wait.at(ENTER_NO_OUTPUT_DELAY_MS)
      expect(wait.reason()).toBe('no-output')
    })
  })

  describe('quiet rule', () => {
    it('resolves "settled" once a single echo has been quiet for exactly ENTER_MIN_QUIET_MS', async () => {
      const wait = startWait()
      await wait.at(200)
      wait.output()

      await wait.at(200 + ENTER_MIN_QUIET_MS - 1)
      expect(wait.reason()).toBeUndefined()

      await wait.at(200 + ENTER_MIN_QUIET_MS)
      expect(wait.reason()).toBe('settled')
    })

    it('after a long pause, waits exactly 2 × the longest pause of quiet, not ENTER_MIN_QUIET_MS', async () => {
      // Pieces 600 ms apart (the first 600 ms after the paste): longest pause 600 ms
      const wait = startWait()
      for (const ms of [600, 1200, 1800]) {
        await wait.at(ms)
        wait.output()
      }

      // ENTER_MIN_QUIET_MS of quiet would have been enough without the 2x rule
      await wait.at(1800 + ENTER_MIN_QUIET_MS)
      expect(wait.reason()).toBeUndefined()

      await wait.at(1800 + 2 * 600 - 1)
      expect(wait.reason()).toBeUndefined()
      await wait.at(1800 + 2 * 600)
      expect(wait.reason()).toBe('settled')
    })

    it('measures the longest pause, not the latest one', async () => {
      // One 1000 ms stall, then quick pieces: the stall sets the quiet time
      const wait = startWait()
      for (const ms of [1000, 1050, 1100]) {
        await wait.at(ms)
        wait.output()
      }

      await wait.at(1100 + 2 * 1000 - 1)
      expect(wait.reason()).toBeUndefined()
      await wait.at(1100 + 2 * 1000)
      expect(wait.reason()).toBe('settled')
    })
  })

  describe('spinner cap (output that never pauses longer than ENTER_MIN_QUIET_MS)', () => {
    it('resolves "cap" at exactly ENTER_MAX_DELAY_MS for a fast spinner', async () => {
      const wait = startWait()
      for (let ms = 250; ms < ENTER_MAX_DELAY_MS; ms += ENTER_POLL_MS) {
        await wait.at(ms)
        wait.output()
        expect(wait.reason()).toBeUndefined()
      }

      await wait.at(ENTER_MAX_DELAY_MS - 1)
      expect(wait.reason()).toBeUndefined()
      await wait.at(ENTER_MAX_DELAY_MS)
      expect(wait.reason()).toBe('cap')
    })

    it('still uses the 8 s cap when the longest pause is exactly ENTER_MIN_QUIET_MS', async () => {
      // Pauses of exactly 400 ms: never quiet for 2 x 400 ms, and not "long"
      const wait = startWait()
      for (let ms = ENTER_MIN_QUIET_MS; ms <= ENTER_MAX_DELAY_MS; ms += ENTER_MIN_QUIET_MS) {
        await wait.at(ms)
        if (ms < ENTER_MAX_DELAY_MS) expect(wait.reason()).toBeUndefined()
        wait.output()
      }
      expect(wait.reason()).toBe('cap')
    })
  })

  describe('hard cap (a paste still arriving in long-paused pieces)', () => {
    it('keeps waiting past ENTER_MAX_DELAY_MS once a pause longer than ENTER_MIN_QUIET_MS was seen', async () => {
      // A piece every 450 ms: one pause just over the "long" line, and never
      // quiet for 2 x 450 ms, so only the hard cap can end the wait
      const wait = startWait()
      for (let ms = 450; ms <= ENTER_MAX_DELAY_MS + 450; ms += 450) {
        await wait.at(ms)
        wait.output()
      }
      expect(wait.reason()).toBeUndefined()
    })

    it('resolves "cap" at exactly ENTER_HARD_MAX_DELAY_MS, not sooner', async () => {
      const wait = startWait()
      for (let ms = 500; ms < ENTER_HARD_MAX_DELAY_MS; ms += 500) {
        await wait.at(ms)
        wait.output()
      }

      await wait.at(ENTER_HARD_MAX_DELAY_MS - 1)
      expect(wait.reason()).toBeUndefined()
      await wait.at(ENTER_HARD_MAX_DELAY_MS)
      expect(wait.reason()).toBe('cap')
    })
  })
})
