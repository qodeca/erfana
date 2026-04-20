/**
 * Tests for WhisperModelManager
 *
 * Covers: path helpers, installation checks, list, ensureBinary,
 * ensureModel, deleteModel, download cancellation, error handling,
 * platform detection for binary URL construction.
 *
 * @see Issue #111 - Local Whisper transcription backend
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'

// Platform-safe path helpers – production code uses path.join which emits
// backslashes on Windows. See #157.
const WHISPER_DIR = path.join('/userData', 'whisper')
const WHISPER_BIN = path.join(WHISPER_DIR, 'bin', 'whisper-cli')
const MODEL_TINY = path.join(WHISPER_DIR, 'models', 'ggml-tiny.bin')
const MODEL_BASE = path.join(WHISPER_DIR, 'models', 'ggml-base.bin')
const MODEL_LARGE = path.join(WHISPER_DIR, 'models', 'ggml-large.bin')

// =============================================================================
// Mock electron
// =============================================================================

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/userData')
  }
}))

// =============================================================================
// Mock fs/promises
// =============================================================================

const mockMkdir = vi.fn()
const mockAccess = vi.fn()
const mockChmod = vi.fn()
const mockReaddir = vi.fn()
const mockUnlink = vi.fn()
const mockRename = vi.fn()
const mockRm = vi.fn()
const mockCopyFile = vi.fn()

vi.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  access: (...args: unknown[]) => mockAccess(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  copyFile: (...args: unknown[]) => mockCopyFile(...args)
}))

// =============================================================================
// Mock fs (sync)
// =============================================================================

const mockCreateWriteStream = vi.fn()

vi.mock('fs', () => ({
  createWriteStream: (...args: unknown[]) => mockCreateWriteStream(...args),
  constants: {
    X_OK: 1,
    R_OK: 4
  }
}))

// =============================================================================
// Mock child_process
// =============================================================================

const mockExecFile = vi.fn()

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args)
}))

// =============================================================================
// Mock os
// =============================================================================

vi.mock('os', () => ({
  tmpdir: () => '/tmp'
}))

// =============================================================================
// Mock crypto
// =============================================================================

vi.mock('crypto', () => ({
  randomUUID: () => 'test-uuid-1234'
}))

// stream/promises is NOT mocked – we let pipeline run for real.
// Tests that trigger downloads provide a mock fetch body that the Readable
// stream can actually consume.

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

vi.mock('./LoggingService', () => ({
  logger: mockLogger
}))

// =============================================================================
// Mock shared modules
// =============================================================================

vi.mock('../../shared/constants', () => ({
  LOCAL_WHISPER: {
    BINARY_NAME: 'whisper-cli',
    MODELS_DIR: 'models',
    BIN_DIR: 'bin',
    WHISPER_DIR: 'whisper',
    SUPPORTED_MODELS: ['tiny', 'base', 'small', 'medium', 'large'],
    MODEL_SIZES: {
      tiny: 75_000_000,
      base: 142_000_000,
      small: 466_000_000,
      medium: 1_500_000_000,
      large: 2_900_000_000
    },
    DOWNLOAD_TIMEOUT: 600_000,
    PROCESS_TIMEOUT: 1_800_000,
    GITHUB_RELEASE_BASE_URL: 'https://github.com/ggml-org/whisper.cpp/releases/download',
    HUGGINGFACE_MODEL_BASE_URL: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
  }
}))

vi.mock('../../shared/errors', async () => {
  const actual = await vi.importActual<typeof import('../../shared/errors')>('../../shared/errors')
  return actual
})

// =============================================================================
// Mock global fetch
// =============================================================================

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build a mock Web API ReadableStream body that produces one chunk then ends.
 *
 * The body is compatible with the Web ReadableStream interface used by
 * downloadFile (response.body.getReader()).
 */
function makeMockBody(data: Uint8Array = new Uint8Array([1, 2, 3])): ReadableStream<Uint8Array> {
  let consumed = false
  let done = false

  return {
    getReader: () => ({
      read: async () => {
        if (!consumed) {
          consumed = true
          return { done: false, value: data }
        }
        if (!done) {
          done = true
          return { done: true, value: undefined }
        }
        // Subsequent reads after done – should never be called in practice
        return { done: true, value: undefined }
      },
      cancel: async () => {}
    })
  } as unknown as ReadableStream<Uint8Array>
}

function makeMockWriteStream(): NodeJS.WritableStream {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Writable } = require('stream') as typeof import('stream')
  return new Writable({
    write(_chunk, _enc, cb) {
      cb()
    }
  }) as unknown as NodeJS.WritableStream
}

// =============================================================================
// Tests
// =============================================================================

describe('WhisperModelManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockChmod.mockResolvedValue(undefined)
    mockUnlink.mockResolvedValue(undefined)
    mockRename.mockResolvedValue(undefined)
    mockRm.mockResolvedValue(undefined)
    // execFile is used via promisify in two forms:
    //   execFileAsync(cmd, args)        → promisify appends callback as 3rd arg
    //   execFileAsync(cmd, args, opts)  → promisify appends callback as 4th arg
    // We accept variadic args and call whichever argument is a function.
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args.find((a) => typeof a === 'function') as
        | ((err: null, stdout: string, stderr: string) => void)
        | undefined
      if (cb) cb(null, '', '')
      return { kill: vi.fn() }
    })
    // Set up a working writestream mock (used by downloadFile → createWriteStream)
    mockCreateWriteStream.mockReturnValue(makeMockWriteStream())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Path helpers
  // ===========================================================================

  describe('path helpers', () => {
    it('getWhisperDir() returns correct path under userData', async () => {
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      expect(manager.getWhisperDir()).toBe(WHISPER_DIR)
    })

    it('getBinaryPath() returns path to whisper-cli inside bin dir', async () => {
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      expect(manager.getBinaryPath()).toBe(WHISPER_BIN)
    })

    it('getModelPath() returns ggml-{model}.bin path inside models dir', async () => {
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      expect(manager.getModelPath('tiny')).toBe(MODEL_TINY)
      expect(manager.getModelPath('base')).toBe(MODEL_BASE)
      expect(manager.getModelPath('large')).toBe(MODEL_LARGE)
    })
  })

  // ===========================================================================
  // isBinaryInstalled
  // ===========================================================================

  describe('isBinaryInstalled()', () => {
    it('returns true when binary is accessible and executable', async () => {
      mockAccess.mockResolvedValue(undefined)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      expect(await manager.isBinaryInstalled()).toBe(true)
      expect(mockAccess).toHaveBeenCalledWith(
        WHISPER_BIN,
        1 // X_OK
      )
    })

    it('returns false when binary is not found', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockAccess.mockRejectedValue(err)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      expect(await manager.isBinaryInstalled()).toBe(false)
    })

    it('returns false on permission errors', async () => {
      const err = new Error('EACCES') as NodeJS.ErrnoException
      err.code = 'EACCES'
      mockAccess.mockRejectedValue(err)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      expect(await manager.isBinaryInstalled()).toBe(false)
    })
  })

  // ===========================================================================
  // isModelInstalled
  // ===========================================================================

  describe('isModelInstalled()', () => {
    it('returns true when model file is readable', async () => {
      mockAccess.mockResolvedValue(undefined)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      expect(await manager.isModelInstalled('tiny')).toBe(true)
      expect(mockAccess).toHaveBeenCalledWith(
        MODEL_TINY,
        4 // R_OK
      )
    })

    it('returns false when model file is missing', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockAccess.mockRejectedValue(err)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      expect(await manager.isModelInstalled('base')).toBe(false)
    })

    it('updates installed cache on check', async () => {
      mockAccess.mockResolvedValue(undefined)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await manager.isModelInstalled('small')
      const info = manager.getModelInfo('small')
      expect(info.installed).toBe(true)
    })

    it('marks model as not installed in cache when missing', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockAccess.mockRejectedValue(err)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await manager.isModelInstalled('medium')
      const info = manager.getModelInfo('medium')
      expect(info.installed).toBe(false)
    })
  })

  // ===========================================================================
  // listInstalledModels
  // ===========================================================================

  describe('listInstalledModels()', () => {
    it('returns list of installed model names from directory', async () => {
      mockReaddir.mockResolvedValue([
        'ggml-tiny.bin',
        'ggml-base.bin',
        'ggml-small.bin',
        'some-other-file.txt'
      ])

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      const models = await manager.listInstalledModels()

      expect(models).toEqual(expect.arrayContaining(['tiny', 'base', 'small']))
      expect(models).not.toContain('some-other-file')
      expect(models.length).toBe(3)
    })

    it('returns empty array when models directory does not exist', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockReaddir.mockRejectedValue(err)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      expect(await manager.listInstalledModels()).toEqual([])
    })

    it('rethrows non-ENOENT errors from readdir', async () => {
      const err = new Error('EACCES') as NodeJS.ErrnoException
      err.code = 'EACCES'
      mockReaddir.mockRejectedValue(err)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await expect(manager.listInstalledModels()).rejects.toThrow('EACCES')
    })

    it('filters out unknown model names not in SUPPORTED_MODELS', async () => {
      mockReaddir.mockResolvedValue([
        'ggml-tiny.bin',
        'ggml-unknown.bin',
        'ggml-base.bin'
      ])

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      const models = await manager.listInstalledModels()

      expect(models).toContain('tiny')
      expect(models).toContain('base')
      expect(models).not.toContain('unknown')
    })

    it('marks models not found in directory as not installed in cache', async () => {
      mockReaddir.mockResolvedValue(['ggml-tiny.bin'])

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await manager.listInstalledModels()

      expect(manager.getModelInfo('tiny').installed).toBe(true)
      expect(manager.getModelInfo('base').installed).toBe(false)
      expect(manager.getModelInfo('large').installed).toBe(false)
    })
  })

  // ===========================================================================
  // getModelInfo
  // ===========================================================================

  describe('getModelInfo()', () => {
    it('returns correct model size from constants', async () => {
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      expect(manager.getModelInfo('tiny').size).toBe(75_000_000)
      expect(manager.getModelInfo('large').size).toBe(2_900_000_000)
    })

    it('returns installed:false by default before any check', async () => {
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      expect(manager.getModelInfo('base').installed).toBe(false)
    })
  })

  // ===========================================================================
  // ensureBinary
  // ===========================================================================

  // WhisperModelManager.getArchSuffix() throws WHISPER_UNSUPPORTED_PLATFORM
  // on non-darwin platforms, so the download-URL tests can only run on macOS.
  // See #157.
  describe.skipIf(process.platform !== 'darwin')('ensureBinary()', () => {
    it('returns path immediately when binary is already installed', async () => {
      mockAccess.mockResolvedValue(undefined) // isBinaryInstalled → true

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      const result = await manager.ensureBinary()

      expect(result).toBe(WHISPER_BIN)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('downloads binary when not installed', async () => {
      // isBinaryInstalled → false, then download
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockAccess.mockRejectedValue(err)

      mockFetch.mockResolvedValue({
        ok: true,
        body: makeMockBody(),
        headers: { get: () => '1000' }
      })

      // readdir for findExtractedBinary: return whisper-cli at top level
      mockReaddir.mockResolvedValue([
        Object.assign('whisper-cli', { name: 'whisper-cli', isFile: () => true, isDirectory: () => false })
      ])
      // Actually readdir returns plain strings by default, but withFileTypes returns Dirent objects
      mockReaddir.mockResolvedValueOnce([
        { name: 'whisper-cli', isFile: () => true, isDirectory: () => false }
      ])

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      const result = await manager.ensureBinary()

      expect(mockFetch).toHaveBeenCalledOnce()
      expect(mockExecFile).toHaveBeenCalledWith(
        'unzip',
        expect.arrayContaining(['-o', expect.stringContaining('.zip'), '-d', expect.any(String)]),
        expect.any(Function)
      )
      expect(mockChmod).toHaveBeenCalledWith(WHISPER_BIN, 0o755)
      expect(result).toBe(WHISPER_BIN)
    })

    it('builds correct download URL for arm64', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockAccess.mockRejectedValue(err)

      // Simulate arm64
      Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true })

      mockFetch.mockResolvedValue({
        ok: true,
        body: makeMockBody(),
        headers: { get: () => '1000' }
      })

      mockReaddir.mockResolvedValueOnce([
        { name: 'whisper-cli', isFile: () => true, isDirectory: () => false }
      ])

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await manager.ensureBinary()

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('arm64')
      expect(url).toContain('macos')
    })

    it('builds correct download URL for x64', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockAccess.mockRejectedValue(err)

      Object.defineProperty(process, 'arch', { value: 'x64', configurable: true })

      mockFetch.mockResolvedValue({
        ok: true,
        body: makeMockBody(),
        headers: { get: () => '1000' }
      })

      mockReaddir.mockResolvedValueOnce([
        { name: 'whisper-cli', isFile: () => true, isDirectory: () => false }
      ])

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await manager.ensureBinary()

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('x86_64')
    })

    it('throws WHISPER_UNSUPPORTED_PLATFORM for unsupported architecture', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockAccess.mockRejectedValue(err)

      Object.defineProperty(process, 'arch', { value: 'ia32', configurable: true })

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      // The unsupported arch error propagates through ensureBinary's catch block,
      // but getArchSuffix() throws AppError with WHISPER_UNSUPPORTED_PLATFORM directly –
      // ensureBinary wraps it with AppError.from which preserves the original code
      // when it's already an AppError.
      await expect(manager.ensureBinary()).rejects.toMatchObject({
        code: 'WHISPER_UNSUPPORTED_PLATFORM'
      })
    })

    it('throws WHISPER_BINARY_DOWNLOAD_FAILED on HTTP error', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockAccess.mockRejectedValue(err)

      Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true })

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        body: null
      })

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await expect(manager.ensureBinary()).rejects.toMatchObject({
        code: 'WHISPER_BINARY_DOWNLOAD_FAILED'
      })
    })

    it('cleans up partial files on download failure', async () => {
      const accessErr = new Error('ENOENT') as NodeJS.ErrnoException
      accessErr.code = 'ENOENT'
      mockAccess.mockRejectedValue(accessErr)

      Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true })

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        body: null
      })

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await expect(manager.ensureBinary()).rejects.toMatchObject({
        code: 'WHISPER_BINARY_DOWNLOAD_FAILED'
      })

      // safeUnlink called for binaryPath and tempZip (ENOENT-safe)
      expect(mockUnlink).toHaveBeenCalled()
    })

    it('cancels download when AbortSignal is aborted before start', async () => {
      const accessErr = new Error('ENOENT') as NodeJS.ErrnoException
      accessErr.code = 'ENOENT'
      mockAccess.mockRejectedValue(accessErr)

      Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true })

      const controller = new AbortController()
      controller.abort()

      mockFetch.mockRejectedValue(new DOMException('aborted', 'AbortError'))

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await expect(manager.ensureBinary({ signal: controller.signal })).rejects.toMatchObject({
        code: 'WHISPER_BINARY_DOWNLOAD_FAILED'
      })
    })

    it('throws WHISPER_UNSUPPORTED_PLATFORM when platform is not darwin', async () => {
      const accessErr = new Error('ENOENT') as NodeJS.ErrnoException
      accessErr.code = 'ENOENT'
      mockAccess.mockRejectedValue(accessErr)

      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

      try {
        const { createWhisperModelManager } = await import('./WhisperModelManager')
        const manager = createWhisperModelManager()

        await expect(manager.ensureBinary()).rejects.toMatchObject({
          code: 'WHISPER_UNSUPPORTED_PLATFORM'
        })
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
      }
    })

    it('finds binary inside a subdirectory of the extracted archive', async () => {
      const accessErr = new Error('ENOENT') as NodeJS.ErrnoException
      accessErr.code = 'ENOENT'
      mockAccess.mockRejectedValue(accessErr)

      Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true })
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

      mockFetch.mockResolvedValue({
        ok: true,
        body: makeMockBody(),
        headers: { get: () => '1000' }
      })

      // First readdir call: top-level contains a subdirectory, not the binary directly
      mockReaddir.mockResolvedValueOnce([
        { name: 'whisper-dist', isFile: () => false, isDirectory: () => true }
      ])
      // Second readdir call: inside the subdirectory, the binary is found
      mockReaddir.mockResolvedValueOnce(['whisper-cli'])

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      const result = await manager.ensureBinary()

      expect(mockChmod).toHaveBeenCalledWith(WHISPER_BIN, 0o755)
      expect(result).toBe(WHISPER_BIN)
    })

    it('finds binary when archive uses legacy "main" binary name', async () => {
      const accessErr = new Error('ENOENT') as NodeJS.ErrnoException
      accessErr.code = 'ENOENT'
      mockAccess.mockRejectedValue(accessErr)

      Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true })
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

      mockFetch.mockResolvedValue({
        ok: true,
        body: makeMockBody(),
        headers: { get: () => '1000' }
      })

      // Top-level contains an entry named 'main' (legacy binary name)
      mockReaddir.mockResolvedValueOnce([
        { name: 'main', isFile: () => true, isDirectory: () => false }
      ])

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      const result = await manager.ensureBinary()

      expect(mockChmod).toHaveBeenCalledWith(WHISPER_BIN, 0o755)
      expect(result).toBe(WHISPER_BIN)
    })
  })

  // ===========================================================================
  // ensureModel
  // ===========================================================================

  describe('ensureModel()', () => {
    it('returns path immediately when model is already installed', async () => {
      mockAccess.mockResolvedValue(undefined)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      const result = await manager.ensureModel('tiny')

      expect(result).toBe(MODEL_TINY)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('downloads model when not installed', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockAccess.mockRejectedValue(err)

      mockFetch.mockResolvedValue({
        ok: true,
        body: makeMockBody(),
        headers: { get: () => '75000000' }
      })

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      const result = await manager.ensureModel('tiny')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
      expect(mockRename).toHaveBeenCalled()
      expect(result).toBe(MODEL_TINY)
    })

    it('reports download progress via callback', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockAccess.mockRejectedValue(err)

      const onProgress = vi.fn()

      // Body with 50 bytes; content-length header = 100 → progress will report ~50%
      mockFetch.mockResolvedValue({
        ok: true,
        body: makeMockBody(new Uint8Array(new Array(50).fill(0))),
        headers: { get: () => '100' }
      })

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await manager.ensureModel('tiny', { onProgress })

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          percent: expect.any(Number),
          downloadedBytes: expect.any(Number),
          totalBytes: 100
        })
      )
    })

    it('throws WHISPER_MODEL_DOWNLOAD_FAILED on HTTP error', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockAccess.mockRejectedValue(err)

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        body: null
      })

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await expect(manager.ensureModel('base')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_DOWNLOAD_FAILED'
      })
    })

    it('cleans up partial download on failure', async () => {
      const accessErr = new Error('ENOENT') as NodeJS.ErrnoException
      accessErr.code = 'ENOENT'
      mockAccess.mockRejectedValue(accessErr)

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        body: null
      })

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await expect(manager.ensureModel('tiny')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_DOWNLOAD_FAILED'
      })

      // safeUnlink for temp file
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringContaining('.download-test-uuid-1234')
      )
    })

    it('throws WHISPER_MODEL_DOWNLOAD_FAILED when AbortSignal is aborted', async () => {
      const accessErr = new Error('ENOENT') as NodeJS.ErrnoException
      accessErr.code = 'ENOENT'
      mockAccess.mockRejectedValue(accessErr)

      const controller = new AbortController()
      controller.abort()

      mockFetch.mockRejectedValue(new DOMException('aborted', 'AbortError'))

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await expect(manager.ensureModel('tiny', { signal: controller.signal })).rejects.toMatchObject({
        code: 'WHISPER_MODEL_DOWNLOAD_FAILED'
      })
    })

    it('updates installed cache after successful download', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockAccess.mockRejectedValue(err)

      mockFetch.mockResolvedValue({
        ok: true,
        body: makeMockBody(),
        headers: { get: () => '100' }
      })

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await manager.ensureModel('tiny')

      expect(manager.getModelInfo('tiny').installed).toBe(true)
    })
  })

  // ===========================================================================
  // deleteModel
  // ===========================================================================

  describe('deleteModel()', () => {
    it('deletes the model file', async () => {
      mockUnlink.mockResolvedValue(undefined)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await manager.deleteModel('tiny')

      expect(mockUnlink).toHaveBeenCalledWith(MODEL_TINY)
    })

    it('updates installed cache to false after deletion', async () => {
      mockUnlink.mockResolvedValue(undefined)

      // Pre-set cache to true
      mockAccess.mockResolvedValue(undefined)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await manager.isModelInstalled('tiny')
      expect(manager.getModelInfo('tiny').installed).toBe(true)

      // Now delete
      mockUnlink.mockResolvedValue(undefined)
      await manager.deleteModel('tiny')

      expect(manager.getModelInfo('tiny').installed).toBe(false)
    })

    it('throws WHISPER_MODEL_NOT_FOUND when model file does not exist', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockUnlink.mockRejectedValue(err)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await expect(manager.deleteModel('base')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_NOT_FOUND'
      })
    })

    it('throws on unexpected errors during deletion', async () => {
      const err = new Error('EPERM') as NodeJS.ErrnoException
      err.code = 'EPERM'
      mockUnlink.mockRejectedValue(err)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await expect(manager.deleteModel('small')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_NOT_FOUND'
      })
    })
  })

  // ===========================================================================
  // Singleton and factory
  // ===========================================================================

  describe('exports', () => {
    it('exports a singleton whisperModelManager instance', async () => {
      const { whisperModelManager } = await import('./WhisperModelManager')

      expect(whisperModelManager).toBeDefined()
      expect(typeof whisperModelManager.ensureBinary).toBe('function')
      expect(typeof whisperModelManager.ensureModel).toBe('function')
      expect(typeof whisperModelManager.deleteModel).toBe('function')
    })

    it('createWhisperModelManager() returns a new independent instance', async () => {
      const { createWhisperModelManager, whisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      expect(manager).not.toBe(whisperModelManager)
    })
  })
})
