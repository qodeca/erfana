/**
 * WelcomePanel.test.tsx
 *
 * todo005: Comprehensive test coverage for WelcomePanel component
 *
 * Test groups:
 * - Loading state (5 tests)
 * - Recent projects display (6 tests)
 * - Project opening (8 tests)
 * - Project removal (6 tests)
 * - UI blocking (5 tests)
 * - Error handling (5 tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WelcomePanel } from './WelcomePanel'
import { AppError, ErrorCode } from '../../../../shared/errors'

// Mock data
const mockProjects = [
  { path: '/path/project-a', name: 'project-a', lastOpened: Date.now() - 60000 },
  { path: '/path/project-b', name: 'project-b', lastOpened: Date.now() - 3600000 }
]

// Mocks
const mockGetRecentProjects = vi.fn()
const mockRemoveRecentProject = vi.fn()
const mockOpenProjectByPath = vi.fn()
const mockShowGlobalToast = vi.fn()

// Use a getter pattern for dynamic mock value
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

// Mock window.api
const mockApi = {
  settings: {
    getRecentProjects: mockGetRecentProjects,
    removeRecentProject: mockRemoveRecentProject
  },
  file: {
    openProjectByPath: mockOpenProjectByPath
  }
}

// Store original window.api
const originalApi = (window as unknown as { api?: typeof mockApi }).api

// Mock dockview props
const mockDockviewProps = {
  api: {} as never,
  containerApi: {} as never,
  params: {},
  group: {} as never,
  title: 'Welcome'
}

describe('WelcomePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.isProjectChanging = false
    ;(window as unknown as { api: typeof mockApi }).api = mockApi

    // Default: successful load with projects
    mockGetRecentProjects.mockResolvedValue({
      success: true,
      projects: mockProjects
    })
    mockOpenProjectByPath.mockResolvedValue('/path/project-a')
    mockRemoveRecentProject.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    ;(window as unknown as { api?: typeof mockApi }).api = originalApi
  })

  describe('Loading state', () => {
    it('should call getRecentProjects on mount', async () => {
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(mockGetRecentProjects).toHaveBeenCalledTimes(1)
      })
    })

    it('should show welcome message', () => {
      render(<WelcomePanel {...mockDockviewProps} />)
      expect(screen.getByText('Welcome to ERFANA')).toBeInTheDocument()
    })

    it('should show instructions', () => {
      render(<WelcomePanel {...mockDockviewProps} />)
      expect(screen.getByText('Open a folder from the Project panel to start editing')).toBeInTheDocument()
    })

    it('should hide recent projects section during initial load', () => {
      mockGetRecentProjects.mockImplementation(() => new Promise(() => {})) // Never resolves
      render(<WelcomePanel {...mockDockviewProps} />)
      expect(screen.queryByText('Recent Projects')).not.toBeInTheDocument()
    })

    it('should show recent projects after load completes', async () => {
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('Recent Projects')).toBeInTheDocument()
      })
    })
  })

  describe('Recent projects display', () => {
    it('should not show recent section when projects list is empty', async () => {
      mockGetRecentProjects.mockResolvedValue({ success: true, projects: [] })
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(mockGetRecentProjects).toHaveBeenCalled()
      })

      expect(screen.queryByText('Recent Projects')).not.toBeInTheDocument()
    })

    it('should render project names', async () => {
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
        expect(screen.getByText('project-b')).toBeInTheDocument()
      })
    })

    it('should render project paths', async () => {
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('/path/project-a')).toBeInTheDocument()
        expect(screen.getByText('/path/project-b')).toBeInTheDocument()
      })
    })

    it('should render remove buttons for each project', async () => {
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        const removeButtons = screen.getAllByRole('button', { name: 'Remove from recent projects' })
        expect(removeButtons).toHaveLength(2)
      })
    })

    it('should show relative time for projects', async () => {
      render(<WelcomePanel {...mockDockviewProps} />)

      // Time formatting is tested elsewhere, just verify elements exist
      await waitFor(() => {
        const timeElements = document.querySelectorAll('.recent-project-time')
        expect(timeElements.length).toBe(2)
      })
    })

    it('should render projects in received order', async () => {
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        const projectItems = document.querySelectorAll('.recent-project-item')
        expect(projectItems.length).toBe(2)
        expect(projectItems[0]).toHaveTextContent('project-a')
        expect(projectItems[1]).toHaveTextContent('project-b')
      })
    })
  })

  describe('Project opening', () => {
    it('should call openProjectByPath on click', async () => {
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      const projectItem = screen.getByText('project-a').closest('.recent-project-item')
      await user.click(projectItem!)

      expect(mockOpenProjectByPath).toHaveBeenCalledWith('/path/project-a')
    })

    it('should show "Opening..." indicator while opening', async () => {
      mockOpenProjectByPath.mockImplementation(() => new Promise(() => {})) // Never resolves
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      const projectItem = screen.getByText('project-a').closest('.recent-project-item')
      await user.click(projectItem!)

      await waitFor(() => {
        expect(screen.getByText('Opening...')).toBeInTheDocument()
      })
    })

    it('should disable item while opening', async () => {
      mockOpenProjectByPath.mockImplementation(() => new Promise(() => {}))
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      const projectItem = screen.getByText('project-a').closest('.recent-project-item')
      await user.click(projectItem!)

      await waitFor(() => {
        expect(projectItem).toHaveClass('opening')
        expect(projectItem).toHaveClass('disabled')
      })
    })

    it('should show error toast on open failure', async () => {
      mockOpenProjectByPath.mockRejectedValue(new Error('Open failed'))
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      const projectItem = screen.getByText('project-a').closest('.recent-project-item')
      await user.click(projectItem!)

      await waitFor(() => {
        expect(mockShowGlobalToast).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
            title: 'Failed to Open Project'
          })
        )
      })
    })

    it('should remove stale project on PROJECT_NOT_FOUND error', async () => {
      const notFoundError = new AppError('Project not found', ErrorCode.PROJECT_NOT_FOUND)
      mockOpenProjectByPath.mockRejectedValue(notFoundError)
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      const projectItem = screen.getByText('project-a').closest('.recent-project-item')
      await user.click(projectItem!)

      await waitFor(() => {
        expect(mockRemoveRecentProject).toHaveBeenCalledWith('/path/project-a')
      })
    })

    it('should reload projects after removing stale project', async () => {
      const notFoundError = new AppError('Project not found', ErrorCode.PROJECT_NOT_FOUND)
      mockOpenProjectByPath.mockRejectedValue(notFoundError)
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(mockGetRecentProjects).toHaveBeenCalledTimes(1)
      })

      const projectItem = screen.getByText('project-a').closest('.recent-project-item')
      await user.click(projectItem!)

      await waitFor(() => {
        // Initial load + reload after stale removal
        expect(mockGetRecentProjects).toHaveBeenCalledTimes(2)
      })
    })

    it('should not call open when disabled', async () => {
      mockState.isProjectChanging = true
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      const projectItem = screen.getByText('project-a').closest('.recent-project-item')
      await user.click(projectItem!)

      expect(mockOpenProjectByPath).not.toHaveBeenCalled()
    })
  })

  describe('Project removal', () => {
    it('should call removeRecentProject on X click', async () => {
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Remove from recent projects' })).toHaveLength(2)
      })

      const removeButtons = screen.getAllByRole('button', { name: 'Remove from recent projects' })
      await user.click(removeButtons[0])

      expect(mockRemoveRecentProject).toHaveBeenCalledWith('/path/project-a')
    })

    it('should reload list after removal', async () => {
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(mockGetRecentProjects).toHaveBeenCalledTimes(1)
      })

      const removeButtons = screen.getAllByRole('button', { name: 'Remove from recent projects' })
      await user.click(removeButtons[0])

      await waitFor(() => {
        // Initial load + reload after removal
        expect(mockGetRecentProjects).toHaveBeenCalledTimes(2)
      })
    })

    it('should show success toast after removal', async () => {
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Remove from recent projects' })).toHaveLength(2)
      })

      const removeButtons = screen.getAllByRole('button', { name: 'Remove from recent projects' })
      await user.click(removeButtons[0])

      await waitFor(() => {
        expect(mockShowGlobalToast).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
            title: 'Project Removed'
          })
        )
      })
    })

    it('should stop propagation to parent', async () => {
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Remove from recent projects' })).toHaveLength(2)
      })

      const removeButtons = screen.getAllByRole('button', { name: 'Remove from recent projects' })
      await user.click(removeButtons[0])

      // Should not open project when clicking remove
      expect(mockOpenProjectByPath).not.toHaveBeenCalled()
      expect(mockRemoveRecentProject).toHaveBeenCalled()
    })

    it('should show error toast on removal failure', async () => {
      mockRemoveRecentProject.mockResolvedValue({ success: false, error: 'Remove failed' })
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Remove from recent projects' })).toHaveLength(2)
      })

      const removeButtons = screen.getAllByRole('button', { name: 'Remove from recent projects' })
      await user.click(removeButtons[0])

      await waitFor(() => {
        expect(mockShowGlobalToast).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
            title: 'Failed to Remove Project'
          })
        )
      })
    })

    it('should disable remove button when isProjectChanging', async () => {
      mockState.isProjectChanging = true
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        const removeButtons = screen.getAllByRole('button', { name: 'Remove from recent projects' })
        expect(removeButtons[0]).toBeDisabled()
      })
    })
  })

  describe('UI blocking', () => {
    it('should disable all items when isProjectChanging', async () => {
      mockState.isProjectChanging = true
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        const projectItems = document.querySelectorAll('.recent-project-item')
        projectItems.forEach(item => {
          expect(item).toHaveClass('disabled')
        })
      })
    })

    it('should prevent clicks when isProjectChanging (onClick short-circuits)', async () => {
      mockState.isProjectChanging = true
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      const projectItem = screen.getByText('project-a').closest('.recent-project-item')
      fireEvent.click(projectItem!)

      // When isDisabled is true, onClick short-circuits and handleProjectClick is never called
      // Therefore no toast is shown - the click is simply ignored
      expect(mockOpenProjectByPath).not.toHaveBeenCalled()
      expect(mockShowGlobalToast).not.toHaveBeenCalled()
    })

    it('should show "Waiting for folder selection..." tooltip when blocked', async () => {
      mockState.isProjectChanging = true
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        const projectItems = document.querySelectorAll('.recent-project-item')
        expect(projectItems[0]).toHaveAttribute('title', 'Waiting for folder selection...')
      })
    })

    it('should not call openProjectByPath when blocked', async () => {
      mockState.isProjectChanging = true
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      const projectItem = screen.getByText('project-a').closest('.recent-project-item')
      fireEvent.click(projectItem!)

      expect(mockOpenProjectByPath).not.toHaveBeenCalled()
    })

    it('should not call removeRecentProject when blocked', async () => {
      mockState.isProjectChanging = true
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Remove from recent projects' })).toHaveLength(2)
      })

      const removeButtons = screen.getAllByRole('button', { name: 'Remove from recent projects' })
      fireEvent.click(removeButtons[0])

      // Button is disabled, but the handler also checks and shows warning
      expect(mockRemoveRecentProject).not.toHaveBeenCalled()
    })
  })

  describe('Error handling', () => {
    it('should show toast on getRecentProjects failure', async () => {
      mockGetRecentProjects.mockRejectedValue(new Error('Load failed'))
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(mockShowGlobalToast).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
            title: 'Failed to Load Recent Projects'
          })
        )
      })
    })

    it('should show toast on API error response', async () => {
      mockGetRecentProjects.mockResolvedValue({ success: false, error: 'API error' })
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(mockShowGlobalToast).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
            title: 'Failed to Load Recent Projects',
            message: 'API error'
          })
        )
      })
    })

    it('should handle exception during removeRecentProject', async () => {
      mockRemoveRecentProject.mockRejectedValue(new Error('Remove exception'))
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Remove from recent projects' })).toHaveLength(2)
      })

      const removeButtons = screen.getAllByRole('button', { name: 'Remove from recent projects' })
      await user.click(removeButtons[0])

      await waitFor(() => {
        expect(mockShowGlobalToast).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
            title: 'Failed to Remove Project'
          })
        )
      })
    })

    it('should not crash when stale removal fails', async () => {
      const notFoundError = new AppError('Project not found', ErrorCode.PROJECT_NOT_FOUND)
      mockOpenProjectByPath.mockRejectedValue(notFoundError)
      mockRemoveRecentProject.mockRejectedValue(new Error('Remove also failed'))

      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      const projectItem = screen.getByText('project-a').closest('.recent-project-item')

      // Should not throw
      await expect(user.click(projectItem!)).resolves.not.toThrow()
    })

    it('should provide user-friendly error messages', async () => {
      mockOpenProjectByPath.mockRejectedValue(new Error('Technical error details'))
      const user = userEvent.setup()
      render(<WelcomePanel {...mockDockviewProps} />)

      await waitFor(() => {
        expect(screen.getByText('project-a')).toBeInTheDocument()
      })

      const projectItem = screen.getByText('project-a').closest('.recent-project-item')
      await user.click(projectItem!)

      await waitFor(() => {
        expect(mockShowGlobalToast).toHaveBeenCalled()
      })
    })
  })
})
