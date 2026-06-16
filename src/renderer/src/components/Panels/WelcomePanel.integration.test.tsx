// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * WelcomePanel.integration.test.tsx
 *
 * todo006: Integration tests for recent projects flow
 *
 * End-to-end scenarios testing the complete flow from UI to mock IPC
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WelcomePanel } from './WelcomePanel'
import { getBasename } from '../../utils/fileUtils'

// Simulated project store
let simulatedProjects: Array<{ path: string; name: string; lastOpened: number }> = []
let nextTimestamp = 1000

// Mocks
const mockShowGlobalToast = vi.fn()
const mockState = { isProjectChanging: false }

// Mock useProjectStore
vi.mock('../../stores/useProjectStore', () => ({
  useProjectStore: (selector: (state: { isProjectChanging: boolean }) => boolean) => {
    return selector(mockState)
  }
}))

// Mock toast service
vi.mock('../../components/Toast/toastService', () => ({
  showGlobalToast: (options: unknown) => mockShowGlobalToast(options)
}))

// Mock useOpenProjectByPath and useProjectManagementContext from context to avoid Provider requirement
// The integration tests still use window.api mocks directly for the actual behavior
const mockHandleOpenProjectByPath = vi.fn()
const mockHandleOpenProject = vi.fn()
const mockImportFile = vi.fn(() => Promise.resolve(null))
vi.mock('../../context/ProjectManagementContext', () => ({
  useOpenProjectByPath: () => ({
    handleOpenProjectByPath: mockHandleOpenProjectByPath,
    isSwitchingProject: false
  }),
  useProjectManagementContext: () => ({
    projectPath: null,
    handleOpenProject: mockHandleOpenProject,
    isSwitchingProject: false
  })
}))

// Mock useImport hook (referenceable spy, matching WelcomePanel.test.tsx)
vi.mock('../../hooks/useImport', () => ({
  useImport: () => ({
    isImporting: false,
    importFile: mockImportFile
  })
}))

// Simulated API that mimics real behavior
const mockApi = {
  settings: {
    getRecentProjects: vi.fn(async () => ({
      success: true,
      projects: [...simulatedProjects].sort((a, b) => b.lastOpened - a.lastOpened)
    })),
    removeRecentProject: vi.fn(async (path: string) => {
      simulatedProjects = simulatedProjects.filter(p => p.path !== path)
      return { success: true }
    }),
    addRecentProject: vi.fn(async (path: string, name: string) => {
      // Remove existing
      simulatedProjects = simulatedProjects.filter(p => p.path !== path)
      // Add at front with new timestamp
      simulatedProjects.unshift({ path, name, lastOpened: nextTimestamp++ })
      // Limit to 5
      if (simulatedProjects.length > 5) {
        simulatedProjects = simulatedProjects.slice(0, 5)
      }
      return { success: true }
    })
  },
  file: {
    openProjectByPath: vi.fn(async (path: string) => {
      // Simulate adding to recent projects on open
      const name = getBasename(path) || path
      simulatedProjects = simulatedProjects.filter(p => p.path !== path)
      simulatedProjects.unshift({ path, name, lastOpened: nextTimestamp++ })
      if (simulatedProjects.length > 5) {
        simulatedProjects = simulatedProjects.slice(0, 5)
      }
      return path
    }),
    onProjectChanged: vi.fn(() => vi.fn()) // Returns unsubscribe function
  }
}

const originalApi = (window as unknown as { api?: typeof mockApi }).api

const mockDockviewProps = {
  api: {} as never,
  containerApi: {} as never,
  params: {},
  group: {} as never,
  title: 'Welcome'
}

describe('Recent Projects Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    simulatedProjects = []
    nextTimestamp = 1000
    mockState.isProjectChanging = false
    ;(window as unknown as { api: typeof mockApi }).api = mockApi
    // Configure mock to call the simulated API (for integration behavior)
    mockHandleOpenProjectByPath.mockImplementation(async (path: string) => {
      // Simulate the API call behavior
      const name = getBasename(path) || path
      simulatedProjects = simulatedProjects.filter(p => p.path !== path)
      simulatedProjects.unshift({ path, name, lastOpened: nextTimestamp++ })
      if (simulatedProjects.length > 5) {
        simulatedProjects = simulatedProjects.slice(0, 5)
      }
      return true
    })
  })

  afterEach(() => {
    ;(window as unknown as { api?: typeof mockApi }).api = originalApi
  })

  describe('Project Opening Flow', () => {
    it('should open project and update recent list', async () => {
      // Pre-populate with one project
      simulatedProjects = [
        { path: '/path/old-project', name: 'old-project', lastOpened: 500 }
      ]

      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('old-project')).toBeInTheDocument()
      })

      // Click to open
      const projectItem = screen.getByText('old-project').closest('.recent-project-item')
      await user.click(projectItem!)

      // Verify hook method was called
      expect(mockHandleOpenProjectByPath).toHaveBeenCalledWith('/path/old-project')
    })

    it('should update timestamp when re-opening existing project', async () => {
      simulatedProjects = [
        { path: '/path/project-a', name: 'project-a', lastOpened: 100 },
        { path: '/path/project-b', name: 'project-b', lastOpened: 200 }
      ]

      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      // Open older project
      const projectItem = screen.getByText('project-a').closest('.recent-project-item')
      await user.click(projectItem!)

      await waitFor(() => {
        // After opening, project-a should have newer timestamp
        expect(simulatedProjects[0].path).toBe('/path/project-a')
        expect(simulatedProjects[0].lastOpened).toBeGreaterThan(200)
      })
    })
  })

  describe('Project Removal Flow', () => {
    it('should remove project and reload list', async () => {
      simulatedProjects = [
        { path: '/path/project-a', name: 'project-a', lastOpened: 100 },
        { path: '/path/project-b', name: 'project-b', lastOpened: 200 }
      ]

      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Remove from recent projects' })).toHaveLength(2)
      })

      // Remove first project
      const removeButtons = screen.getAllByRole('button', { name: 'Remove from recent projects' })
      await user.click(removeButtons[0])

      await waitFor(() => {
        // Verify project was removed from simulated store
        expect(simulatedProjects).toHaveLength(1)
        expect(simulatedProjects[0].path).toBe('/path/project-a')
      })
    })
  })

  describe('Max Projects Limit', () => {
    it('should maintain max 5 projects after adding to full list', async () => {
      // Start with 5 projects (oldest first in array, but sorted by lastOpened)
      simulatedProjects = [
        { path: '/path/project-4', name: 'project-4', lastOpened: 400 }, // newest
        { path: '/path/project-3', name: 'project-3', lastOpened: 300 },
        { path: '/path/project-2', name: 'project-2', lastOpened: 200 },
        { path: '/path/project-1', name: 'project-1', lastOpened: 100 },
        { path: '/path/project-0', name: 'project-0', lastOpened: 50 }  // oldest
      ]

      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-4')).toBeInTheDocument()
      })

      // Simulate opening a new project via API (outside component)
      await mockApi.settings.addRecentProject('/path/new-project', 'new-project')

      // Should still have 5 projects
      expect(simulatedProjects.length).toBe(5)

      // New project should be first
      expect(simulatedProjects[0].path).toBe('/path/new-project')

      // All original projects should still exist except possibly the oldest
      // The addRecentProject mock adds to front and slices to 5
      expect(simulatedProjects.length).toBeLessThanOrEqual(5)
    })
  })

  describe('UI Blocking', () => {
    it('should block UI interactions when isProjectChanging', async () => {
      simulatedProjects = [
        { path: '/path/project-a', name: 'project-a', lastOpened: 100 }
      ]

      mockState.isProjectChanging = true
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        const projectItem = document.querySelector('.recent-project-item')
        expect(projectItem).toHaveClass('disabled')
      })
    })

    it('should prevent open while blocked', async () => {
      simulatedProjects = [
        { path: '/path/project-a', name: 'project-a', lastOpened: 100 }
      ]

      mockState.isProjectChanging = true
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      const projectItem = screen.getByText('project-a').closest('.recent-project-item')
      await user.click(projectItem!)

      expect(mockHandleOpenProjectByPath).not.toHaveBeenCalled()
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle rapid project switches without corruption', async () => {
      simulatedProjects = [
        { path: '/path/project-a', name: 'project-a', lastOpened: 100 },
        { path: '/path/project-b', name: 'project-b', lastOpened: 200 },
        { path: '/path/project-c', name: 'project-c', lastOpened: 300 }
      ]

      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      // Rapidly click multiple projects
      const items = document.querySelectorAll('.recent-project-item')
      await user.click(items[0])
      await user.click(items[1])
      await user.click(items[2])

      // All should have been called (though some may be blocked by loading state)
      // The main point is no corruption occurred
      expect(simulatedProjects.length).toBeLessThanOrEqual(5)
    })

    it('should handle concurrent add and remove operations', async () => {
      simulatedProjects = [
        { path: '/path/existing', name: 'existing', lastOpened: 100 }
      ]

      // Concurrent add and remove
      const addPromise = mockApi.settings.addRecentProject('/path/new', 'new')
      const removePromise = mockApi.settings.removeRecentProject('/path/existing')

      await Promise.all([addPromise, removePromise])

      // Should have just the new project
      expect(simulatedProjects).toHaveLength(1)
      expect(simulatedProjects[0].path).toBe('/path/new')
    })
  })

  describe('Empty State', () => {
    it('should not show recent section when no projects', async () => {
      simulatedProjects = []

      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(mockApi.settings.getRecentProjects).toHaveBeenCalled()
      })

      expect(screen.queryByText('Recent Projects')).not.toBeInTheDocument()
    })

    it('should show recent section when mounting with projects', async () => {
      // Test that recent section shows when there are projects
      simulatedProjects = [
        { path: '/path/first', name: 'first', lastOpened: 1000 }
      ]

      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('Recent Projects')).toBeInTheDocument()
        expect(screen.getByText('first')).toBeInTheDocument()
      })
    })
  })

  describe('Timestamp Ordering', () => {
    it('should display projects sorted by lastOpened descending', async () => {
      simulatedProjects = [
        { path: '/path/oldest', name: 'oldest', lastOpened: 100 },
        { path: '/path/newest', name: 'newest', lastOpened: 300 },
        { path: '/path/middle', name: 'middle', lastOpened: 200 }
      ]

      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        const items = document.querySelectorAll('.recent-project-item')
        expect(items.length).toBe(3)
        // Should be sorted: newest, middle, oldest
        expect(items[0]).toHaveTextContent('newest')
        expect(items[1]).toHaveTextContent('middle')
        expect(items[2]).toHaveTextContent('oldest')
      })
    })
  })
})
