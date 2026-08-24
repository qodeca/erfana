// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the shared export mutex.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { describe, it, expect } from 'vitest'
import { ExportLock } from './ExportLock'

describe('ExportLock', () => {
  it('grants the first acquire and refuses the second', () => {
    const lock = new ExportLock()
    expect(lock.acquire()).toBe(true)
    expect(lock.acquire()).toBe(false)
  })

  it('is re-acquirable after release', () => {
    const lock = new ExportLock()
    lock.acquire()
    lock.release()
    expect(lock.acquire()).toBe(true)
  })

  it('tolerates a release that never acquired, so `finally` is always safe', () => {
    const lock = new ExportLock()
    expect(() => lock.release()).not.toThrow()
    expect(lock.acquire()).toBe(true)
  })

  it('is not reentrant — the holder cannot acquire twice', () => {
    const lock = new ExportLock()
    lock.acquire()
    expect(lock.acquire()).toBe(false)
  })

  it('keeps two instances independent', () => {
    const first = new ExportLock()
    const second = new ExportLock()
    first.acquire()
    expect(second.acquire()).toBe(true)
  })
})
