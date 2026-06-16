// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Document Import IPC Handlers (registerDocumentImportHandlers)
 *
 * Tests IPC handler registration and request/response handling
 * for document import via LiteParse: import, cancel, and extensions.
 *
 * @see Issue #133 - LiteParse IPC handlers, Zod schemas, and preload bridge
 * @see Spec #021 - LiteParse document import
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'
import {
  TEST_IMPORT_DIR,
  TEST_DOC_PATH,
  TEST_DOC_OTHER_PATH,
  TEST_DOC_XYZ_PATH,
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

// Mock electron
const mockIpcMainHandle = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle
  },
  dialog: {
    showOpenDialog: vi.fn()
  }
}))

// Mock services
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

// Mock LoggingService
vi.mock('../services/LoggingService', () => ({
  logger: mockLogger
}))

// Mock fs/promises
vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  rm: mockRm,
  cp: mockCp,
  stat: vi.fn()
}))

// Mock fileUtils
vi.mock('../utils/fileUtils', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    changeExtension: mockChangeExtension,
    sanitizeFileName: mockSanitizeFileName,
    findAvailableFileName: mockFindAvailableFileName
  }
})

// Mock shared modules
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

// Mock isConfigurableConverter
vi.mock('../services/import/types', () => ({
  isConfigurableConverter: mockIsConfigurableConverter
}))

// Local helpers
function h(channel: string) {
  return getHandler(mockIpcMainHandle, channel)
}

// Tests
describe('registerDocumentImportHandlers', () => {
  beforeEach(() => {
    resetMocks()
  })

  describe('handler registration', () => {
    it('registers import:document handler', async () => {
      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const channels = mockIpcMainHandle.mock.calls.map((c) => c[0])
      expect(channels).toContain('import:document')
    })

    it('registers import:documentCancel handler', async () => {
      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const channels = mockIpcMainHandle.mock.calls.map((c) => c[0])
      expect(channels).toContain('import:documentCancel')
    })

    it('registers import:getDocumentExtensions handler', async () => {
      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const channels = mockIpcMainHandle.mock.calls.map((c) => c[0])
      expect(channels).toContain('import:getDocumentExtensions')
    })
  })

  describe('import:document – schema validation', () => {
    it('returns error for invalid request (missing filePath)', async () => {
      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), {})) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid import request')
    })

    it('returns error for empty filePath', async () => {
      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), { filePath: '' })) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid import request')
    })

    it('returns error for non-absolute file path', async () => {
      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), {
        filePath: 'relative/path/doc.pdf'
      })) as {
        success: boolean
        error?: string
        errorCode?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid file path')
      expect(result.errorCode).toBe('PATH_TRAVERSAL')
    })

    it('rejects absolute path with traversal segments', async () => {
      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), {
        filePath: '/project/../etc/passwd'
      })) as {
        success: boolean
        error?: string
        errorCode?: string
      }

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('PATH_TRAVERSAL')
    })
  })

  describe('import:document – concurrency guard', () => {
    it('rejects concurrent imports', async () => {
      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const mockEvent = createMockEvent()

      let resolveTrigger: (value: unknown) => void
      const controlledPromise = new Promise((resolve) => {
        resolveTrigger = resolve
      })
      const mockConverter = { convert: vi.fn(() => controlledPromise) }
      mockGetConverter.mockReturnValue(mockConverter)

      // Start first import (intentionally not awaited)
      const firstImportPromise = handler!(mockEvent, { filePath: TEST_DOC_PATH })

      // Allow event loop to tick so the first handler sets activeDocumentController
      await Promise.resolve()

      // Second import should be rejected immediately
      const secondResult = (await handler!(mockEvent, { filePath: TEST_DOC_OTHER_PATH })) as {
        success: boolean
        error?: string
        errorCode?: string
      }

      expect(secondResult.success).toBe(false)
      expect(secondResult.error).toContain('already in progress')
      expect(secondResult.errorCode).toBe('IMPORT_BUSY')

      // Resolve the first converter to unblock cleanup
      resolveTrigger!({ success: false, error: 'test cleanup' })
      await firstImportPromise
    })
  })

  describe('import:document – project check', () => {
    it('returns error when no project is open', async () => {
      mockGetProjectPath.mockReturnValue(null)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), { filePath: TEST_DOC_PATH })) as {
        success: boolean
        error?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toContain('No project')
    })
  })

  describe('import:document – unsupported type', () => {
    it('returns error when no converter is found for the extension', async () => {
      mockGetConverter.mockReturnValue(null)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), { filePath: TEST_DOC_XYZ_PATH })) as {
        success: boolean
        error?: string
        errorCode?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.errorCode).toBe('IMPORT_UNSUPPORTED_TYPE')
    })
  })

  describe('import:document – successful import', () => {
    it('returns success with outputPath when conversion succeeds', async () => {
      const mockConverter = {
        convert: vi.fn().mockResolvedValue({
          success: true,
          content: '# Document\n\nConverted content.'
        })
      }
      mockGetConverter.mockReturnValue(mockConverter)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), { filePath: TEST_DOC_PATH })) as {
        success: boolean
        outputPath?: string
      }

      expect(result.success).toBe(true)
      expect(result.outputPath).toBeDefined()
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining(TEST_IMPORT_DIR + path.sep),
        '# Document\n\nConverted content.',
        'utf-8'
      )
    })

    it('creates the import directory with recursive option', async () => {
      const mockConverter = {
        convert: vi.fn().mockResolvedValue({ success: true, content: '# Content' })
      }
      mockGetConverter.mockReturnValue(mockConverter)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      await handler!(createMockEvent(), { filePath: TEST_DOC_PATH })

      expect(mockMkdir).toHaveBeenCalledWith(TEST_IMPORT_DIR, { recursive: true })
    })

    it('streams progress events to renderer', async () => {
      const mockConverter = {
        convert: vi.fn().mockResolvedValue({ success: true, content: '# Content' })
      }
      mockGetConverter.mockReturnValue(mockConverter)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const mockEvent = createMockEvent()
      await handler!(mockEvent, { filePath: TEST_DOC_PATH })

      const sender = (mockEvent as { sender: { send: ReturnType<typeof vi.fn> } }).sender
      expect(sender.send).toHaveBeenCalledWith(
        'import:documentProgress',
        expect.objectContaining({ percent: 0 })
      )
      expect(sender.send).toHaveBeenCalledWith(
        'import:documentProgress',
        expect.objectContaining({ percent: 100, phase: 'Complete' })
      )
    })
  })

  describe('import:document – failed conversion', () => {
    it('returns error when converter returns failure', async () => {
      const mockConverter = {
        convert: vi.fn().mockResolvedValue({
          success: false,
          error: 'PDF is encrypted',
          errorCode: 'IMPORT_ENCRYPTED'
        })
      }
      mockGetConverter.mockReturnValue(mockConverter)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), { filePath: TEST_DOC_PATH })) as {
        success: boolean
        error?: string
        errorCode?: string
      }

      expect(result.success).toBe(false)
      expect(result.error).toBe('PDF is encrypted')
      expect(result.errorCode).toBe('IMPORT_ENCRYPTED')
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('uses IMPORT_CONVERSION_FAILED as fallback errorCode when converter omits it', async () => {
      const mockConverter = {
        convert: vi.fn().mockResolvedValue({ success: false })
      }
      mockGetConverter.mockReturnValue(mockConverter)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), { filePath: TEST_DOC_PATH })) as {
        success: boolean
        errorCode?: string
      }

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('IMPORT_CONVERSION_FAILED')
    })

    it('returns IMPORT_CONVERSION_FAILED when converter.convert() throws', async () => {
      const mockConverter = {
        convert: vi.fn().mockRejectedValue(new Error('boom'))
      }
      mockGetConverter.mockReturnValue(mockConverter)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), { filePath: TEST_DOC_PATH })) as {
        success: boolean
        errorCode?: string
      }

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('IMPORT_CONVERSION_FAILED')
    })
  })

  describe('import:document – configurable converter', () => {
    it('calls createConfigured when converter supports options', async () => {
      const configuredConverter = {
        convert: vi.fn().mockResolvedValue({
          success: true,
          content: '# Configured output'
        })
      }
      const mockConverter = {
        createConfigured: vi.fn().mockReturnValue(configuredConverter)
      }
      mockGetConverter.mockReturnValue(mockConverter)
      mockIsConfigurableConverter.mockReturnValue(true)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      const result = (await handler!(createMockEvent(), {
        filePath: TEST_DOC_PATH,
        options: { ocr: true, dpi: 300 }
      })) as { success: boolean }

      expect(result.success).toBe(true)
      expect(mockConverter.createConfigured).toHaveBeenCalledWith({ ocr: true, dpi: 300 })
      expect(configuredConverter.convert).toHaveBeenCalledWith(TEST_DOC_PATH)
    })

    it('uses base converter when no options provided', async () => {
      const mockConverter = {
        convert: vi.fn().mockResolvedValue({ success: true, content: '# Output' }),
        createConfigured: vi.fn()
      }
      mockGetConverter.mockReturnValue(mockConverter)
      mockIsConfigurableConverter.mockReturnValue(false)

      const { registerDocumentImportHandlers } = await import('./import-handlers')
      registerDocumentImportHandlers()

      const handler = h('import:document')
      await handler!(createMockEvent(), { filePath: TEST_DOC_PATH })

      expect(mockConverter.createConfigured).not.toHaveBeenCalled()
      expect(mockConverter.convert).toHaveBeenCalledWith(TEST_DOC_PATH)
    })
  })

})
