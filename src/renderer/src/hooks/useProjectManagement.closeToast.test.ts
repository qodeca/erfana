// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * useProjectManagement — the "Project Closed" toast (#485)
 *
 * A reload closes the old page's project in main (`page-reloaded`), and that
 * close's `project:changed` can reach the new page once it has subscribed. The
 * new page never had a project, so it must stay on the Welcome screen without
 * a "Project Closed" toast. A page that did have the project open still gets it,
 * whichever of the close reply and the close event reaches it first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useProjectManagement } from './useProjectManagement'

const mocks = vi.hoisted(() => ({ showGlobalToast: vi.fn() }))

vi.mock('../components/Toast/toastService', () => ({
  showGlobalToast: mocks.showGlobalToast
}))

vi.mock('../components/Dialog', () => ({
  useDialog: () => ({ showConfirm: vi.fn(async () => true) })
}))

// No dirty tabs and no terminal to ask about; the real close helper still runs
vi.mock('../components/ProjectTree/switchHelpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/ProjectTree/switchHelpers')>()),
  prepareProjectTransition: async () => ({ proceed: true, terminalBusy: false, settle: () => {} })
}))

type ProjectChangedListener = (data: {
  oldPath: string | null
  newPath: string | null
  generation: number
}) => unknown

let projectChangedListener: ProjectChangedListener | null

/** Fire main's project-changed event and wait for the listener to finish. */
async function emitProjectChanged(newPath: string | null, oldPath: string | null, generation: number): Promise<void> {
  await act(async () => {
    await projectChangedListener?.({ oldPath, newPath, generation })
  })
}

const closedToastShown = (): boolean =>
  mocks.showGlobalToast.mock.calls.some(([toast]) => toast?.title === 'Project Closed')

beforeEach(() => {
  vi.clearAllMocks()
  projectChangedListener = null
  // Extend the existing window rather than replacing it: `vi.stubGlobal('window',
  // …)` would destroy React's DOM internals.
  ;(window as any).api = {
    file: {
      openProject: vi.fn(async () => null),
      openProjectByPath: vi.fn(async () => null),
      closeProject: vi.fn(async () => true),
      readDirectory: vi.fn(async () => []),
      onProjectChanged: vi.fn((listener: ProjectChangedListener) => {
        projectChangedListener = listener
        return () => {}
      })
    },
    logging: { log: vi.fn() }
  }
})

afterEach(() => {
  delete (window as any).api
})

describe('useProjectManagement – Project Closed toast', () => {
  it('stays silent when the close reaches a page that never had the project (a reload)', async () => {
    const { result } = renderHook(() => useProjectManagement())

    await emitProjectChanged(null, '/proj', 4)

    expect(result.current.projectPath).toBeNull()
    expect(closedToastShown()).toBe(false)
  })

  it('still tells the user when the page had the project open', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await emitProjectChanged('/proj', null, 3)
    expect(result.current.projectPath).toBe('/proj')

    await emitProjectChanged(null, '/proj', 4)

    expect(result.current.projectPath).toBeNull()
    expect(closedToastShown()).toBe(true)
  })

  it('tells the user after File › Close Project when the close reply lands before the event', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await emitProjectChanged('/proj', null, 3)

    // The reply resolves first: the close helper has already cleared the path
    // when main's project-changed event arrives
    await act(async () => {
      await result.current.handleCloseProject()
    })
    expect((window as any).api.file.closeProject).toHaveBeenCalledTimes(1)
    expect(result.current.projectPath).toBeNull()
    expect(closedToastShown()).toBe(false)

    await emitProjectChanged(null, '/proj', 4)

    expect(closedToastShown()).toBe(true)
  })
})
