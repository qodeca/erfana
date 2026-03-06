/**
 * Tests for Transcription IPC Handlers
 *
 * Tests IPC handler registration and request/response handling
 * for transcription import, cancel, validate, and API key management.
 *
 * @see Issue #75 - Media import with transcription
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// =============================================================================
// Mock electron
// =============================================================================

const mockIpcMainHandle = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))

// =============================================================================
// Mock services
// =============================================================================

const mockTranscribe = vi.fn()

vi.mock('../services/TranscriptionService', () => ({
  transcriptionService: {
    transcribe: mockTranscribe
  }
}))

const mockValidate = vi.fn()

vi.mock('../services/AudioMetadataService', () => ({
  audioMetadataService: {
    validate: mockValidate,
    getDuration: vi.fn().mockResolvedValue(60)
  }
}))

const mockApiKeyGetKey = vi.fn()
const mockApiKeyStoreKey = vi.fn()
const mockApiKeyClearKey = vi.fn()

vi.mock('../services/ApiKeyService', () => ({
  apiKeyService: {
    getKey: mockApiKeyGetKey,
    storeKey: mockApiKeyStoreKey,
    clearKey: mockApiKeyClearKey
  }
}))

const mockGetSetting = vi.fn()
const mockSetSetting = vi.fn()

vi.mock('../services/GlobalSettingsService', () => ({
  globalSettingsService: {
    getSetting: mockGetSetting,
    setSetting: mockSetSetting
  }
}))

const mockGetProjectPath = vi.fn()

vi.mock('../services/FileService', () => ({
  fileService: {
    getProjectPath: mockGetProjectPath
  }
}))

// =============================================================================
// Mock utilities
// =============================================================================

const mockWriteFile = vi.fn()
const mockMkdir = vi.fn()

vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir
}))

const mockChangeExtension = vi.fn((name: string) => name.replace(/\.[^.]+$/, '.md'))
const mockSanitizeFileName = vi.fn((name: string) => name)
const mockFindAvailableFileName = vi.fn((_dir: string, name: string) =>
  `/project/import/${name}`
)

vi.mock('../utils/fileUtils', () => ({
  changeExtension: mockChangeExtension,
  sanitizeFileName: mockSanitizeFileName,
  findAvailableFileName: mockFindAvailableFileName
}))

// =============================================================================
// Mock LoggingService
// =============================================================================

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}

vi.mock('../services/LoggingService', () => ({
  logger: mockLogger
}))

// =============================================================================
// Mock shared modules
// =============================================================================

vi.mock('../../shared/errors', () => ({
  ErrorCode: {
    TRANSCRIPTION_NO_API_KEY: 'TRANSCRIPTION_NO_API_KEY',
    TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
    TRANSCRIPTION_CANCELLED: 'TRANSCRIPTION_CANCELLED'
  }
}))

vi.mock('../../shared/constants', () => ({
  IMPORT: { DIR_NAME: 'import' }
}))

// =============================================================================
// Helper to get a registered handler
// =============================================================================

function getHandler(channel: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = mockIpcMainHandle.mock.calls.find((c) => c[0] === channel)
  return call?.[1] as ((...args: unknown[]) => Promise<unknown>) | undefined
}

// =============================================================================
// Tests
// =============================================================================

describe('transcription-handlers', () => {
  const mockEvent = {
    sender: {
      isDestroyed: () => false,
      send: vi.fn()
    }
  } as unknown as IpcMainInvokeEvent

  beforeEach(async () => {
    vi.clearAllMocks()
    mockApiKeyGetKey.mockResolvedValue('sk-test-key')
    mockApiKeyStoreKey.mockResolvedValue(undefined)
    mockApiKeyClearKey.mockResolvedValue(undefined)
    mockGetProjectPath.mockReturnValue('/project')
    mockGetSetting.mockReturnValue({ backend: 'openai', openaiApiKeyStored: false })
    mockSetSetting.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)

    mockTranscribe.mockResolvedValue({
      success: true,
      transcript: 'Test transcription.',
      duration: 60,
      language: 'en'
    })

    mockValidate.mockResolvedValue({
      valid: true,
      durationSeconds: 60,
      sizeInMB: 5
    })
  })

  // ===========================================================================
  // Handler registration
  // ===========================================================================

  describe('handler registration', () => {
    it('should register all transcription handlers', async () => {
      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const channels = mockIpcMainHandle.mock.calls.map((c) => c[0])

      expect(channels).toContain('transcription:import')
      expect(channels).toContain('transcription:cancel')
      expect(channels).toContain('transcription:validate')
      expect(channels).toContain('transcription:setApiKey')
      expect(channels).toContain('transcription:hasApiKey')
      expect(channels).toContain('transcription:clearApiKey')
    })
  })

  // ===========================================================================
  // transcription:import
  // ===========================================================================

  describe('transcription:import', () => {
    it('should transcribe and write markdown file', async () => {
      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:import')
      expect(handler).toBeDefined()

      const request = { filePath: '/path/to/audio.mp3', language: 'en' }
      const result = await handler!(mockEvent, request) as { success: boolean; outputPath?: string }

      expect(result.success).toBe(true)
      expect(result.outputPath).toBeDefined()
      expect(mockTranscribe).toHaveBeenCalled()
      expect(mockWriteFile).toHaveBeenCalled()
    })

    it('should return error for invalid request', async () => {
      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:import')
      const result = await handler!(mockEvent, { filePath: '' }) as { success: boolean; error?: string }

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid request')
    })

    it('should return error when no API key', async () => {
      mockApiKeyGetKey.mockResolvedValue(null)

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:import')
      const request = { filePath: '/path/to/audio.mp3', language: 'en' }
      const result = await handler!(mockEvent, request) as { success: boolean; errorCode?: string }

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_NO_API_KEY')
    })

    it('should return error when no project open', async () => {
      mockGetProjectPath.mockReturnValue(null)

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:import')
      const request = { filePath: '/path/to/audio.mp3', language: 'en' }
      const result = await handler!(mockEvent, request) as { success: boolean; error?: string }

      expect(result.success).toBe(false)
      expect(result.error).toContain('No project')
    })

    it('should stream progress to renderer', async () => {
      // Mock transcribe to capture the progress callback and call it
      mockTranscribe.mockImplementation(
        async (_fp: string, _lang: string, onProgress: (p: { percent: number; phase: string }) => void) => {
          onProgress({ percent: 50, phase: 'Processing' })
          return {
            success: true,
            transcript: 'Test.',
            duration: 30,
            language: 'en'
          }
        }
      )

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:import')
      const request = { filePath: '/path/to/audio.mp3', language: 'en' }
      await handler!(mockEvent, request)

      const sender = (mockEvent as { sender: { send: ReturnType<typeof vi.fn> } }).sender
      expect(sender.send).toHaveBeenCalledWith(
        'transcription:progress',
        expect.objectContaining({ percent: 50, phase: 'Processing' })
      )
    })
  })

  // ===========================================================================
  // transcription:cancel
  // ===========================================================================

  describe('transcription:cancel', () => {
    it('should return error when no active transcription', async () => {
      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:cancel')
      const result = await handler!() as { success: boolean; error?: string }

      expect(result.success).toBe(false)
      expect(result.error).toContain('No active transcription')
    })
  })

  // ===========================================================================
  // transcription:validate
  // ===========================================================================

  describe('transcription:validate', () => {
    it('should validate audio file', async () => {
      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:validate')
      const result = await handler!(mockEvent, '/path/to/audio.mp3') as { valid: boolean; durationSeconds?: number }

      expect(result.valid).toBe(true)
      expect(result.durationSeconds).toBe(60)
    })

    it('should return error for invalid file path', async () => {
      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:validate')
      const result = await handler!(mockEvent, '') as { valid: boolean; error?: string }

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid file path')
    })

    it('should handle validation failures', async () => {
      mockValidate.mockResolvedValue({
        valid: false,
        error: 'Invalid audio',
        sizeInMB: 0
      })

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:validate')
      const result = await handler!(mockEvent, '/path/to/bad.txt') as { valid: boolean; error?: string }

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid audio')
    })
  })

  // ===========================================================================
  // transcription:setApiKey
  // ===========================================================================

  describe('transcription:setApiKey', () => {
    it('should store API key and update settings', async () => {
      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:setApiKey')
      const result = await handler!(mockEvent, 'sk-new-key') as { success: boolean }

      expect(result.success).toBe(true)
      expect(mockApiKeyStoreKey).toHaveBeenCalledWith('openai', 'sk-new-key')
      expect(mockSetSetting).toHaveBeenCalledWith(
        'transcription',
        expect.objectContaining({ openaiApiKeyStored: true })
      )
    })

    it('should reject empty API key', async () => {
      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:setApiKey')
      const result = await handler!(mockEvent, '') as { success: boolean; error?: string }

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid API key')
      expect(mockApiKeyStoreKey).not.toHaveBeenCalled()
    })

    it('should trim API key whitespace', async () => {
      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:setApiKey')
      await handler!(mockEvent, '  sk-trimmed  ')

      expect(mockApiKeyStoreKey).toHaveBeenCalledWith('openai', 'sk-trimmed')
    })
  })

  // ===========================================================================
  // transcription:hasApiKey
  // ===========================================================================

  describe('transcription:hasApiKey', () => {
    it('should return true when key exists', async () => {
      mockApiKeyGetKey.mockResolvedValue('sk-key')

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:hasApiKey')
      const result = await handler!()

      expect(result).toBe(true)
    })

    it('should return false when key does not exist', async () => {
      mockApiKeyGetKey.mockResolvedValue(null)

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:hasApiKey')
      const result = await handler!()

      expect(result).toBe(false)
    })
  })

  // ===========================================================================
  // transcription:clearApiKey
  // ===========================================================================

  describe('transcription:clearApiKey', () => {
    it('should clear API key and update settings', async () => {
      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:clearApiKey')
      const result = await handler!() as { success: boolean }

      expect(result.success).toBe(true)
      expect(mockApiKeyClearKey).toHaveBeenCalledWith('openai')
      expect(mockSetSetting).toHaveBeenCalledWith(
        'transcription',
        expect.objectContaining({ openaiApiKeyStored: false })
      )
    })

    it('should handle clear failure', async () => {
      mockApiKeyClearKey.mockRejectedValue(new Error('Permission denied'))

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:clearApiKey')
      const result = await handler!() as { success: boolean; error?: string }

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to clear API key')
    })
  })
})
