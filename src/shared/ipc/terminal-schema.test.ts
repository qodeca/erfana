// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  TERMINAL_MAX_DIM,
  TERMINAL_OUTPUT_ACK_MAX_CHARS,
  TERMINAL_WRITE_MAX_CHARS,
  ScreenReaderSupportSchema,
  TerminalCreateRequestSchema,
  TerminalCreateResponseSchema,
  TerminalIdSchema,
  TerminalOutputAckRequestSchema,
  TerminalResizeRequestSchema,
  TerminalWriteRequestSchema
} from './terminal-schema'
import { TERMINAL_CHANNELS, TERMINAL_EVENTS } from './terminal-channels'
import * as legacy from './schema'
import * as moved from './terminal-schema'

describe('TerminalIdSchema', () => {
  it.each(['terminal-1', 'terminal-123456789'])('accepts %s', (id) => {
    expect(TerminalIdSchema.safeParse(id).success).toBe(true)
  })

  it.each(['', 'terminal-', 'terminal-0x1', 'terminal-1234567890', 'Terminal-1', ' terminal-1', 'terminal-1\n'])(
    'refuses %j',
    (id) => {
      expect(TerminalIdSchema.safeParse(id).success).toBe(false)
    }
  )
})

describe('TerminalOutputAckRequestSchema', () => {
  it.each([1, 32 * 1024, TERMINAL_OUTPUT_ACK_MAX_CHARS])('accepts %d', (chars) => {
    expect(TerminalOutputAckRequestSchema.safeParse({ terminalId: 'terminal-1', chars }).success).toBe(true)
  })

  it.each([0, -1, 0.5, TERMINAL_OUTPUT_ACK_MAX_CHARS + 1, Number.NaN, Number.POSITIVE_INFINITY, '10', null])(
    'refuses chars %j',
    (chars) => {
      expect(TerminalOutputAckRequestSchema.safeParse({ terminalId: 'terminal-1', chars }).success).toBe(false)
    }
  )

  it('is strict and needs a valid id', () => {
    expect(TerminalOutputAckRequestSchema.safeParse({ terminalId: 'terminal-1', chars: 1, extra: 1 }).success).toBe(false)
    expect(TerminalOutputAckRequestSchema.safeParse({ terminalId: 'nope', chars: 1 }).success).toBe(false)
  })
})

describe('TerminalCreateRequestSchema', () => {
  it('accepts cwd, cols and rows', () => {
    expect(TerminalCreateRequestSchema.safeParse({ cwd: 'x', cols: 80, rows: 24 }).success).toBe(true)
    expect(TerminalCreateRequestSchema.safeParse({ cols: 80, rows: 24 }).success).toBe(true)
  })

  it('is strict and requires the size', () => {
    expect(TerminalCreateRequestSchema.safeParse({ cols: 80, rows: 24, shell: 'sh' }).success).toBe(false)
    expect(TerminalCreateRequestSchema.safeParse({ cols: 80, rows: 24, env: {} }).success).toBe(false)
    expect(TerminalCreateRequestSchema.safeParse({ cols: 80 }).success).toBe(false)
    expect(TerminalCreateRequestSchema.safeParse({}).success).toBe(false)
  })

  it('bounds the size', () => {
    expect(TerminalCreateRequestSchema.safeParse({ cols: TERMINAL_MAX_DIM, rows: 1 }).success).toBe(true)
    expect(TerminalCreateRequestSchema.safeParse({ cols: TERMINAL_MAX_DIM + 1, rows: 1 }).success).toBe(false)
    expect(TerminalCreateRequestSchema.safeParse({ cols: 0, rows: 1 }).success).toBe(false)
  })
})

describe('TerminalCreateResponseSchema', () => {
  it('has a success and a failure branch, and the failure carries its reason', () => {
    expect(
      TerminalCreateResponseSchema.safeParse({ success: true, terminalId: 'terminal-1', shellKind: 'posix' }).success
    ).toBe(true)
    expect(TerminalCreateResponseSchema.safeParse({ success: false, error: 'no' }).success).toBe(true)
    expect(TerminalCreateResponseSchema.safeParse({ success: false }).success).toBe(false)
    expect(TerminalCreateResponseSchema.safeParse({ success: true, terminalId: 'terminal-1' }).success).toBe(false)
    expect(TerminalCreateResponseSchema.safeParse(null).success).toBe(false)
  })
})

describe('write and resize', () => {
  it('caps a write at 1 Mi characters', () => {
    expect(TERMINAL_WRITE_MAX_CHARS).toBe(1024 * 1024)
    const ok = { terminalId: 'terminal-1', data: 'a'.repeat(TERMINAL_WRITE_MAX_CHARS) }
    expect(TerminalWriteRequestSchema.safeParse(ok).success).toBe(true)
    expect(TerminalWriteRequestSchema.safeParse({ ...ok, data: ok.data + 'a' }).success).toBe(false)
  })

  it('accepts whole numbers from 1 to the limit', () => {
    const base = { terminalId: 'terminal-1' }
    expect(TerminalResizeRequestSchema.safeParse({ ...base, cols: 1, rows: TERMINAL_MAX_DIM }).success).toBe(true)
    expect(TerminalResizeRequestSchema.safeParse({ ...base, cols: 1.5, rows: 1 }).success).toBe(false)
    expect(TerminalResizeRequestSchema.safeParse({ ...base, cols: 1, rows: TERMINAL_MAX_DIM + 1 }).success).toBe(false)
  })
})

describe('ScreenReaderSupportSchema (lens review [23])', () => {
  it('accepts { enabled } only', () => {
    expect(ScreenReaderSupportSchema.parse({ enabled: true })).toEqual({ enabled: true })
    expect(ScreenReaderSupportSchema.safeParse({ enabled: 'yes' }).success).toBe(false)
    expect(ScreenReaderSupportSchema.safeParse({ enabled: true, extra: 1 }).success).toBe(false)
    expect(ScreenReaderSupportSchema.safeParse({}).success).toBe(false)
  })
})

describe('compatibility and channel names', () => {
  it('re-exports the event schemas from schema.ts', () => {
    expect(legacy.TerminalDataSchema).toBe(moved.TerminalDataSchema)
    expect(legacy.TerminalExitSchema).toBe(moved.TerminalExitSchema)
    expect(legacy.TerminalErrorSchema).toBe(moved.TerminalErrorSchema)
  })

  it('keeps the wire names', () => {
    expect(Object.values(TERMINAL_CHANNELS).sort()).toEqual(
      [
        'terminal:isAvailable',
        'terminal:create',
        'terminal:write',
        'terminal:resize',
        'terminal:kill',
        'terminal:getInfo',
        'terminal:list',
        'terminal:getActivity',
        'terminal:clearComplete',
        'terminal:ackOutput',
        'terminal:getScreenReaderSupport'
      ].sort()
    )
    expect(Object.values(TERMINAL_EVENTS).sort()).toEqual(
      ['terminal:data', 'terminal:exit', 'terminal:error', 'terminal:clear', 'terminal:screenReaderSupportChanged'].sort()
    )
  })
})
