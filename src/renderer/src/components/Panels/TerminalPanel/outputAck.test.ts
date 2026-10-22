// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import { createOutputAcker } from './outputAck'
import { TERMINAL_OUTPUT_ACK_STEP_CHARS } from '../../../../../shared/ipc/terminal-schema'

const STEP = TERMINAL_OUTPUT_ACK_STEP_CHARS

/** Total characters acknowledged so far. */
const total = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.reduce((sum, call) => sum + (call[1] as number), 0)

describe('createOutputAcker', () => {
  it('reports parsed output once per step, not once per batch', () => {
    const send = vi.fn()
    const acker = createOutputAcker('terminal-1', send)
    const callbacks = Array.from({ length: 8 }, () => acker.received(STEP / 8, false)!)
    expect(send).not.toHaveBeenCalled()
    callbacks.slice(0, 7).forEach((done) => done())
    expect(send).not.toHaveBeenCalled()
    callbacks[7]()
    expect(send).toHaveBeenCalledExactlyOnceWith('terminal-1', STEP)
  })

  it('reports the whole amount when one batch passes the step', () => {
    const send = vi.fn()
    const acker = createOutputAcker('terminal-1', send)
    acker.received(STEP * 2 + 5, false)!()
    expect(send).toHaveBeenCalledExactlyOnceWith('terminal-1', STEP * 2 + 5)
  })

  it('acknowledges on receipt while hidden, without a parse callback', () => {
    const send = vi.fn()
    const acker = createOutputAcker('terminal-1', send)
    expect(acker.received(STEP, true)).toBeUndefined()
    expect(send).toHaveBeenCalledExactlyOnceWith('terminal-1', STEP)
  })

  it('releases what is still being parsed when the window hides, and counts it once', () => {
    const send = vi.fn()
    const acker = createOutputAcker('terminal-1', send)
    const first = acker.received(10_000, false)!
    const second = acker.received(20_000, false)!
    first()
    expect(send).not.toHaveBeenCalled()

    acker.releaseInFlight()
    expect(send).toHaveBeenCalledExactlyOnceWith('terminal-1', 30_000)

    // The late parse callback of a released write reports nothing
    second()
    acker.received(STEP, true)
    expect(total(send)).toBe(30_000 + STEP)

    // Visible again: normal acking resumes, every character counted once
    const third = acker.received(STEP, false)!
    third()
    expect(total(send)).toBe(30_000 + 2 * STEP)
  })

  it('releaseInFlight reports nothing when nothing is outstanding', () => {
    const send = vi.fn()
    const acker = createOutputAcker('terminal-1', send)
    acker.releaseInFlight()
    acker.received(10, false)!()
    acker.releaseInFlight()
    acker.releaseInFlight()
    expect(send).toHaveBeenCalledExactlyOnceWith('terminal-1', 10)
  })
})
