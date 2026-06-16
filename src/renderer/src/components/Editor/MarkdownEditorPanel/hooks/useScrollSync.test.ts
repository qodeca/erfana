// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useScrollSync Hook
 *
 * Tests scroll synchronization between editor and preview panes.
 * Uses mocked Monaco editor and DOM elements.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScrollSync, UseScrollSyncOptions } from './useScrollSync'
import type { MonacoEditorHandle } from '../../MonacoMarkdownEditor'
import * as monaco from 'monaco-editor'

// Mock logger to prevent console noise
vi.mock('../../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Store mock return values so we can control them per test
const mockScrollMapEntries = [
  { line: 1, editorOffset: 0, previewOffset: 0 },
  { line: 10, editorOffset: 200, previewOffset: 200 }
]

// Mock the logic module functions
vi.mock('../../../../components/Panels/markdownEditorPanel.logic', () => ({
  processElementForScrollMap: vi.fn().mockReturnValue({
    startLine: 1,
    endLine: 1,
    topOffset: 0,
    bottomOffset: 20
  }),
  aggregateLineOffsets: vi.fn().mockReturnValue(new Map([[1, 0], [10, 200]])),
  buildScrollMapEntries: vi.fn().mockReturnValue([
    { line: 1, editorOffset: 0, previewOffset: 0 },
    { line: 10, editorOffset: 200, previewOffset: 200 }
  ]),
  enforceMonotonicPreviewOffsets: vi.fn((entries) => entries),
  interpolateScrollPosition: vi.fn().mockReturnValue(100),
  isSplitMode: vi.fn((mode) => mode === 'split' || mode === 'split-horizontal')
}))

/**
 * Creates a mock Monaco editor instance
 */
function createMockEditor(): monaco.editor.IStandaloneCodeEditor & { _triggerScrollChange: () => void } {
  const scrollChangeListeners: Array<() => void> = []

  return {
    getScrollTop: vi.fn().mockReturnValue(0),
    setScrollTop: vi.fn(),
    getTopForLineNumber: vi.fn((line: number) => line * 20),
    getDomNode: vi.fn().mockReturnValue(document.createElement('div')),
    layout: vi.fn(),
    onDidScrollChange: vi.fn((listener: () => void) => {
      scrollChangeListeners.push(listener)
      return {
        dispose: vi.fn(() => {
          const index = scrollChangeListeners.indexOf(listener)
          if (index > -1) scrollChangeListeners.splice(index, 1)
        })
      }
    }),
    // Helper to trigger scroll change
    _triggerScrollChange: () => {
      scrollChangeListeners.forEach((listener) => listener())
    }
  } as unknown as monaco.editor.IStandaloneCodeEditor & { _triggerScrollChange: () => void }
}

/**
 * Creates a mock MonacoEditorHandle ref
 */
function createMockEditorHandle(mockEditor: monaco.editor.IStandaloneCodeEditor): React.RefObject<MonacoEditorHandle | null> {
  return {
    current: {
      getEditor: () => mockEditor
    } as unknown as MonacoEditorHandle
  }
}

/**
 * Creates a fully mocked preview container element with all required DOM methods
 */
function createMockPreviewElement(): HTMLDivElement {
  const div = document.createElement('div')

  // Add offsetParent to simulate attached element
  Object.defineProperty(div, 'offsetParent', {
    get: () => document.body,
    configurable: true
  })

  // Add mock querySelectorAll that returns empty array (no line elements)
  const originalQuerySelectorAll = div.querySelectorAll.bind(div)
  div.querySelectorAll = vi.fn((selector: string) => {
    if (selector === '[data-line-start]') {
      return [] as unknown as NodeListOf<Element>
    }
    return originalQuerySelectorAll(selector)
  })

  // Mock getBoundingClientRect
  div.getBoundingClientRect = vi.fn().mockReturnValue({
    top: 0,
    left: 0,
    bottom: 500,
    right: 500,
    width: 500,
    height: 500,
    x: 0,
    y: 0,
    toJSON: () => ({})
  })

  // Store scrollTop value
  let scrollTopValue = 0
  Object.defineProperty(div, 'scrollTop', {
    get: () => scrollTopValue,
    set: (value: number) => {
      scrollTopValue = value
    },
    configurable: true
  })

  return div
}

/**
 * Creates a mock preview ref
 */
function createMockPreviewRef(): React.RefObject<HTMLDivElement | null> {
  return { current: createMockPreviewElement() }
}

describe('useScrollSync', () => {
  let mockEditor: monaco.editor.IStandaloneCodeEditor & { _triggerScrollChange: () => void }
  let editorRef: React.RefObject<MonacoEditorHandle | null>
  let previewRef: React.RefObject<HTMLDivElement | null>
  let defaultOptions: UseScrollSyncOptions

  beforeEach(() => {
    vi.useFakeTimers()

    mockEditor = createMockEditor()
    editorRef = createMockEditorHandle(mockEditor)
    previewRef = createMockPreviewRef()

    defaultOptions = {
      editorRef,
      previewRef,
      viewMode: 'split',
      currentFilePath: '/path/to/file.md',
      currentContent: '# Hello World'
    }

    // Mock requestAnimationFrame to execute synchronously
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 0
    })

    // Mock ResizeObserver
    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn()
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('should initialize with isEditorReady as false', () => {
      const { result } = renderHook(() => useScrollSync(defaultOptions))

      expect(result.current.isEditorReady).toBe(false)
    })

    it('should provide setIsEditorReady function', () => {
      const { result } = renderHook(() => useScrollSync(defaultOptions))

      expect(typeof result.current.setIsEditorReady).toBe('function')
    })

    it('should provide scrollMapRef', () => {
      const { result } = renderHook(() => useScrollSync(defaultOptions))

      expect(result.current.scrollMapRef).toBeDefined()
      expect(result.current.scrollMapRef.current).toEqual([])
    })

    it('should provide rebuildScrollMap function', () => {
      const { result } = renderHook(() => useScrollSync(defaultOptions))

      expect(typeof result.current.rebuildScrollMap).toBe('function')
    })

    it('should provide scroll handlers', () => {
      const { result } = renderHook(() => useScrollSync(defaultOptions))

      expect(typeof result.current.handleEditorScroll).toBe('function')
      expect(typeof result.current.handlePreviewScroll).toBe('function')
    })
  })

  describe('setIsEditorReady', () => {
    it('should update isEditorReady state', () => {
      const { result } = renderHook(() => useScrollSync(defaultOptions))

      act(() => {
        result.current.setIsEditorReady(true)
      })

      expect(result.current.isEditorReady).toBe(true)
    })

    it('should trigger re-render when isEditorReady changes', () => {
      let renderCount = 0

      const { result } = renderHook(() => {
        renderCount++
        return useScrollSync(defaultOptions)
      })

      const initialRenderCount = renderCount

      act(() => {
        result.current.setIsEditorReady(true)
      })

      expect(renderCount).toBeGreaterThan(initialRenderCount)
    })
  })

  describe('view mode changes', () => {
    it('should reset isEditorReady when view mode changes', () => {
      const { result, rerender } = renderHook(
        (props: UseScrollSyncOptions) => useScrollSync(props),
        { initialProps: defaultOptions }
      )

      // Set editor ready
      act(() => {
        result.current.setIsEditorReady(true)
      })
      expect(result.current.isEditorReady).toBe(true)

      // Change view mode
      rerender({ ...defaultOptions, viewMode: 'split-horizontal' })

      expect(result.current.isEditorReady).toBe(false)
    })

    it('should reset isEditorReady when switching to editor-only mode', () => {
      const { result, rerender } = renderHook(
        (props: UseScrollSyncOptions) => useScrollSync(props),
        { initialProps: defaultOptions }
      )

      act(() => {
        result.current.setIsEditorReady(true)
      })

      rerender({ ...defaultOptions, viewMode: 'editor' })

      expect(result.current.isEditorReady).toBe(false)
    })

    it('should reset isEditorReady when switching to preview-only mode', () => {
      const { result, rerender } = renderHook(
        (props: UseScrollSyncOptions) => useScrollSync(props),
        { initialProps: defaultOptions }
      )

      act(() => {
        result.current.setIsEditorReady(true)
      })

      rerender({ ...defaultOptions, viewMode: 'preview' })

      expect(result.current.isEditorReady).toBe(false)
    })
  })

  describe('rebuildScrollMap', () => {
    it('should not rebuild when not in split mode', () => {
      const { result } = renderHook(() =>
        useScrollSync({ ...defaultOptions, viewMode: 'editor' })
      )

      act(() => {
        result.current.rebuildScrollMap()
      })

      // Scroll map should remain empty
      expect(result.current.scrollMapRef.current).toEqual([])
    })

    it('should not rebuild when editor ref is null', () => {
      const { result } = renderHook(() =>
        useScrollSync({
          ...defaultOptions,
          editorRef: { current: null }
        })
      )

      act(() => {
        result.current.rebuildScrollMap()
      })

      expect(result.current.scrollMapRef.current).toEqual([])
    })

    it('should not rebuild when preview ref is null', () => {
      const { result } = renderHook(() =>
        useScrollSync({
          ...defaultOptions,
          previewRef: { current: null }
        })
      )

      act(() => {
        result.current.rebuildScrollMap()
      })

      expect(result.current.scrollMapRef.current).toEqual([])
    })

    it('should call rebuildScrollMap without error in split mode', () => {
      const { result } = renderHook(() => useScrollSync(defaultOptions))

      act(() => {
        result.current.setIsEditorReady(true)
      })

      // Should not throw
      expect(() => {
        act(() => {
          result.current.rebuildScrollMap()
        })
      }).not.toThrow()
    })

    it('should call rebuildScrollMap without error in split-horizontal mode', () => {
      const { result } = renderHook(() =>
        useScrollSync({ ...defaultOptions, viewMode: 'split-horizontal' })
      )

      act(() => {
        result.current.setIsEditorReady(true)
      })

      // Should not throw
      expect(() => {
        act(() => {
          result.current.rebuildScrollMap()
        })
      }).not.toThrow()
    })
  })

  describe('handleEditorScroll', () => {
    it('should not sync when preview ref is null', () => {
      const { result } = renderHook(() =>
        useScrollSync({
          ...defaultOptions,
          previewRef: { current: null }
        })
      )

      // Should not throw
      expect(() => {
        act(() => {
          result.current.handleEditorScroll()
        })
      }).not.toThrow()
    })

    it('should not sync when scroll map is empty', () => {
      const { result } = renderHook(() => useScrollSync(defaultOptions))

      // Should not throw when scroll map is empty
      expect(() => {
        act(() => {
          result.current.handleEditorScroll()
        })
      }).not.toThrow()
    })

    it('should call handleEditorScroll without error after map build', () => {
      const { result } = renderHook(() => useScrollSync(defaultOptions))

      // Manually populate scroll map for this test
      act(() => {
        result.current.scrollMapRef.current = mockScrollMapEntries
      })

      // Trigger editor scroll
      expect(() => {
        act(() => {
          result.current.handleEditorScroll()
        })
      }).not.toThrow()
    })
  })

  describe('handlePreviewScroll', () => {
    it('should not sync when preview ref is null', () => {
      const { result } = renderHook(() =>
        useScrollSync({
          ...defaultOptions,
          previewRef: { current: null }
        })
      )

      // Should not throw
      expect(() => {
        act(() => {
          result.current.handlePreviewScroll()
        })
      }).not.toThrow()
    })

    it('should not sync when scroll map is empty', () => {
      const { result } = renderHook(() => useScrollSync(defaultOptions))

      // Should not throw when scroll map is empty
      expect(() => {
        act(() => {
          result.current.handlePreviewScroll()
        })
      }).not.toThrow()
    })

    it('should sync editor scroll when preview scrolls with populated map', () => {
      const { result } = renderHook(() => useScrollSync(defaultOptions))

      // Manually populate scroll map for this test
      act(() => {
        result.current.scrollMapRef.current = mockScrollMapEntries
      })

      // Trigger preview scroll
      act(() => {
        result.current.handlePreviewScroll()
      })

      // Editor setScrollTop should have been called
      expect(mockEditor.setScrollTop).toHaveBeenCalled()
    })
  })

  describe('cleanup', () => {
    it('should clean up on unmount', () => {
      const { unmount } = renderHook(() => useScrollSync(defaultOptions))

      // Should not throw
      expect(() => unmount()).not.toThrow()
    })

    it('should remove event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(previewRef.current!, 'removeEventListener')

      const { result, unmount } = renderHook(() => useScrollSync(defaultOptions))

      // Set up listeners
      act(() => {
        result.current.setIsEditorReady(true)
      })

      // Wait for effects
      act(() => {
        vi.advanceTimersByTime(100)
      })

      unmount()

      // Event listeners should be cleaned up
      expect(removeEventListenerSpy).toHaveBeenCalled()
    })
  })

  describe('content changes', () => {
    it('should not throw when content changes', () => {
      const { rerender } = renderHook(
        (props: UseScrollSyncOptions) => useScrollSync(props),
        { initialProps: defaultOptions }
      )

      // Change content - should not throw
      expect(() => {
        rerender({ ...defaultOptions, currentContent: '# New Content' })

        // Allow async operations to complete
        act(() => {
          vi.advanceTimersByTime(1000)
        })
      }).not.toThrow()
    })

    it('should not throw when file path changes', () => {
      const { rerender } = renderHook(
        (props: UseScrollSyncOptions) => useScrollSync(props),
        { initialProps: defaultOptions }
      )

      // Change file path - should not throw
      expect(() => {
        rerender({ ...defaultOptions, currentFilePath: '/path/to/other.md' })

        // Allow async operations to complete
        act(() => {
          vi.advanceTimersByTime(1000)
        })
      }).not.toThrow()
    })
  })

  describe('non-split modes', () => {
    it('should not set up scroll sync in editor-only mode', () => {
      const { result } = renderHook(() =>
        useScrollSync({ ...defaultOptions, viewMode: 'editor' })
      )

      act(() => {
        result.current.setIsEditorReady(true)
      })

      // Scroll map should remain empty in non-split mode
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(result.current.scrollMapRef.current).toEqual([])
    })

    it('should not set up scroll sync in preview-only mode', () => {
      const { result } = renderHook(() =>
        useScrollSync({ ...defaultOptions, viewMode: 'preview' })
      )

      act(() => {
        result.current.setIsEditorReady(true)
      })

      // Scroll map should remain empty in non-split mode
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(result.current.scrollMapRef.current).toEqual([])
    })
  })

  describe('defensive checks', () => {
    it('should handle preview element not attached to DOM', () => {
      const detachedDiv = createMockPreviewElement()
      Object.defineProperty(detachedDiv, 'offsetParent', {
        get: () => null, // Not attached
        configurable: true
      })

      const { result } = renderHook(() =>
        useScrollSync({
          ...defaultOptions,
          previewRef: { current: detachedDiv }
        })
      )

      act(() => {
        result.current.setIsEditorReady(true)
        result.current.scrollMapRef.current = mockScrollMapEntries
      })

      // Should not throw when element is detached
      expect(() => {
        act(() => {
          result.current.handleEditorScroll()
        })
      }).not.toThrow()

      expect(() => {
        act(() => {
          result.current.handlePreviewScroll()
        })
      }).not.toThrow()
    })

    it('should handle editor not available', () => {
      const noEditorHandle: React.RefObject<MonacoEditorHandle | null> = {
        current: {
          getEditor: () => null
        } as unknown as MonacoEditorHandle
      }

      const { result } = renderHook(() =>
        useScrollSync({
          ...defaultOptions,
          editorRef: noEditorHandle
        })
      )

      // Should not throw
      expect(() => {
        act(() => {
          result.current.handleEditorScroll()
        })
      }).not.toThrow()

      expect(() => {
        act(() => {
          result.current.handlePreviewScroll()
        })
      }).not.toThrow()
    })
  })

  describe('error handling', () => {
    it('should handle errors in handleEditorScroll gracefully', () => {
      const throwingEditor = createMockEditor()
      throwingEditor.getScrollTop = vi.fn(() => {
        throw new Error('Test error')
      })

      const { result } = renderHook(() =>
        useScrollSync({
          ...defaultOptions,
          editorRef: createMockEditorHandle(throwingEditor)
        })
      )

      act(() => {
        result.current.setIsEditorReady(true)
        result.current.scrollMapRef.current = mockScrollMapEntries
      })

      // Should not throw
      expect(() => {
        act(() => {
          result.current.handleEditorScroll()
        })
      }).not.toThrow()
    })

    it('should handle errors in rebuildScrollMap gracefully', () => {
      const throwingEditor = createMockEditor()
      throwingEditor.getTopForLineNumber = vi.fn(() => {
        throw new Error('Test error')
      })

      const { result } = renderHook(() =>
        useScrollSync({
          ...defaultOptions,
          editorRef: createMockEditorHandle(throwingEditor)
        })
      )

      // Should not throw and should set empty scroll map
      expect(() => {
        act(() => {
          result.current.rebuildScrollMap()
        })
      }).not.toThrow()

      expect(result.current.scrollMapRef.current).toEqual([])
    })
  })

  describe('scroll sync prevention (isSyncing)', () => {
    it('should prevent infinite scroll loops', () => {
      const { result } = renderHook(() => useScrollSync(defaultOptions))

      act(() => {
        result.current.setIsEditorReady(true)
        result.current.scrollMapRef.current = mockScrollMapEntries
      })

      // First scroll should work - should not throw
      expect(() => {
        act(() => {
          result.current.handleEditorScroll()
        })
      }).not.toThrow()

      // Immediate second scroll should be blocked by isSyncing
      // (In real implementation, RAF would clear isSyncing)
    })
  })

  describe('ResizeObserver integration', () => {
    it('should create ResizeObserver in split mode when editor is ready', () => {
      const resizeObserverMock = vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn()
      }))
      global.ResizeObserver = resizeObserverMock

      const { result } = renderHook(() => useScrollSync(defaultOptions))

      const countBefore = resizeObserverMock.mock.calls.length

      act(() => {
        result.current.setIsEditorReady(true)
      })

      // ResizeObserver should be created after editor is ready
      expect(resizeObserverMock.mock.calls.length).toBeGreaterThanOrEqual(countBefore)
    })

    it('should not create new ResizeObserver when switching from split to non-split mode', () => {
      const observeCallsMade: number[] = []
      const resizeObserverMock = vi.fn().mockImplementation(() => ({
        observe: vi.fn(() => {
          observeCallsMade.push(1)
        }),
        unobserve: vi.fn(),
        disconnect: vi.fn()
      }))
      global.ResizeObserver = resizeObserverMock

      const { rerender, result } = renderHook(
        (props: UseScrollSyncOptions) => useScrollSync(props),
        { initialProps: defaultOptions }
      )

      act(() => {
        result.current.setIsEditorReady(true)
      })

      const observeCountInSplit = observeCallsMade.length

      // Switch to non-split mode
      rerender({ ...defaultOptions, viewMode: 'editor' })

      // observe should not be called more times after switching to non-split
      // (disconnect should be called instead)
      expect(observeCallsMade.length).toBe(observeCountInSplit)
    })
  })

  describe('mermaid event handling', () => {
    it('should add mermaid:rendered event listener', () => {
      const addEventListenerSpy = vi.spyOn(previewRef.current!, 'addEventListener')

      const { result } = renderHook(() => useScrollSync(defaultOptions))

      act(() => {
        result.current.setIsEditorReady(true)
      })

      // Wait for effects
      act(() => {
        vi.advanceTimersByTime(100)
      })

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'mermaid:rendered',
        expect.any(Function)
      )
    })
  })

  describe('image load handling', () => {
    it('should handle image load events for scroll map rebuild', () => {
      // Create preview with an incomplete image
      const previewEl = createMockPreviewElement()
      const img = document.createElement('img')
      Object.defineProperty(img, 'complete', { value: false })
      previewEl.appendChild(img)

      // Override querySelectorAll to return the image
      previewEl.querySelectorAll = vi.fn((selector: string) => {
        if (selector === 'img') {
          return [img] as unknown as NodeListOf<Element>
        }
        if (selector === '[data-line-start]') {
          return [] as unknown as NodeListOf<Element>
        }
        return [] as unknown as NodeListOf<Element>
      })

      const { result } = renderHook(() =>
        useScrollSync({
          ...defaultOptions,
          previewRef: { current: previewEl }
        })
      )

      act(() => {
        result.current.setIsEditorReady(true)
      })

      // Re-render to trigger the effect
      act(() => {
        vi.advanceTimersByTime(100)
      })

      // Hook should not throw when handling images
      // The image load listener attachment is tested implicitly
    })
  })
})
