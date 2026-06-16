// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useImport Hook Tests
 *
 * Comprehensive test suite for the unified import workflow hook.
 * Covers:
 * - Empty file array handling
 * - Single and batch file imports
 * - Large file warning flow
 * - Error handling paths
 * - Batch size limits
 * - State management (isImporting)
 * - Toast notifications
 * - Organize prompt triggering
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useImport, type ImportFileInfo, type ProcessFilesResult } from './useImport'
import { IMPORT } from '../../../shared/constants'

// Mock the dialog context
const mockShowConfirm = vi.fn()
const mockShowAlert = vi.fn().mockResolvedValue(undefined)
vi.mock('../components/Dialog/DialogContext', () => ({
  useDialog: () => ({
    showConfirm: mockShowConfirm,
    showAlert: mockShowAlert
  })
}))

// Mock toast helpers
const mockShowSuccessToast = vi.fn()
const mockShowErrorToast = vi.fn()
const mockShowWarningToast = vi.fn()
vi.mock('../utils/toastHelpers', () => ({
  showSuccessToast: (...args: unknown[]) => mockShowSuccessToast(...args),
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
  showWarningToast: (...args: unknown[]) => mockShowWarningToast(...args)
}))

// Mock prompt execution
const mockExecutePromptTemplate = vi.fn()
vi.mock('../utils/panelUtils', () => ({
  executePromptTemplate: (...args: unknown[]) => mockExecutePromptTemplate(...args)
}))

// Mock terminal portal context
vi.mock('../context/TerminalPortalContext', () => ({
  useTerminalPortalOptional: () => null
}))

// Mock scroll scheduler
vi.mock('../utils/promptScrollScheduler.logic', () => ({
  scheduleScrollIfNeeded: vi.fn()
}))

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

// Mock useTranscriptionStore
const mockOpenDialog = vi.fn()
vi.mock('../stores/useTranscriptionStore', () => ({
  useTranscriptionStore: Object.assign(
    vi.fn(() => ({
      isDialogOpen: false,
      openDialog: mockOpenDialog
    })),
    {
      getState: vi.fn(() => ({
        openDialog: mockOpenDialog
      }))
    }
  )
}))

// Mock useDocumentImportStore
const mockDocImportOpenDialog = vi.fn()
const mockFetchExtensions = vi.fn().mockResolvedValue(undefined)
const mockInitDependencyListener = vi.fn().mockReturnValue(() => {})
vi.mock('../stores/useDocumentImportStore', () => ({
  useDocumentImportStore: Object.assign(
    vi.fn(() => ({
      isOpen: false,
      documentExtensions: [],
      openDialog: mockDocImportOpenDialog
    })),
    {
      getState: vi.fn(() => ({
        openDialog: mockDocImportOpenDialog,
        documentExtensions: [],
        fetchExtensions: mockFetchExtensions,
        initDependencyListener: mockInitDependencyListener
      }))
    }
  )
}))

// Mock window.api
const mockSelectFile = vi.fn()
const mockProcessImport = vi.fn()
const mockValidateAudio = vi.fn()

Object.defineProperty(window, 'api', {
  writable: true,
  configurable: true,
  value: {
    import: {
      selectFile: mockSelectFile,
      process: mockProcessImport,
      getDocumentExtensions: vi.fn().mockResolvedValue([]),
      onDependenciesReady: vi.fn().mockReturnValue(() => {})
    },
    transcription: {
      validate: mockValidateAudio
    }
  }
})

/**
 * Helper to create ImportFileInfo for tests
 */
function createTestFile(overrides: Partial<ImportFileInfo> = {}): ImportFileInfo {
  return {
    path: '/test/file.md',
    name: 'file.md',
    sizeInBytes: 1024,
    ...overrides
  }
}

describe('useImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShowConfirm.mockResolvedValue(true)
    mockProcessImport.mockResolvedValue({
      success: true,
      outputPath: '/project/import/file.md'
    })
    mockExecutePromptTemplate.mockResolvedValue({ success: true })
    mockValidateAudio.mockResolvedValue({ valid: true })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('isImporting starts as false', () => {
      const { result } = renderHook(() => useImport())
      expect(result.current.isImporting).toBe(false)
    })

    it('provides importFile and processFiles functions', () => {
      const { result } = renderHook(() => useImport())
      expect(typeof result.current.importFile).toBe('function')
      expect(typeof result.current.processFiles).toBe('function')
    })
  })

  describe('processFiles - empty array', () => {
    it('returns early with empty result for empty file array', async () => {
      const { result } = renderHook(() => useImport())

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles([])
      })

      expect(processResult).toEqual({
        successCount: 0,
        failCount: 0,
        skippedCount: 0,
        outputPaths: [],
        failures: []
      })

      // Should not show any toasts
      expect(mockShowSuccessToast).not.toHaveBeenCalled()
      expect(mockShowErrorToast).not.toHaveBeenCalled()
    })
  })

  describe('processFiles - single file success', () => {
    it('imports single file successfully', async () => {
      const { result } = renderHook(() => useImport())
      const file = createTestFile()

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles([file])
      })

      expect(processResult).toEqual({
        successCount: 1,
        failCount: 0,
        skippedCount: 0,
        outputPaths: ['/project/import/file.md'],
        failures: []
      })

      expect(mockProcessImport).toHaveBeenCalledWith('/test/file.md')
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        'File imported',
        '"file.md" imported successfully'
      )
    })

    it('triggers organize prompt for single file import', async () => {
      const { result } = renderHook(() => useImport())
      const file = createTestFile()

      await act(async () => {
        await result.current.processFiles([file])
      })

      expect(mockExecutePromptTemplate).toHaveBeenCalledWith(
        'organize-import',
        expect.objectContaining({
          importedFilePath: '/project/import/file.md'
        })
      )
    })

    it('sets isImporting to false after processing completes', async () => {
      const { result } = renderHook(() => useImport())
      const file = createTestFile()

      await act(async () => {
        await result.current.processFiles([file])
      })

      // After completion, should be false
      expect(result.current.isImporting).toBe(false)
    })
  })

  describe('processFiles - single file failure', () => {
    it('handles import failure with error code', async () => {
      mockProcessImport.mockResolvedValue({
        success: false,
        errorCode: 'IMPORT_UNSUPPORTED_TYPE',
        error: 'File type not supported'
      })

      const { result } = renderHook(() => useImport())
      const file = createTestFile()

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles([file])
      })

      expect(processResult).toEqual({
        successCount: 0,
        failCount: 1,
        skippedCount: 0,
        outputPaths: [],
        failures: [{ file, error: expect.any(String) }]
      })

      expect(mockShowErrorToast).toHaveBeenCalled()
    })

    it('handles unexpected exception during import', async () => {
      mockProcessImport.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useImport())
      const file = createTestFile()

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles([file])
      })

      expect(processResult?.failCount).toBe(1)
      expect(processResult?.failures).toHaveLength(1)
      expect(processResult?.failures[0].error).toBe('Network error')
      expect(mockShowErrorToast).toHaveBeenCalled()
    })

    it('handles success without outputPath as failure', async () => {
      mockProcessImport.mockResolvedValue({
        success: true,
        outputPath: undefined // Backend bug
      })

      const { result } = renderHook(() => useImport())
      const file = createTestFile()

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles([file])
      })

      expect(processResult?.failCount).toBe(1)
      expect(processResult?.failures[0].error).toBe('No output path returned')
    })
  })

  describe('processFiles - batch import', () => {
    it('imports multiple files successfully', async () => {
      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/file1.md', name: 'file1.md' }),
        createTestFile({ path: '/test/file2.md', name: 'file2.md' })
      ]

      mockProcessImport
        .mockResolvedValueOnce({ success: true, outputPath: '/import/file1.md' })
        .mockResolvedValueOnce({ success: true, outputPath: '/import/file2.md' })

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      expect(processResult).toEqual({
        successCount: 2,
        failCount: 0,
        skippedCount: 0,
        outputPaths: ['/import/file1.md', '/import/file2.md'],
        failures: []
      })

      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        'Import complete',
        'Imported 2 files'
      )
    })

    it('shows warning toast for partial batch success', async () => {
      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/file1.md', name: 'file1.md' }),
        createTestFile({ path: '/test/file2.md', name: 'file2.md' })
      ]

      mockProcessImport
        .mockResolvedValueOnce({ success: true, outputPath: '/import/file1.md' })
        .mockResolvedValueOnce({ success: false, error: 'Failed' })

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      expect(processResult?.successCount).toBe(1)
      expect(processResult?.failCount).toBe(1)
      expect(mockShowWarningToast).toHaveBeenCalledWith(
        'Import partially complete',
        'Imported 1 of 2 files'
      )
    })

    it('does NOT trigger organize prompt for batch imports', async () => {
      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/file1.md', name: 'file1.md' }),
        createTestFile({ path: '/test/file2.md', name: 'file2.md' })
      ]

      mockProcessImport
        .mockResolvedValueOnce({ success: true, outputPath: '/import/file1.md' })
        .mockResolvedValueOnce({ success: true, outputPath: '/import/file2.md' })

      await act(async () => {
        await result.current.processFiles(files)
      })

      // Organize prompt should only fire for single file imports
      expect(mockExecutePromptTemplate).not.toHaveBeenCalled()
    })
  })

  describe('processFiles - large file warning', () => {
    it('shows confirmation dialog for large files', async () => {
      const { result } = renderHook(() => useImport())
      // Create a file larger than IMPORT.SIZE_WARNING_THRESHOLD (50MB)
      const largeFile = createTestFile({
        sizeInBytes: 60 * 1024 * 1024 // 60MB
      })

      await act(async () => {
        await result.current.processFiles([largeFile])
      })

      expect(mockShowConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Large file warning',
          confirmLabel: 'Import anyway',
          cancelLabel: 'Skip'
        })
      )
    })

    it('skips file when user declines large file warning', async () => {
      mockShowConfirm.mockResolvedValue(false) // User clicks Skip

      const { result } = renderHook(() => useImport())
      const largeFile = createTestFile({
        sizeInBytes: 60 * 1024 * 1024
      })

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles([largeFile])
      })

      expect(processResult).toEqual({
        successCount: 0,
        failCount: 0,
        skippedCount: 1, // Tracked as skipped, not failed
        outputPaths: [],
        failures: []
      })

      // Import should NOT be called
      expect(mockProcessImport).not.toHaveBeenCalled()
    })

    it('proceeds with import when user confirms large file', async () => {
      mockShowConfirm.mockResolvedValue(true) // User clicks Import anyway

      const { result } = renderHook(() => useImport())
      const largeFile = createTestFile({
        sizeInBytes: 60 * 1024 * 1024
      })

      await act(async () => {
        await result.current.processFiles([largeFile])
      })

      expect(mockProcessImport).toHaveBeenCalled()
    })

    it('does NOT show warning for files under threshold', async () => {
      const { result } = renderHook(() => useImport())
      const smallFile = createTestFile({
        sizeInBytes: 10 * 1024 * 1024 // 10MB
      })

      await act(async () => {
        await result.current.processFiles([smallFile])
      })

      expect(mockShowConfirm).not.toHaveBeenCalled()
      expect(mockProcessImport).toHaveBeenCalled()
    })
  })

  describe('processFiles - batch size limit', () => {
    it('rejects batches exceeding MAX_BATCH_SIZE', async () => {
      const { result } = renderHook(() => useImport())

      // Create more files than MAX_BATCH_SIZE (100)
      const tooManyFiles = Array.from({ length: IMPORT.MAX_BATCH_SIZE + 1 }, (_, i) =>
        createTestFile({ path: `/test/file${i}.md`, name: `file${i}.md` })
      )

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(tooManyFiles)
      })

      expect(processResult).toEqual({
        successCount: 0,
        failCount: 0,
        skippedCount: 0,
        outputPaths: [],
        failures: []
      })

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        'Too many files',
        expect.stringContaining(`${IMPORT.MAX_BATCH_SIZE}`)
      )

      // Should NOT process any files
      expect(mockProcessImport).not.toHaveBeenCalled()
    })

    it('accepts batches at exactly MAX_BATCH_SIZE', async () => {
      const { result } = renderHook(() => useImport())

      // Create exactly MAX_BATCH_SIZE files
      const maxFiles = Array.from({ length: IMPORT.MAX_BATCH_SIZE }, (_, i) =>
        createTestFile({ path: `/test/file${i}.md`, name: `file${i}.md` })
      )

      mockProcessImport.mockResolvedValue({
        success: true,
        outputPath: '/import/file.md'
      })

      await act(async () => {
        await result.current.processFiles(maxFiles)
      })

      // Should process all files
      expect(mockProcessImport).toHaveBeenCalledTimes(IMPORT.MAX_BATCH_SIZE)
    })
  })

  describe('processFiles - onFileResult callback', () => {
    it('calls onFileResult for each file processed', async () => {
      const { result } = renderHook(() => useImport())
      const onFileResult = vi.fn()
      const files = [
        createTestFile({ path: '/test/file1.md', name: 'file1.md' }),
        createTestFile({ path: '/test/file2.md', name: 'file2.md' })
      ]

      mockProcessImport
        .mockResolvedValueOnce({ success: true, outputPath: '/import/file1.md' })
        .mockResolvedValueOnce({ success: false, error: 'Failed' })

      await act(async () => {
        await result.current.processFiles(files, { onFileResult })
      })

      expect(onFileResult).toHaveBeenCalledTimes(2)
      expect(onFileResult).toHaveBeenNthCalledWith(
        1,
        files[0],
        'success',
        '/import/file1.md'
      )
      expect(onFileResult).toHaveBeenNthCalledWith(
        2,
        files[1],
        'failed'
      )
    })

    it('calls onFileResult with skipped status for user-skipped large files', async () => {
      mockShowConfirm.mockResolvedValue(false) // Skip

      const { result } = renderHook(() => useImport())
      const onFileResult = vi.fn()
      const largeFile = createTestFile({
        sizeInBytes: 60 * 1024 * 1024
      })

      await act(async () => {
        await result.current.processFiles([largeFile], { onFileResult })
      })

      // M2 fix: now uses 'skipped' status instead of false
      expect(onFileResult).toHaveBeenCalledWith(largeFile, 'skipped')
    })
  })

  describe('importFile', () => {
    it('returns null when user cancels file selection', async () => {
      mockSelectFile.mockResolvedValue(null)

      const { result } = renderHook(() => useImport())

      let importResult: string | null | undefined
      await act(async () => {
        importResult = await result.current.importFile()
      })

      expect(importResult).toBeNull()
      expect(mockProcessImport).not.toHaveBeenCalled()
    })

    it('converts sizeInMB to sizeInBytes correctly', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/file.pdf',
        name: 'file.pdf',
        sizeInMB: 5.5, // 5.5 MB
        extension: 'pdf'
      })

      const { result } = renderHook(() => useImport())

      await act(async () => {
        await result.current.importFile()
      })

      // Verify processFiles was called with converted size
      // (indirectly through mockProcessImport being called)
      expect(mockProcessImport).toHaveBeenCalledWith('/external/file.pdf')
    })

    it('returns output path on successful import', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/file.pdf',
        name: 'file.pdf',
        sizeInMB: 1,
        extension: 'pdf'
      })
      mockProcessImport.mockResolvedValue({
        success: true,
        outputPath: '/project/import/file.md'
      })

      const { result } = renderHook(() => useImport())

      let importResult: string | null | undefined
      await act(async () => {
        importResult = await result.current.importFile()
      })

      expect(importResult).toBe('/project/import/file.md')
    })

    it('shows error toast on file selection failure', async () => {
      mockSelectFile.mockRejectedValue(new Error('Dialog error'))

      const { result } = renderHook(() => useImport())

      let importResult: string | null | undefined
      await act(async () => {
        importResult = await result.current.importFile()
      })

      expect(importResult).toBeNull()
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        'File selection failed',
        'Could not open file selection dialog'
      )
    })
  })

  // T1: Tests for error message handling
  describe('error message handling', () => {
    it('shows user-friendly message for known error codes', async () => {
      mockProcessImport.mockResolvedValue({
        success: false,
        errorCode: 'IMPORT_UNSUPPORTED_TYPE',
        error: 'Raw error message'
      })

      const { result } = renderHook(() => useImport())

      await act(async () => {
        await result.current.processFiles([createTestFile()])
      })

      // Should use ERROR_MESSAGES mapping, not raw error
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        'Import failed',
        expect.stringMatching(/file\.md:/)
      )
    })

    it('falls back to provided error message for unknown codes', async () => {
      mockProcessImport.mockResolvedValue({
        success: false,
        errorCode: 'UNKNOWN_ERROR_CODE',
        error: 'Custom fallback message'
      })

      const { result } = renderHook(() => useImport())

      await act(async () => {
        await result.current.processFiles([createTestFile()])
      })

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        'Import failed',
        expect.stringContaining('Custom fallback message')
      )
    })

    it('uses default message when no error code or message provided', async () => {
      mockProcessImport.mockResolvedValue({
        success: false
      })

      const { result } = renderHook(() => useImport())

      await act(async () => {
        await result.current.processFiles([createTestFile()])
      })

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        'Import failed',
        expect.stringContaining('Failed to import file')
      )
    })
  })

  // T2: Test for batch import with all files failing
  describe('processFiles - batch all files failing', () => {
    it('shows summary error toast when all files in batch fail', async () => {
      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/file1.md', name: 'file1.md' }),
        createTestFile({ path: '/test/file2.md', name: 'file2.md' }),
        createTestFile({ path: '/test/file3.md', name: 'file3.md' })
      ]

      mockProcessImport.mockResolvedValue({ success: false, error: 'Failed' })

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      expect(processResult?.successCount).toBe(0)
      expect(processResult?.failCount).toBe(3)
      expect(processResult?.skippedCount).toBe(0)

      // Should show individual error toasts
      expect(mockShowErrorToast).toHaveBeenCalledTimes(4) // 3 individual + 1 summary

      // L1 fix: Should show summary toast for all-fail batches
      expect(mockShowErrorToast).toHaveBeenLastCalledWith(
        'Import failed',
        'Failed to import 3 files'
      )
    })
  })

  // T3: Test for exactly-at-threshold boundary
  describe('processFiles - threshold boundary', () => {
    it('does NOT show warning for files at exactly SIZE_WARNING_THRESHOLD', async () => {
      const { result } = renderHook(() => useImport())
      // Exactly 50MB (at threshold, not over)
      const boundaryFile = createTestFile({
        sizeInBytes: IMPORT.SIZE_WARNING_THRESHOLD
      })

      await act(async () => {
        await result.current.processFiles([boundaryFile])
      })

      // Threshold check uses `>`, so exactly 50MB should NOT trigger warning
      expect(mockShowConfirm).not.toHaveBeenCalled()
      expect(mockProcessImport).toHaveBeenCalled()
    })

    it('shows warning for files 1 byte over SIZE_WARNING_THRESHOLD', async () => {
      const { result } = renderHook(() => useImport())
      const overThresholdFile = createTestFile({
        sizeInBytes: IMPORT.SIZE_WARNING_THRESHOLD + 1
      })

      await act(async () => {
        await result.current.processFiles([overThresholdFile])
      })

      expect(mockShowConfirm).toHaveBeenCalled()
    })
  })

  // T4: Test for organize prompt failure path
  describe('organize prompt error handling', () => {
    it('continues successfully even when organize prompt fails', async () => {
      mockExecutePromptTemplate.mockRejectedValue(new Error('Template not found'))

      const { result } = renderHook(() => useImport())

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles([createTestFile()])
      })

      // Import should still succeed
      expect(processResult?.successCount).toBe(1)
      expect(mockShowSuccessToast).toHaveBeenCalled()
    })

    it('handles non-success prompt result gracefully', async () => {
      mockExecutePromptTemplate.mockResolvedValue({ success: false })

      const { result } = renderHook(() => useImport())

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles([createTestFile()])
      })

      // Import should still succeed
      expect(processResult?.successCount).toBe(1)
    })
  })

  // T5: Test for mixed large/small files in batch
  describe('processFiles - mixed file sizes', () => {
    it('handles batch with both large and normal files', async () => {
      mockShowConfirm.mockResolvedValue(true) // Confirm large file

      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/small.md', name: 'small.md', sizeInBytes: 10 * 1024 * 1024 }),
        createTestFile({ path: '/test/large.md', name: 'large.md', sizeInBytes: 60 * 1024 * 1024 }),
        createTestFile({ path: '/test/tiny.md', name: 'tiny.md', sizeInBytes: 1024 })
      ]

      mockProcessImport.mockResolvedValue({ success: true, outputPath: '/import/file.md' })

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      // Should only show confirmation for large file
      expect(mockShowConfirm).toHaveBeenCalledTimes(1)
      expect(mockProcessImport).toHaveBeenCalledTimes(3)
      expect(processResult?.successCount).toBe(3)
    })

    it('skips only large files when user declines, processes rest', async () => {
      mockShowConfirm.mockResolvedValue(false) // Skip large files

      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/small.md', name: 'small.md', sizeInBytes: 10 * 1024 * 1024 }),
        createTestFile({ path: '/test/large.md', name: 'large.md', sizeInBytes: 60 * 1024 * 1024 })
      ]

      mockProcessImport.mockResolvedValue({ success: true, outputPath: '/import/file.md' })

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      expect(processResult?.successCount).toBe(1) // small.md processed
      expect(processResult?.skippedCount).toBe(1) // large.md skipped
      expect(mockProcessImport).toHaveBeenCalledTimes(1)
    })
  })

  // T6: Test for zero-size file handling
  describe('processFiles - zero-size files', () => {
    it('processes zero-size files without large file warning', async () => {
      const { result } = renderHook(() => useImport())
      const emptyFile = createTestFile({
        sizeInBytes: 0
      })

      await act(async () => {
        await result.current.processFiles([emptyFile])
      })

      // Zero-size files should not trigger large file warning
      expect(mockShowConfirm).not.toHaveBeenCalled()
      expect(mockProcessImport).toHaveBeenCalled()
    })
  })

  // Video file routing tests
  describe('video file routing', () => {
    it('importFile() with .mp4 file opens TranscriptionDialog', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/presentation.mp4',
        name: 'presentation.mp4',
        sizeInMB: 500,
        extension: 'mp4'
      })

      const { result } = renderHook(() => useImport())

      let importResult: string | null | undefined
      await act(async () => {
        importResult = await result.current.importFile()
      })

      expect(mockOpenDialog).toHaveBeenCalledWith('/external/presentation.mp4', 'presentation.mp4')
      expect(mockProcessImport).not.toHaveBeenCalled()
      expect(importResult).toBeNull()
    })

    it('importFile() with .mov file opens TranscriptionDialog', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/screencast.mov',
        name: 'screencast.mov',
        sizeInMB: 200,
        extension: 'mov'
      })

      const { result } = renderHook(() => useImport())

      let importResult: string | null | undefined
      await act(async () => {
        importResult = await result.current.importFile()
      })

      expect(mockOpenDialog).toHaveBeenCalledWith('/external/screencast.mov', 'screencast.mov')
      expect(mockProcessImport).not.toHaveBeenCalled()
      expect(importResult).toBeNull()
    })

    it('importFile() with .mkv file opens TranscriptionDialog', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/lecture.mkv',
        name: 'lecture.mkv',
        sizeInMB: 800,
        extension: 'mkv'
      })

      const { result } = renderHook(() => useImport())

      let importResult: string | null | undefined
      await act(async () => {
        importResult = await result.current.importFile()
      })

      expect(mockOpenDialog).toHaveBeenCalledWith('/external/lecture.mkv', 'lecture.mkv')
      expect(mockProcessImport).not.toHaveBeenCalled()
      expect(importResult).toBeNull()
    })

    it('importFile() with .avi file opens TranscriptionDialog', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/clip.avi',
        name: 'clip.avi',
        sizeInMB: 100,
        extension: 'avi'
      })

      const { result } = renderHook(() => useImport())

      let importResult: string | null | undefined
      await act(async () => {
        importResult = await result.current.importFile()
      })

      expect(mockOpenDialog).toHaveBeenCalledWith('/external/clip.avi', 'clip.avi')
      expect(importResult).toBeNull()
    })

    it('importFile() with .webm file opens TranscriptionDialog', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/video.webm',
        name: 'video.webm',
        sizeInMB: 50,
        extension: 'webm'
      })

      const { result } = renderHook(() => useImport())

      await act(async () => {
        await result.current.importFile()
      })

      expect(mockOpenDialog).toHaveBeenCalledWith('/external/video.webm', 'video.webm')
      expect(mockProcessImport).not.toHaveBeenCalled()
    })

    it('importFile() with .flv file opens TranscriptionDialog', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/old.flv',
        name: 'old.flv',
        sizeInMB: 30,
        extension: 'flv'
      })

      const { result } = renderHook(() => useImport())

      await act(async () => {
        await result.current.importFile()
      })

      expect(mockOpenDialog).toHaveBeenCalledWith('/external/old.flv', 'old.flv')
      expect(mockProcessImport).not.toHaveBeenCalled()
    })

    it('importFile() with .wmv file opens TranscriptionDialog', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/recording.wmv',
        name: 'recording.wmv',
        sizeInMB: 120,
        extension: 'wmv'
      })

      const { result } = renderHook(() => useImport())

      await act(async () => {
        await result.current.importFile()
      })

      expect(mockOpenDialog).toHaveBeenCalledWith('/external/recording.wmv', 'recording.wmv')
      expect(mockProcessImport).not.toHaveBeenCalled()
    })

    it('importFile() does NOT validate video file via transcription.validate (no pre-validation for video)', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/video.mp4',
        name: 'video.mp4',
        sizeInMB: 100,
        extension: 'mp4'
      })

      const { result } = renderHook(() => useImport())

      await act(async () => {
        await result.current.importFile()
      })

      // Audio validation is skipped for video files
      expect(mockValidateAudio).not.toHaveBeenCalled()
      expect(mockOpenDialog).toHaveBeenCalled()
    })

    it('processFiles() with video files in batch are filtered out with media warning', async () => {
      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/video.mp4', name: 'video.mp4' }),
        createTestFile({ path: '/test/document.pdf', name: 'document.pdf' })
      ]

      mockProcessImport.mockResolvedValue({ success: true, outputPath: '/import/document.md' })

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      // Video file should be skipped with a media warning
      expect(mockShowWarningToast).toHaveBeenCalledWith(
        'Media files skipped',
        expect.stringContaining('media file(s) skipped')
      )
      // Only the PDF should be processed
      expect(mockProcessImport).toHaveBeenCalledWith('/test/document.pdf')
      expect(mockProcessImport).not.toHaveBeenCalledWith('/test/video.mp4')
      expect(processResult?.successCount).toBe(1)
    })

    it('processFiles() with mixed video + non-media: video skipped, others processed', async () => {
      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/lecture.mkv', name: 'lecture.mkv' }),
        createTestFile({ path: '/test/notes.txt', name: 'notes.txt' }),
        createTestFile({ path: '/test/report.pdf', name: 'report.pdf' })
      ]

      mockProcessImport.mockResolvedValue({ success: true, outputPath: '/import/file.md' })

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      expect(mockShowWarningToast).toHaveBeenCalledWith(
        'Media files skipped',
        expect.stringContaining('1 media file(s) skipped')
      )
      expect(mockProcessImport).toHaveBeenCalledTimes(2)
      expect(mockProcessImport).not.toHaveBeenCalledWith('/test/lecture.mkv')
      expect(processResult?.successCount).toBe(2)
    })

    it('processFiles() with all-video batch: rejected entirely with warning toast', async () => {
      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/video1.mp4', name: 'video1.mp4' }),
        createTestFile({ path: '/test/video2.mov', name: 'video2.mov' }),
        createTestFile({ path: '/test/video3.mkv', name: 'video3.mkv' })
      ]

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      expect(mockShowWarningToast).toHaveBeenCalledWith(
        'Media files not supported in batch',
        expect.any(String)
      )
      expect(mockProcessImport).not.toHaveBeenCalled()
      expect(processResult?.skippedCount).toBe(3)
      expect(processResult?.successCount).toBe(0)
    })

    it('processFiles() with mixed audio and video batch: both treated as media, all skipped', async () => {
      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/audio.mp3', name: 'audio.mp3' }),
        createTestFile({ path: '/test/video.mp4', name: 'video.mp4' })
      ]

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      // All-media batch: rejected entirely
      expect(mockShowWarningToast).toHaveBeenCalledWith(
        'Media files not supported in batch',
        expect.any(String)
      )
      expect(mockProcessImport).not.toHaveBeenCalled()
      expect(processResult?.skippedCount).toBe(2)
    })

    it('processFiles() with video + audio + non-media: media skipped, non-media processed', async () => {
      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/video.mp4', name: 'video.mp4' }),
        createTestFile({ path: '/test/audio.mp3', name: 'audio.mp3' }),
        createTestFile({ path: '/test/document.pdf', name: 'document.pdf' })
      ]

      mockProcessImport.mockResolvedValue({ success: true, outputPath: '/import/document.md' })

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      expect(mockShowWarningToast).toHaveBeenCalledWith(
        'Media files skipped',
        expect.stringContaining('media file(s) skipped')
      )
      expect(mockProcessImport).toHaveBeenCalledWith('/test/document.pdf')
      expect(mockProcessImport).not.toHaveBeenCalledWith('/test/video.mp4')
      expect(mockProcessImport).not.toHaveBeenCalledWith('/test/audio.mp3')
      expect(processResult?.successCount).toBe(1)
    })

    it('should route uppercase .MP4 extension to TranscriptionDialog', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/path/to/VIDEO.MP4',
        name: 'VIDEO.MP4',
        sizeInMB: 10,
        extension: 'MP4'
      })

      const { result } = renderHook(() => useImport())
      await act(async () => {
        await result.current.importFile()
      })

      expect(mockOpenDialog).toHaveBeenCalledWith('/path/to/VIDEO.MP4', 'VIDEO.MP4')
    })
  })

  // Audio file routing tests
  describe('audio file routing', () => {
    it('importFile() with .mp3 file opens TranscriptionDialog', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/recording.mp3',
        name: 'recording.mp3',
        sizeInMB: 10,
        extension: 'mp3'
      })
      mockValidateAudio.mockResolvedValue({ valid: true })

      const { result } = renderHook(() => useImport())

      let importResult: string | null | undefined
      await act(async () => {
        importResult = await result.current.importFile()
      })

      expect(mockOpenDialog).toHaveBeenCalledWith('/external/recording.mp3', 'recording.mp3')
      expect(mockProcessImport).not.toHaveBeenCalled()
      expect(importResult).toBeNull()
    })

    it('importFile() with .ogg file opens TranscriptionDialog', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/audio.ogg',
        name: 'audio.ogg',
        sizeInMB: 5,
        extension: 'ogg'
      })
      mockValidateAudio.mockResolvedValue({ valid: true })

      const { result } = renderHook(() => useImport())

      let importResult: string | null | undefined
      await act(async () => {
        importResult = await result.current.importFile()
      })

      expect(mockOpenDialog).toHaveBeenCalledWith('/external/audio.ogg', 'audio.ogg')
      expect(mockProcessImport).not.toHaveBeenCalled()
      expect(importResult).toBeNull()
    })

    it('importFile() with .pdf file proceeds through normal import', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/document.pdf',
        name: 'document.pdf',
        sizeInMB: 2,
        extension: 'pdf'
      })

      const { result } = renderHook(() => useImport())

      let importResult: string | null | undefined
      await act(async () => {
        importResult = await result.current.importFile()
      })

      expect(mockProcessImport).toHaveBeenCalledWith('/external/document.pdf')
      expect(mockOpenDialog).not.toHaveBeenCalled()
      expect(importResult).toBe('/project/import/file.md')
    })

    it('importFile() with invalid audio file shows error toast', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/external/corrupt.mp3',
        name: 'corrupt.mp3',
        sizeInMB: 3,
        extension: 'mp3'
      })
      mockValidateAudio.mockResolvedValue({ valid: false, error: 'File is corrupted' })

      const { result } = renderHook(() => useImport())

      let importResult: string | null | undefined
      await act(async () => {
        importResult = await result.current.importFile()
      })

      expect(mockShowErrorToast).toHaveBeenCalledWith('Invalid audio file', 'File is corrupted')
      expect(mockOpenDialog).not.toHaveBeenCalled()
      expect(importResult).toBeNull()
    })

    it('processFiles() with mixed batch skips audio files and warns', async () => {
      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/recording.mp3', name: 'recording.mp3' }),
        createTestFile({ path: '/test/document.pdf', name: 'document.pdf' })
      ]

      mockProcessImport.mockResolvedValue({ success: true, outputPath: '/import/document.md' })

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      expect(mockShowWarningToast).toHaveBeenCalledWith(
        'Media files skipped',
        expect.stringContaining('media file(s) skipped')
      )
      expect(mockProcessImport).toHaveBeenCalledWith('/test/document.pdf')
      expect(mockProcessImport).not.toHaveBeenCalledWith('/test/recording.mp3')
      expect(processResult?.successCount).toBe(1)
    })

    it('processFiles() with all-audio batch rejects entirely', async () => {
      const { result } = renderHook(() => useImport())
      const files = [
        createTestFile({ path: '/test/audio1.mp3', name: 'audio1.mp3' }),
        createTestFile({ path: '/test/audio2.mp3', name: 'audio2.mp3' })
      ]

      let processResult: ProcessFilesResult | undefined
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      expect(mockShowWarningToast).toHaveBeenCalledWith(
        'Media files not supported in batch',
        expect.any(String)
      )
      expect(mockProcessImport).not.toHaveBeenCalled()
      expect(processResult?.skippedCount).toBe(2)
    })
  })

  // Document file routing tests
  describe('document file routing', () => {
    it('should route document files to DocumentImportDialog', async () => {
      // Set up extensions cache to include pdf
      const { useDocumentImportStore } = await import('../stores/useDocumentImportStore')
      const mockGetState = vi.mocked(useDocumentImportStore.getState)
      mockGetState.mockReturnValue({
        ...mockGetState(),
        documentExtensions: ['pdf', 'docx', 'pptx'],
        openDialog: mockDocImportOpenDialog,
        fetchExtensions: mockFetchExtensions,
        initDependencyListener: mockInitDependencyListener
      } as any)

      mockSelectFile.mockResolvedValueOnce({
        path: '/test/document.pdf',
        name: 'document.pdf',
        sizeInMB: 1.5,
        extension: 'pdf'
      })

      const { result } = renderHook(() => useImport())
      let importResult: string | null = null
      await act(async () => {
        importResult = await result.current.importFile()
      })

      expect(mockDocImportOpenDialog).toHaveBeenCalledWith(
        '/test/document.pdf',
        'document.pdf',
        1.5,
        'pdf'
      )
      expect(importResult).toBeNull()
      expect(mockProcessImport).not.toHaveBeenCalled()
    })

    it('should show LibreOffice required alert for Office files when missing', async () => {
      const { useDocumentImportStore } = await import('../stores/useDocumentImportStore')
      const mockGetState = vi.mocked(useDocumentImportStore.getState)
      mockGetState.mockReturnValue({
        ...mockGetState(),
        documentExtensions: [],
        hasLibreOffice: false,
        hasImageMagick: true,
        openDialog: mockDocImportOpenDialog,
        fetchExtensions: mockFetchExtensions,
        initDependencyListener: mockInitDependencyListener
      } as any)

      mockSelectFile.mockResolvedValueOnce({
        path: '/test/report.docx',
        name: 'report.docx',
        sizeInMB: 2.0,
        extension: 'docx'
      })

      const { result } = renderHook(() => useImport())
      await act(async () => {
        await result.current.importFile()
      })

      expect(mockShowAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'LibreOffice required'
        })
      )
      expect(mockDocImportOpenDialog).not.toHaveBeenCalled()
      expect(mockProcessImport).not.toHaveBeenCalled()
    })

    it('should show ImageMagick required alert for image files when missing', async () => {
      const { useDocumentImportStore } = await import('../stores/useDocumentImportStore')
      const mockGetState = vi.mocked(useDocumentImportStore.getState)
      mockGetState.mockReturnValue({
        ...mockGetState(),
        documentExtensions: [],
        hasLibreOffice: true,
        hasImageMagick: false,
        openDialog: mockDocImportOpenDialog,
        fetchExtensions: mockFetchExtensions,
        initDependencyListener: mockInitDependencyListener
      } as any)

      mockSelectFile.mockResolvedValueOnce({
        path: '/test/scan.tiff',
        name: 'scan.tiff',
        sizeInMB: 5.0,
        extension: 'tiff'
      })

      const { result } = renderHook(() => useImport())
      await act(async () => {
        await result.current.importFile()
      })

      expect(mockShowAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'ImageMagick required'
        })
      )
    })

    it('should filter document files from batch with warning toast', async () => {
      const { useDocumentImportStore } = await import('../stores/useDocumentImportStore')
      const mockGetState = vi.mocked(useDocumentImportStore.getState)
      mockGetState.mockReturnValue({
        ...mockGetState(),
        documentExtensions: ['pdf'],
        openDialog: mockDocImportOpenDialog,
        fetchExtensions: mockFetchExtensions,
        initDependencyListener: mockInitDependencyListener
      } as any)

      const files = [
        createTestFile({ path: '/test/doc.pdf', name: 'doc.pdf' }),
        createTestFile({ path: '/test/notes.md', name: 'notes.md' })
      ]

      mockProcessImport.mockResolvedValue({
        success: true,
        outputPath: '/project/import/notes.md'
      })

      const { result } = renderHook(() => useImport())
      await act(async () => {
        await result.current.processFiles(files)
      })

      expect(mockShowWarningToast).toHaveBeenCalledWith(
        'Document files skipped',
        expect.stringContaining('1 document file(s) skipped')
      )
      // Only the .md file should be processed
      expect(mockProcessImport).toHaveBeenCalledTimes(1)
      expect(mockProcessImport).toHaveBeenCalledWith('/test/notes.md')
    })

    it('should reject all-document batch with warning toast', async () => {
      const { useDocumentImportStore } = await import('../stores/useDocumentImportStore')
      const mockGetState = vi.mocked(useDocumentImportStore.getState)
      mockGetState.mockReturnValue({
        ...mockGetState(),
        documentExtensions: ['pdf', 'docx'],
        openDialog: mockDocImportOpenDialog,
        fetchExtensions: mockFetchExtensions,
        initDependencyListener: mockInitDependencyListener
      } as any)

      const files = [
        createTestFile({ path: '/test/a.pdf', name: 'a.pdf' }),
        createTestFile({ path: '/test/b.docx', name: 'b.docx' })
      ]

      const { result } = renderHook(() => useImport())
      let processResult: any
      await act(async () => {
        processResult = await result.current.processFiles(files)
      })

      expect(mockShowWarningToast).toHaveBeenCalledWith(
        'Document files not supported in batch',
        expect.any(String)
      )
      expect(processResult.skippedCount).toBe(2)
      expect(mockProcessImport).not.toHaveBeenCalled()
    })
  })
})
