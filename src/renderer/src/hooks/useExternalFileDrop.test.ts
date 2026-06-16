// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useExternalFileDrop Hook Tests
 *
 * Tests for the external file drop custom hook.
 * Covers Spec #012: External File Drop to Project Tree
 *
 * Test coverage:
 * - isExternalDrag() - detection of external vs internal drags
 * - extractDroppedFiles() - file path extraction from FileList
 * - Hook state management and event handlers
 * - Auto-expand folder timer logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useExternalFileDrop,
  isExternalDrag,
  extractDroppedFiles,
  type ExternalDropFile,
  type UseExternalFileDropOptions
} from './useExternalFileDrop'

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
}))

// Store file paths for mock lookups
const mockFilePaths = new Map<File, string>()

// Mock window.api.utils.getPathForFile for Electron sandboxed environment
// In sandboxed Electron, File.path is not available, so we use webUtils.getPathForFile
const mockGetPathForFile = vi.fn((file: File): string => {
  // Return path from our mock storage
  const path = mockFilePaths.get(file)
  if (path) return path
  // Fallback to checking the file object directly (for legacy tests)
  return (file as File & { path?: string }).path ?? ''
})

// Set up global window.api mock - use Object.defineProperty to properly define
Object.defineProperty(window, 'api', {
  writable: true,
  configurable: true,
  value: {
    utils: {
      getPathForFile: mockGetPathForFile
    }
  }
})

beforeEach(() => {
  mockFilePaths.clear()
  mockGetPathForFile.mockClear()
})

/**
 * Helper to create mock DragEvent
 */
function createMockDragEvent(options: {
  types?: string[]
  files?: File[]
  target?: HTMLElement
}): DragEvent {
  const { types = [], files = [], target = document.createElement('div') } = options

  const dataTransfer = {
    types,
    files: files as any as FileList,
    dropEffect: 'none' as DataTransfer['dropEffect']
  } as DataTransfer

  const event = {
    dataTransfer,
    target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
  } as unknown as DragEvent

  return event
}

/**
 * Helper to create mock File with Electron path property
 * Also registers the file path in mockFilePaths for the getPathForFile mock
 */
function createMockFile(options: {
  name: string
  path: string
  type?: string
  size?: number
}): File & { path?: string } {
  const { name, path, type = 'text/markdown', size = 1024 } = options

  const file = new File([], name, { type }) as File & { path?: string }
  Object.defineProperty(file, 'size', { value: size })
  Object.defineProperty(file, 'path', { value: path })

  // Register in mock storage for getPathForFile mock
  mockFilePaths.set(file, path)

  return file
}

/**
 * Helper to create FileList from array of Files
 */
function createFileList(files: File[]): FileList {
  const fileList = {
    length: files.length,
    item: (index: number) => files[index] || null,
    [Symbol.iterator]: function* () {
      for (let i = 0; i < files.length; i++) {
        yield files[i]
      }
    }
  } as FileList

  // Add indexed access
  files.forEach((file, index) => {
    ;(fileList as any)[index] = file
  })

  return fileList
}

describe('isExternalDrag', () => {
  it('returns true when dataTransfer.types includes Files', () => {
    const event = createMockDragEvent({ types: ['Files'] })
    expect(isExternalDrag(event)).toBe(true)
  })

  it('returns false for internal drag (no Files type)', () => {
    const event = createMockDragEvent({ types: ['text/plain'] })
    expect(isExternalDrag(event)).toBe(false)
  })

  it('returns false when dataTransfer is null', () => {
    const event = { dataTransfer: null } as unknown as DragEvent
    expect(isExternalDrag(event)).toBe(false)
  })

  it('returns false when types is empty', () => {
    const event = createMockDragEvent({ types: [] })
    expect(isExternalDrag(event)).toBe(false)
  })

  it('returns true when Files is present with other types', () => {
    const event = createMockDragEvent({ types: ['Files', 'text/uri-list'] })
    expect(isExternalDrag(event)).toBe(true)
  })
})

describe('extractDroppedFiles', () => {
  it('extracts path and name from Electron File objects', () => {
    const file1 = createMockFile({
      name: 'file1.md',
      path: '/external/file1.md'
    })
    const file2 = createMockFile({
      name: 'file2.md',
      path: '/external/file2.md'
    })

    const fileList = createFileList([file1, file2])
    const result = extractDroppedFiles(fileList)

    expect(result).toEqual([
      { path: '/external/file1.md', name: 'file1.md', sizeInBytes: 1024, isDirectory: false },
      { path: '/external/file2.md', name: 'file2.md', sizeInBytes: 1024, isDirectory: false }
    ])
  })

  it('filters out directories', () => {
    const file = createMockFile({
      name: 'file.md',
      path: '/external/file.md',
      type: 'text/markdown',
      sizeInBytes: 1024
    })
    const directory = createMockFile({
      name: 'folder',
      path: '/external/folder',
      type: '',
      size: 0
    })

    const fileList = createFileList([file, directory])
    const result = extractDroppedFiles(fileList)

    expect(result.length).toBe(2)
    expect(result[0].isDirectory).toBe(false)
    expect(result[1].isDirectory).toBe(true) // Marked as directory
  })

  it('returns empty array for empty FileList', () => {
    const fileList = createFileList([])
    const result = extractDroppedFiles(fileList)

    expect(result).toEqual([])
  })

  it('detects directories by type and size heuristic', () => {
    const directory = createMockFile({
      name: 'MyFolder',
      path: '/external/MyFolder',
      type: '',
      size: 0
    })

    const fileList = createFileList([directory])
    const result = extractDroppedFiles(fileList)

    expect(result[0].isDirectory).toBe(true)
  })

  it('handles files without path property gracefully', () => {
    const standardFile = new File(['content'], 'file.md', { type: 'text/markdown' })
    const fileList = createFileList([standardFile])

    const result = extractDroppedFiles(fileList)

    // Should skip files without path property (non-Electron environment)
    expect(result).toEqual([])
  })
})

describe('useExternalFileDrop', () => {
  let defaultOptions: UseExternalFileDropOptions

  beforeEach(() => {
    vi.useFakeTimers()

    defaultOptions = {
      projectPath: '/project',
      expandedFolders: new Set<string>(),
      setExpandedFolders: vi.fn()
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('hook state', () => {
    it('isExternalDragActive starts false', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))
      expect(result.current.isExternalDragActive).toBe(false)
    })

    it('externalDropTarget starts null', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))
      expect(result.current.externalDropTarget).toBeNull()
    })

    it('provides all required event handlers', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      expect(typeof result.current.handleDragEnter).toBe('function')
      expect(typeof result.current.handleDragOver).toBe('function')
      expect(typeof result.current.handleDragLeave).toBe('function')
      expect(typeof result.current.handleDrop).toBe('function')
    })

    it('provides helper functions', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      expect(typeof result.current.isValidDropTarget).toBe('function')
      expect(typeof result.current.getTargetFromEvent).toBe('function')
    })
  })

  describe('handleDragEnter', () => {
    it('activates external drag on Files type', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const event = createMockDragEvent({ types: ['Files'] })

      act(() => {
        result.current.handleDragEnter(event)
      })

      expect(result.current.isExternalDragActive).toBe(true)
    })

    it('does not activate for internal drag', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const event = createMockDragEvent({ types: ['application/x-dnd-kit'] })

      act(() => {
        result.current.handleDragEnter(event)
      })

      expect(result.current.isExternalDragActive).toBe(false)
    })

    it('updates drop target on enter', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const target = document.createElement('div')
      target.dataset.path = '/project/docs'
      target.dataset.type = 'directory'

      const event = createMockDragEvent({ types: ['Files'], target })

      act(() => {
        result.current.handleDragEnter(event)
      })

      expect(result.current.externalDropTarget).toBe('/project/docs')
    })

    it('handles nested element drag enter correctly', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const event1 = createMockDragEvent({ types: ['Files'] })
      const event2 = createMockDragEvent({ types: ['Files'] })

      act(() => {
        result.current.handleDragEnter(event1)
        result.current.handleDragEnter(event2)
      })

      // Should still be active (nested enter)
      expect(result.current.isExternalDragActive).toBe(true)
    })
  })

  describe('handleDragOver', () => {
    it('calls preventDefault to allow drop', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const event = createMockDragEvent({ types: ['Files'] })

      act(() => {
        result.current.handleDragOver(event)
      })

      expect(event.preventDefault).toHaveBeenCalled()
    })

    it('sets dropEffect to copy for valid targets', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const target = document.createElement('div')
      target.dataset.path = '/project/docs'
      target.dataset.type = 'directory'

      const event = createMockDragEvent({ types: ['Files'], target })

      act(() => {
        result.current.handleDragOver(event)
      })

      expect(event.dataTransfer!.dropEffect).toBe('copy')
    })

    it('sets dropEffect to none for invalid targets', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const target = document.createElement('div')
      target.dataset.path = '/external/path'
      target.dataset.type = 'directory'

      const event = createMockDragEvent({ types: ['Files'], target })

      act(() => {
        result.current.handleDragOver(event)
      })

      expect(event.dataTransfer!.dropEffect).toBe('none')
    })

    it('updates drop target on drag over', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const target1 = document.createElement('div')
      target1.dataset.path = '/project/docs'
      target1.dataset.type = 'directory'

      const target2 = document.createElement('div')
      target2.dataset.path = '/project/images'
      target2.dataset.type = 'directory'

      act(() => {
        result.current.handleDragOver(createMockDragEvent({ types: ['Files'], target: target1 }))
      })

      expect(result.current.externalDropTarget).toBe('/project/docs')

      act(() => {
        result.current.handleDragOver(createMockDragEvent({ types: ['Files'], target: target2 }))
      })

      expect(result.current.externalDropTarget).toBe('/project/images')
    })

    it('does not handle internal drags', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const event = createMockDragEvent({ types: ['text/plain'] })

      act(() => {
        result.current.handleDragOver(event)
      })

      expect(event.preventDefault).not.toHaveBeenCalled()
    })
  })

  describe('handleDragLeave', () => {
    it('deactivates external drag when fully leaving', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const event = createMockDragEvent({ types: ['Files'] })

      act(() => {
        result.current.handleDragEnter(event)
      })

      expect(result.current.isExternalDragActive).toBe(true)

      act(() => {
        result.current.handleDragLeave(event)
      })

      expect(result.current.isExternalDragActive).toBe(false)
    })

    it('clears drop target on leave', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const target = document.createElement('div')
      target.dataset.path = '/project/docs'
      target.dataset.type = 'directory'

      const enterEvent = createMockDragEvent({ types: ['Files'], target })
      const leaveEvent = createMockDragEvent({ types: ['Files'] })

      act(() => {
        result.current.handleDragEnter(enterEvent)
      })

      expect(result.current.externalDropTarget).toBe('/project/docs')

      act(() => {
        result.current.handleDragLeave(leaveEvent)
      })

      expect(result.current.externalDropTarget).toBeNull()
    })

    it('handles nested element leave correctly', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const event = createMockDragEvent({ types: ['Files'] })

      act(() => {
        result.current.handleDragEnter(event) // Enter 1
        result.current.handleDragEnter(event) // Enter 2 (nested)
        result.current.handleDragLeave(event) // Leave 1
      })

      // Should still be active (one more leave needed)
      expect(result.current.isExternalDragActive).toBe(true)

      act(() => {
        result.current.handleDragLeave(event) // Leave 2
      })

      expect(result.current.isExternalDragActive).toBe(false)
    })
  })

  describe('handleDrop', () => {
    it('extracts and returns dropped files', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const file1 = createMockFile({
        name: 'file1.md',
        path: '/external/file1.md'
      })
      const file2 = createMockFile({
        name: 'file2.md',
        path: '/external/file2.md'
      })

      const target = document.createElement('div')
      target.dataset.path = '/project'
      target.dataset.type = 'directory'

      const event = createMockDragEvent({
        types: ['Files'],
        files: [file1, file2],
        target
      })

      let droppedFiles: ExternalDropFile[] | null = null
      act(() => {
        droppedFiles = result.current.handleDrop(event)
      })

      expect(droppedFiles).toEqual([
        { path: '/external/file1.md', name: 'file1.md', sizeInBytes: 1024, isDirectory: false },
        { path: '/external/file2.md', name: 'file2.md', sizeInBytes: 1024, isDirectory: false }
      ])
    })

    it('filters out directories per FR-011', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const file = createMockFile({
        name: 'file.md',
        path: '/external/file.md'
      })
      const directory = createMockFile({
        name: 'folder',
        path: '/external/folder',
        type: '',
        size: 0
      })

      const target = document.createElement('div')
      target.dataset.path = '/project'
      target.dataset.type = 'directory'

      const event = createMockDragEvent({
        types: ['Files'],
        files: [file, directory],
        target
      })

      let droppedFiles: ExternalDropFile[] | null = null
      act(() => {
        droppedFiles = result.current.handleDrop(event)
      })

      expect(droppedFiles).toHaveLength(1)
      expect(droppedFiles![0].name).toBe('file.md')
    })

    it('returns null for invalid drop target', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const file = createMockFile({
        name: 'file.md',
        path: '/external/file.md'
      })

      const target = document.createElement('div')
      target.dataset.path = '/external/path'
      target.dataset.type = 'directory'

      const event = createMockDragEvent({
        types: ['Files'],
        files: [file],
        target
      })

      let droppedFiles: ExternalDropFile[] | null = null
      act(() => {
        droppedFiles = result.current.handleDrop(event)
      })

      expect(droppedFiles).toBeNull()
    })

    it('returns null when only directories dropped', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const directory = createMockFile({
        name: 'folder',
        path: '/external/folder',
        type: '',
        size: 0
      })

      const target = document.createElement('div')
      target.dataset.path = '/project'
      target.dataset.type = 'directory'

      const event = createMockDragEvent({
        types: ['Files'],
        files: [directory],
        target
      })

      let droppedFiles: ExternalDropFile[] | null = null
      act(() => {
        droppedFiles = result.current.handleDrop(event)
      })

      expect(droppedFiles).toBeNull()
    })

    it('resets state after drop', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const file = createMockFile({
        name: 'file.md',
        path: '/external/file.md'
      })

      const target = document.createElement('div')
      target.dataset.path = '/project'
      target.dataset.type = 'directory'

      const enterEvent = createMockDragEvent({ types: ['Files'], target })
      const dropEvent = createMockDragEvent({
        types: ['Files'],
        files: [file],
        target
      })

      act(() => {
        result.current.handleDragEnter(enterEvent)
      })

      expect(result.current.isExternalDragActive).toBe(true)

      act(() => {
        result.current.handleDrop(dropEvent)
      })

      expect(result.current.isExternalDragActive).toBe(false)
      expect(result.current.externalDropTarget).toBeNull()
    })

    it('calls preventDefault on drop event', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const file = createMockFile({
        name: 'file.md',
        path: '/external/file.md'
      })

      const target = document.createElement('div')
      target.dataset.path = '/project'
      target.dataset.type = 'directory'

      const event = createMockDragEvent({
        types: ['Files'],
        files: [file],
        target
      })

      act(() => {
        result.current.handleDrop(event)
      })

      expect(event.preventDefault).toHaveBeenCalled()
    })
  })

  describe('auto-expand timer', () => {
    it('starts timer when hovering over collapsed folder', () => {
      const setExpandedFolders = vi.fn()
      const options: UseExternalFileDropOptions = {
        projectPath: '/project',
        expandedFolders: new Set<string>(),
        setExpandedFolders
      }

      const { result } = renderHook(() => useExternalFileDrop(options))

      const target = document.createElement('div')
      target.dataset.path = '/project/docs'
      target.dataset.type = 'directory'

      const event = createMockDragEvent({ types: ['Files'], target })

      act(() => {
        result.current.handleDragEnter(event)
      })

      // Fast-forward timer
      act(() => {
        vi.advanceTimersByTime(1000) // AUTO_EXPAND.HOVER_DELAY
      })

      expect(setExpandedFolders).toHaveBeenCalled()
    })

    it('does not auto-expand already expanded folders', () => {
      const setExpandedFolders = vi.fn()
      const options: UseExternalFileDropOptions = {
        projectPath: '/project',
        expandedFolders: new Set(['/project/docs']),
        setExpandedFolders
      }

      const { result } = renderHook(() => useExternalFileDrop(options))

      const target = document.createElement('div')
      target.dataset.path = '/project/docs'
      target.dataset.type = 'directory'

      const event = createMockDragEvent({ types: ['Files'], target })

      act(() => {
        result.current.handleDragEnter(event)
      })

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(setExpandedFolders).not.toHaveBeenCalled()
    })

    it('cancels timer when moving to different folder', () => {
      const setExpandedFolders = vi.fn()
      const options: UseExternalFileDropOptions = {
        projectPath: '/project',
        expandedFolders: new Set<string>(),
        setExpandedFolders
      }

      const { result } = renderHook(() => useExternalFileDrop(options))

      const target1 = document.createElement('div')
      target1.dataset.path = '/project/docs'
      target1.dataset.type = 'directory'

      const target2 = document.createElement('div')
      target2.dataset.path = '/project/images'
      target2.dataset.type = 'directory'

      act(() => {
        result.current.handleDragOver(createMockDragEvent({ types: ['Files'], target: target1 }))
      })

      act(() => {
        vi.advanceTimersByTime(500)
      })

      // Move to different folder before timer expires
      act(() => {
        result.current.handleDragOver(createMockDragEvent({ types: ['Files'], target: target2 }))
      })

      // Original timer should be cancelled, advance remaining time
      act(() => {
        vi.advanceTimersByTime(500)
      })

      // Should not have expanded docs folder
      expect(setExpandedFolders).not.toHaveBeenCalled()

      // Advance full delay for new folder
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Should expand images folder
      expect(setExpandedFolders).toHaveBeenCalled()
    })

    it('clears timer on unmount', () => {
      const options: UseExternalFileDropOptions = {
        projectPath: '/project',
        expandedFolders: new Set<string>(),
        setExpandedFolders: vi.fn()
      }

      const { result, unmount } = renderHook(() => useExternalFileDrop(options))

      const target = document.createElement('div')
      target.dataset.path = '/project/docs'
      target.dataset.type = 'directory'

      act(() => {
        result.current.handleDragEnter(createMockDragEvent({ types: ['Files'], target }))
      })

      // Unmount before timer fires
      unmount()

      // Timer should be cleared, no errors
      expect(() => {
        act(() => {
          vi.runAllTimers()
        })
      }).not.toThrow()
    })
  })

  describe('isValidDropTarget', () => {
    it('accepts folders within project', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      expect(result.current.isValidDropTarget('/project/docs', true)).toBe(true)
    })

    it('accepts project root', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      expect(result.current.isValidDropTarget('/project', true)).toBe(true)
    })

    it('rejects files (non-directories)', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      expect(result.current.isValidDropTarget('/project/file.md', false)).toBe(false)
    })

    it('rejects folders outside project', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      expect(result.current.isValidDropTarget('/other/path', true)).toBe(false)
    })

    it('rejects when no project is open', () => {
      const options: UseExternalFileDropOptions = {
        projectPath: null,
        expandedFolders: new Set<string>(),
        setExpandedFolders: vi.fn()
      }

      const { result } = renderHook(() => useExternalFileDrop(options))

      expect(result.current.isValidDropTarget('/any/path', true)).toBe(false)
    })

    it('handles trailing slashes correctly', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      expect(result.current.isValidDropTarget('/project/docs/', true)).toBe(true)
    })

    it('rejects a sibling folder that shares a name prefix with the project', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      // '/projector' starts with '/project' textually but is not inside it
      expect(result.current.isValidDropTarget('/projector/sub', true)).toBe(false)
    })
  })

  describe('getTargetFromEvent', () => {
    it('extracts folder path from tree node', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const target = document.createElement('div')
      target.dataset.path = '/project/docs'
      target.dataset.type = 'directory'

      const event = createMockDragEvent({ types: ['Files'], target })

      const path = result.current.getTargetFromEvent(event)

      expect(path).toBe('/project/docs')
    })

    it('walks up DOM tree to find tree node', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const parent = document.createElement('div')
      parent.dataset.path = '/project/docs'
      parent.dataset.type = 'directory'

      const child = document.createElement('span')
      parent.appendChild(child)

      const event = createMockDragEvent({ types: ['Files'], target: child })

      const path = result.current.getTargetFromEvent(event)

      expect(path).toBe('/project/docs')
    })

    it('returns project root when no specific folder found', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const treeContainer = document.createElement('div')
      treeContainer.classList.add('project-tree-content')

      const target = document.createElement('div')
      treeContainer.appendChild(target)

      const event = createMockDragEvent({ types: ['Files'], target })

      const path = result.current.getTargetFromEvent(event)

      expect(path).toBe('/project')
    })

    it('returns null when outside tree', () => {
      const { result } = renderHook(() => useExternalFileDrop(defaultOptions))

      const target = document.createElement('div')

      const event = createMockDragEvent({ types: ['Files'], target })

      const path = result.current.getTargetFromEvent(event)

      expect(path).toBeNull()
    })
  })
})
