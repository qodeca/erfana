// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { shouldAutosave } from './autosaveGate'

const CLEAR = { conflict: false, deleted: false, contentBlocked: false }

describe('shouldAutosave', () => {
  it('writes a tab whose file is on disk and unchanged by others', () => {
    expect(shouldAutosave(CLEAR)).toBe(true)
  })

  it('waits for the conflict bar choice when the file changed on disk', () => {
    expect(shouldAutosave({ ...CLEAR, conflict: true })).toBe(false)
  })

  it('never writes back a file that was deleted on disk (#460)', () => {
    expect(shouldAutosave({ ...CLEAR, deleted: true })).toBe(false)
    expect(shouldAutosave({ ...CLEAR, conflict: true, deleted: true })).toBe(false)
  })

  it('never writes while the file cannot be shown (#478 F1: too large, binary, encoding, unreadable)', () => {
    expect(shouldAutosave({ ...CLEAR, contentBlocked: true })).toBe(false)
  })
})
