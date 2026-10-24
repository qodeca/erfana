// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useProjectManagement – the first tree load names its project's generation
 *
 * A rapid double open lets main commit the second project before the first
 * one's tree read arrives; the read carries the generation of the event that
 * started it so main can refuse it as superseded instead of as a confinement
 * error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useProjectManagement } from './useProjectManagement'

vi.mock('../utils/logger', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))
vi.mock('../components/Toast/toastService', () => ({ showGlobalToast: vi.fn() }))
vi.mock('../components/Dialog', () => ({
  useDialog: () => ({ showConfirm: vi.fn(async () => true) })
}))

type Listener = (data: { oldPath: string | null; newPath: string | null; generation?: number }) => unknown

let listener: Listener | null
let readDirectory: ReturnType<typeof vi.fn>

beforeEach(() => {
  listener = null
  readDirectory = vi.fn(async () => [])
  ;(window as any).api = {
    file: {
      openProject: vi.fn(async () => null),
      openProjectByPath: vi.fn(async () => null),
      closeProject: vi.fn(async () => true),
      readDirectory,
      onProjectChanged: vi.fn((cb: Listener) => {
        listener = cb
        return () => {}
      })
    },
    logging: { log: vi.fn() }
  }
})

afterEach(() => {
  delete (window as any).api
})

describe('useProjectManagement first load generation', () => {
  it('passes the event generation to the first readDirectory', async () => {
    renderHook(() => useProjectManagement())

    await act(async () => {
      await listener?.({ oldPath: null, newPath: '/projB', generation: 7 })
    })

    expect(readDirectory).toHaveBeenCalledTimes(1)
    expect(readDirectory).toHaveBeenCalledWith({ dirPath: '/projB', generation: 7 })
  })

  it('sends no generation when the event carries none', async () => {
    renderHook(() => useProjectManagement())

    await act(async () => {
      await listener?.({ oldPath: null, newPath: '/projB' })
    })

    expect(readDirectory.mock.calls[0][0].generation).toBeUndefined()
  })
})
