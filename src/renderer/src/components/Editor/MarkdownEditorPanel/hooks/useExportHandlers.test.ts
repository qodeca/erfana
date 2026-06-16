// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useExportHandlers Hook
 *
 * Tests PDF and DOCX export functionality with comprehensive mocking of:
 * - window.api.pdf.exportToPdf and window.api.docx.exportToDocx
 * - previewHandleRef.current.element DOM queries
 * - convertMermaidDiagramsToImages utility
 * - showToast callback
 *
 * @module useExportHandlers.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExportHandlers, type EditorFile } from './useExportHandlers'
import type { MarkdownPreviewHandle } from '../../MarkdownPreview'

// Mock the svgToImage utility
vi.mock('../../../../utils/svgToImage', () => ({
  convertMermaidDiagramsToImages: vi.fn()
}))

// Mock the logger
vi.mock('../../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

// Import the mocked function for type-safe usage
import { convertMermaidDiagramsToImages } from '../../../../utils/svgToImage'

// Type assertion for mocked function
const mockConvertMermaidDiagramsToImages = convertMermaidDiagramsToImages as ReturnType<typeof vi.fn>

// Mock window.api
const mockExportToPdf = vi.fn()
const mockExportToDocx = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    value: {
      pdf: {
        exportToPdf: mockExportToPdf
      },
      docx: {
        exportToDocx: mockExportToDocx
      }
    },
    writable: true,
    configurable: true
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

/**
 * Helper to create a mock preview element with DOM structure
 */
function createMockPreviewElement(innerHTML = '<p>Test content</p>'): HTMLDivElement {
  const element = document.createElement('div')
  const contentElement = document.createElement('div')
  contentElement.className = 'markdown-preview-content'
  contentElement.innerHTML = innerHTML
  element.appendChild(contentElement)
  return element
}

/**
 * Helper to create a mock ref for MarkdownPreviewHandle
 */
function createMockPreviewRef(element: HTMLDivElement | null): React.RefObject<MarkdownPreviewHandle | null> {
  return {
    current: element ? {
      scrollToAnchor: vi.fn(),
      element
    } : null
  }
}

/**
 * Helper to create a mock editor file
 */
function createMockEditorFile(overrides: Partial<EditorFile> = {}): EditorFile {
  return {
    path: '/path/to/document.md',
    content: '# Test Document\n\nSome content here.',
    modified: false,
    ...overrides
  }
}

describe('useExportHandlers', () => {
  describe('initial state', () => {
    it('should initialize with isExportingPdf as false', () => {
      const showToast = vi.fn()
      const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

      const { result } = renderHook(() =>
        useExportHandlers({
          currentFile: createMockEditorFile(),
          previewHandleRef,
          showToast
        })
      )

      expect(result.current.isExportingPdf).toBe(false)
    })

    it('should initialize with isExportingDocx as false', () => {
      const showToast = vi.fn()
      const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

      const { result } = renderHook(() =>
        useExportHandlers({
          currentFile: createMockEditorFile(),
          previewHandleRef,
          showToast
        })
      )

      expect(result.current.isExportingDocx).toBe(false)
    })

    it('should provide handleExportPdf function', () => {
      const showToast = vi.fn()
      const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

      const { result } = renderHook(() =>
        useExportHandlers({
          currentFile: createMockEditorFile(),
          previewHandleRef,
          showToast
        })
      )

      expect(result.current.handleExportPdf).toBeDefined()
      expect(typeof result.current.handleExportPdf).toBe('function')
    })

    it('should provide handleExportDocx function', () => {
      const showToast = vi.fn()
      const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

      const { result } = renderHook(() =>
        useExportHandlers({
          currentFile: createMockEditorFile(),
          previewHandleRef,
          showToast
        })
      )

      expect(result.current.handleExportDocx).toBeDefined()
      expect(typeof result.current.handleExportDocx).toBe('function')
    })
  })

  describe('handleExportPdf', () => {
    describe('precondition validation', () => {
      it('should show error toast when no preview element available', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(null)

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportPdf()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'Export failed',
          message: 'No content to export',
          type: 'error',
          duration: 3000
        })
        expect(mockExportToPdf).not.toHaveBeenCalled()
      })

      it('should show error toast when no current file', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: null,
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportPdf()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'Export failed',
          message: 'No content to export',
          type: 'error',
          duration: 3000
        })
        expect(mockExportToPdf).not.toHaveBeenCalled()
      })
    })

    describe('successful export', () => {
      it('should call exportToPdf with correct HTML and filename', async () => {
        const showToast = vi.fn()
        const previewElement = createMockPreviewElement('<h1>My Document</h1>')
        const previewHandleRef = createMockPreviewRef(previewElement)

        mockExportToPdf.mockResolvedValue({
          success: true,
          filePath: '/output/document.pdf'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile({ path: '/path/to/document.md' }),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportPdf()
        })

        expect(mockExportToPdf).toHaveBeenCalledWith({
          html: '<h1>My Document</h1>',
          fileName: 'document'
        })
      })

      it('should show success toast with saved filename', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToPdf.mockResolvedValue({
          success: true,
          filePath: '/output/my-document.pdf'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportPdf()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'PDF exported',
          message: 'Saved as my-document.pdf',
          type: 'success',
          duration: 3000
        })
      })

      it('should set isExportingPdf to true during export', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        let resolveExport: (value: unknown) => void
        mockExportToPdf.mockReturnValue(
          new Promise((resolve) => {
            resolveExport = resolve
          })
        )

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        // Start export
        let exportPromise: Promise<void>
        act(() => {
          exportPromise = result.current.handleExportPdf()
        })

        // Check that isExportingPdf is true during export
        expect(result.current.isExportingPdf).toBe(true)

        // Complete export
        await act(async () => {
          resolveExport!({ success: true, filePath: '/output/doc.pdf' })
          await exportPromise
        })

        // Check that isExportingPdf is false after export
        expect(result.current.isExportingPdf).toBe(false)
      })

      it('should extract filename without .md extension', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToPdf.mockResolvedValue({
          success: true,
          filePath: '/output/test.pdf'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile({ path: '/path/to/my-notes.md' }),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportPdf()
        })

        expect(mockExportToPdf).toHaveBeenCalledWith(
          expect.objectContaining({
            fileName: 'my-notes'
          })
        )
      })
    })

    describe('cancelled export', () => {
      it('should not show toast when export is cancelled by user', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToPdf.mockResolvedValue({
          success: false,
          errorCode: 'PDF_EXPORT_CANCELLED'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportPdf()
        })

        expect(showToast).not.toHaveBeenCalled()
      })
    })

    describe('failed export', () => {
      it('should show error toast when export fails with error message', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToPdf.mockResolvedValue({
          success: false,
          error: 'Disk full'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportPdf()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'Export failed',
          message: 'Disk full',
          type: 'error',
          duration: 5000
        })
      })

      it('should show Unknown error when no error message provided', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToPdf.mockResolvedValue({
          success: false
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportPdf()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'Export failed',
          message: 'Unknown error',
          type: 'error',
          duration: 5000
        })
      })

      it('should handle thrown exceptions', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToPdf.mockRejectedValue(new Error('Network error'))

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportPdf()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'Export failed',
          message: 'Network error',
          type: 'error',
          duration: 5000
        })
      })

      it('should reset isExportingPdf to false after error', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToPdf.mockRejectedValue(new Error('Some error'))

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportPdf()
        })

        expect(result.current.isExportingPdf).toBe(false)
      })
    })

    describe('rapid click prevention', () => {
      it('should ignore second call while export is in progress', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        let resolveExport: (value: unknown) => void
        mockExportToPdf.mockReturnValue(
          new Promise((resolve) => {
            resolveExport = resolve
          })
        )

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        // Start first export
        let exportPromise1: Promise<void>
        act(() => {
          exportPromise1 = result.current.handleExportPdf()
        })

        // Try to start second export while first is in progress
        act(() => {
          result.current.handleExportPdf()
        })

        // Only one call should have been made
        expect(mockExportToPdf).toHaveBeenCalledTimes(1)

        // Complete export
        await act(async () => {
          resolveExport!({ success: true, filePath: '/output/doc.pdf' })
          await exportPromise1
        })
      })
    })

    describe('content extraction', () => {
      it('should use .markdown-preview-content innerHTML when available', async () => {
        const showToast = vi.fn()
        const previewElement = createMockPreviewElement('<strong>Content inside</strong>')
        const previewHandleRef = createMockPreviewRef(previewElement)

        mockExportToPdf.mockResolvedValue({
          success: true,
          filePath: '/output/doc.pdf'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportPdf()
        })

        expect(mockExportToPdf).toHaveBeenCalledWith(
          expect.objectContaining({
            html: '<strong>Content inside</strong>'
          })
        )
      })

      it('should fall back to element.innerHTML if .markdown-preview-content not found', async () => {
        const showToast = vi.fn()
        // Create element without .markdown-preview-content
        const element = document.createElement('div')
        element.innerHTML = '<p>Fallback content</p>'
        const previewHandleRef = createMockPreviewRef(element)

        mockExportToPdf.mockResolvedValue({
          success: true,
          filePath: '/output/doc.pdf'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportPdf()
        })

        expect(mockExportToPdf).toHaveBeenCalledWith(
          expect.objectContaining({
            html: '<p>Fallback content</p>'
          })
        )
      })
    })
  })

  describe('handleExportDocx', () => {
    beforeEach(() => {
      // Default mock for Mermaid conversion
      mockConvertMermaidDiagramsToImages.mockResolvedValue({
        html: '<p>Converted content</p>',
        totalDiagrams: 0,
        failedDiagrams: 0
      })
    })

    describe('precondition validation', () => {
      it('should show error toast when no preview element available', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(null)

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'Export failed',
          message: 'No content to export',
          type: 'error',
          duration: 3000
        })
        expect(mockExportToDocx).not.toHaveBeenCalled()
      })

      it('should show error toast when no current file', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: null,
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'Export failed',
          message: 'No content to export',
          type: 'error',
          duration: 3000
        })
        expect(mockExportToDocx).not.toHaveBeenCalled()
      })

      it('should show error toast when .markdown-preview-content not found', async () => {
        const showToast = vi.fn()
        // Create element without .markdown-preview-content
        const element = document.createElement('div')
        element.innerHTML = '<p>No preview content class</p>'
        const previewHandleRef = createMockPreviewRef(element)

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'Export failed',
          message: 'No preview content available',
          type: 'error',
          duration: 3000
        })
        expect(mockExportToDocx).not.toHaveBeenCalled()
      })
    })

    describe('successful export', () => {
      it('should call exportToDocx with converted HTML and filename', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockConvertMermaidDiagramsToImages.mockResolvedValue({
          html: '<p>Processed HTML</p>',
          totalDiagrams: 0,
          failedDiagrams: 0
        })

        mockExportToDocx.mockResolvedValue({
          success: true,
          filePath: '/output/document.docx'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile({ path: '/path/to/document.md' }),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        expect(mockExportToDocx).toHaveBeenCalledWith({
          html: '<p>Processed HTML</p>',
          fileName: 'document'
        })
      })

      it('should show success toast with saved filename', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToDocx.mockResolvedValue({
          success: true,
          filePath: '/output/my-report.docx'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'DOCX exported',
          message: 'Saved as my-report.docx',
          type: 'success',
          duration: 3000
        })
      })

      it('should set isExportingDocx to true during export', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        let resolveExport: (value: unknown) => void
        mockExportToDocx.mockReturnValue(
          new Promise((resolve) => {
            resolveExport = resolve
          })
        )

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        // Start export
        let exportPromise: Promise<void>
        act(() => {
          exportPromise = result.current.handleExportDocx()
        })

        // Check that isExportingDocx is true during export
        expect(result.current.isExportingDocx).toBe(true)

        // Complete export
        await act(async () => {
          resolveExport!({ success: true, filePath: '/output/doc.docx' })
          await exportPromise
        })

        // Check that isExportingDocx is false after export
        expect(result.current.isExportingDocx).toBe(false)
      })
    })

    describe('Mermaid diagram conversion', () => {
      it('should pass content element to convertMermaidDiagramsToImages', async () => {
        const showToast = vi.fn()
        const previewElement = createMockPreviewElement('<div class="mermaid">graph TD</div>')
        const previewHandleRef = createMockPreviewRef(previewElement)

        mockExportToDocx.mockResolvedValue({
          success: true,
          filePath: '/output/doc.docx'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        expect(mockConvertMermaidDiagramsToImages).toHaveBeenCalledTimes(1)
        // The function should receive the content element, not the wrapper
        const callArg = mockConvertMermaidDiagramsToImages.mock.calls[0][0]
        expect(callArg).toBeInstanceOf(Element)
        expect(callArg.className).toBe('markdown-preview-content')
      })

      it('should show warning toast when some diagrams fail to convert', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockConvertMermaidDiagramsToImages.mockResolvedValue({
          html: '<p>Partial content</p>',
          totalDiagrams: 3,
          failedDiagrams: 1
        })

        mockExportToDocx.mockResolvedValue({
          success: true,
          filePath: '/output/doc.docx'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        // Should show warning about failed diagrams
        expect(showToast).toHaveBeenCalledWith({
          title: 'Diagram conversion warning',
          message: '1 of 3 diagram(s) could not be converted',
          type: 'warning',
          duration: 5000
        })

        // Should also show success toast
        expect(showToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'DOCX exported',
            type: 'success'
          })
        )
      })

      it('should not show warning when all diagrams convert successfully', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockConvertMermaidDiagramsToImages.mockResolvedValue({
          html: '<p>All converted</p>',
          totalDiagrams: 3,
          failedDiagrams: 0
        })

        mockExportToDocx.mockResolvedValue({
          success: true,
          filePath: '/output/doc.docx'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        // Should NOT show warning
        expect(showToast).not.toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Diagram conversion warning'
          })
        )

        // Should show success
        expect(showToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'DOCX exported'
          })
        )
      })
    })

    describe('cancelled export', () => {
      it('should not show toast when export is cancelled by user', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToDocx.mockResolvedValue({
          success: false,
          errorCode: 'DOCX_EXPORT_CANCELLED'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        expect(showToast).not.toHaveBeenCalled()
      })
    })

    describe('failed export', () => {
      it('should show error toast when export fails with error message', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToDocx.mockResolvedValue({
          success: false,
          error: 'Permission denied'
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'Export failed',
          message: 'Permission denied',
          type: 'error',
          duration: 5000
        })
      })

      it('should show Unknown error when no error message provided', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToDocx.mockResolvedValue({
          success: false
        })

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'Export failed',
          message: 'Unknown error',
          type: 'error',
          duration: 5000
        })
      })

      it('should handle thrown exceptions during conversion', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockConvertMermaidDiagramsToImages.mockRejectedValue(new Error('Conversion failed'))

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'Export failed',
          message: 'Conversion failed',
          type: 'error',
          duration: 5000
        })
      })

      it('should handle thrown exceptions during export', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToDocx.mockRejectedValue(new Error('Export API error'))

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        expect(showToast).toHaveBeenCalledWith({
          title: 'Export failed',
          message: 'Export API error',
          type: 'error',
          duration: 5000
        })
      })

      it('should reset isExportingDocx to false after error', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        mockExportToDocx.mockRejectedValue(new Error('Some error'))

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        await act(async () => {
          await result.current.handleExportDocx()
        })

        expect(result.current.isExportingDocx).toBe(false)
      })
    })

    describe('rapid click prevention', () => {
      it('should ignore second call while export is in progress', async () => {
        const showToast = vi.fn()
        const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

        let resolveExport: (value: unknown) => void
        mockExportToDocx.mockReturnValue(
          new Promise((resolve) => {
            resolveExport = resolve
          })
        )

        const { result } = renderHook(() =>
          useExportHandlers({
            currentFile: createMockEditorFile(),
            previewHandleRef,
            showToast
          })
        )

        // Start first export
        let exportPromise1: Promise<void>
        act(() => {
          exportPromise1 = result.current.handleExportDocx()
        })

        // Try to start second export while first is in progress
        act(() => {
          result.current.handleExportDocx()
        })

        // Only one conversion should have been triggered
        expect(mockConvertMermaidDiagramsToImages).toHaveBeenCalledTimes(1)

        // Complete export
        await act(async () => {
          resolveExport!({ success: true, filePath: '/output/doc.docx' })
          await exportPromise1
        })
      })
    })
  })

  describe('filename extraction edge cases', () => {
    it('should handle file path with multiple dots', async () => {
      const showToast = vi.fn()
      const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

      mockExportToPdf.mockResolvedValue({
        success: true,
        filePath: '/output/test.pdf'
      })

      const { result } = renderHook(() =>
        useExportHandlers({
          currentFile: createMockEditorFile({ path: '/path/to/file.name.with.dots.md' }),
          previewHandleRef,
          showToast
        })
      )

      await act(async () => {
        await result.current.handleExportPdf()
      })

      expect(mockExportToPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'file.name.with.dots'
        })
      )
    })

    it('should handle file path without extension', async () => {
      const showToast = vi.fn()
      const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

      mockExportToPdf.mockResolvedValue({
        success: true,
        filePath: '/output/test.pdf'
      })

      const { result } = renderHook(() =>
        useExportHandlers({
          currentFile: createMockEditorFile({ path: '/path/to/README' }),
          previewHandleRef,
          showToast
        })
      )

      await act(async () => {
        await result.current.handleExportPdf()
      })

      expect(mockExportToPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'README'
        })
      )
    })

    it('should handle file path with spaces', async () => {
      const showToast = vi.fn()
      const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

      mockExportToPdf.mockResolvedValue({
        success: true,
        filePath: '/output/test.pdf'
      })

      const { result } = renderHook(() =>
        useExportHandlers({
          currentFile: createMockEditorFile({ path: '/path/to/my document.md' }),
          previewHandleRef,
          showToast
        })
      )

      await act(async () => {
        await result.current.handleExportPdf()
      })

      expect(mockExportToPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'my document'
        })
      )
    })

    it('should handle deeply nested file path', async () => {
      const showToast = vi.fn()
      const previewHandleRef = createMockPreviewRef(createMockPreviewElement())

      mockExportToPdf.mockResolvedValue({
        success: true,
        filePath: '/output/test.pdf'
      })

      const { result } = renderHook(() =>
        useExportHandlers({
          currentFile: createMockEditorFile({ path: '/a/b/c/d/e/f/document.md' }),
          previewHandleRef,
          showToast
        })
      )

      await act(async () => {
        await result.current.handleExportPdf()
      })

      expect(mockExportToPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'document'
        })
      )
    })
  })

  describe('callback stability', () => {
    it('should have stable handleExportPdf reference when dependencies do not change', () => {
      const showToast = vi.fn()
      const previewHandleRef = createMockPreviewRef(createMockPreviewElement())
      const currentFile = createMockEditorFile()

      const { result, rerender } = renderHook(() =>
        useExportHandlers({
          currentFile,
          previewHandleRef,
          showToast
        })
      )

      const firstRef = result.current.handleExportPdf

      rerender()

      expect(result.current.handleExportPdf).toBe(firstRef)
    })

    it('should have stable handleExportDocx reference when dependencies do not change', () => {
      const showToast = vi.fn()
      const previewHandleRef = createMockPreviewRef(createMockPreviewElement())
      const currentFile = createMockEditorFile()

      const { result, rerender } = renderHook(() =>
        useExportHandlers({
          currentFile,
          previewHandleRef,
          showToast
        })
      )

      const firstRef = result.current.handleExportDocx

      rerender()

      expect(result.current.handleExportDocx).toBe(firstRef)
    })
  })
})
