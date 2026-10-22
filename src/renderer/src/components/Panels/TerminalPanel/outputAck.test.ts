// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import { createOutputAcker } from './outputAck'
import { TERMINAL_OUTPUT_ACK_STEP_CHARS } from '../../../../../shared/ipc/terminal-schema'

describe('createOutputAcker', () => {
  it('reports parsed output once per step, not once per batch', () => {
    const send = vi.fn()
    const acker = createOutputAcker('terminal-1', send)
    const batch = TERMINAL_OUTPUT_ACK_STEP_CHARS / 8
    for (let i = 0; i < 7; i++) acker.parsed(batch)
    expect(send).not.toHaveBeenCalled()
    acker.parsed(batch)
    expect(send).toHaveBeenCalledExactlyOnceWith('terminal-1', TERMINAL_OUTPUT_ACK_STEP_CHARS)
  })

  it('reports the whole amount when one batch passes the step', () => {
    const send = vi.fn()
    const acker = createOutputAcker('terminal-1', send)
    acker.parsed(TERMINAL_OUTPUT_ACK_STEP_CHARS * 2 + 5)
    expect(send).toHaveBeenCalledExactlyOnceWith('terminal-1', TERMINAL_OUTPUT_ACK_STEP_CHARS * 2 + 5)
  })

  it('flush reports the remainder once, and nothing when there is none', () => {
    const send = vi.fn()
    const acker = createOutputAcker('terminal-1', send)
    acker.flush()
    expect(send).not.toHaveBeenCalled()
    acker.parsed(10)
    acker.flush()
    acker.flush()
    expect(send).toHaveBeenCalledExactlyOnceWith('terminal-1', 10)
  })
})
