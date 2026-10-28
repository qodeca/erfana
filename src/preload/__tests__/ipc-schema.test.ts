// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { ProjectChangedSchema, TerminalDataSchema, TerminalExitSchema, TerminalErrorSchema } from '@shared/ipc/schema'

describe('IPC schema contracts', () => {
  it('validates project:changed payloads', () => {
    expect(ProjectChangedSchema.parse({ oldPath: '/a', newPath: null, generation: 2 })).toEqual({ oldPath: '/a', newPath: null, generation: 2 })
    expect(ProjectChangedSchema.parse({ oldPath: null, newPath: '/b', generation: 1 })).toEqual({ oldPath: null, newPath: '/b', generation: 1 })
  })

  it('rejects invalid project:changed payloads', () => {
    expect(() => ProjectChangedSchema.parse({ oldPath: 1, newPath: null } as any)).toThrow()
    expect(() => ProjectChangedSchema.parse({} as any)).toThrow()
    expect(() => ProjectChangedSchema.parse({ oldPath: null, newPath: '/b' } as any)).toThrow()
    expect(() => ProjectChangedSchema.parse({ oldPath: null, newPath: '/b', generation: -1 })).toThrow()
  })

  it('validates terminal event payloads', () => {
    expect(TerminalDataSchema.parse({ terminalId: 't1', data: 'ls' })).toEqual({ terminalId: 't1', data: 'ls' })
    expect(TerminalExitSchema.parse({ terminalId: 't1', exitCode: 0 })).toEqual({ terminalId: 't1', exitCode: 0 })
    expect(TerminalErrorSchema.parse({ terminalId: 't1', error: 'oops' })).toEqual({ terminalId: 't1', error: 'oops' })
  })
})

