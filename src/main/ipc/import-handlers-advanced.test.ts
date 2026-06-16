// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Document Import IPC Handlers – advanced scenarios
 *
 * Covers screenshot copy, cancellation race, edge cases,
 * documentCancel handler, and getDocumentExtensions handler.
 *
 * @see Issue #133 - LiteParse IPC handlers, Zod schemas, and preload bridge
 * @see Spec #021 - LiteParse document import
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import {
  TEST_DOC_PATH,
  TEST_IMPORT_DIR,
  mockGetConverter,
  mockGetExtensionsByConversionType,
  mockGetSupportedExtensions,
  mockGetProjectPath,
  mockLogger,
  mockWriteFile,
  mockMkdir,
  mockRm,
  mockCp,
  mockChangeExtension,
  mockSanitizeFileName,
  mockFindAvailableFileName,
  mockIsConfigurableConverter,
  getHandler,
  createMockEvent,
  resetMocks
} from './__test-helpers__/import-handlers-mocks'

const TEST_SCREENSHOT_DIR = path.join(os.tmpdir(), 'erfana-test', 'screenshots')
const TEST_DOC_MD = path.join(TEST_IMPORT_DIR, 'doc.md')

// =============================================================================
// Mock electron
// =============================================================================

const mockIpcMainHandle = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle
  },
  dialog: {
    showOpenDialog: vi.fn()
  }
}))

// =============================================================================
// Mock services
// =============================================================================

vi.mock('../services/import', () => ({
  converterRegistry: {
    getConverter: mockGetConverter,
    getExtensionsByConversionType: mockGetExtensionsByConversionType,
    getSupportedExtensions: mockGetSupportedExtensions
  },
  importService: {
    validate: vi.fn(),
    importFile: vi.fn(),
    getSupportedExtensions: mockGetSupportedExtensions,
    isSupported: vi.fn()
  }
}))

vi.mock('../services/FileService', () => ({
  fileService: {
    getProjectPath: mockGetProjectPath
  }
}))

// =============================================================================
// Mock LoggingService
// =============================================================================

vi.mock('../services/LoggingService', () => ({
  logger: mockLogger
}))

// =============================================================================
// Mock fs/promises
// =============================================================================

vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  rm: mockRm,
  cp: mockCp,
  stat: vi.fn()
}))

// =============================================================================
// Mock fileUtils
// =============================================================================

vi.mock('../utils/fileUtils', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    changeExtension: mockChangeExtension,
    sanitizeFileName: mockSanitizeFileName,
    findAvailableFileName: mockFindAvailableFileName
  }
})

// =============================================================================
// Mock shared modules
// =============================================================================

vi.mock('../../shared/errors', () => {
  class MockAppError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
      this.name = 'AppError'
    }
  }
  return {
    ErrorCode: {
      PATH_TRAVERSAL: 'PATH_TRAVERSAL',
      IMPORT_CONVERSION_FAILED: 'IMPORT_CONVERSION_FAILED',
      IMPORT_UNSUPPORTED_TYPE: 'IMPORT_UNSUPPORTED_TYPE',
      IMPORT_BUSY: 'IMPORT_BUSY',
      PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND'
    },
    AppError: MockAppError,
    getUserFriendlyMessage: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : 'An unexpected error occurred'
    )
  }
})

vi.mock('../../shared/constants', () => ({
  IMPORT: { DIR_NAME: 'import' },
  VIDEO_IMPORT: { SUPPORTED_EXTENSIONS: ['mp4', 'mov'] }
}))

// =============================================================================
// Mock isConfigurableConverter
// =============================================================================

vi.mock('../services/import/types', () => ({
  isConfigurableConverter: mockIsConfigurableConverter
}))

// =============================================================================
// Local helpers (delegate to imported helpers with bound mockIpcMainHandle)
// =============================================================================

function h(channel: string) {
  return getHandler(mockIpcMainHandle, channel)
}

// =============================================================================
// Tests
// =============================================================================

describe('registerDocumentImportHandlers – advanced', () => {
  beforeEach(() => {
    resetMocks()
  })

  // ===========================================================================
  // import:document – screenshot copy
  // ===========================================================================

  describe('import:document – screenshot copy', () => {
    it('copies screenshotDir to import/screenshots/ when present', async () => {
      const mockConverter = {
        convert: vi.fn().mockResolvedValue({
          success: true,
          content: '# test',
          screenshotDir: TEST_SCREENSHOT_DIR
        })
      }
      mockGetConverter.mockReturnValue(mockConverter)
      mockFindAvailableFileName.mockResolvedValue(TEST_DOC_MD)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), { filePath: TEST_DOC_PATH })) as {
        success: boolean
      }

      expect(result.success).toBe(true)
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('screenshots'),
        { recursive: true }
      )
      expect(mockCp).toHaveBeenCalledWith(
        TEST_SCREENSHOT_DIR,
        expect.stringContaining('screenshots'),
        { recursive: true }
      )
    })

    it('logs warning and still returns success when screenshot copy fails', async () => {
      const mockConverter = {
        convert: vi.fn().mockResolvedValue({
          success: true,
          content: '# test',
          screenshotDir: TEST_SCREENSHOT_DIR
        })
      }
      mockGetConverter.mockReturnValue(mockConverter)
      mockCp.mockRejectedValue(new Error('ENOSPC: no space left on device'))

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), { filePath: TEST_DOC_PATH })) as {
        success: boolean
      }

      expect(result.success).toBe(true)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to copy screenshots',
        expect.objectContaining({ error: expect.any(String) })
      )
    })

    it('cleans up temp screenshotDir after successful copy', async () => {
      const mockConverter = {
        convert: vi.fn().mockResolvedValue({
          success: true,
          content: '# test',
          screenshotDir: TEST_SCREENSHOT_DIR
        })
      }
      mockGetConverter.mockReturnValue(mockConverter)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      await handler!(createMockEvent(), { filePath: TEST_DOC_PATH })

      // rm is called via .catch() so we need to wait a tick for it to settle
      await Promise.resolve()

      expect(mockRm).toHaveBeenCalledWith(TEST_SCREENSHOT_DIR, { recursive: true, force: true })
    })

    it('cleans up temp screenshotDir even when copy fails', async () => {
      const mockConverter = {
        convert: vi.fn().mockResolvedValue({
          success: true,
          content: '# test',
          screenshotDir: TEST_SCREENSHOT_DIR
        })
      }
      mockGetConverter.mockReturnValue(mockConverter)
      mockCp.mockRejectedValue(new Error('copy error'))

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      await handler!(createMockEvent(), { filePath: TEST_DOC_PATH })

      await Promise.resolve()

      expect(mockRm).toHaveBeenCalledWith(TEST_SCREENSHOT_DIR, { recursive: true, force: true })
    })
  })

  // ===========================================================================
  // import:document – cancellation race
  // ===========================================================================

  describe('import:document – cancellation race', () => {
    it('detects abort via local controller even after cancel nulls module-level var', async () => {
      let resolveTrigger: (value: unknown) => void
      const controlledPromise = new Promise((resolve) => {
        resolveTrigger = resolve
      })
      const mockConverter = { convert: vi.fn(() => controlledPromise) }
      mockGetConverter.mockReturnValue(mockConverter)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const importHandler = h('import:document')
      const cancelHandler = h('import:documentCancel')
      const mockEvent = createMockEvent()

      // Start import (don't await)
      const importPromise = importHandler!(mockEvent, { filePath: TEST_DOC_PATH })

      // Allow event loop to tick so the handler sets activeDocumentController
      await Promise.resolve()

      // Cancel – nulls the module-level activeDocumentController
      await cancelHandler!()

      // Resolve the converter with a success result
      resolveTrigger!({ success: true, content: '# content' })

      const result = (await importPromise) as { success: boolean; error?: string }

      // The local controller was aborted, so import must return cancelled
      expect(result.success).toBe(false)
      expect(result.error).toContain('cancelled')
      expect(mockWriteFile).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // import:document – edge cases
  // ===========================================================================

  describe('import:document – edge cases', () => {
    it('does not send progress when webContents is destroyed', async () => {
      const mockConverter = {
        convert: vi.fn().mockResolvedValue({ success: true, content: '# Content' })
      }
      mockGetConverter.mockReturnValue(mockConverter)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const mockEvent = createMockEvent({ isDestroyed: () => true })
      await handler!(mockEvent, { filePath: TEST_DOC_PATH })

      const sender = (mockEvent as { sender: { send: ReturnType<typeof vi.fn> } }).sender
      expect(sender.send).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // import:documentCancel
  // ===========================================================================

  describe('import:documentCancel', () => {
    it('returns error when no active import exists', async () => {
      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:documentCancel')
      const result = (await handler!()) as { success: boolean; error?: string }

      expect(result.success).toBe(false)
      expect(result.error).toContain('No active document import')
    })

    it('returns success when an active import is cancelled', async () => {
      let resolveTrigger: (value: unknown) => void
      const controlledPromise = new Promise((resolve) => {
        resolveTrigger = resolve
      })
      const mockConverter = { convert: vi.fn(() => controlledPromise) }
      mockGetConverter.mockReturnValue(mockConverter)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const importHandler = h('import:document')
      const cancelHandler = h('import:documentCancel')
      const mockEvent = createMockEvent()

      // Start import (don't await)
      const importPromise = importHandler!(mockEvent, { filePath: TEST_DOC_PATH })

      // Allow event loop to tick so the handler sets activeDocumentController
      await Promise.resolve()

      const cancelResult = (await cancelHandler!()) as { success: boolean; error?: string }

      expect(cancelResult.success).toBe(true)
      expect(cancelResult.error).toBeUndefined()

      // Resolve the converter to unblock the import handler
      resolveTrigger!({ success: false, error: 'cancelled by test cleanup' })
      await importPromise
    })
  })

  // ===========================================================================
  // import:getDocumentExtensions
  // ===========================================================================

  describe('import:getDocumentExtensions', () => {
    it('returns the requiresConversion extensions from registry', async () => {
      mockGetExtensionsByConversionType.mockReturnValue({
        requiresConversion: ['pdf', 'docx', 'xlsx'],
        passthrough: ['txt', 'md']
      })

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:getDocumentExtensions')
      const result = await handler!()

      expect(result).toEqual(['pdf', 'docx', 'xlsx'])
    })

    it('returns empty array when no document converters are registered', async () => {
      mockGetExtensionsByConversionType.mockReturnValue({
        requiresConversion: [],
        passthrough: ['txt']
      })

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:getDocumentExtensions')
      const result = await handler!()

      expect(result).toEqual([])
    })
  })
})
