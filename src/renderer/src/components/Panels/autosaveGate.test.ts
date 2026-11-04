// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { shouldAutosave } from './autosaveGate'

describe('shouldAutosave', () => {
  it('writes a tab whose file is on disk and unchanged by others', () => {
    expect(shouldAutosave(false, false)).toBe(true)
  })

  it('waits for the conflict bar choice when the file changed on disk', () => {
    expect(shouldAutosave(true, false)).toBe(false)
  })

  it('never writes back a file that was deleted on disk (#460)', () => {
    expect(shouldAutosave(false, true)).toBe(false)
    expect(shouldAutosave(true, true)).toBe(false)
  })
})
