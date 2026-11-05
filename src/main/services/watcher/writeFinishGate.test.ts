// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWriteFinishGate, type WriteFinishDeps } from './writeFinishGate'

type Disk = { kind: 'file'; size: number } | { kind: 'error'; code: string }

/** A fake disk the gate stats, answering on the next microtask like fs/promises. */
function makeDisk(initial: Disk) {
  let state = initial
  const stat: NonNullable<WriteFinishDeps['stat']> = (_path, cb) => {
    const now = state
    queueMicrotask(() => {
      if (now.kind === 'file') cb(null, { size: now.size })
      else cb(Object.assign(new Error(now.code), { code: now.code }))
    })
  }
  return { stat, set: (next: Disk) => (state = next) }
}

const OPTS = { stabilityThreshold: 300, pollInterval: 100, maxWaitMs: 2000 }

describe('writeFinishGate (#464)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('emits once after the size has been stable for the threshold', async () => {
    const disk = makeDisk({ kind: 'file', size: 10 })
    const emit = vi.fn()
    const gate = createWriteFinishGate('/p/a.md', OPTS, emit, { stat: disk.stat, now: Date.now })

    gate.trigger()
    gate.trigger() // a burst is one change
    await vi.advanceTimersByTimeAsync(250)
    expect(emit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(gate.isPending()).toBe(false)
  })

  it('waits while the size keeps changing', async () => {
    const disk = makeDisk({ kind: 'file', size: 10 })
    const emit = vi.fn()
    const gate = createWriteFinishGate('/p/a.md', OPTS, emit, { stat: disk.stat, now: Date.now })

    gate.trigger()
    for (const size of [20, 30, 40]) {
      await vi.advanceTimersByTimeAsync(100)
      disk.set({ kind: 'file', size })
    }
    expect(emit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('keeps waiting through a moment the file is missing, then emits when it is back', async () => {
    const disk = makeDisk({ kind: 'file', size: 10 })
    const emit = vi.fn()
    const gate = createWriteFinishGate('/p/a.md', OPTS, emit, { stat: disk.stat, now: Date.now })

    gate.trigger()
    disk.set({ kind: 'error', code: 'ENOENT' }) // a delete-then-rename writer mid-replace
    await vi.advanceTimersByTimeAsync(400)
    expect(emit).not.toHaveBeenCalled()
    expect(gate.isPending()).toBe(true)

    disk.set({ kind: 'file', size: 12 })
    await vi.advanceTimersByTimeAsync(500)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('is never stuck: a file gone for good ends the wait, and the next change is reported', async () => {
    const disk = makeDisk({ kind: 'error', code: 'ENOENT' })
    const emit = vi.fn()
    const gate = createWriteFinishGate('/p/a.md', OPTS, emit, { stat: disk.stat, now: Date.now })

    gate.trigger()
    await vi.advanceTimersByTimeAsync(OPTS.maxWaitMs + 200)
    // A missing file is the unlink path's to report, not a change
    expect(emit).not.toHaveBeenCalled()
    expect(gate.isPending()).toBe(false)

    // chokidar 5.0.0 swallowed this one for good; the gate reports it
    disk.set({ kind: 'file', size: 5 })
    gate.trigger()
    await vi.advanceTimersByTimeAsync(500)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('emits after maxWait when the file stays locked (EPERM), so the reader can say why', async () => {
    const disk = makeDisk({ kind: 'error', code: 'EPERM' })
    const emit = vi.fn()
    const gate = createWriteFinishGate('/p/a.md', OPTS, emit, { stat: disk.stat, now: Date.now })

    gate.trigger()
    await vi.advanceTimersByTimeAsync(OPTS.maxWaitMs + 200)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(gate.isPending()).toBe(false)
  })

  it('emits by maxWait even when the size never settles', async () => {
    let size = 0
    const stat: NonNullable<WriteFinishDeps['stat']> = (_p, cb) => queueMicrotask(() => cb(null, { size: ++size }))
    const emit = vi.fn()
    const gate = createWriteFinishGate('/p/a.md', OPTS, emit, { stat, now: Date.now })

    gate.trigger()
    await vi.advanceTimersByTimeAsync(OPTS.maxWaitMs + 200)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('cancel drops the wait without emitting; a closed watch stops polling', async () => {
    const disk = makeDisk({ kind: 'file', size: 10 })
    const emit = vi.fn()
    let closed = false
    const gate = createWriteFinishGate('/p/a.md', OPTS, emit, { stat: disk.stat, now: Date.now, isClosed: () => closed })

    gate.trigger()
    gate.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(emit).not.toHaveBeenCalled()

    gate.trigger()
    closed = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(emit).not.toHaveBeenCalled()
    expect(gate.isPending()).toBe(false)
  })
})
