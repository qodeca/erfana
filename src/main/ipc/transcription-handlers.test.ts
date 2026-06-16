// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Transcription IPC Handlers
 *
 * Tests IPC handler registration and request/response handling
 * for transcription import, cancel, validate, and API key management.
 *
 * @see Issue #75 - Media import with transcription
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import type { IpcMainInvokeEvent } from 'electron'

// Platform-safe absolute paths (see #157)
const TEST_PROJECT = path.join(os.tmpdir(), 'erfana-test', 'project')
const TEST_AUDIO = path.join(os.tmpdir(), 'erfana-test', 'path', 'to', 'audio.mp3')
const TEST_BAD_FILE = path.join(os.tmpdir(), 'erfana-test', 'path', 'to', 'bad.txt')
const TEST_RECORDING = path.join(os.tmpdir(), 'erfana-test', 'path', 'to', 'recording.mp3')

// =============================================================================
// Mock electron
// =============================================================================

const mockIpcMainHandle = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'mock-userData')
  },
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

const mockLocalWhisperTranscribe = vi.fn()

vi.mock('../services/LocalWhisperService', () => ({
  localWhisperService: {
    transcribe: mockLocalWhisperTranscribe
  }
}))

vi.mock('../services/WhisperModelManager', () => ({
  whisperModelManager: {
    ensureBinary: vi.fn(),
    ensureModel: vi.fn(),
    listInstalledModels: vi.fn().mockResolvedValue([]),
    getModelInfo: vi.fn(() => ({ size: 0, installed: false })),
    deleteModel: vi.fn()
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
  path.join(os.tmpdir(), 'erfana-test', 'project', 'import', name)
)

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
    mockGetProjectPath.mockReturnValue(TEST_PROJECT)
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
      expect(channels).toContain('transcription:whisperEnsureBinary')
      expect(channels).toContain('transcription:whisperEnsureModel')
      expect(channels).toContain('transcription:whisperListModels')
      expect(channels).toContain('transcription:whisperDeleteModel')
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

      const request = { filePath: TEST_AUDIO, language: 'en' }
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
      const request = { filePath: TEST_AUDIO, language: 'en' }
      const result = await handler!(mockEvent, request) as { success: boolean; errorCode?: string }

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_NO_API_KEY')
    })

    it('should return error when no project open', async () => {
      mockGetProjectPath.mockReturnValue(null)

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:import')
      const request = { filePath: TEST_AUDIO, language: 'en' }
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
      const request = { filePath: TEST_AUDIO, language: 'en' }
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
      const result = await handler!(mockEvent, TEST_AUDIO) as { valid: boolean; durationSeconds?: number }

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
      const result = await handler!(mockEvent, TEST_BAD_FILE) as { valid: boolean; error?: string }

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

  // ===========================================================================
  // transcription:whisperEnsureBinary
  // ===========================================================================

  describe('transcription:whisperEnsureBinary', () => {
    it('should return success with path when ensureBinary succeeds', async () => {
      const { whisperModelManager } = await import('../services/WhisperModelManager')
      vi.mocked(whisperModelManager.ensureBinary).mockResolvedValue('/usr/local/bin/whisper')

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:whisperEnsureBinary')
      expect(handler).toBeDefined()

      const result = await handler!(mockEvent) as { success: boolean; path?: string; error?: string }

      expect(result.success).toBe(true)
      expect(result.path).toBe('/usr/local/bin/whisper')
      expect(whisperModelManager.ensureBinary).toHaveBeenCalledWith(
        expect.objectContaining({ onProgress: expect.any(Function) })
      )
    })

    it('should return failure when ensureBinary throws', async () => {
      const { whisperModelManager } = await import('../services/WhisperModelManager')
      vi.mocked(whisperModelManager.ensureBinary).mockRejectedValue(new Error('Download failed'))

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:whisperEnsureBinary')
      const result = await handler!(mockEvent) as { success: boolean; path?: string; error?: string }

      expect(result.success).toBe(false)
      expect(result.error).toBe('Download failed')
      expect(result.path).toBeUndefined()
    })

    it('should stream download progress to renderer', async () => {
      const { whisperModelManager } = await import('../services/WhisperModelManager')
      vi.mocked(whisperModelManager.ensureBinary).mockImplementation(async ({ onProgress }) => {
        onProgress?.({ percent: 42, phase: 'Downloading' })
        return '/usr/local/bin/whisper'
      })

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:whisperEnsureBinary')
      await handler!(mockEvent)

      const sender = (mockEvent as { sender: { send: ReturnType<typeof vi.fn> } }).sender
      expect(sender.send).toHaveBeenCalledWith(
        'transcription:whisperDownloadProgress',
        expect.objectContaining({ percent: 42, phase: 'Downloading' })
      )
    })
  })

  // ===========================================================================
  // transcription:whisperEnsureModel
  // ===========================================================================

  describe('transcription:whisperEnsureModel', () => {
    it('should return success with path for a valid model name', async () => {
      const { whisperModelManager } = await import('../services/WhisperModelManager')
      vi.mocked(whisperModelManager.ensureModel).mockResolvedValue('/models/whisper/base.bin')

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:whisperEnsureModel')
      expect(handler).toBeDefined()

      const result = await handler!(mockEvent, 'base') as { success: boolean; path?: string; error?: string }

      expect(result.success).toBe(true)
      expect(result.path).toBe('/models/whisper/base.bin')
      expect(whisperModelManager.ensureModel).toHaveBeenCalledWith(
        'base',
        expect.objectContaining({ onProgress: expect.any(Function) })
      )
    })

    it('should return failure for an invalid model name', async () => {
      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:whisperEnsureModel')
      const result = await handler!(mockEvent, 'invalid-model') as { success: boolean; path?: string; error?: string }

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid whisper model')
      expect(result.path).toBeUndefined()
    })

    it('should return failure when ensureModel throws', async () => {
      const { whisperModelManager } = await import('../services/WhisperModelManager')
      vi.mocked(whisperModelManager.ensureModel).mockRejectedValue(new Error('Disk full'))

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:whisperEnsureModel')
      const result = await handler!(mockEvent, 'small') as { success: boolean; path?: string; error?: string }

      expect(result.success).toBe(false)
      expect(result.error).toBe('Disk full')
    })

    it('should stream download progress to renderer', async () => {
      const { whisperModelManager } = await import('../services/WhisperModelManager')
      vi.mocked(whisperModelManager.ensureModel).mockImplementation(async (_model, { onProgress }) => {
        onProgress?.({ percent: 75, phase: 'Downloading model' })
        return '/models/whisper/small.bin'
      })

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:whisperEnsureModel')
      await handler!(mockEvent, 'small')

      const sender = (mockEvent as { sender: { send: ReturnType<typeof vi.fn> } }).sender
      expect(sender.send).toHaveBeenCalledWith(
        'transcription:whisperDownloadProgress',
        expect.objectContaining({ percent: 75, phase: 'Downloading model' })
      )
    })
  })

  // ===========================================================================
  // transcription:whisperListModels
  // ===========================================================================

  describe('transcription:whisperListModels', () => {
    it('should return all models with their info', async () => {
      const { whisperModelManager } = await import('../services/WhisperModelManager')
      vi.mocked(whisperModelManager.listInstalledModels).mockResolvedValue(['base', 'small'])
      vi.mocked(whisperModelManager.getModelInfo).mockImplementation((name) => {
        if (name === 'base') return { size: 142_000_000, installed: true }
        if (name === 'small') return { size: 484_000_000, installed: true }
        return { size: 0, installed: false }
      })

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:whisperListModels')
      expect(handler).toBeDefined()

      const result = await handler!() as { success: boolean; models: Array<{ name: string; size: number; installed: boolean }> }

      expect(result.success).toBe(true)
      expect(result.models).toHaveLength(5)
      expect(result.models).toContainEqual(expect.objectContaining({ name: 'base', installed: true }))
      expect(result.models).toContainEqual(expect.objectContaining({ name: 'small', installed: true }))
      expect(result.models).toContainEqual(expect.objectContaining({ name: 'tiny', installed: false }))
      expect(result.models.every((m) => 'name' in m && 'size' in m && 'installed' in m)).toBe(true)
    })

    it('should return success: false with empty models array on error', async () => {
      const { whisperModelManager } = await import('../services/WhisperModelManager')
      vi.mocked(whisperModelManager.listInstalledModels).mockRejectedValue(new Error('Permission denied'))

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:whisperListModels')
      const result = await handler!() as { success: boolean; models: unknown[] }

      expect(result.success).toBe(false)
      expect(result.models).toEqual([])
    })
  })

  // ===========================================================================
  // transcription:whisperDeleteModel
  // ===========================================================================

  describe('transcription:whisperDeleteModel', () => {
    it('should return success for a valid installed model', async () => {
      const { whisperModelManager } = await import('../services/WhisperModelManager')
      vi.mocked(whisperModelManager.deleteModel).mockResolvedValue(undefined)

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:whisperDeleteModel')
      expect(handler).toBeDefined()

      const result = await handler!(mockEvent, 'medium') as { success: boolean; error?: string }

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
      expect(whisperModelManager.deleteModel).toHaveBeenCalledWith('medium')
    })

    it('should return failure for an invalid model name', async () => {
      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:whisperDeleteModel')
      const result = await handler!(mockEvent, 'unknown-model') as { success: boolean; error?: string }

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid whisper model')
    })

    it('should return failure when deleteModel throws', async () => {
      const { whisperModelManager } = await import('../services/WhisperModelManager')
      vi.mocked(whisperModelManager.deleteModel).mockRejectedValue(new Error('File not found'))

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:whisperDeleteModel')
      const result = await handler!(mockEvent, 'large') as { success: boolean; error?: string }

      expect(result.success).toBe(false)
      expect(result.error).toBe('File not found')
    })
  })

  // ===========================================================================
  // Backend routing (transcribeWithBackend)
  // ===========================================================================

  describe('backend routing', () => {
    it('should route to localWhisperService when backend is local', async () => {
      mockGetSetting.mockReturnValue({ backend: 'local', whisperModel: 'small', openaiApiKeyStored: false })
      mockLocalWhisperTranscribe.mockResolvedValue({
        success: true,
        transcript: 'Local transcription result.',
        duration: 30,
        language: 'en'
      })

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:import')
      const request = { filePath: TEST_AUDIO, language: 'en' }
      const result = await handler!(mockEvent, request) as { success: boolean; outputPath?: string }

      expect(result.success).toBe(true)
      expect(mockLocalWhisperTranscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: TEST_AUDIO,
          language: 'en',
          model: 'small'
        })
      )
      expect(mockTranscribe).not.toHaveBeenCalled()
    })

    it('should pass the whisperModel setting to the local backend', async () => {
      mockGetSetting.mockReturnValue({ backend: 'local', whisperModel: 'medium', openaiApiKeyStored: false })
      mockLocalWhisperTranscribe.mockResolvedValue({
        success: true,
        transcript: 'Medium model output.',
        duration: 45,
        language: 'fr'
      })

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:import')
      const request = { filePath: TEST_RECORDING, language: 'fr' }
      await handler!(mockEvent, request)

      expect(mockLocalWhisperTranscribe).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'medium' })
      )
    })

    it('should fall back to base model when whisperModel setting is absent', async () => {
      mockGetSetting.mockReturnValue({ backend: 'local', openaiApiKeyStored: false })
      mockLocalWhisperTranscribe.mockResolvedValue({
        success: true,
        transcript: 'Fallback model output.',
        duration: 20,
        language: 'en'
      })

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:import')
      const request = { filePath: TEST_RECORDING, language: 'en' }
      await handler!(mockEvent, request)

      expect(mockLocalWhisperTranscribe).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'base' })
      )
    })

    it('should route to transcriptionService when backend is openai', async () => {
      mockGetSetting.mockReturnValue({ backend: 'openai', openaiApiKeyStored: true })

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:import')
      const request = { filePath: TEST_AUDIO, language: 'en' }
      const result = await handler!(mockEvent, request) as { success: boolean }

      expect(result.success).toBe(true)
      expect(mockTranscribe).toHaveBeenCalled()
      expect(mockLocalWhisperTranscribe).not.toHaveBeenCalled()
    })

    it('should not require API key when backend is local', async () => {
      mockGetSetting.mockReturnValue({ backend: 'local', whisperModel: 'tiny', openaiApiKeyStored: false })
      mockApiKeyGetKey.mockResolvedValue(null)
      mockLocalWhisperTranscribe.mockResolvedValue({
        success: true,
        transcript: 'Offline transcription.',
        duration: 10,
        language: 'en'
      })

      const { registerTranscriptionHandlers } = await import('./transcription-handlers')
      registerTranscriptionHandlers()

      const handler = getHandler('transcription:import')
      const request = { filePath: TEST_AUDIO, language: 'en' }
      const result = await handler!(mockEvent, request) as { success: boolean; errorCode?: string }

      expect(result.success).toBe(true)
      expect(result.errorCode).toBeUndefined()
    })
  })
})
