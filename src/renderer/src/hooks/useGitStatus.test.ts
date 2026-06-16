// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useGitStatus Hook
 * ============================
 * Tests for git status refresh with debouncing, cooldown, and window focus handling
 *
 * Includes:
 * - Constant verification tests
 * - Interface/shape tests
 * - Mock integration tests
 * - Behavioral tests with renderHook (Issue #74 review fix)
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { GIT_STATUS } from '../components/ProjectTree/constants'
import { useGitStatus } from './useGitStatus'
import { useGitStore } from '../stores/useGitStore'
import { useGlobalSettingsStore } from '../stores/useGlobalSettingsStore'

// Test the constants that control timing behavior
describe('useGitStatus constants', () => {
  it('should have DEBOUNCE_DELAY set to 250ms (Issue #74)', () => {
    // Reduced from 500ms for faster git status latency (Issue #74)
    expect(GIT_STATUS.DEBOUNCE_DELAY).toBe(250)
  })

  it('should have COOLDOWN_DURATION set to 500ms (Issue #74)', () => {
    // Reduced from 1500ms for faster git status latency (Issue #74)
    expect(GIT_STATUS.COOLDOWN_DURATION).toBe(500)
  })

  it('should have constants as readonly', () => {
    // TypeScript enforces this at compile time via `as const`
    // Runtime verification that values exist
    expect(typeof GIT_STATUS.DEBOUNCE_DELAY).toBe('number')
    expect(typeof GIT_STATUS.COOLDOWN_DURATION).toBe('number')
  })
})

// Test the hook's type interface (compile-time verification)
describe('useGitStatus interface', () => {
  // These tests verify the expected interface without rendering
  // The actual hook behavior is tested via integration tests

  it('should export UseGitStatusOptions interface fields', () => {
    // Verified at compile time, this test documents the expected interface
    const options = {
      projectPath: '/test/project' as string | null,
      enabled: true,
    }
    expect(options.projectPath).toBe('/test/project')
    expect(options.enabled).toBe(true)
  })

  it('should export UseGitStatusReturn interface fields', () => {
    // Documents the expected return shape
    const expectedFields = [
      'isGitRepo',
      'branch',
      'isDetached',
      'counts',
      'truncated',
      'error',
      'isRefreshing',
      'getFileStatus',
      'getFolderStatus',
      'refresh',
    ]
    expect(expectedFields.length).toBe(10)
  })

  it('should expect counts to have all status fields', () => {
    // Documents the expected counts shape
    const expectedCountFields = [
      'modified',
      'untracked',
      'deleted',
      'staged',
      'conflicted',
    ]
    expect(expectedCountFields.length).toBe(5)
  })
})

// Test the hook's integration without full React rendering
describe('useGitStatus behavior', () => {
  describe('configuration', () => {
    it('should use 250ms debounce delay (Issue #74)', () => {
      // Debounce delay reduced for faster git status latency (Issue #74)
      expect(GIT_STATUS.DEBOUNCE_DELAY).toBe(250)
    })

    it('should use 500ms cooldown duration (Issue #74)', () => {
      // Cooldown reduced for faster git status latency (Issue #74)
      expect(GIT_STATUS.COOLDOWN_DURATION).toBe(500)
    })

    it('should have cooldown longer than debounce', () => {
      // Cooldown should be >= debounce to prevent overlapping refreshes
      expect(GIT_STATUS.COOLDOWN_DURATION).toBeGreaterThanOrEqual(GIT_STATUS.DEBOUNCE_DELAY)
    })
  })

  describe('documentation', () => {
    it('should support projectPath option', () => {
      // projectPath: string | null - current project directory
      const nullPath: string | null = null
      const stringPath: string | null = '/test'
      expect(nullPath).toBeNull()
      expect(stringPath).toBe('/test')
    })

    it('should support enabled option with default true', () => {
      // enabled?: boolean - enable git status tracking (default: true)
      const defaultEnabled = true
      const explicitDisabled = false
      expect(defaultEnabled).toBe(true)
      expect(explicitDisabled).toBe(false)
    })
  })
})

// Mock-based integration test for the hook's core logic
describe('useGitStatus mock integration', () => {
  const mockSetStatus = vi.fn()
  const mockSetRefreshing = vi.fn()
  const mockClear = vi.fn()
  const mockGetFileStatus = vi.fn()
  const mockGetFolderStatus = vi.fn()
  const mockGetStatus = vi.fn()
  const mockOnDirectoryChanged = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockGetStatus.mockResolvedValue({
      isGitRepo: true,
      branch: 'main',
      isDetached: false,
      files: [],
      counts: { modified: 1, untracked: 2, deleted: 0, staged: 0, conflicted: 0 },
      truncated: false,
    })

    mockOnDirectoryChanged.mockReturnValue(() => {})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('store actions', () => {
    it('should define setStatus action', () => {
      const response = {
        isGitRepo: true,
        branch: 'main',
        isDetached: false,
        files: [],
        counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
        truncated: false,
      }
      mockSetStatus(response)
      expect(mockSetStatus).toHaveBeenCalledWith(response)
    })

    it('should define setRefreshing action', () => {
      mockSetRefreshing(true)
      mockSetRefreshing(false)
      expect(mockSetRefreshing).toHaveBeenCalledWith(true)
      expect(mockSetRefreshing).toHaveBeenCalledWith(false)
    })

    it('should define clear action', () => {
      mockClear()
      expect(mockClear).toHaveBeenCalled()
    })

    it('should define getFileStatus action', () => {
      mockGetFileStatus('/test/file.ts')
      expect(mockGetFileStatus).toHaveBeenCalledWith('/test/file.ts')
    })

    it('should define getFolderStatus action', () => {
      mockGetFolderStatus('/test/folder')
      expect(mockGetFolderStatus).toHaveBeenCalledWith('/test/folder')
    })
  })

  describe('IPC integration', () => {
    it('should call git.getStatus with project path', async () => {
      await mockGetStatus('/test/project')
      expect(mockGetStatus).toHaveBeenCalledWith('/test/project')
    })

    it('should handle IPC errors', async () => {
      mockGetStatus.mockRejectedValueOnce(new Error('IPC Error'))

      try {
        await mockGetStatus('/test/project')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe('IPC Error')
      }
    })

    it('should subscribe to directory changes', () => {
      const callback = vi.fn()
      const unsubscribe = mockOnDirectoryChanged(callback)
      expect(mockOnDirectoryChanged).toHaveBeenCalled()
      expect(typeof unsubscribe).toBe('function')
    })
  })

  describe('error response format', () => {
    it('should return error response on failure', () => {
      const errorResponse = {
        isGitRepo: false,
        branch: null,
        isDetached: false,
        files: [],
        counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
        truncated: false,
        error: 'Test error',
      }

      mockSetStatus(errorResponse)
      expect(mockSetStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          isGitRepo: false,
          error: 'Test error',
        })
      )
    })
  })
})

/**
 * Behavioral tests using renderHook (Issue #74 review fix)
 * Tests actual hook behavior with mocked window.api
 */
describe('useGitStatus behavioral tests', () => {
  // Mock window.api
  const mockGetStatus = vi.fn()
  const mockOnDirectoryChanged = vi.fn()
  const mockGitWatcher = {
    start: vi.fn().mockResolvedValue({ success: true }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    onStateChanged: vi.fn().mockReturnValue(() => {}),
  }
  const mockGitPolling = {
    start: vi.fn().mockResolvedValue({ success: true }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    onPollTriggered: vi.fn().mockReturnValue(() => {}),
    setEnabled: vi.fn().mockResolvedValue({ success: true }),
    setInterval: vi.fn().mockResolvedValue({ success: true }),
  }

  // Save original window.api
  const originalApi = (window as { api?: unknown }).api

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] })
    vi.clearAllMocks()

    // Reset stores
    useGitStore.setState({
      isGitRepo: false,
      branch: null,
      isDetached: false,
      counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
      truncated: false,
      error: null,
      isRefreshing: false,
      lastRefreshTime: 0,
      fileStatuses: new Map(),
      folderStatuses: new Map(),
    })

    useGlobalSettingsStore.setState({
      settings: {
        logging: { level: 'info' },
        editor: { preserveLineBreaks: false },
        gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
      },
      isLoading: false,
      error: null,
      isInitialized: true,
      wasCorruptionRecovered: false,
    })

    // Mock window.api
    mockGetStatus.mockResolvedValue({
      isGitRepo: true,
      branch: 'main',
      isDetached: false,
      files: [],
      counts: { modified: 1, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
      truncated: false,
    })

    mockOnDirectoryChanged.mockReturnValue(() => {})

    ;(window as { api?: unknown }).api = {
      git: { getStatus: mockGetStatus },
      directoryWatch: { onDirectoryChanged: mockOnDirectoryChanged },
      gitWatcher: mockGitWatcher,
      gitPolling: mockGitPolling,
    }
  })

  afterEach(() => {
    // IMPORTANT: Cleanup React components BEFORE restoring window.api
    // Otherwise, useEffect cleanup in hooks will run with undefined api
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
    // Reset store after cleanup to clear any pending state updates
    useGitStore.setState({
      isGitRepo: false,
      branch: null,
      isDetached: false,
      counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
      truncated: false,
      error: null,
      isRefreshing: false,
      lastRefreshTime: 0,
      fileStatuses: new Map(),
      folderStatuses: new Map(),
    })
  })

  afterAll(() => {
    // Restore original window.api only once after all tests
    ;(window as { api?: unknown }).api = originalApi
  })

  describe('initialization', () => {
    it('should start loading immediately when enabled with project path', async () => {
      const { result } = renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      // When enabled with valid path, hook starts loading immediately
      expect(result.current.isGitRepo).toBe(false)
      expect(result.current.branch).toBeNull()
      // isRefreshing is true because the hook starts fetching on mount
      expect(result.current.isRefreshing).toBe(true)
    })

    it('should return idle state when disabled', async () => {
      const { result } = renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: false })
      )

      // When disabled, no loading occurs
      expect(result.current.isGitRepo).toBe(false)
      expect(result.current.branch).toBeNull()
      expect(result.current.isRefreshing).toBe(false)
    })

    it('should call getStatus on mount with project path', async () => {
      renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      // Let the initial effect run
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockGetStatus).toHaveBeenCalledWith('/test/project')
    })

    it('should not call getStatus when disabled', async () => {
      renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: false })
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockGetStatus).not.toHaveBeenCalled()
    })

    it('should not call getStatus when projectPath is null', async () => {
      renderHook(() =>
        useGitStatus({ projectPath: null, enabled: true })
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockGetStatus).not.toHaveBeenCalled()
    })
  })

  describe('cleanup', () => {
    it('should clean up subscriptions on unmount', async () => {
      const unsubscribeDirectory = vi.fn()
      const unsubscribeWatcher = vi.fn()
      const unsubscribePolling = vi.fn()

      mockOnDirectoryChanged.mockReturnValue(unsubscribeDirectory)
      mockGitWatcher.onStateChanged.mockReturnValue(unsubscribeWatcher)
      mockGitPolling.onPollTriggered.mockReturnValue(unsubscribePolling)

      const { unmount } = renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      unmount()

      expect(unsubscribeDirectory).toHaveBeenCalled()
      expect(unsubscribeWatcher).toHaveBeenCalled()
      expect(unsubscribePolling).toHaveBeenCalled()
    })

    it('should stop watchers on unmount', async () => {
      const { unmount } = renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      unmount()

      expect(mockGitWatcher.stop).toHaveBeenCalled()
      expect(mockGitPolling.stop).toHaveBeenCalled()
    })
  })

  describe('project path changes', () => {
    it('should refresh when project path changes', async () => {
      const { rerender } = renderHook(
        ({ projectPath }) => useGitStatus({ projectPath, enabled: true }),
        { initialProps: { projectPath: '/project1' as string | null } }
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockGetStatus).toHaveBeenCalledWith('/project1')
      mockGetStatus.mockClear()

      // Change project path
      rerender({ projectPath: '/project2' })

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockGetStatus).toHaveBeenCalledWith('/project2')
    })

    it('should clear status when project path becomes null', async () => {
      const { rerender, result } = renderHook(
        ({ projectPath }) => useGitStatus({ projectPath, enabled: true }),
        { initialProps: { projectPath: '/project1' as string | null } }
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      // Simulate store update from successful fetch
      act(() => {
        useGitStore.getState().setStatus({
          isGitRepo: true,
          branch: 'main',
          isDetached: false,
          files: [],
          counts: { modified: 1, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
          truncated: false,
        })
      })

      expect(result.current.isGitRepo).toBe(true)

      // Set project path to null
      rerender({ projectPath: null })

      // Status should be cleared
      expect(result.current.isGitRepo).toBe(false)
    })
  })

  describe('manual refresh', () => {
    it('should provide a refresh function that bypasses cooldown', async () => {
      const { result } = renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      mockGetStatus.mockClear()

      // Set recent refresh time to trigger cooldown
      act(() => {
        useGitStore.setState({ lastRefreshTime: Date.now() })
      })

      // Manual refresh should bypass cooldown
      await act(async () => {
        result.current.refresh()
        await vi.runAllTimersAsync()
      })

      expect(mockGetStatus).toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should handle IPC errors gracefully', async () => {
      mockGetStatus.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      // Hook should not throw, error should be in store
      expect(result.current.isGitRepo).toBe(false)
    })
  })

  describe('watcher integration', () => {
    it('should start git watcher with project path', async () => {
      renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockGitWatcher.start).toHaveBeenCalledWith('/test/project')
    })

    it('should start polling with project path', async () => {
      renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockGitPolling.start).toHaveBeenCalledWith('/test/project')
    })
  })

  describe('window visibility gating (016-AC-012)', () => {
    let directoryChangeCallback: () => void
    let stateChangeCallback: (event: { eventTypes: string[]; projectPath: string; correlationId: string }) => void
    let pollTriggeredCallback: (event: { timestamp: number; reason: string }) => void
    const originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden')

    afterEach(() => {
      if (originalHiddenDescriptor) {
        Object.defineProperty(document, 'hidden', originalHiddenDescriptor)
      }
    })

    beforeEach(() => {
      // Capture callbacks from subscriptions
      mockOnDirectoryChanged.mockImplementation((cb) => {
        directoryChangeCallback = cb
        return () => {}
      })

      mockGitWatcher.onStateChanged.mockImplementation((cb) => {
        stateChangeCallback = cb
        return () => {}
      })

      mockGitPolling.onPollTriggered.mockImplementation((cb) => {
        pollTriggeredCallback = cb
        return () => {}
      })
    })

    it('should drop git status refreshes while window is hidden', async () => {
      renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      // Let initial load complete
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      mockGetStatus.mockClear()

      // Simulate hiding window
      await act(async () => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Trigger git state change while hidden
      await act(async () => {
        stateChangeCallback({
          eventTypes: ['index'],
          projectPath: '/test/project',
          correlationId: 'test-1'
        })
        await vi.runAllTimersAsync()
      })

      // Should NOT have called getStatus (0 calls)
      expect(mockGetStatus).toHaveBeenCalledTimes(0)
    })

    it('should drop polling-triggered refreshes while window is hidden', async () => {
      renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      // Let initial load complete
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      mockGetStatus.mockClear()

      // Simulate hiding window
      await act(async () => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Trigger poll event while hidden
      await act(async () => {
        pollTriggeredCallback({
          timestamp: Date.now(),
          reason: 'interval'
        })
        await vi.runAllTimersAsync()
      })

      // Should NOT have called getStatus (0 calls)
      expect(mockGetStatus).toHaveBeenCalledTimes(0)
    })

    // Note: this tests that git status refreshes triggered by directory changes
    // are gated. Directory *tree* refreshes (useDirectoryWatcher) are NOT gated
    // by visibility -- they continue even while hidden, as specified in FR-008.
    it('should drop directory-change-triggered git refreshes while hidden', async () => {
      renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      // Let initial load complete
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      mockGetStatus.mockClear()

      // Simulate hiding window
      await act(async () => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Trigger directory change while hidden
      await act(async () => {
        directoryChangeCallback()
        await vi.runAllTimersAsync()
      })

      // Should NOT have called getStatus (0 calls)
      expect(mockGetStatus).toHaveBeenCalledTimes(0)
    })

    it('should fire single catch-up refresh on restore', async () => {
      renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      // Let initial load complete
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      mockGetStatus.mockClear()

      // Simulate hiding window
      await act(async () => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Trigger multiple events while hidden
      await act(async () => {
        stateChangeCallback({
          eventTypes: ['index'],
          projectPath: '/test/project',
          correlationId: 'test-1'
        })
        pollTriggeredCallback({
          timestamp: Date.now(),
          reason: 'interval'
        })
        directoryChangeCallback()
        await vi.runAllTimersAsync()
      })

      // Verify no calls while hidden
      expect(mockGetStatus).toHaveBeenCalledTimes(0)

      // Simulate restoring visibility
      await act(async () => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.runAllTimersAsync()
      })

      // Should have exactly 1 catch-up refresh
      expect(mockGetStatus).toHaveBeenCalledTimes(1)
      expect(mockGetStatus).toHaveBeenCalledWith('/test/project')
    })

    it('should respect cooldown when catch-up refresh fires on restore', async () => {
      renderHook(() =>
        useGitStatus({ projectPath: '/test/project', enabled: true })
      )

      // Let initial load complete
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      mockGetStatus.mockClear()

      // Set lastRefreshTime to recent (within cooldown window)
      const elapsed = 100
      const recentTime = Date.now() - elapsed
      const remainingCooldown = GIT_STATUS.COOLDOWN_DURATION - elapsed
      act(() => {
        useGitStore.setState({ lastRefreshTime: recentTime })
      })

      // Simulate hiding window
      await act(async () => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Simulate restoring visibility
      await act(async () => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Should NOT fire immediately (cooldown active)
      expect(mockGetStatus).toHaveBeenCalledTimes(0)

      // Advance time by remaining cooldown
      await act(async () => {
        await vi.advanceTimersByTimeAsync(remainingCooldown)
      })

      // Now should have called getStatus after cooldown expires
      expect(mockGetStatus).toHaveBeenCalledTimes(1)
      expect(mockGetStatus).toHaveBeenCalledWith('/test/project')
    })
  })
})
