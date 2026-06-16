// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for LocalWhisperService
 *
 * Covers: transcribe(), binary/model ensure, whisper-cli spawning,
 * progress parsing from stderr, output file reading and cleanup,
 * AbortSignal cancellation, non-zero exit codes, format conversion
 * for non-wav inputs, chunking for long files, temp file cleanup.
 *
 * @see Issue #111 - Local Whisper transcription backend
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'os'
import type { ChildProcess } from 'child_process'

// =============================================================================
// Mock child_process
// =============================================================================

const mockSpawn = vi.fn()
const mockExecFile = vi.fn()

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execFile: (...args: unknown[]) => mockExecFile(...args)
}))

// =============================================================================
// Mock fs/promises
// =============================================================================

const mockReadFile = vi.fn()
const mockUnlink = vi.fn()
const mockStat = vi.fn()

// `realpath` is mocked to act as an identity — the existing tests pass
// fictional paths and the Phase 4 argv validator would otherwise trip on
// them. Individual argv-validator tests override this.
const mockRealpath = vi.fn((p: string) => Promise.resolve(p))

vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  realpath: (...args: unknown[]) => mockRealpath(...(args as [string]))
}))

// =============================================================================
// Mock os
// =============================================================================

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual }
})

// =============================================================================
// Mock crypto
// =============================================================================

let uuidCounter = 0
vi.mock('crypto', () => ({
  randomUUID: () => `test-uuid-${uuidCounter++}`
}))

// =============================================================================
// Mock the shared media-binaries resolver
// =============================================================================

vi.mock('../utils/mediaBinaries', () => ({
  ffmpegPath: '/usr/local/bin/ffmpeg',
  ffprobePath: '/usr/local/bin/ffprobe',
  mediaBinariesAvailable: () => true
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

vi.mock('./LoggingService', () => ({
  logger: mockLogger
}))

// =============================================================================
// Mock shared constants
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
  },
  TRANSCRIPTION: {
    CHUNK_BOUNDARY_SECONDS: 480,
    CHUNK_OVERLAP_SECONDS: 0.5,
    MAX_RETRY_ATTEMPTS: 3,
    RETRY_BASE_DELAY_MS: 10,
    RETRY_MAX_DELAY_MS: 50,
    API_TIMEOUT_MS: 300000,
    TEMP_PREFIX: 'erfana-transcription-chunk-',
    OPENAI_API_URL: 'https://api.openai.com/v1/audio/transcriptions',
    PRIMARY_MODEL: 'gpt-4o-transcribe',
    FALLBACK_MODEL: 'whisper-1',
    MAX_API_FILE_SIZE: 25 * 1024 * 1024
  }
}))

// =============================================================================
// Mock shared/errors (use real implementation)
// =============================================================================

vi.mock('../../shared/errors', async () => {
  const actual = await vi.importActual<typeof import('../../shared/errors')>('../../shared/errors')
  return actual
})

// =============================================================================
// Mock WhisperModelManager
// =============================================================================

const mockEnsureBinary = vi.fn()
const mockEnsureModel = vi.fn()
const mockVerifyInstalledBinary = vi.fn()

vi.mock('./WhisperModelManager', () => ({
  whisperModelManager: {
    ensureBinary: (...args: unknown[]) => mockEnsureBinary(...args),
    ensureModel: (...args: unknown[]) => mockEnsureModel(...args),
    verifyInstalledBinary: (...args: unknown[]) => mockVerifyInstalledBinary(...args)
  },
  createWhisperModelManager: () => ({
    ensureBinary: (...args: unknown[]) => mockEnsureBinary(...args),
    ensureModel: (...args: unknown[]) => mockEnsureModel(...args),
    verifyInstalledBinary: (...args: unknown[]) => mockVerifyInstalledBinary(...args)
  })
}))

// =============================================================================
// Child process factory helpers
// =============================================================================

/**
 * Create a mock execFile response for a duration probe.
 *
 * The duration string format is "H:MM:SS.CC" (e.g. "0:01:00.00" = 60 seconds).
 *
 * The mock captures stderr and close listeners and fires them via setImmediate
 * so they always fire AFTER the caller registers their handlers.
 */
function makeDurationExecChild(durationStr: string, failDurationParse = false): ReturnType<typeof mockExecFile> {
  const stderrCallbacks: ((data: Buffer) => void)[] = []
  const closeCallbacks: (() => void)[] = []

  const child = {
    kill: vi.fn(),
    stderr: {
      on: (event: string, cb: (data: Buffer) => void): void => {
        if (event === 'data') stderrCallbacks.push(cb)
      }
    },
    on: (event: string, cb: () => void): typeof child => {
      if (event === 'close') closeCallbacks.push(cb)
      return child
    }
  }

  // Fire data and close on the next tick – after all .on() registrations
  setImmediate(() => {
    const stderrData = failDurationParse
      ? 'some output without duration'
      : `Input #0, wav, Duration: ${durationStr}, start: 0.000000`
    for (const cb of stderrCallbacks) cb(Buffer.from(stderrData))
    for (const cb of closeCallbacks) cb()
  })

  return child
}

/**
 * Set up mockExecFile to handle BOTH conversion calls and duration probe calls.
 *
 * The duration probe uses: execFile(ffmpeg, ['-i', file, '-f', 'null', '-'], opts, cb)
 *   → The callback is ignored; data is emitted via stderr + close events.
 *
 * Conversion uses: execFile(ffmpeg, ['-i', input, '-ar', '16000', ...], opts, callback)
 *   → The callback is called with (null) for success.
 */
function setupDualExecFileMock(
  durationStr: string,
  conversionError?: Error | null
): void {
  mockExecFile.mockImplementation(
    (...args: unknown[]) => {
      const ffmpegArgs = args[1] as string[]
      // Find callback (last argument that's a function)
      const cb = args.find((a) => typeof a === 'function') as
        | ((err: Error | null, stdout: string, stderr: string) => void)
        | undefined

      // Duration probe: has '-f' and 'null' in args
      if (ffmpegArgs.includes('-f') && ffmpegArgs.includes('null')) {
        return makeDurationExecChild(durationStr)
      }

      // Chunk extraction: has '-t' in args (time-based extraction)
      if (ffmpegArgs.includes('-t')) {
        if (cb) setImmediate(() => cb(conversionError ?? null, '', ''))
        return { kill: vi.fn(), stderr: { on: vi.fn() }, on: vi.fn(() => ({})) }
      }

      // Format conversion call – call callback
      if (cb) setImmediate(() => cb(conversionError ?? null, '', ''))
      return { kill: vi.fn(), stderr: { on: vi.fn() }, on: vi.fn(() => ({})) }
    }
  )
}

/**
 * Create a mock spawn child process that auto-fires close after a tick.
 *
 * This ensures the close event fires AFTER runWhisper registers its handlers.
 *
 * @param exitCode - exit code to fire (0 = success, non-0 = failure)
 * @param stderrLines - optional stderr lines to emit before close
 */
function makeWhisperSpawnChild(
  exitCode: number | null = 0,
  stderrLines: string[] = []
): ChildProcess {
  const stderrCallbacks: ((data: Buffer) => void)[] = []
  const closeCallbacks: ((code: number | null) => void)[] = []
  const errorCallbacks: ((err: Error) => void)[] = []

  const child = {
    kill: vi.fn(),
    stderr: {
      on: (event: string, cb: (data: Buffer) => void): void => {
        if (event === 'data') stderrCallbacks.push(cb)
      }
    },
    stdout: {
      on: vi.fn()
    },
    on: (event: string, cb: ((code: number | null) => void) | ((err: Error) => void)): typeof child => {
      if (event === 'close') closeCallbacks.push(cb as (code: number | null) => void)
      if (event === 'error') errorCallbacks.push(cb as (err: Error) => void)
      return child
    }
  }

  // Fire events on next tick so handlers are registered first
  setImmediate(() => {
    for (const line of stderrLines) {
      for (const cb of stderrCallbacks) cb(Buffer.from(line))
    }
    for (const cb of closeCallbacks) cb(exitCode)
  })

  return child as unknown as ChildProcess
}

/**
 * Create a mock spawn child process that fires an 'error' event.
 */
function makeWhisperSpawnErrorChild(error: Error): ChildProcess {
  const errorCallbacks: ((err: Error) => void)[] = []
  const child = {
    kill: vi.fn(),
    stderr: { on: vi.fn() },
    stdout: { on: vi.fn() },
    on: (event: string, cb: (err: Error) => void): typeof child => {
      if (event === 'error') errorCallbacks.push(cb)
      return child
    }
  }

  setImmediate(() => {
    for (const cb of errorCallbacks) cb(error)
  })

  return child as unknown as ChildProcess
}

// =============================================================================
// Tests
// =============================================================================

describe('LocalWhisperService', () => {
  const onProgress = vi.fn()

  beforeEach(() => {
    uuidCounter = 0
    vi.clearAllMocks()

    mockEnsureBinary.mockResolvedValue('/userData/whisper/bin/whisper-cli')
    mockEnsureModel.mockResolvedValue('/userData/whisper/models/ggml-tiny.bin')
    // `verifyInstalledBinary` returns the `VerifiedBinary` shape consumed
    // by `LocalWhisperService.runWhisper` for the spawn-path forensic log.
    mockVerifyInstalledBinary.mockResolvedValue({
      spec: {
        filename: 'whisper-test.tar.gz',
        archiveFormat: 'tar.gz',
        sha256: 'aabbcc',
        sizeBytes: 1,
        files: {
          main: { filename: 'whisper-cli', sizeBytes: 1, sha256: 'aabbcc' },
          sidecars: []
        }
      },
      mainSha: 'aabbcc',
      revisionIndex: 1
    })
    mockReadFile.mockResolvedValue('Hello world transcription.')
    mockUnlink.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 32_000 })
    mockRealpath.mockImplementation((p: string) => Promise.resolve(p))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Happy path – single file (wav)
  // ===========================================================================

  describe('transcribe() – single wav file', () => {
    it('calls ensureBinary and ensureModel before transcribing', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(mockEnsureBinary).toHaveBeenCalledOnce()
      expect(mockEnsureModel).toHaveBeenCalledWith('tiny', expect.objectContaining({ signal: undefined }))
    })

    it('spawns whisper-cli with correct arguments', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(mockSpawn).toHaveBeenCalledWith(
        '/userData/whisper/bin/whisper-cli',
        expect.arrayContaining([
          '-m', '/userData/whisper/models/ggml-tiny.bin',
          '-l', 'en',
          '-otxt',
          '--no-timestamps',
          '-f', '/audio/test.wav'
        ]),
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
      )
    })

    it('emits forensic INFO log with {spawnedPath, computedSha, signatureValid, manifestRevision, binaryVersion} before spawning', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))
      mockVerifyInstalledBinary.mockResolvedValueOnce({
        spec: {
          filename: 'whisper-macos-universal-v1.8.4-erfana1.tar.gz',
          archiveFormat: 'tar.gz',
          sha256: 'aabbcc',
          sizeBytes: 1,
          files: {
            main: { filename: 'whisper-cli', sizeBytes: 1, sha256: 'ff6de29f7a5581bea65a87c2437aabc8' },
            sidecars: []
          }
        },
        mainSha: 'ff6de29f7a5581bea65a87c2437aabc8',
        revisionIndex: 7
      })

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Whisper spawn',
        expect.objectContaining({
          spawnedPath: '/userData/whisper/bin/whisper-cli',
          computedSha: 'ff6de29f7a5581bea65a87c2437aabc8',
          signatureValid: true,
          manifestRevision: 7,
          binaryVersion: 'whisper-cli'
        })
      )
    })

    it('reads output text file and returns transcript', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))
      mockReadFile.mockResolvedValue('  Transcribed text here.  ')

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(true)
      expect(result.transcript).toBe('Transcribed text here.')
      expect(mockReadFile).toHaveBeenCalledWith('/audio/test.wav.txt', 'utf-8')
    })

    it('returns language in result when not auto-detect', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'pl',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(true)
      expect(result.language).toBe('pl')
    })

    it('returns undefined language when language is "auto"', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'auto',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(true)
      expect(result.language).toBeUndefined()
    })

    it('reports duration in result', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(true)
      expect(result.duration).toBe(60) // 0:01:00.00
    })
  })

  // ===========================================================================
  // Progress reporting
  // ===========================================================================

  describe('progress reporting', () => {
    it('reports initial progress phases before spawning whisper', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ percent: 0, phase: 'Preparing' }))
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'Checking whisper binary' }))
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'Checking whisper model' }))
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'Preparing audio' }))
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'Analyzing audio' }))
    })

    it('parses progress percentage from whisper stderr output', async () => {
      setupDualExecFileMock('0:01:00.00')

      const stderrLines = [
        'whisper_full: progress = 25%\n',
        'whisper_full: progress = 50%\n',
        'whisper_full: progress = 75%\n',
        'whisper_full: progress = 100%\n'
      ]
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0, stderrLines))

      const progressValues: number[] = []
      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress: (p) => progressValues.push(p.percent)
      })

      // Whisper progress 25% maps to overall 10 + (25/100)*80 = 30
      // Whisper progress 50% maps to overall 10 + (50/100)*80 = 50
      expect(progressValues).toContain(30)
      expect(progressValues).toContain(50)
    })

    it('reports 100% at completion', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ percent: 100, phase: 'Complete' }))
    })
  })

  // ===========================================================================
  // Non-zero exit code
  // ===========================================================================

  describe('non-zero exit code', () => {
    it('returns WHISPER_PROCESS_FAILED error when whisper-cli exits non-zero', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(1))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('WHISPER_PROCESS_FAILED')
    })

    it('includes stderr output in error message', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() =>
        makeWhisperSpawnChild(2, ['error: could not load model\n'])
      )

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('could not load model')
    })

    it('returns WHISPER_OUTPUT_PARSE_FAILED when output txt file is missing', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockReadFile.mockRejectedValue(err)

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('WHISPER_OUTPUT_PARSE_FAILED')
    })

    it('returns WHISPER_PROCESS_FAILED when spawn emits error event', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() =>
        makeWhisperSpawnErrorChild(new Error('spawn failed: ENOENT'))
      )

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('WHISPER_PROCESS_FAILED')
    })
  })

  // ===========================================================================
  // AbortSignal cancellation
  // ===========================================================================

  describe('AbortSignal cancellation', () => {
    it('returns cancelled result when signal is already aborted before start', async () => {
      const controller = new AbortController()
      controller.abort()

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        signal: controller.signal,
        onProgress
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_CANCELLED')
      expect(mockEnsureBinary).not.toHaveBeenCalled()
    })

    it('returns cancelled when signal is aborted after ensureBinary', async () => {
      const controller = new AbortController()

      mockEnsureBinary.mockImplementation(async () => {
        controller.abort()
        return '/userData/whisper/bin/whisper-cli'
      })

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        signal: controller.signal,
        onProgress
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_CANCELLED')
    })

    it('kills whisper process when signal is aborted during transcription', async () => {
      const controller = new AbortController()

      setupDualExecFileMock('0:01:00.00')

      // Create a whisper spawn child that does NOT auto-fire close,
      // so we can control when the abort happens
      const stderrCallbacks: ((data: Buffer) => void)[] = []
      const closeCallbacks: ((code: number | null) => void)[] = []
      const killFn = vi.fn()

      const child = {
        kill: killFn,
        stderr: {
          on: (event: string, cb: (data: Buffer) => void): void => {
            if (event === 'data') stderrCallbacks.push(cb)
          }
        },
        stdout: { on: vi.fn() },
        on: (event: string, cb: (code: number | null) => void): typeof child => {
          if (event === 'close') closeCallbacks.push(cb)
          return child
        }
      }

      mockSpawn.mockImplementation(() => child as unknown as ChildProcess)

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const transcribePromise = service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        signal: controller.signal,
        onProgress
      })

      // Wait for spawn to be called, then abort and trigger close
      await new Promise<void>((resolve) => setImmediate(resolve))
      await new Promise<void>((resolve) => setImmediate(resolve))
      controller.abort()
      for (const cb of closeCallbacks) cb(null)

      const result = await transcribePromise

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_CANCELLED')
    })
  })

  // ===========================================================================
  // Format conversion (non-wav inputs)
  // ===========================================================================

  describe('format conversion', () => {
    it('does not convert .wav files (native format)', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      // No conversion call – only duration probe
      const conversionCalls = mockExecFile.mock.calls.filter((call) => {
        const args = call[1] as string[]
        return args.includes('-ar') && args.includes('16000')
      })
      expect(conversionCalls.length).toBe(0)
    })

    it('converts .mp3 files to wav via ffmpeg for consistent whisper.cpp support', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/test.mp3',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      const conversionCalls = mockExecFile.mock.calls.filter((call) => {
        const args = call[1] as string[]
        return args.includes('-ar') && args.includes('16000')
      })
      expect(conversionCalls.length).toBe(1)
    })

    it('converts .m4a files to wav before transcription', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.m4a',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(true)

      // First execFile call should be conversion (not duration probe which uses -f null)
      const conversionCalls = mockExecFile.mock.calls.filter((call) => {
        const args = call[1] as string[]
        return args.includes('-ar') && args.includes('16000')
      })
      expect(conversionCalls.length).toBeGreaterThanOrEqual(1)
      const firstConversionArgs = conversionCalls[0][1] as string[]
      expect(firstConversionArgs).toContain('/audio/test.m4a')
    })

    it('converts .ogg files to wav', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.ogg',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(true)
      const conversionCalls = mockExecFile.mock.calls.filter((call) => {
        const args = call[1] as string[]
        return args.includes('/audio/test.ogg')
      })
      expect(conversionCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('converts .flac files to wav', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.flac',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(true)
      const conversionCalls = mockExecFile.mock.calls.filter((call) => {
        const args = call[1] as string[]
        return args.includes('/audio/test.flac')
      })
      expect(conversionCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('adds converted wav file to temp files for cleanup', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/test.m4a',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      // Temp wav file should have been cleaned up
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringMatching(/erfana-whisper-.+\.wav/)
      )
    })
  })

  // ===========================================================================
  // Chunked transcription
  // ===========================================================================

  describe('chunked transcription (long files)', () => {
    it('chunks files longer than CHUNK_BOUNDARY_SECONDS (480s)', async () => {
      // 600 seconds > 480 → 2 chunks
      setupDualExecFileMock('0:10:00.00')

      let spawnCallCount = 0
      mockSpawn.mockImplementation(() => {
        spawnCallCount++
        return makeWhisperSpawnChild(0)
      })

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/long.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      // 600 / 480 = ceil(1.25) = 2 chunks
      expect(spawnCallCount).toBe(2)
    })

    it('joins chunk transcripts with spaces', async () => {
      setupDualExecFileMock('0:10:00.00')

      let readCount = 0
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))
      mockReadFile.mockImplementation(() => {
        readCount++
        return Promise.resolve(readCount === 1 ? 'First chunk.' : 'Second chunk.')
      })

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/long.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(true)
      expect(result.transcript).toBe('First chunk. Second chunk.')
    })

    it('reports chunk progress during chunked transcription', async () => {
      setupDualExecFileMock('0:10:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const progressCalls: Array<{ currentChunk?: number; totalChunks?: number }> = []

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/long.wav',
        language: 'en',
        model: 'tiny',
        onProgress: (p) => progressCalls.push(p)
      })

      const chunkProgressCalls = progressCalls.filter((p) => p.currentChunk !== undefined)
      expect(chunkProgressCalls.length).toBeGreaterThanOrEqual(2)
      expect(chunkProgressCalls[0].totalChunks).toBe(2)
    })

    it('extracts chunks using ffmpeg with -ss/-t arguments', async () => {
      setupDualExecFileMock('0:10:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/long.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      // Chunk extraction calls use -ss and -t
      const chunkExtractCalls = mockExecFile.mock.calls.filter((call) => {
        const args = call[1] as string[]
        return args.includes('-t') && args.includes('-ss')
      })
      expect(chunkExtractCalls.length).toBe(2)
    })

    it('aborts chunking when signal is aborted mid-way', async () => {
      // Use a duration that is slightly above the chunk boundary so we get 2 chunks
      setupDualExecFileMock('0:10:00.00')

      const controller = new AbortController()
      let spawnCallCount = 0

      mockSpawn.mockImplementation(() => {
        spawnCallCount++
        if (spawnCallCount === 1) {
          // Abort during first chunk transcription
          controller.abort()
          return makeWhisperSpawnChild(null)
        }
        return makeWhisperSpawnChild(0)
      })

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/long.wav',
        language: 'en',
        model: 'tiny',
        signal: controller.signal,
        onProgress
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_CANCELLED')
    })
  })

  // ===========================================================================
  // Temp file cleanup
  // ===========================================================================

  describe('temp file cleanup', () => {
    it('cleans up converted wav temp file after successful transcription', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/test.m4a',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringMatching(/erfana-whisper-.+\.wav/)
      )
    })

    it('cleans up temp files even when transcription fails', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(1)) // non-zero exit

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.flac',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(false)
      // Temp wav should still be cleaned up
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringMatching(/erfana-whisper-.+\.wav/)
      )
    })

    it('handles ENOENT gracefully during cleanup', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const enoentErr = new Error('ENOENT') as NodeJS.ErrnoException
      enoentErr.code = 'ENOENT'
      mockUnlink.mockRejectedValue(enoentErr)

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      // Should not throw despite cleanup failing
      await expect(
        service.transcribe({
          filePath: '/audio/test.wav',
          language: 'en',
          model: 'tiny',
          onProgress
        })
      ).resolves.toMatchObject({ success: true })
    })

    it('only cleans files in tmpdir with correct prefix (not the original input file)', async () => {
      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      // The original input /audio/test.wav should never be deleted.
      // (The .txt output file IS deleted by runWhisper, which is expected.)
      const unlinkCalls = mockUnlink.mock.calls.map((c) => c[0] as string)
      const deletedOriginal = unlinkCalls.some((p: string) => p === '/audio/test.wav')
      expect(deletedOriginal).toBe(false)
    })
  })

  // ===========================================================================
  // Model manager error propagation
  // ===========================================================================

  describe('model manager errors', () => {
    it('returns error when ensureBinary throws', async () => {
      const { AppError, ErrorCode } = await import('../../shared/errors')
      mockEnsureBinary.mockRejectedValue(
        new AppError('Binary download failed', ErrorCode.WHISPER_BINARY_DOWNLOAD_FAILED)
      )

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('WHISPER_BINARY_DOWNLOAD_FAILED')
    })

    it('returns error when ensureModel throws', async () => {
      const { AppError, ErrorCode } = await import('../../shared/errors')
      mockEnsureModel.mockRejectedValue(
        new AppError('Model download failed', ErrorCode.WHISPER_MODEL_DOWNLOAD_FAILED)
      )

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('WHISPER_MODEL_DOWNLOAD_FAILED')
    })
  })

  // ===========================================================================
  // Duration detection fallback
  // ===========================================================================

  describe('duration detection fallback', () => {
    it('falls back to file size estimation when ffmpeg cannot parse duration', async () => {
      // Duration probe emits no parseable duration
      setupDualExecFileMock('unparseable_duration', true)
      mockStat.mockResolvedValue({ size: 32_000 }) // 1 second at 32,000 bytes/sec
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      // Duration should be estimated from file size
      expect(result.success).toBe(true)
      expect(result.duration).toBe(1) // 32_000 / 32_000 = 1 second
    })

    it('uses Math.max(1, ...) so minimum duration is 1 second', async () => {
      setupDualExecFileMock('unparseable_duration', true)
      mockStat.mockResolvedValue({ size: 100 }) // very small file → < 1 sec → clamped to 1
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      const result = await service.transcribe({
        filePath: '/audio/test.wav',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      expect(result.success).toBe(true)
      expect(result.duration).toBeGreaterThanOrEqual(1)
    })
  })

  // ===========================================================================
  // Singleton and factory
  // ===========================================================================

  describe('exports', () => {
    it('exports a singleton localWhisperService instance', async () => {
      const { localWhisperService } = await import('./LocalWhisperService')

      expect(localWhisperService).toBeDefined()
      expect(typeof localWhisperService.transcribe).toBe('function')
    })

    it('createLocalWhisperService() returns a new instance', async () => {
      const { createLocalWhisperService, localWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      expect(service).not.toBe(localWhisperService)
    })
  })

  // ===========================================================================
  // resolveFfmpegPath() asar path rewrite
  // ===========================================================================

  describe('resolveFfmpegPath() uses the shared media-binaries path', () => {
    // Re-apply every mock cleared by resetModules, parameterised by the
    // ffmpeg path the shared resolver should report (undefined = "unavailable").
    const applyTranscribeMocks = (ffmpegPathValue: string | undefined): void => {
      vi.doMock('../utils/mediaBinaries', () => ({
        ffmpegPath: ffmpegPathValue,
        ffprobePath: ffmpegPathValue ? '/opt/ffmpeg/ffprobe' : undefined,
        mediaBinariesAvailable: () => !!ffmpegPathValue
      }))
      vi.doMock('child_process', () => ({
        spawn: (...args: unknown[]) => mockSpawn(...args),
        execFile: (...args: unknown[]) => mockExecFile(...args)
      }))
      vi.doMock('fs/promises', () => ({
        readFile: (...args: unknown[]) => mockReadFile(...args),
        unlink: (...args: unknown[]) => mockUnlink(...args),
        stat: (...args: unknown[]) => mockStat(...args),
        realpath: (...args: unknown[]) => mockRealpath(...(args as [string]))
      }))
      vi.doMock('os', () => ({
        tmpdir: () => os.tmpdir(),
        // Provide cpus() for the CPU probe — else the new `checkCpuSupport`
        // call at the top of `transcribe()` throws `cpus is not a function`.
        cpus: () => os.cpus()
      }))
      vi.doMock('crypto', () => ({ randomUUID: () => `test-uuid-${uuidCounter++}` }))
      vi.doMock('./LoggingService', () => ({ logger: mockLogger }))
      vi.doMock('./WhisperModelManager', () => ({
        whisperModelManager: {
          ensureBinary: (...args: unknown[]) => mockEnsureBinary(...args),
          ensureModel: (...args: unknown[]) => mockEnsureModel(...args),
          verifyInstalledBinary: (...args: unknown[]) => mockVerifyInstalledBinary(...args)
        },
        createWhisperModelManager: () => ({
          ensureBinary: (...args: unknown[]) => mockEnsureBinary(...args),
          ensureModel: (...args: unknown[]) => mockEnsureModel(...args),
          verifyInstalledBinary: (...args: unknown[]) => mockVerifyInstalledBinary(...args)
        })
      }))
      vi.doMock('../../shared/constants', () => ({
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
        },
        TRANSCRIPTION: {
          CHUNK_BOUNDARY_SECONDS: 480,
          CHUNK_OVERLAP_SECONDS: 0.5,
          MAX_RETRY_ATTEMPTS: 3,
          RETRY_BASE_DELAY_MS: 10,
          RETRY_MAX_DELAY_MS: 50,
          API_TIMEOUT_MS: 300000,
          TEMP_PREFIX: 'erfana-transcription-chunk-',
          OPENAI_API_URL: 'https://api.openai.com/v1/audio/transcriptions',
          PRIMARY_MODEL: 'gpt-4o-transcribe',
          FALLBACK_MODEL: 'whisper-1',
          MAX_API_FILE_SIZE: 25 * 1024 * 1024
        }
      }))
      vi.doMock('../../shared/errors', async () => {
        const actual = await vi.importActual<typeof import('../../shared/errors')>('../../shared/errors')
        return actual
      })

      setupDualExecFileMock('0:01:00.00')
      mockSpawn.mockImplementation(() => makeWhisperSpawnChild(0))
    }

    it('passes the resolved ffmpeg binary path through unchanged', async () => {
      vi.resetModules()
      applyTranscribeMocks('/opt/ffmpeg/ffmpeg')

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      await service.transcribe({
        filePath: '/audio/test.mp3',
        language: 'en',
        model: 'tiny',
        onProgress
      })

      // All ffmpeg execFile calls should use the resolved path as-is
      const ffmpegCalls = mockExecFile.mock.calls.filter((call) => {
        const cmd = call[0] as string
        return cmd.includes('ffmpeg')
      })
      expect(ffmpegCalls.length).toBeGreaterThan(0)
      for (const call of ffmpegCalls) {
        expect(call[0]).toBe('/opt/ffmpeg/ffmpeg')
        expect(call[0]).not.toMatch(/\.asar/)
      }
    })

    it('rejects without invoking ffmpeg when no ffmpeg binary is available', async () => {
      vi.resetModules()
      applyTranscribeMocks(undefined)

      const { createLocalWhisperService } = await import('./LocalWhisperService')
      const service = createLocalWhisperService({
        ensureBinary: mockEnsureBinary,
        ensureModel: mockEnsureModel,
        verifyInstalledBinary: mockVerifyInstalledBinary
      } as never)

      // resolveFfmpegPath() throws before any ffmpeg spawn; transcribe() maps
      // the AppError to a typed failure result.
      const result = await service.transcribe({
        filePath: '/audio/test.mp3',
        language: 'en',
        model: 'tiny',
        onProgress
      })
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('WHISPER_PROCESS_FAILED')
      const ffmpegCalls = mockExecFile.mock.calls.filter((call) => String(call[0]).includes('ffmpeg'))
      expect(ffmpegCalls.length).toBe(0)
    })
  })

  // ===========================================================================
  // Argv hardening — validateAudioPath() (Phase 4 / #165)
  // ===========================================================================

  describe('validateAudioPath() argv hardening', () => {
    it('rejects empty string', async () => {
      const { validateAudioPath } = await import('./LocalWhisperService')
      await expect(validateAudioPath('')).rejects.toMatchObject({
        code: 'WHISPER_INVALID_PATH'
      })
    })

    it('rejects UNC path with backslashes', async () => {
      const { validateAudioPath } = await import('./LocalWhisperService')
      await expect(
        validateAudioPath('\\\\server\\share\\audio.wav')
      ).rejects.toMatchObject({ code: 'WHISPER_INVALID_PATH' })
    })

    it('rejects UNC path with forward slashes', async () => {
      const { validateAudioPath } = await import('./LocalWhisperService')
      await expect(
        validateAudioPath('//server/share/audio.wav')
      ).rejects.toMatchObject({ code: 'WHISPER_INVALID_PATH' })
    })

    it('rejects NTFS alternate-data-stream colon in basename', async () => {
      const { validateAudioPath } = await import('./LocalWhisperService')
      await expect(
        validateAudioPath('C:/audio/test.wav:evil')
      ).rejects.toMatchObject({ code: 'WHISPER_INVALID_PATH' })
    })

    it('rejects Windows reserved device name (CON)', async () => {
      const { validateAudioPath } = await import('./LocalWhisperService')
      await expect(
        validateAudioPath('/tmp/CON.wav')
      ).rejects.toMatchObject({ code: 'WHISPER_INVALID_PATH' })
    })

    it('rejects Windows reserved device name with extension variant (COM1.wav)', async () => {
      const { validateAudioPath } = await import('./LocalWhisperService')
      await expect(
        validateAudioPath('/tmp/COM1.wav')
      ).rejects.toMatchObject({ code: 'WHISPER_INVALID_PATH' })
    })

    it('rejects Windows reserved device name case-insensitive (nul)', async () => {
      const { validateAudioPath } = await import('./LocalWhisperService')
      await expect(
        validateAudioPath('/tmp/nul.wav')
      ).rejects.toMatchObject({ code: 'WHISPER_INVALID_PATH' })
    })

    it('rejects when realpath throws (e.g. ENOENT)', async () => {
      const { validateAudioPath } = await import('./LocalWhisperService')
      mockRealpath.mockRejectedValueOnce(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      )
      await expect(
        validateAudioPath('/tmp/missing.wav')
      ).rejects.toMatchObject({ code: 'WHISPER_INVALID_PATH' })
    })

    it('returns canonical path when validation passes', async () => {
      const { validateAudioPath } = await import('./LocalWhisperService')
      mockRealpath.mockResolvedValueOnce('/resolved/tmp/audio.wav')
      await expect(validateAudioPath('/tmp/audio.wav')).resolves.toBe(
        '/resolved/tmp/audio.wav'
      )
    })

    it('accepts a plain POSIX absolute path (drive-letter colon still ok)', async () => {
      const { validateAudioPath } = await import('./LocalWhisperService')
      await expect(
        validateAudioPath('C:/Users/Test/audio.wav')
      ).resolves.toBe('C:/Users/Test/audio.wav')
    })
  })

  // ===========================================================================
  // CPU pre-flight probe — checkCpuSupport() (review #1 C1/M1)
  // ===========================================================================

  describe('checkCpuSupport() pre-flight probe', () => {
    // The module-level cache has to be reset between cases because each test
    // expects a fresh probe. We expose __resetCpuProbeForTests() from the
    // service module specifically for this purpose.
    beforeEach(async () => {
      const mod = await import('./LocalWhisperService')
      mod.__resetCpuProbeForTests()
    })

    it('returns ok=true on a modern CPU brand', async () => {
      const osModule = await import('os')
      vi.spyOn(osModule, 'cpus').mockReturnValue([
        {
          model: 'Intel(R) Core(TM) i7-8700K CPU @ 3.70 GHz',
          speed: 3700,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
        } as never
      ])
      const { checkCpuSupport } = await import('./LocalWhisperService')
      const result = checkCpuSupport()
      expect(result.ok).toBe(true)
    })

    it('rejects Intel Core 2 Duo', async () => {
      const osModule = await import('os')
      vi.spyOn(osModule, 'cpus').mockReturnValue([
        {
          model: 'Intel(R) Core(TM)2 Duo CPU E8400 @ 3.00 GHz',
          speed: 3000,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
        } as never
      ])
      const { checkCpuSupport } = await import('./LocalWhisperService')
      const result = checkCpuSupport()
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('OpenAI API backend')
      }
    })

    it('rejects Pentium 4', async () => {
      const osModule = await import('os')
      vi.spyOn(osModule, 'cpus').mockReturnValue([
        {
          model: 'Intel(R) Pentium(R) 4 CPU 3.00GHz',
          speed: 3000,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
        } as never
      ])
      const { checkCpuSupport } = await import('./LocalWhisperService')
      expect(checkCpuSupport().ok).toBe(false)
    })

    it('is case-insensitive (PhENOM II)', async () => {
      const osModule = await import('os')
      vi.spyOn(osModule, 'cpus').mockReturnValue([
        {
          model: 'AMD PhENOM(tm) II X4 965',
          speed: 3400,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
        } as never
      ])
      const { checkCpuSupport } = await import('./LocalWhisperService')
      expect(checkCpuSupport().ok).toBe(false)
    })

    it('falls through (ok=true) when os.cpus() returns empty array', async () => {
      const osModule = await import('os')
      vi.spyOn(osModule, 'cpus').mockReturnValue([])
      const { checkCpuSupport } = await import('./LocalWhisperService')
      expect(checkCpuSupport().ok).toBe(true)
    })

    it('caches result across calls', async () => {
      const osModule = await import('os')
      const cpusSpy = vi.spyOn(osModule, 'cpus').mockReturnValue([
        {
          model: 'AMD Ryzen 9 5950X 16-Core Processor',
          speed: 3400,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
        } as never
      ])
      const { checkCpuSupport } = await import('./LocalWhisperService')
      checkCpuSupport()
      checkCpuSupport()
      checkCpuSupport()
      expect(cpusSpy).toHaveBeenCalledTimes(1)
    })
  })
})
