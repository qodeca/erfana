// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectManagementContext.test.tsx
 *
 * Tests for the ProjectManagementContext to ensure:
 * - Provider provides context values correctly
 * - Hooks throw when used outside provider
 * - Callback registration/unregistration works
 * - useProjectChangedEffect properly registers callbacks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  ProjectManagementProvider,
  useProjectManagementContext,
  useOpenProjectByPath,
  useProjectChangedEffect,
  registerProjectChangedCallback
} from './ProjectManagementContext'

// Mock logger
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))
vi.mock('../utils/logger', () => ({ logger: mockLogger }))

// Mock the useProjectManagement hook
const mockProjectManagement = {
  projectPath: '/test/project',
  files: [],
  loading: false,
  error: null,
  isSwitchingProject: false,
  initialLoadComplete: true,
  handleOpenProject: vi.fn(),
  handleCloseProject: vi.fn(),
  handleOpenProjectByPath: vi.fn(),
  refreshFiles: vi.fn()
}

// Capture the onProjectChanged callback for testing
let capturedOnProjectChanged: ((newPath: string | null) => void) | null = null

vi.mock('../hooks/useProjectManagement', () => ({
  useProjectManagement: (options?: { onProjectChanged?: (newPath: string | null) => void }) => {
    // Capture callback for testing
    if (options?.onProjectChanged) {
      capturedOnProjectChanged = options.onProjectChanged
    }
    return mockProjectManagement
  }
}))

// Mock useDialog dependency
vi.mock('../components/Dialog', () => ({
  useDialog: () => ({
    showConfirm: vi.fn(),
    showRename: vi.fn(),
    showNewFile: vi.fn(),
    showNewFolder: vi.fn()
  })
}))

describe('ProjectManagementContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnProjectChanged = null
  })

  describe('window title', () => {
    it('sets "{name} | ERFANA v{version}" when a project is open', () => {
      mockProjectManagement.projectPath = 'C:\\Users\\marcin\\Projects\\erfana'
      render(
        <ProjectManagementProvider>
          <div>child</div>
        </ProjectManagementProvider>
      )
      expect(document.title).toBe('erfana | ERFANA v0.0.0-test')
      mockProjectManagement.projectPath = '/test/project'
    })

    it('sets just "ERFANA v{version}" when no project is open', () => {
      mockProjectManagement.projectPath = null as unknown as string
      render(
        <ProjectManagementProvider>
          <div>child</div>
        </ProjectManagementProvider>
      )
      expect(document.title).toBe('ERFANA v0.0.0-test')
      mockProjectManagement.projectPath = '/test/project'
    })
  })

  describe('ProjectManagementProvider', () => {
    it('should provide context values to children', () => {
      function TestComponent() {
        const context = useProjectManagementContext()
        return <div data-testid="project-path">{context.projectPath}</div>
      }

      render(
        <ProjectManagementProvider>
          <TestComponent />
        </ProjectManagementProvider>
      )

      expect(screen.getByTestId('project-path')).toHaveTextContent('/test/project')
    })

    it('should render children', () => {
      render(
        <ProjectManagementProvider>
          <div data-testid="child">Child content</div>
        </ProjectManagementProvider>
      )

      expect(screen.getByTestId('child')).toHaveTextContent('Child content')
    })
  })

  describe('useProjectManagementContext', () => {
    it('should throw when used outside provider', () => {
      function TestComponent() {
        useProjectManagementContext()
        return <div>Should not render</div>
      }

      // Suppress console.error for expected error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        render(<TestComponent />)
      }).toThrow('useProjectManagementContext must be used within ProjectManagementProvider')

      consoleSpy.mockRestore()
    })

    it('should return full context value', () => {
      function TestComponent() {
        const context = useProjectManagementContext()
        return (
          <div>
            <span data-testid="path">{context.projectPath}</span>
            <span data-testid="loading">{String(context.loading)}</span>
            <span data-testid="switching">{String(context.isSwitchingProject)}</span>
          </div>
        )
      }

      render(
        <ProjectManagementProvider>
          <TestComponent />
        </ProjectManagementProvider>
      )

      expect(screen.getByTestId('path')).toHaveTextContent('/test/project')
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
      expect(screen.getByTestId('switching')).toHaveTextContent('false')
    })
  })

  describe('useOpenProjectByPath', () => {
    it('should throw when used outside provider', () => {
      function TestComponent() {
        useOpenProjectByPath()
        return <div>Should not render</div>
      }

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        render(<TestComponent />)
      }).toThrow('useProjectManagementContext must be used within ProjectManagementProvider')

      consoleSpy.mockRestore()
    })

    it('should return only handleOpenProjectByPath and isSwitchingProject', () => {
      function TestComponent() {
        const { handleOpenProjectByPath, isSwitchingProject } = useOpenProjectByPath()
        return (
          <div>
            <span data-testid="has-handler">{typeof handleOpenProjectByPath}</span>
            <span data-testid="switching">{String(isSwitchingProject)}</span>
          </div>
        )
      }

      render(
        <ProjectManagementProvider>
          <TestComponent />
        </ProjectManagementProvider>
      )

      expect(screen.getByTestId('has-handler')).toHaveTextContent('function')
      expect(screen.getByTestId('switching')).toHaveTextContent('false')
    })
  })

  describe('registerProjectChangedCallback', () => {
    it('should register callback and return unregister function', () => {
      const callback = vi.fn()
      const unregister = registerProjectChangedCallback(callback)

      expect(typeof unregister).toBe('function')
    })

    it('should call registered callback when provider triggers onProjectChanged', () => {
      const testCallback = vi.fn()

      function TestComponent() {
        useProjectChangedEffect(testCallback)
        return <div>Test</div>
      }

      render(
        <ProjectManagementProvider>
          <TestComponent />
        </ProjectManagementProvider>
      )

      // Trigger the onProjectChanged from useProjectManagement
      expect(capturedOnProjectChanged).not.toBeNull()
      act(() => {
        capturedOnProjectChanged!('/new/path')
      })

      expect(testCallback).toHaveBeenCalledWith('/new/path')
    })

    it('should call callback with null when project is closed', () => {
      const testCallback = vi.fn()

      function TestComponent() {
        useProjectChangedEffect(testCallback)
        return <div>Test</div>
      }

      render(
        <ProjectManagementProvider>
          <TestComponent />
        </ProjectManagementProvider>
      )

      act(() => {
        capturedOnProjectChanged!(null)
      })

      expect(testCallback).toHaveBeenCalledWith(null)
    })

    it('should unregister callback on component unmount', () => {
      const testCallback = vi.fn()

      function TestComponent() {
        useProjectChangedEffect(testCallback)
        return <div>Test</div>
      }

      const { unmount } = render(
        <ProjectManagementProvider>
          <TestComponent />
        </ProjectManagementProvider>
      )

      // Unmount component
      unmount()

      // Trigger callback - should not be called since unregistered
      // We need to manually re-create the provider to get a new captured callback
      testCallback.mockClear()
      render(
        <ProjectManagementProvider>
          <div>Empty</div>
        </ProjectManagementProvider>
      )

      act(() => {
        if (capturedOnProjectChanged) {
          capturedOnProjectChanged('/another/path')
        }
      })

      // The first callback should not be called (it was unregistered)
      expect(testCallback).not.toHaveBeenCalled()
    })
  })

  describe('useProjectChangedEffect', () => {
    it('should call latest callback version via ref', () => {
      const capturedValues: string[] = []

      function TestComponent({ id }: { id: string }) {
        useProjectChangedEffect((path) => {
          capturedValues.push(`${id}:${path}`)
        })
        return <div>Test {id}</div>
      }

      const { rerender } = render(
        <ProjectManagementProvider>
          <TestComponent id="v1" />
        </ProjectManagementProvider>
      )

      act(() => {
        capturedOnProjectChanged!('/path1')
      })

      expect(capturedValues).toContain('v1:/path1')

      // Re-render with new id - callback closure changes
      rerender(
        <ProjectManagementProvider>
          <TestComponent id="v2" />
        </ProjectManagementProvider>
      )

      act(() => {
        capturedOnProjectChanged!('/path2')
      })

      // Should use the latest callback (v2)
      expect(capturedValues).toContain('v2:/path2')
    })
  })

  describe('Multiple callbacks', () => {
    it('should notify all registered callbacks', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      function TestComponent1() {
        useProjectChangedEffect(callback1)
        return <div>Test1</div>
      }

      function TestComponent2() {
        useProjectChangedEffect(callback2)
        return <div>Test2</div>
      }

      render(
        <ProjectManagementProvider>
          <TestComponent1 />
          <TestComponent2 />
        </ProjectManagementProvider>
      )

      act(() => {
        capturedOnProjectChanged!('/shared/path')
      })

      expect(callback1).toHaveBeenCalledWith('/shared/path')
      expect(callback2).toHaveBeenCalledWith('/shared/path')
    })

    it('should handle callback errors gracefully', () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Callback error')
      })
      const normalCallback = vi.fn()

      // Clear logger mocks
      mockLogger.warn.mockClear()

      function TestComponent1() {
        useProjectChangedEffect(errorCallback)
        return <div>Test1</div>
      }

      function TestComponent2() {
        useProjectChangedEffect(normalCallback)
        return <div>Test2</div>
      }

      render(
        <ProjectManagementProvider>
          <TestComponent1 />
          <TestComponent2 />
        </ProjectManagementProvider>
      )

      // Should not throw
      act(() => {
        capturedOnProjectChanged!('/path')
      })

      // Error callback was called and threw
      expect(errorCallback).toHaveBeenCalled()
      // Normal callback should still be called
      expect(normalCallback).toHaveBeenCalledWith('/path')
      // Warning should be logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'ProjectManagementContext: callback error',
        expect.objectContaining({
          error: 'Callback error'
        })
      )
    })
  })
})
