// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { isAbortError } from './isAbortError'

describe('isAbortError', () => {
  it('matches the reason an AbortController rejects with', () => {
    const controller = new AbortController()
    controller.abort()
    expect(isAbortError(controller.signal.reason)).toBe(true)
  })

  it('matches a DOMException named AbortError', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
  })

  it('does not match a real failure', () => {
    expect(isAbortError(new Error('SHA-256 mismatch'))).toBe(false)
    expect(isAbortError(new DOMException('timed out', 'TimeoutError'))).toBe(false)
  })

  it('does not match a non-Error value', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
  })
})
