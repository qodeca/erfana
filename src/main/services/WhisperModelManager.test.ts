// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for WhisperModelManager — Phase 4 (#165)
 *
 * Covers:
 *   - Path helpers + platform-aware binary filename
 *   - `isBinaryInstalled()` full verification chain (access + schema sentinel
 *     + streaming per-file SHA)
 *   - `isModelInstalled()` + `listInstalledModels()` + cache behaviour
 *   - `ensureBinary()` fast-path + 9-step install flow + legacy-cruft
 *     migration + error paths (unsupported platform, manifest invalid,
 *     download failure, abort)
 *   - `ensureModel()` — happy path via `downloadToFile`, progress callback,
 *     cleanup on failure, cache update, abort handling
 *   - `deleteModel()` + singleton/factory exports
 *
 * Mock boundary (post-D12 rewrite): module seams, not global fetch. See
 * sibling file `WhisperModelManager.downgrade.test.ts` for the regression
 * tests that established this pattern + `docs/windows/contributing.md`
 * §"Test-file split policy" for why the two files coexist.
 *
 * @see Issue #165 — Phase 4 Local Whisper
 * @see D12 in docs/windows/deferred-work-phase4.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as realCrypto from 'crypto'

// ---------------------------------------------------------------------------
// Path constants — production code uses `path.join` which emits backslashes
// on Windows. See #157.
// ---------------------------------------------------------------------------

const WHISPER_DIR = path.join('/userData', 'whisper')
const WHISPER_BIN_DARWIN = path.join(WHISPER_DIR, 'bin', 'whisper-cli')
const WHISPER_BIN_WIN32 = path.join(WHISPER_DIR, 'bin', 'whisper.exe')
const MODEL_TINY = path.join(WHISPER_DIR, 'models', 'ggml-tiny.bin')
const MODEL_BASE = path.join(WHISPER_DIR, 'models', 'ggml-base.bin')
const MODEL_LARGE = path.join(WHISPER_DIR, 'models', 'ggml-large.bin')

// ---------------------------------------------------------------------------
// Test-controlled SHA bytes for streaming `verifyAllFiles()` mock.
// Each file's content is a distinct byte so we can tell the streams apart
// if needed; production's real crypto module hashes them.
// ---------------------------------------------------------------------------

const MAIN_BYTES = Buffer.from('whisper-cli-stub-bytes', 'utf8')
const MAIN_SHA = realCrypto.createHash('sha256').update(MAIN_BYTES).digest('hex')
const SIDECAR_BYTES: Record<string, Buffer> = {
  'whisper.dll': Buffer.from('whisper-dll-stub', 'utf8'),
  'ggml.dll': Buffer.from('ggml-dll-stub', 'utf8'),
  'ggml-base.dll': Buffer.from('ggml-base-dll-stub', 'utf8'),
  'ggml-cpu.dll': Buffer.from('ggml-cpu-dll-stub', 'utf8')
}
const SIDECAR_SHAS: Record<string, string> = Object.fromEntries(
  Object.entries(SIDECAR_BYTES).map(([k, buf]) => [
    k,
    realCrypto.createHash('sha256').update(buf).digest('hex')
  ])
)

// ---------------------------------------------------------------------------
// Mock: electron
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/userData') }
}))

// ---------------------------------------------------------------------------
// Mock: fs/promises — covers readFile (sentinels + manifest), writeFile
// (sentinel writes), access / mkdir / chmod / readdir / unlink / rename / rm
// (misc install-flow bookkeeping).
// ---------------------------------------------------------------------------

const mockMkdir = vi.fn()
const mockAccess = vi.fn()
const mockChmod = vi.fn()
const mockReaddir = vi.fn()
const mockUnlink = vi.fn()
const mockRename = vi.fn()
const mockRm = vi.fn()
const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()

vi.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  access: (...args: unknown[]) => mockAccess(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  copyFile: vi.fn()
}))

// ---------------------------------------------------------------------------
// Mock: fs (sync) — createReadStream is consumed by verifyAllFiles() to
// stream bytes into crypto.createHash('sha256'). The mock returns a Readable
// emitting pre-computed bytes so the real crypto module produces a known
// digest.
// ---------------------------------------------------------------------------

import { Readable } from 'stream'

function makeBytesStream(buf: Buffer): NodeJS.ReadableStream {
  return Readable.from([buf])
}

const mockCreateReadStream = vi.fn((p: string) => {
  // Route by filename — the test may control misc files via overrides.
  if (p.endsWith('whisper-cli') || p.endsWith('whisper.exe')) return makeBytesStream(MAIN_BYTES)
  for (const [name, bytes] of Object.entries(SIDECAR_BYTES)) {
    if (p.endsWith(name)) return makeBytesStream(bytes)
  }
  // Default: empty stream (hashes to the SHA of zero bytes).
  return makeBytesStream(Buffer.alloc(0))
})

vi.mock('fs', () => ({
  createReadStream: (p: string) => mockCreateReadStream(p),
  constants: { X_OK: 1, R_OK: 4 }
}))

// ---------------------------------------------------------------------------
// Mock: child_process — used by `stripDownloadMarks()` on darwin to spawn
// `xattr -d com.apple.quarantine`. Default is a no-op success.
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn()

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args)
}))

// ---------------------------------------------------------------------------
// Mock: os / crypto / util / shared modules
// ---------------------------------------------------------------------------

vi.mock('os', () => ({ tmpdir: () => '/tmp' }))

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto')
  return {
    ...actual,
    randomUUID: () => 'test-uuid-1234'
  }
})

const mockLogger = {
  trace: vi.fn(), debug: vi.fn(), info: vi.fn(),
  warn: vi.fn(), error: vi.fn(), fatal: vi.fn()
}
vi.mock('./LoggingService', () => ({ logger: mockLogger }))

vi.mock('../../shared/constants', () => ({
  LOCAL_WHISPER: {
    BINARY_NAME: 'whisper-cli',
    MODELS_DIR: 'models',
    BIN_DIR: 'bin',
    WHISPER_DIR: 'whisper',
    SUPPORTED_MODELS: ['tiny', 'base', 'small', 'medium', 'large'],
    MODEL_SIZES: {
      tiny: 75_000_000, base: 142_000_000, small: 466_000_000,
      medium: 1_500_000_000, large: 2_900_000_000
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

// ---------------------------------------------------------------------------
// Mock: whisper-assets — force darwin-universal by default so tests run
// cross-platform. Individual tests can override via
// `mockClassifyPlatform.mockReturnValueOnce(...)`.
// ---------------------------------------------------------------------------

const DARWIN_SPEC = {
  filename: 'whisper-macos-universal-test.tar.gz',
  archiveFormat: 'tar.gz' as const,
  sha256: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
  sizeBytes: 1_000_000,
  files: {
    main: { filename: 'whisper-cli', sizeBytes: MAIN_BYTES.length, sha256: MAIN_SHA },
    sidecars: []
  }
}

const WIN32_SPEC = {
  filename: 'whisper-win-x64-test.zip',
  archiveFormat: 'zip' as const,
  sha256: '0011223344556677889900112233445566778899001122334455667788990011',
  sizeBytes: 1_000_000,
  files: {
    main: { filename: 'whisper.exe', sizeBytes: MAIN_BYTES.length, sha256: MAIN_SHA },
    sidecars: [
      { filename: 'whisper.dll', sizeBytes: SIDECAR_BYTES['whisper.dll'].length, sha256: SIDECAR_SHAS['whisper.dll'] },
      { filename: 'ggml.dll', sizeBytes: SIDECAR_BYTES['ggml.dll'].length, sha256: SIDECAR_SHAS['ggml.dll'] },
      { filename: 'ggml-base.dll', sizeBytes: SIDECAR_BYTES['ggml-base.dll'].length, sha256: SIDECAR_SHAS['ggml-base.dll'] },
      { filename: 'ggml-cpu.dll', sizeBytes: SIDECAR_BYTES['ggml-cpu.dll'].length, sha256: SIDECAR_SHAS['ggml-cpu.dll'] }
    ]
  }
}

const mockClassifyPlatform = vi.fn(() => ({ supported: true, platform: 'darwin-universal' as const }))

vi.mock('./whisper-assets', () => ({
  ARTIFACTS: {
    'darwin-universal': DARWIN_SPEC,
    'win32-x64': WIN32_SPEC
  },
  BINARY_ARCHIVE_MAX_BYTES: 20 * 1024 * 1024,
  LAST_SEEN_REVISION_FILENAME: '.last-seen-revision',
  MANIFEST_MAX_BYTES: 64 * 1024,
  MANIFEST_SIG_MAX_BYTES: 8 * 1024,
  MANIFEST_SIG_URL: 'https://example.invalid/manifest.json.minisig',
  MANIFEST_URL: 'https://example.invalid/manifest.json',
  MIN_REVISION_INDEX: 1,
  MODEL_MAX_BYTES: 2 * 1024 * 1024 * 1024,
  RELEASE_URL_BASE: 'https://example.invalid',
  SCHEMA_SENTINEL_FILENAME: '.schema-version',
  SCHEMA_VERSION: 1,
  artifactUrl: (filename: string) => `https://example.invalid/${filename}`,
  classifyPlatform: () => mockClassifyPlatform()
}))

// ---------------------------------------------------------------------------
// Mock: secureDownloader / verifyManifest / zipArchive / tarArchive — the
// Phase 4 module seams. Mirrors WhisperModelManager.downgrade.test.ts.
// ---------------------------------------------------------------------------

const mockDownloadToFile = vi.fn()

vi.mock('../utils/secureDownloader', () => ({
  downloadToFile: (...args: unknown[]) => mockDownloadToFile(...args),
  SecureDownloaderError: class SecureDownloaderError extends Error {
    constructor(msg: string) { super(msg); this.name = 'SecureDownloaderError' }
  }
}))

const mockVerifyManifest = vi.fn()

vi.mock('../utils/verifyManifest', () => ({
  verifyManifest: (...args: unknown[]) => mockVerifyManifest(...args),
  VerifyManifestError: class VerifyManifestError extends Error {
    constructor(msg: string) { super(msg); this.name = 'VerifyManifestError' }
  }
}))

vi.mock('../utils/zipArchive', () => ({ unzip: vi.fn() }))
vi.mock('../utils/tarArchive', () => ({ untarGz: vi.fn() }))

// ---------------------------------------------------------------------------
// Arrange helper — ported from WhisperModelManager.downgrade.test.ts
// ---------------------------------------------------------------------------

/**
 * Arrange mocks for a "not installed, full 9-step flow" scenario. Each
 * failure path is toggled by the caller overriding specific mocks after this
 * helper runs.
 */
function arrangeFreshInstall(opts: {
  manifestRevisionIndex?: number
  lastSeenRevisionOnDisk?: number | null
  manifestPlatformSha?: string
  platform?: 'darwin-universal' | 'win32-x64'
  legacyBinDirContent?: string[]
} = {}): void {
  const platform = opts.platform ?? 'darwin-universal'
  const spec = platform === 'darwin-universal' ? DARWIN_SPEC : WIN32_SPEC
  mockClassifyPlatform.mockReturnValue({ supported: true, platform })

  // isBinaryInstalled → false (sentinel read throws ENOENT; access fails too).
  const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  mockAccess.mockRejectedValue(enoent)

  mockDownloadToFile.mockResolvedValue(undefined)
  mockVerifyManifest.mockResolvedValue({
    signingKeyRole: 'primary',
    signingKeyId: 'test-key-id'
  })

  const manifestBody = {
    schemaVersion: 1,
    revisionIndex: opts.manifestRevisionIndex ?? 1,
    upstream: { sha: 'deadbeef', label: 'v1.8.4' },
    erfanaRevision: opts.manifestRevisionIndex ?? 1,
    builtAt: '2026-04-21T00:00:00Z',
    workflowRunUrl: 'https://example.invalid/run/1',
    workflowCommitSha: 'cafef00d',
    artifacts: {
      macosUniversal: {
        filename: DARWIN_SPEC.filename,
        sha256: platform === 'darwin-universal' ? (opts.manifestPlatformSha ?? DARWIN_SPEC.sha256) : DARWIN_SPEC.sha256,
        size: DARWIN_SPEC.sizeBytes
      },
      win64: {
        filename: WIN32_SPEC.filename,
        sha256: platform === 'win32-x64' ? (opts.manifestPlatformSha ?? WIN32_SPEC.sha256) : WIN32_SPEC.sha256,
        size: WIN32_SPEC.sizeBytes
      }
    },
    signingKey: 'primary' as const
  }

  mockReadFile.mockImplementation(async (p: string) => {
    if (typeof p === 'string' && p.includes('manifest.json') && !p.includes('.minisig')) {
      return JSON.stringify(manifestBody)
    }
    if (typeof p === 'string' && p.endsWith('.last-seen-revision')) {
      if (opts.lastSeenRevisionOnDisk == null) throw enoent
      return String(opts.lastSeenRevisionOnDisk)
    }
    if (typeof p === 'string' && p.endsWith('.schema-version')) {
      throw enoent
    }
    throw enoent
  })

  mockReaddir.mockResolvedValue(opts.legacyBinDirContent ?? [])
  mockWriteFile.mockResolvedValue(undefined)
  mockMkdir.mockResolvedValue(undefined)
  mockRm.mockResolvedValue(undefined)
  mockChmod.mockResolvedValue(undefined)
  mockUnlink.mockResolvedValue(undefined)
  mockRename.mockResolvedValue(undefined)

  // execFile (used for macOS xattr strip) — no-op success.
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args.find((a) => typeof a === 'function') as
      | ((err: null, stdout: string, stderr: string) => void)
      | undefined
    if (cb) cb(null, '', '')
    return { kill: vi.fn() }
  })

  return void spec  // satisfies unused-var; spec is referenced via closures if tests need it
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WhisperModelManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Defaults — individual tests override.
    mockClassifyPlatform.mockReturnValue({ supported: true, platform: 'darwin-universal' })
    mockMkdir.mockResolvedValue(undefined)
    mockChmod.mockResolvedValue(undefined)
    mockUnlink.mockResolvedValue(undefined)
    mockRename.mockResolvedValue(undefined)
    mockRm.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args.find((a) => typeof a === 'function') as
        | ((err: null, stdout: string, stderr: string) => void)
        | undefined
      if (cb) cb(null, '', '')
      return { kill: vi.fn() }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // =========================================================================
  // Path helpers
  // =========================================================================

  describe('path helpers', () => {
    it('getWhisperDir() returns correct path under userData', async () => {
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      expect(manager.getWhisperDir()).toBe(WHISPER_DIR)
    })

    it('getBinaryPath() returns whisper-cli on darwin spec', async () => {
      mockClassifyPlatform.mockReturnValue({ supported: true, platform: 'darwin-universal' })
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      expect(manager.getBinaryPath()).toBe(WHISPER_BIN_DARWIN)
    })

    it('getBinaryPath() returns whisper.exe on win32-x64 spec', async () => {
      mockClassifyPlatform.mockReturnValue({ supported: true, platform: 'win32-x64' })
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      expect(manager.getBinaryPath()).toBe(WHISPER_BIN_WIN32)
    })

    it('getModelPath() returns ggml-{model}.bin path inside models dir', async () => {
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      expect(manager.getModelPath('tiny')).toBe(MODEL_TINY)
      expect(manager.getModelPath('base')).toBe(MODEL_BASE)
      expect(manager.getModelPath('large')).toBe(MODEL_LARGE)
    })
  })

  // =========================================================================
  // isBinaryInstalled — Phase 4 full verification chain
  // =========================================================================

  describe('isBinaryInstalled()', () => {
    it('returns true only when access succeeds, schema sentinel matches, and all SHAs match', async () => {
      mockAccess.mockResolvedValue(undefined)
      mockReadFile.mockImplementation(async (p: string) => {
        if (p.endsWith('.schema-version')) return '1'
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      // mockCreateReadStream already returns MAIN_BYTES → SHA matches DARWIN_SPEC.files.main.sha256
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      expect(await manager.isBinaryInstalled()).toBe(true)
    })

    it('returns false when binary is not accessible (ENOENT)', async () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      mockAccess.mockRejectedValue(err)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      expect(await manager.isBinaryInstalled()).toBe(false)
    })

    it('returns false on permission errors (EACCES)', async () => {
      const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
      mockAccess.mockRejectedValue(err)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      expect(await manager.isBinaryInstalled()).toBe(false)
    })

    it('returns false when schema sentinel is missing', async () => {
      mockAccess.mockResolvedValue(undefined)
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      expect(await manager.isBinaryInstalled()).toBe(false)
    })

    it('returns false when schema sentinel is stale (wrong version)', async () => {
      mockAccess.mockResolvedValue(undefined)
      mockReadFile.mockImplementation(async (p: string) => {
        if (p.endsWith('.schema-version')) return '0' // wrong version
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      expect(await manager.isBinaryInstalled()).toBe(false)
    })

    it('returns false when main binary SHA does not match pin', async () => {
      mockAccess.mockResolvedValue(undefined)
      mockReadFile.mockImplementation(async (p: string) => {
        if (p.endsWith('.schema-version')) return '1'
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      // Make the stream emit wrong bytes so the SHA won't match
      mockCreateReadStream.mockImplementationOnce(() => makeBytesStream(Buffer.from('tampered')))
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      expect(await manager.isBinaryInstalled()).toBe(false)
    })
  })

  // =========================================================================
  // isModelInstalled
  // =========================================================================

  describe('isModelInstalled()', () => {
    it('returns true when model file is readable', async () => {
      mockAccess.mockResolvedValue(undefined)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      expect(await manager.isModelInstalled('tiny')).toBe(true)
      expect(mockAccess).toHaveBeenCalledWith(MODEL_TINY, 4 /* R_OK */)
    })

    it('returns false when model file is missing', async () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
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
      expect(manager.getModelInfo('small').installed).toBe(true)
    })

    it('marks model as not installed in cache when missing', async () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      mockAccess.mockRejectedValue(err)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await manager.isModelInstalled('medium')
      expect(manager.getModelInfo('medium').installed).toBe(false)
    })
  })

  // =========================================================================
  // listInstalledModels
  // =========================================================================

  describe('listInstalledModels()', () => {
    it('returns list of installed model names from directory', async () => {
      mockReaddir.mockResolvedValue([
        'ggml-tiny.bin', 'ggml-base.bin', 'ggml-small.bin', 'some-other-file.txt'
      ])
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      const models = await manager.listInstalledModels()
      expect(models).toEqual(expect.arrayContaining(['tiny', 'base', 'small']))
      expect(models).not.toContain('some-other-file')
      expect(models.length).toBe(3)
    })

    it('returns empty array when models directory does not exist', async () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      mockReaddir.mockRejectedValue(err)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      expect(await manager.listInstalledModels()).toEqual([])
    })

    it('rethrows non-ENOENT errors from readdir', async () => {
      const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
      mockReaddir.mockRejectedValue(err)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await expect(manager.listInstalledModels()).rejects.toThrow('EACCES')
    })

    it('filters out unknown model names not in SUPPORTED_MODELS', async () => {
      mockReaddir.mockResolvedValue(['ggml-tiny.bin', 'ggml-unknown.bin', 'ggml-base.bin'])
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

  // =========================================================================
  // getModelInfo
  // =========================================================================

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

  // =========================================================================
  // ensureBinary — Phase 4 9-step install flow
  //
  // Note: WHISPER_DOWNGRADE_BLOCKED / WHISPER_SOURCE_PIN_DRIFT /
  // WHISPER_MANIFEST_INVALID error paths are covered exhaustively in
  // WhisperModelManager.downgrade.test.ts. This block covers happy-path +
  // non-overlapping error cases (unsupported platform, archive download
  // failure, abort, legacy cruft migration).
  // =========================================================================

  describe('ensureBinary()', () => {
    it('returns path immediately when binary is already installed (fast path)', async () => {
      mockAccess.mockResolvedValue(undefined)
      mockReadFile.mockImplementation(async (p: string) => {
        if (p.endsWith('.schema-version')) return '1'
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      const result = await manager.ensureBinary()
      expect(result).toBe(WHISPER_BIN_DARWIN)
      expect(mockDownloadToFile).not.toHaveBeenCalled()
    })

    it('runs the 9-step install flow when not installed (darwin)', async () => {
      arrangeFreshInstall({ manifestRevisionIndex: 1, lastSeenRevisionOnDisk: null, platform: 'darwin-universal' })
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const { untarGz } = await import('../utils/tarArchive')
      const manager = createWhisperModelManager()

      const result = await manager.ensureBinary()

      // Step 1+2: manifest + sig downloaded
      expect(mockDownloadToFile).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.invalid/manifest.json' })
      )
      expect(mockDownloadToFile).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.invalid/manifest.json.minisig' })
      )
      // Step 3: sig verified
      expect(mockVerifyManifest).toHaveBeenCalled()
      // Step 6: archive download with SHA pin
      expect(mockDownloadToFile).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `https://example.invalid/${DARWIN_SPEC.filename}`,
          expectedSha256: DARWIN_SPEC.sha256
        })
      )
      // Step 7: tarball extracted (darwin)
      expect(untarGz).toHaveBeenCalled()
      // Step 9a: schema sentinel written
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.schema-version'),
        '1',
        'utf8'
      )
      // Step 9b: lastSeenRevision bumped
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.last-seen-revision'),
        '1',
        'utf8'
      )
      // Note: `stripDownloadMarks()` branches on the REAL `process.platform`
      // (not the mocked `classifyPlatform`), so xattr (darwin) vs ADS unlink
      // (win32) depends on the test-host OS. Covered implicitly by the
      // no-throw happy path above. `chmod` is gated on `spec.archiveFormat`
      // in production, so this assertion is host-agnostic for tar.gz targets.
      expect(mockChmod).toHaveBeenCalledWith(WHISPER_BIN_DARWIN, 0o755)
      // Returns the path
      expect(result).toBe(WHISPER_BIN_DARWIN)
    })

    it('runs the 9-step install flow with zip extraction on win32-x64', async () => {
      arrangeFreshInstall({ manifestRevisionIndex: 1, lastSeenRevisionOnDisk: null, platform: 'win32-x64' })
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const { unzip } = await import('../utils/zipArchive')
      const manager = createWhisperModelManager()

      await manager.ensureBinary()

      // Windows: unzip chosen instead of untarGz
      expect(unzip).toHaveBeenCalled()
      // No chmod on win32
      expect(mockChmod).not.toHaveBeenCalled()
      // Archive URL points at the Windows zip
      expect(mockDownloadToFile).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `https://example.invalid/${WIN32_SPEC.filename}`,
          expectedSha256: WIN32_SPEC.sha256
        })
      )
    })

    it('performs legacy-cruft migration when sentinel absent and bin/ has content', async () => {
      arrangeFreshInstall({
        manifestRevisionIndex: 1,
        lastSeenRevisionOnDisk: null,
        legacyBinDirContent: ['old-whisper-cli', 'old-artifact.bin']
      })
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      await manager.ensureBinary()

      // legacy bin/ dir wiped before download
      expect(mockRm).toHaveBeenCalledWith(
        expect.stringContaining(path.join('whisper', 'bin')),
        expect.objectContaining({ recursive: true, force: true })
      )
      // legacy-wipe log emitted
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Clearing legacy whisper/bin/'),
        expect.any(Object)
      )
    })

    it('throws WHISPER_UNSUPPORTED_PLATFORM on unsupported platform', async () => {
      mockClassifyPlatform.mockReturnValue({
        supported: false,
        reason: 'linux is not supported'
      } as never)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await expect(manager.ensureBinary()).rejects.toMatchObject({
        code: 'WHISPER_UNSUPPORTED_PLATFORM'
      })
    })

    it('wraps SecureDownloaderError on archive download as WHISPER_BINARY_DOWNLOAD_FAILED', async () => {
      arrangeFreshInstall({ manifestRevisionIndex: 1, lastSeenRevisionOnDisk: null })
      // Let the two manifest downloads succeed; fail the third (archive).
      const { SecureDownloaderError } = await import('../utils/secureDownloader')
      let call = 0
      mockDownloadToFile.mockImplementation(async () => {
        call += 1
        if (call >= 3) throw new SecureDownloaderError('connection reset')
        return undefined
      })
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await expect(manager.ensureBinary()).rejects.toMatchObject({
        code: 'WHISPER_BINARY_DOWNLOAD_FAILED'
      })
    })

    it('throws WHISPER_BINARY_DOWNLOAD_FAILED when AbortSignal is already aborted', async () => {
      arrangeFreshInstall({ manifestRevisionIndex: 1, lastSeenRevisionOnDisk: null })
      mockDownloadToFile.mockRejectedValue(new DOMException('aborted', 'AbortError'))
      const controller = new AbortController()
      controller.abort()
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await expect(manager.ensureBinary({ signal: controller.signal })).rejects.toMatchObject({
        code: 'WHISPER_BINARY_DOWNLOAD_FAILED'
      })
    })
  })

  // =========================================================================
  // ensureModel — Phase 4 downloadToFile flow
  // =========================================================================

  describe('ensureModel()', () => {
    it('returns path immediately when model is already installed', async () => {
      mockAccess.mockResolvedValue(undefined)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      const result = await manager.ensureModel('tiny')
      expect(result).toBe(MODEL_TINY)
      expect(mockDownloadToFile).not.toHaveBeenCalled()
    })

    it('downloads model via downloadToFile when not installed and renames temp to final', async () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      mockAccess.mockRejectedValue(err)
      mockDownloadToFile.mockResolvedValue(undefined)

      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()

      const result = await manager.ensureModel('tiny')

      expect(mockDownloadToFile).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin'
        })
      )
      expect(mockRename).toHaveBeenCalled()
      expect(result).toBe(MODEL_TINY)
    })

    it('reports download progress via callback in the wrapping shape', async () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      mockAccess.mockRejectedValue(err)
      // Capture the downloadToFile onProgress arg and drive it from the test.
      mockDownloadToFile.mockImplementation(async (opts: { onProgress?: (bytes: number, total: number) => void }) => {
        opts.onProgress?.(50, 100)
        opts.onProgress?.(100, 100)
      })
      const onProgress = vi.fn()
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await manager.ensureModel('tiny', { onProgress })

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ percent: 50, downloadedBytes: 50, totalBytes: 100 })
      )
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ percent: 100, downloadedBytes: 100, totalBytes: 100 })
      )
    })

    it('throws WHISPER_MODEL_DOWNLOAD_FAILED on SecureDownloaderError', async () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      mockAccess.mockRejectedValue(err)
      const { SecureDownloaderError } = await import('../utils/secureDownloader')
      mockDownloadToFile.mockRejectedValue(new SecureDownloaderError('HTTP 404'))
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await expect(manager.ensureModel('base')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_DOWNLOAD_FAILED'
      })
    })

    it('cleans up partial download on failure', async () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      mockAccess.mockRejectedValue(err)
      const { SecureDownloaderError } = await import('../utils/secureDownloader')
      mockDownloadToFile.mockRejectedValue(new SecureDownloaderError('HTTP 503'))
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await expect(manager.ensureModel('tiny')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_DOWNLOAD_FAILED'
      })
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringContaining('.download-test-uuid-1234')
      )
    })

    it('throws WHISPER_MODEL_DOWNLOAD_FAILED when AbortSignal is aborted', async () => {
      const accessErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      mockAccess.mockRejectedValue(accessErr)
      mockDownloadToFile.mockRejectedValue(new DOMException('aborted', 'AbortError'))
      const controller = new AbortController()
      controller.abort()
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await expect(manager.ensureModel('tiny', { signal: controller.signal })).rejects.toMatchObject({
        code: 'WHISPER_MODEL_DOWNLOAD_FAILED'
      })
    })

    it('updates installed cache after successful download', async () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      mockAccess.mockRejectedValue(err)
      mockDownloadToFile.mockResolvedValue(undefined)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await manager.ensureModel('tiny')
      expect(manager.getModelInfo('tiny').installed).toBe(true)
    })
  })

  // =========================================================================
  // deleteModel
  // =========================================================================

  describe('deleteModel()', () => {
    it('deletes the model file', async () => {
      mockUnlink.mockResolvedValue(undefined)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await manager.deleteModel('tiny')
      expect(mockUnlink).toHaveBeenCalledWith(MODEL_TINY)
    })

    it('updates installed cache to false after deletion', async () => {
      mockAccess.mockResolvedValue(undefined)
      mockUnlink.mockResolvedValue(undefined)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await manager.isModelInstalled('tiny')
      expect(manager.getModelInfo('tiny').installed).toBe(true)
      await manager.deleteModel('tiny')
      expect(manager.getModelInfo('tiny').installed).toBe(false)
    })

    it('throws WHISPER_MODEL_NOT_FOUND when model file does not exist', async () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      mockUnlink.mockRejectedValue(err)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await expect(manager.deleteModel('base')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_NOT_FOUND'
      })
    })

    it('throws on unexpected errors during deletion', async () => {
      const err = Object.assign(new Error('EPERM'), { code: 'EPERM' })
      mockUnlink.mockRejectedValue(err)
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const manager = createWhisperModelManager()
      await expect(manager.deleteModel('small')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_NOT_FOUND'
      })
    })
  })

  // =========================================================================
  // Singleton and factory
  // =========================================================================

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
