// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useFileWatcher Hook
 *
 * Tests cover:
 * - isEchoEvent pure function (self-save echo detection)
 * - createFileSaveGuard helper
 * - useFileWatcher hook via renderHook (external change handling, ref-based guards)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createFileSaveGuard, isEchoEvent, useFileWatcher } from './useFileWatcher'

// =========================================================================
// Mocks
// =========================================================================

type FileChangedCallback = (data: { filePath: string }) => void
type FileDeletedCallback = (data: { filePath: string }) => void
type FileErrorCallback = (data: { filePath: string; error: string }) => void

let fileChangedListeners: FileChangedCallback[] = []
let fileDeletedListeners: FileDeletedCallback[] = []

const mockFileWatch = {
  start: vi.fn().mockResolvedValue({ success: true }),
  stop: vi.fn(),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  onFileChanged: vi.fn((cb: FileChangedCallback) => {
    fileChangedListeners.push(cb)
    return () => {
      fileChangedListeners = fileChangedListeners.filter((l) => l !== cb)
    }
  }),
  onFileDeleted: vi.fn((cb: FileDeletedCallback) => {
    fileDeletedListeners.push(cb)
    return () => {
      fileDeletedListeners = fileDeletedListeners.filter((l) => l !== cb)
    }
  }),
  onFileError: vi.fn((_cb: FileErrorCallback) => vi.fn())
}

const mockReadFile = vi.fn<(path: string) => Promise<string>>()

// Set up window.api mock
Object.defineProperty(window, 'api', {
  value: {
    file: {
      readFile: mockReadFile
    },
    fileWatch: mockFileWatch
  },
  writable: true,
  configurable: true
})

// Emit a simulated file change event from chokidar
function emitFileChanged(filePath: string): void {
  for (const listener of fileChangedListeners) {
    listener({ filePath })
  }
}

// =========================================================================
// isEchoEvent
// =========================================================================

describe('isEchoEvent', () => {
  it('should return false when set is empty', () => {
    expect(isEchoEvent('any content', new Set())).toBe(false)
  })

  it('should return true when content matches an entry', () => {
    expect(isEchoEvent('hello world', new Set(['hello world']))).toBe(true)
  })

  it('should return false when content differs from all entries', () => {
    expect(isEchoEvent('hello world', new Set(['hello changed']))).toBe(false)
  })

  it('should return true when content matches after CRLF normalization', () => {
    expect(isEchoEvent('line1\r\nline2', new Set(['line1\nline2']))).toBe(true)
  })

  it('should return true when both have CRLF', () => {
    expect(isEchoEvent('line1\r\nline2', new Set(['line1\r\nline2']))).toBe(true)
  })

  it('should return false for empty vs non-empty', () => {
    expect(isEchoEvent('', new Set(['content']))).toBe(false)
    expect(isEchoEvent('content', new Set(['']))).toBe(false)
  })

  it('should return true for both empty', () => {
    expect(isEchoEvent('', new Set(['']))).toBe(true)
  })

  it('should match any entry in the set (rapid saves)', () => {
    const pending = new Set(['save1 content', 'save2 content'])
    expect(isEchoEvent('save1 content', pending)).toBe(true)
    expect(isEchoEvent('save2 content', pending)).toBe(true)
    expect(isEchoEvent('external content', pending)).toBe(false)
  })
})

// =========================================================================
// createFileSaveGuard
// =========================================================================

describe('createFileSaveGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('creation', () => {
    it('should create pause and resume functions', () => {
      const guard = createFileSaveGuard('/test/file.md')

      expect(guard.pauseWatch).toBeDefined()
      expect(guard.resumeWatch).toBeDefined()
      expect(typeof guard.pauseWatch).toBe('function')
      expect(typeof guard.resumeWatch).toBe('function')
    })
  })

  describe('pauseWatch', () => {
    it('should call fileWatch.pause with correct path', async () => {
      const guard = createFileSaveGuard('/test/file.md')

      await guard.pauseWatch()

      expect(mockFileWatch.pause).toHaveBeenCalledTimes(1)
      expect(mockFileWatch.pause).toHaveBeenCalledWith('/test/file.md')
    })

    it('should use the path provided during creation', async () => {
      const guard1 = createFileSaveGuard('/path/one.md')
      const guard2 = createFileSaveGuard('/path/two.md')

      await guard1.pauseWatch()
      await guard2.pauseWatch()

      expect(mockFileWatch.pause).toHaveBeenCalledWith('/path/one.md')
      expect(mockFileWatch.pause).toHaveBeenCalledWith('/path/two.md')
    })
  })

  describe('resumeWatch', () => {
    it('should call fileWatch.resume with correct path', async () => {
      const guard = createFileSaveGuard('/test/file.md')

      await guard.resumeWatch()

      expect(mockFileWatch.resume).toHaveBeenCalledTimes(1)
      expect(mockFileWatch.resume).toHaveBeenCalledWith('/test/file.md')
    })

    it('should use the path provided during creation', async () => {
      const guard1 = createFileSaveGuard('/path/one.md')
      const guard2 = createFileSaveGuard('/path/two.md')

      await guard1.resumeWatch()
      await guard2.resumeWatch()

      expect(mockFileWatch.resume).toHaveBeenCalledWith('/path/one.md')
      expect(mockFileWatch.resume).toHaveBeenCalledWith('/path/two.md')
    })
  })

  describe('usage pattern', () => {
    it('should support pause-save-resume pattern', async () => {
      const guard = createFileSaveGuard('/test/file.md')

      await guard.pauseWatch()
      await guard.resumeWatch()

      expect(mockFileWatch.pause).toHaveBeenCalledTimes(1)
      expect(mockFileWatch.resume).toHaveBeenCalledTimes(1)
      const pauseCallOrder = mockFileWatch.pause.mock.invocationCallOrder[0]
      const resumeCallOrder = mockFileWatch.resume.mock.invocationCallOrder[0]
      expect(pauseCallOrder).toBeLessThan(resumeCallOrder)
    })

    it('should be reusable for multiple saves', async () => {
      const guard = createFileSaveGuard('/test/file.md')

      await guard.pauseWatch()
      await guard.resumeWatch()
      await guard.pauseWatch()
      await guard.resumeWatch()

      expect(mockFileWatch.pause).toHaveBeenCalledTimes(2)
      expect(mockFileWatch.resume).toHaveBeenCalledTimes(2)
    })
  })

  describe('edge cases', () => {
    it('should handle empty file path', async () => {
      const guard = createFileSaveGuard('')

      await guard.pauseWatch()
      await guard.resumeWatch()

      expect(mockFileWatch.pause).toHaveBeenCalledWith('')
      expect(mockFileWatch.resume).toHaveBeenCalledWith('')
    })

    it('should handle paths with special characters', async () => {
      const specialPath = '/path/with spaces/and-dashes/file (1).md'
      const guard = createFileSaveGuard(specialPath)

      await guard.pauseWatch()

      expect(mockFileWatch.pause).toHaveBeenCalledWith(specialPath)
    })
  })
})

// =========================================================================
// useFileWatcher hook
// =========================================================================

describe('useFileWatcher', () => {
  const TEST_PATH = '/test/file.md'

  beforeEach(() => {
    vi.clearAllMocks()
    // Re-establish mock implementations after clearAllMocks
    mockFileWatch.start.mockResolvedValue({ success: true })
    mockFileWatch.pause.mockResolvedValue(undefined)
    mockFileWatch.resume.mockResolvedValue(undefined)
    mockFileWatch.onFileChanged.mockImplementation((cb: FileChangedCallback) => {
      fileChangedListeners.push(cb)
      return () => {
        fileChangedListeners = fileChangedListeners.filter((l) => l !== cb)
      }
    })
    mockFileWatch.onFileDeleted.mockImplementation((cb: FileDeletedCallback) => {
      fileDeletedListeners.push(cb)
      return () => {
        fileDeletedListeners = fileDeletedListeners.filter((l) => l !== cb)
      }
    })
    mockFileWatch.onFileError.mockReturnValue(vi.fn())
    fileChangedListeners = []
    fileDeletedListeners = []
  })

  function renderFileWatcher(overrides?: {
    filePath?: string | null
    hasLocalChanges?: boolean
    onContentUpdate?: (content: string) => void
    onReload?: () => void
  }) {
    const defaults = {
      filePath: TEST_PATH,
      hasLocalChanges: false,
      onContentUpdate: vi.fn(),
      onReload: vi.fn(),
      ...overrides
    }
    return {
      ...renderHook(
        (props) => useFileWatcher(props),
        { initialProps: defaults }
      ),
      mocks: defaults
    }
  }

  describe('notifySaveComplete', () => {
    it('should expose notifySaveComplete in return value', () => {
      const { result } = renderFileWatcher()

      expect(result.current.notifySaveComplete).toBeDefined()
      expect(typeof result.current.notifySaveComplete).toBe('function')
    })
  })

  describe('self-save echo detection', () => {
    it('should ignore file change when disk content matches last saved content', async () => {
      const onContentUpdate = vi.fn()
      mockReadFile.mockResolvedValue('saved content')

      const { result } = renderFileWatcher({ onContentUpdate })

      // Notify that we just saved this content
      act(() => {
        result.current.notifySaveComplete('saved content')
      })

      // Simulate chokidar event
      act(() => {
        emitFileChanged(TEST_PATH)
      })

      // Wait for async handleExternalChange to complete
      await waitFor(() => {
        expect(mockReadFile).toHaveBeenCalledWith(TEST_PATH)
      })

      // Should NOT reload – it's our own save echo
      expect(onContentUpdate).not.toHaveBeenCalled()
      expect(result.current.externalChangeDetected).toBe(false)
    })

    it('should reload when disk content differs from last saved content', async () => {
      const onContentUpdate = vi.fn()
      mockReadFile.mockResolvedValue('externally modified content')

      const { result } = renderFileWatcher({ onContentUpdate })

      // Notify that we saved different content
      act(() => {
        result.current.notifySaveComplete('our saved content')
      })

      // Simulate chokidar event
      act(() => {
        emitFileChanged(TEST_PATH)
      })

      // Wait for async handleExternalChange to complete
      await waitFor(() => {
        expect(onContentUpdate).toHaveBeenCalledWith('externally modified content')
      })
    })

    it('should clear lastSavedContentRef after echo detection', async () => {
      const onContentUpdate = vi.fn()

      // First call returns saved content (echo), second call returns different content
      mockReadFile.mockResolvedValueOnce('saved content')
      mockReadFile.mockResolvedValueOnce('external change')

      const { result } = renderFileWatcher({ onContentUpdate })

      // Save and trigger echo
      act(() => {
        result.current.notifySaveComplete('saved content')
      })
      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(mockReadFile).toHaveBeenCalledTimes(1)
      })

      // Echo was dropped, content ref should be cleared
      expect(onContentUpdate).not.toHaveBeenCalled()

      // Second change event – no saved content to compare, should reload
      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(onContentUpdate).toHaveBeenCalledWith('external change')
      })
    })

    it('should handle CRLF normalization in echo detection', async () => {
      const onContentUpdate = vi.fn()
      // Disk has CRLF, we saved with LF
      mockReadFile.mockResolvedValue('line1\r\nline2')

      const { result } = renderFileWatcher({ onContentUpdate })

      act(() => {
        result.current.notifySaveComplete('line1\nline2')
      })

      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(mockReadFile).toHaveBeenCalled()
      })

      // Should be treated as echo despite line ending difference
      expect(onContentUpdate).not.toHaveBeenCalled()
    })

    it('should handle rapid successive saves (two saves before first echo)', async () => {
      const onContentUpdate = vi.fn()

      // First echo returns save1 content, second echo returns save2 content
      mockReadFile.mockResolvedValueOnce('save1 content')
      mockReadFile.mockResolvedValueOnce('save2 content')

      const { result } = renderFileWatcher({ onContentUpdate })

      // Two rapid saves – both stored in the Set
      act(() => {
        result.current.notifySaveComplete('save1 content')
        result.current.notifySaveComplete('save2 content')
      })

      // First echo arrives (from save1)
      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(mockReadFile).toHaveBeenCalledTimes(1)
      })

      // First echo should be suppressed
      expect(onContentUpdate).not.toHaveBeenCalled()

      // Second echo arrives (from save2)
      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(mockReadFile).toHaveBeenCalledTimes(2)
      })

      // Second echo should also be suppressed
      expect(onContentUpdate).not.toHaveBeenCalled()
    })
  })

  describe('external change with hasLocalChanges ref', () => {
    it('should show conflict when hasLocalChanges is true and content differs', async () => {
      mockReadFile.mockResolvedValue('external content')

      const { result } = renderFileWatcher({ hasLocalChanges: true })

      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(result.current.externalChangeDetected).toBe(true)
      })
    })

    it('should auto-reload when hasLocalChanges is false and content differs', async () => {
      const onContentUpdate = vi.fn()
      mockReadFile.mockResolvedValue('external content')

      const { result } = renderFileWatcher({
        hasLocalChanges: false,
        onContentUpdate
      })

      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(onContentUpdate).toHaveBeenCalledWith('external content')
      })

      expect(result.current.externalChangeDetected).toBe(false)
    })

    it('should use ref value when hasLocalChanges prop changes after mount', async () => {
      mockReadFile.mockResolvedValue('external content')

      const { result, rerender, mocks } = renderFileWatcher({ hasLocalChanges: false })

      // Change hasLocalChanges to true via rerender
      rerender({ ...mocks, hasLocalChanges: true })

      // Now trigger a change event – should show conflict because ref is updated
      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(result.current.externalChangeDetected).toBe(true)
      })
    })
  })

  describe('isSavingRef guard', () => {
    it('should ignore change events while saving', async () => {
      const onContentUpdate = vi.fn()
      mockReadFile.mockResolvedValue('external content')

      const { result } = renderFileWatcher({ onContentUpdate })

      // Mark as saving
      act(() => {
        result.current.markSaving()
      })

      // Trigger change event – should be ignored (returns early before readFile)
      act(() => {
        emitFileChanged(TEST_PATH)
      })

      // isSavingRef guard returns early before any async call
      expect(mockReadFile).not.toHaveBeenCalled()
      expect(onContentUpdate).not.toHaveBeenCalled()
    })

    it('should process events after unmarkSaving', async () => {
      const onContentUpdate = vi.fn()
      mockReadFile.mockResolvedValue('external content')

      const { result } = renderFileWatcher({ onContentUpdate })

      // Mark as saving, then unmark
      act(() => {
        result.current.markSaving()
        result.current.unmarkSaving()
      })

      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(onContentUpdate).toHaveBeenCalledWith('external content')
      })
    })
  })

  describe('lastSavedContentRef lifecycle', () => {
    it('should clear on keepLocal', async () => {
      const onContentUpdate = vi.fn()
      mockReadFile.mockResolvedValue('new external content')

      const { result } = renderFileWatcher({ hasLocalChanges: true, onContentUpdate })

      // Save some content
      act(() => {
        result.current.notifySaveComplete('our content')
      })

      // Keep local version (clears lastSavedContentRef)
      act(() => {
        result.current.keepLocal()
      })

      // Next change event should not find any saved content to compare
      // Since hasLocalChanges is true, should show conflict
      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(result.current.externalChangeDetected).toBe(true)
      })
    })

    it('should clear on reloadFromDisk', async () => {
      const onContentUpdate = vi.fn()
      mockReadFile.mockResolvedValue('reloaded content')

      const { result } = renderFileWatcher({ onContentUpdate })

      // Save content
      act(() => {
        result.current.notifySaveComplete('our content')
      })

      // Trigger external change that causes reload
      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(onContentUpdate).toHaveBeenCalledWith('reloaded content')
      })

      // After reload, lastSavedContentRef should be null
      // Next change with same content should NOT be treated as echo
      mockReadFile.mockResolvedValue('reloaded content')
      onContentUpdate.mockClear()

      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        // Should reload again since lastSavedContentRef was cleared
        expect(onContentUpdate).toHaveBeenCalledWith('reloaded content')
      })
    })

    it('should clear on file path change', async () => {
      const { result, rerender, mocks } = renderFileWatcher()

      act(() => {
        result.current.notifySaveComplete('saved for file A')
      })

      // Change file path – should clear lastSavedContentRef via effect cleanup
      rerender({ ...mocks, filePath: '/other/file.md' })

      // The saved content from the old file should not affect the new file
      const onContentUpdate = mocks.onContentUpdate
      mockReadFile.mockResolvedValue('saved for file A')

      act(() => {
        emitFileChanged('/other/file.md')
      })

      await waitFor(() => {
        // Should reload, not treat as echo (lastSavedContentRef was cleared)
        expect(onContentUpdate).toHaveBeenCalledWith('saved for file A')
      })
    })
  })

  describe('error handling', () => {
    it('should fall back to ref-based decision when readFile fails', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      const { result } = renderFileWatcher({ hasLocalChanges: true })

      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(result.current.externalChangeDetected).toBe(true)
      })
    })

    it('should auto-reload on readFile failure with no local changes', async () => {
      const onContentUpdate = vi.fn()
      // First call fails (in handleExternalChange), second succeeds (in reloadFromDisk fallback)
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'))
      mockReadFile.mockResolvedValueOnce('recovered content')

      renderFileWatcher({ hasLocalChanges: false, onContentUpdate })

      act(() => {
        emitFileChanged(TEST_PATH)
      })

      await waitFor(() => {
        expect(onContentUpdate).toHaveBeenCalledWith('recovered content')
      })
    })
  })

  describe('events for different files are ignored', () => {
    it('should ignore change events for other file paths', async () => {
      const onContentUpdate = vi.fn()

      renderFileWatcher({ onContentUpdate })

      act(() => {
        emitFileChanged('/other/file.md')
      })

      // Event for a different file is filtered at the listener level (not our file)
      expect(mockReadFile).not.toHaveBeenCalled()
      expect(onContentUpdate).not.toHaveBeenCalled()
    })
  })
})
