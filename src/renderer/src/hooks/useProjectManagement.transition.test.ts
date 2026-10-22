// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for how useProjectManagement ends a project transition: what each of
 * the open (picker), open-by-path and close handlers tells `settle()`.
 *
 * `settle(true)` keeps the autosave hold (the project really changed);
 * `settle(false)` releases it (cancelled picker, no-op, failure).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProjectManagement } from './useProjectManagement'
import { showGlobalToast } from '../components/Toast/toastService'

const mocks = vi.hoisted(() => ({
  settle: vi.fn(),
  proceed: true,
  terminalBusy: false,
  openProjectWithTokenGuard: vi.fn(),
  closeProjectWithTokenGuard: vi.fn(),
  interrupt: vi.fn()
}))

vi.mock('../components/ProjectTree/switchHelpers', () => ({
  prepareProjectTransition: async () => ({
    proceed: mocks.proceed,
    terminalBusy: mocks.terminalBusy,
    settle: mocks.settle
  }),
  interruptActiveTerminalIfAny: () => mocks.interrupt(),
  openProjectWithTokenGuard: (...args: unknown[]) => mocks.openProjectWithTokenGuard(...args),
  closeProjectWithTokenGuard: (...args: unknown[]) => mocks.closeProjectWithTokenGuard(...args)
}))

vi.mock('../components/Dialog', () => ({
  useDialog: () => ({ showConfirm: vi.fn(), showAlert: vi.fn(), showPrompt: vi.fn() })
}))
vi.mock('../components/Toast/toastService', () => ({ showGlobalToast: vi.fn() }))

const openProjectByPath = vi.fn()
const api = {
  file: {
    openProject: vi.fn(),
    openProjectByPath,
    closeProject: vi.fn(),
    readDirectory: vi.fn().mockResolvedValue([]),
    onProjectChanged: vi.fn(() => vi.fn())
  }
}

function setup() {
  return renderHook(() => useProjectManagement({ api: api as never }))
}

describe('useProjectManagement transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.proceed = true
    mocks.terminalBusy = false
  })

  describe('handleOpenProject (picker)', () => {
    it('settles with true when a different project was opened', async () => {
      mocks.openProjectWithTokenGuard.mockResolvedValue('/b')
      const { result } = setup()
      await act(async () => {
        await result.current.handleOpenProject()
      })
      expect(mocks.settle).toHaveBeenCalledExactlyOnceWith(true)
    })

    it('settles with false when the picker is cancelled', async () => {
      mocks.openProjectWithTokenGuard.mockResolvedValue(null)
      const { result } = setup()
      await act(async () => {
        await result.current.handleOpenProject()
      })
      expect(mocks.settle).toHaveBeenCalledExactlyOnceWith(false)
    })

    it('settles with false when the open throws', async () => {
      mocks.openProjectWithTokenGuard.mockRejectedValue(new Error('boom'))
      const { result } = setup()
      await act(async () => {
        await result.current.handleOpenProject()
      })
      expect(mocks.settle).toHaveBeenCalledExactlyOnceWith(false)
      // Same wording as the Welcome panel's open failure
      expect(showGlobalToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', title: 'Failed to Open Project' })
      )
    })

    it('opens nothing and never settles when the prompt was cancelled (prepare already ended it)', async () => {
      mocks.proceed = false
      const { result } = setup()
      await act(async () => {
        await result.current.handleOpenProject()
      })
      expect(mocks.openProjectWithTokenGuard).not.toHaveBeenCalled()
      expect(mocks.settle).not.toHaveBeenCalled()
    })
  })

  describe('handleCloseProject', () => {
    it('settles with true when the project was closed', async () => {
      mocks.closeProjectWithTokenGuard.mockResolvedValue(true)
      const { result } = setup()
      await act(async () => {
        await result.current.handleCloseProject()
      })
      expect(mocks.settle).toHaveBeenCalledExactlyOnceWith(true)
    })

    it('settles with false when main did not close it', async () => {
      mocks.closeProjectWithTokenGuard.mockResolvedValue(false)
      const { result } = setup()
      await act(async () => {
        await result.current.handleCloseProject()
      })
      expect(mocks.settle).toHaveBeenCalledExactlyOnceWith(false)
    })

    it('settles with false when the close throws', async () => {
      mocks.closeProjectWithTokenGuard.mockRejectedValue(new Error('boom'))
      const { result } = setup()
      await act(async () => {
        await result.current.handleCloseProject()
      })
      expect(mocks.settle).toHaveBeenCalledExactlyOnceWith(false)
    })
  })

  describe('handleOpenProjectByPath', () => {
    it('settles with true when main answers a different path', async () => {
      openProjectByPath.mockResolvedValue('/b')
      const { result } = setup()
      await act(async () => {
        await result.current.handleOpenProjectByPath('/b')
      })
      expect(mocks.settle).toHaveBeenCalledExactlyOnceWith(true)
    })

    it('settles with false when the open fails', async () => {
      openProjectByPath.mockRejectedValue(new Error('gone'))
      const { result } = setup()
      await act(async () => {
        await expect(result.current.handleOpenProjectByPath('/b')).rejects.toThrow('gone')
      })
      expect(mocks.settle).toHaveBeenCalledExactlyOnceWith(false)
    })
  })
})
