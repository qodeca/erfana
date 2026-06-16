// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * project-lock-schema.test.ts
 *
 * Tests for project lock IPC schemas
 *
 * Coverage:
 * - LockInfoSchema validation (valid, invalid, missing fields, defaults)
 * - LockResultSchema discriminated union (acquired, already_locked, error)
 * - LockStatusSchema discriminated union (unlocked, locked_by_self, locked_by_other, error)
 * - IPC payload schemas (AcquireLockPayloadSchema, ReleaseLockPayloadSchema, CheckLockPayloadSchema, FocusRequestedEventSchema)
 */

import { describe, it, expect } from 'vitest'
import {
  LockInfoSchema,
  LockResultSchema,
  LockStatusSchema,
  AcquireLockPayloadSchema,
  ReleaseLockPayloadSchema,
  CheckLockPayloadSchema,
  FocusRequestedEventSchema
} from './project-lock-schema'

describe('LockInfoSchema', () => {
  const validLock = {
    instanceId: '550e8400-e29b-41d4-a716-446655440000',
    pid: 12345,
    timestamp: '2025-12-25T10:00:00.000Z',
    hostname: 'macbook.local',
    path: '/Users/test/projects/my-project'
  }

  it('validates complete lock info with all fields', () => {
    const result = LockInfoSchema.parse({
      ...validLock,
      focus_request: true,
      requester_pid: 67890
    })

    expect(result).toEqual({
      ...validLock,
      focus_request: true,
      requester_pid: 67890
    })
  })

  it('validates lock info with minimal required fields', () => {
    const result = LockInfoSchema.parse(validLock)

    expect(result).toEqual({
      ...validLock,
      focus_request: false // Default value
    })
  })

  it('applies default value for focus_request when omitted', () => {
    const result = LockInfoSchema.parse(validLock)

    expect(result.focus_request).toBe(false)
  })

  it('validates lock info with focus_request true', () => {
    const result = LockInfoSchema.parse({
      ...validLock,
      focus_request: true
    })

    expect(result.focus_request).toBe(true)
  })

  it('rejects invalid UUID format', () => {
    expect(() =>
      LockInfoSchema.parse({
        ...validLock,
        instanceId: 'not-a-uuid'
      })
    ).toThrow()
  })

  it('rejects negative PID', () => {
    expect(() =>
      LockInfoSchema.parse({
        ...validLock,
        pid: -1
      })
    ).toThrow()
  })

  it('rejects zero PID', () => {
    expect(() =>
      LockInfoSchema.parse({
        ...validLock,
        pid: 0
      })
    ).toThrow()
  })

  it('rejects non-integer PID', () => {
    expect(() =>
      LockInfoSchema.parse({
        ...validLock,
        pid: 12345.67
      })
    ).toThrow()
  })

  it('rejects invalid ISO 8601 timestamp', () => {
    expect(() =>
      LockInfoSchema.parse({
        ...validLock,
        timestamp: '2025-12-25 10:00:00'
      })
    ).toThrow()
  })

  it('allows empty hostname string', () => {
    const result = LockInfoSchema.parse({
      ...validLock,
      hostname: ''
    })

    expect(result.hostname).toBe('')
  })

  it('allows empty path string', () => {
    const result = LockInfoSchema.parse({
      ...validLock,
      path: ''
    })

    expect(result.path).toBe('')
  })

  it('rejects missing instanceId', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { instanceId, ...lockWithoutInstanceId } = validLock
    expect(() => LockInfoSchema.parse(lockWithoutInstanceId)).toThrow()
  })

  it('rejects missing pid', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pid, ...lockWithoutPid } = validLock
    expect(() => LockInfoSchema.parse(lockWithoutPid)).toThrow()
  })

  it('rejects missing timestamp', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { timestamp, ...lockWithoutTimestamp } = validLock
    expect(() => LockInfoSchema.parse(lockWithoutTimestamp)).toThrow()
  })

  it('rejects missing hostname', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { hostname, ...lockWithoutHostname } = validLock
    expect(() => LockInfoSchema.parse(lockWithoutHostname)).toThrow()
  })

  it('rejects missing path', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { path, ...lockWithoutPath } = validLock
    expect(() => LockInfoSchema.parse(lockWithoutPath)).toThrow()
  })

  it('rejects negative requester_pid', () => {
    expect(() =>
      LockInfoSchema.parse({
        ...validLock,
        requester_pid: -1
      })
    ).toThrow()
  })

  it('allows requester_pid to be undefined', () => {
    const result = LockInfoSchema.parse({
      ...validLock,
      requester_pid: undefined
    })

    expect(result.requester_pid).toBeUndefined()
  })
})

describe('LockResultSchema', () => {
  it('validates acquired status', () => {
    const result = LockResultSchema.parse({
      status: 'acquired',
      lockPath: '/Users/test/.erfana/locks/abc123.lock'
    })

    expect(result).toEqual({
      status: 'acquired',
      lockPath: '/Users/test/.erfana/locks/abc123.lock'
    })
  })

  it('validates already_locked status', () => {
    const result = LockResultSchema.parse({
      status: 'already_locked',
      holderPid: 12345,
      holderHostname: 'other-machine.local'
    })

    expect(result).toEqual({
      status: 'already_locked',
      holderPid: 12345,
      holderHostname: 'other-machine.local'
    })
  })

  it('validates error status', () => {
    const result = LockResultSchema.parse({
      status: 'error',
      message: 'Failed to create lock file'
    })

    expect(result).toEqual({
      status: 'error',
      message: 'Failed to create lock file'
    })
  })

  it('rejects invalid status value', () => {
    expect(() =>
      LockResultSchema.parse({
        status: 'invalid_status',
        lockPath: '/path/to/lock'
      })
    ).toThrow()
  })

  it('rejects acquired status without lockPath', () => {
    expect(() =>
      LockResultSchema.parse({
        status: 'acquired'
      })
    ).toThrow()
  })

  it('rejects already_locked status without holderPid', () => {
    expect(() =>
      LockResultSchema.parse({
        status: 'already_locked',
        holderHostname: 'other-machine.local'
      })
    ).toThrow()
  })

  it('rejects already_locked status without holderHostname', () => {
    expect(() =>
      LockResultSchema.parse({
        status: 'already_locked',
        holderPid: 12345
      })
    ).toThrow()
  })

  it('rejects error status without message', () => {
    expect(() =>
      LockResultSchema.parse({
        status: 'error'
      })
    ).toThrow()
  })

  it('rejects mismatched fields for acquired status', () => {
    expect(() =>
      LockResultSchema.parse({
        status: 'acquired',
        holderPid: 12345,
        holderHostname: 'other-machine.local'
      })
    ).toThrow()
  })
})

describe('LockStatusSchema', () => {
  it('validates unlocked status', () => {
    const result = LockStatusSchema.parse({
      status: 'unlocked'
    })

    expect(result).toEqual({
      status: 'unlocked'
    })
  })

  it('validates locked_by_self status', () => {
    const result = LockStatusSchema.parse({
      status: 'locked_by_self',
      lockPath: '/Users/test/.erfana/locks/abc123.lock'
    })

    expect(result).toEqual({
      status: 'locked_by_self',
      lockPath: '/Users/test/.erfana/locks/abc123.lock'
    })
  })

  it('validates locked_by_other status', () => {
    const result = LockStatusSchema.parse({
      status: 'locked_by_other',
      holderPid: 12345,
      holderHostname: 'other-machine.local'
    })

    expect(result).toEqual({
      status: 'locked_by_other',
      holderPid: 12345,
      holderHostname: 'other-machine.local'
    })
  })

  it('validates error status', () => {
    const result = LockStatusSchema.parse({
      status: 'error',
      message: 'Failed to read lock file'
    })

    expect(result).toEqual({
      status: 'error',
      message: 'Failed to read lock file'
    })
  })

  it('rejects invalid status value', () => {
    expect(() =>
      LockStatusSchema.parse({
        status: 'invalid_status'
      })
    ).toThrow()
  })

  it('rejects locked_by_self status without lockPath', () => {
    expect(() =>
      LockStatusSchema.parse({
        status: 'locked_by_self'
      })
    ).toThrow()
  })

  it('rejects locked_by_other status without holderPid', () => {
    expect(() =>
      LockStatusSchema.parse({
        status: 'locked_by_other',
        holderHostname: 'other-machine.local'
      })
    ).toThrow()
  })

  it('rejects locked_by_other status without holderHostname', () => {
    expect(() =>
      LockStatusSchema.parse({
        status: 'locked_by_other',
        holderPid: 12345
      })
    ).toThrow()
  })

  it('rejects error status without message', () => {
    expect(() =>
      LockStatusSchema.parse({
        status: 'error'
      })
    ).toThrow()
  })
})

describe('AcquireLockPayloadSchema', () => {
  it('validates valid payload', () => {
    const result = AcquireLockPayloadSchema.parse({
      projectPath: '/Users/test/projects/my-project'
    })

    expect(result).toEqual({
      projectPath: '/Users/test/projects/my-project'
    })
  })

  it('rejects empty projectPath', () => {
    expect(() =>
      AcquireLockPayloadSchema.parse({
        projectPath: ''
      })
    ).toThrow()
  })

  it('rejects missing projectPath', () => {
    expect(() => AcquireLockPayloadSchema.parse({})).toThrow()
  })

  it('rejects non-string projectPath', () => {
    expect(() =>
      AcquireLockPayloadSchema.parse({
        projectPath: 123
      })
    ).toThrow()
  })
})

describe('ReleaseLockPayloadSchema', () => {
  it('validates valid payload', () => {
    const result = ReleaseLockPayloadSchema.parse({
      projectPath: '/Users/test/projects/my-project'
    })

    expect(result).toEqual({
      projectPath: '/Users/test/projects/my-project'
    })
  })

  it('rejects empty projectPath', () => {
    expect(() =>
      ReleaseLockPayloadSchema.parse({
        projectPath: ''
      })
    ).toThrow()
  })

  it('rejects missing projectPath', () => {
    expect(() => ReleaseLockPayloadSchema.parse({})).toThrow()
  })

  it('rejects non-string projectPath', () => {
    expect(() =>
      ReleaseLockPayloadSchema.parse({
        projectPath: 123
      })
    ).toThrow()
  })
})

describe('CheckLockPayloadSchema', () => {
  it('validates valid payload', () => {
    const result = CheckLockPayloadSchema.parse({
      projectPath: '/Users/test/projects/my-project'
    })

    expect(result).toEqual({
      projectPath: '/Users/test/projects/my-project'
    })
  })

  it('rejects empty projectPath', () => {
    expect(() =>
      CheckLockPayloadSchema.parse({
        projectPath: ''
      })
    ).toThrow()
  })

  it('rejects missing projectPath', () => {
    expect(() => CheckLockPayloadSchema.parse({})).toThrow()
  })

  it('rejects non-string projectPath', () => {
    expect(() =>
      CheckLockPayloadSchema.parse({
        projectPath: 123
      })
    ).toThrow()
  })
})

describe('FocusRequestedEventSchema', () => {
  it('validates valid event', () => {
    const result = FocusRequestedEventSchema.parse({
      projectPath: '/Users/test/projects/my-project',
      requesterPid: 12345
    })

    expect(result).toEqual({
      projectPath: '/Users/test/projects/my-project',
      requesterPid: 12345
    })
  })

  it('allows empty projectPath string', () => {
    const result = FocusRequestedEventSchema.parse({
      projectPath: '',
      requesterPid: 12345
    })

    expect(result.projectPath).toBe('')
  })

  it('rejects missing projectPath', () => {
    expect(() =>
      FocusRequestedEventSchema.parse({
        requesterPid: 12345
      })
    ).toThrow()
  })

  it('rejects missing requesterPid', () => {
    expect(() =>
      FocusRequestedEventSchema.parse({
        projectPath: '/Users/test/projects/my-project'
      })
    ).toThrow()
  })

  it('rejects non-string projectPath', () => {
    expect(() =>
      FocusRequestedEventSchema.parse({
        projectPath: 123,
        requesterPid: 12345
      })
    ).toThrow()
  })

  it('rejects non-number requesterPid', () => {
    expect(() =>
      FocusRequestedEventSchema.parse({
        projectPath: '/Users/test/projects/my-project',
        requesterPid: '12345'
      })
    ).toThrow()
  })
})
