// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { BENCH_SAMPLES, PickBench, PickFaults } from './pickSupport'

describe('PickBench (025-AC-049, 025-AC-050 bench hooks)', () => {
  it('keeps the latest 500 samples per stage', () => {
    const bench = new PickBench()
    for (let i = 0; i < BENCH_SAMPLES + 3; i++) bench.record('highlight', i)
    bench.record('send', 7)
    const read = bench.read('highlight')
    expect(read).toHaveLength(BENCH_SAMPLES)
    expect(read[0]).toBe(3)
    expect(bench.read('send')).toEqual([7])
    expect(bench.read('confirmToMenu')).toEqual([])
    bench.clear()
    expect(bench.read('send')).toEqual([])
  })
})

describe('PickFaults', () => {
  it('hands out each armed fault the armed number of times', () => {
    const faults = new PickFaults()
    expect(faults.takeEmptyCapture()).toBe(false)
    faults.armEmptyCaptures(2)
    faults.armCaptureFailures(1)
    faults.armWriteFailures(1)
    expect([faults.takeEmptyCapture(), faults.takeEmptyCapture(), faults.takeEmptyCapture()]).toEqual([true, true, false])
    expect([faults.takeCaptureFailure(), faults.takeCaptureFailure()]).toEqual([true, false])
    expect(faults.writeFault()).toMatchObject({ message: 'forced write failure', code: 'EIO' })
    expect(faults.writeFault()).toBeNull()
  })

  it('delays or fails the hint lookup, and reset clears everything', async () => {
    const faults = new PickFaults()
    await expect(faults.hintsHook()).resolves.toBeUndefined()
    let release: () => void = () => undefined
    faults.armHints({ until: new Promise<void>((r) => (release = r)) })
    let done = false
    const waiting = faults.hintsHook().then(() => (done = true))
    await Promise.resolve()
    expect(done).toBe(false)
    release()
    await waiting
    faults.armHints({ throws: true })
    await expect(faults.hintsHook()).rejects.toThrow('forced hint failure')
    faults.armEmptyCaptures(1)
    faults.armCaptureFailures(1)
    faults.armWriteFailures(1)
    faults.reset()
    expect(faults.takeEmptyCapture() || faults.takeCaptureFailure() || faults.writeFault() !== null).toBe(false)
    await expect(faults.hintsHook()).resolves.toBeUndefined()
  })
})
