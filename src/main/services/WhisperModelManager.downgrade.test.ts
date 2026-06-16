// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Downgrade-protection regression tests for `WhisperModelManager.ensureBinary()`.
 *
 * Closes audit finding C2 (Phase 4 B5b). The pre-B5b test suite had zero
 * coverage of the monotonic revision floor that defeats manifest-replay
 * attacks — these tests close that gap.
 *
 * Intentionally a separate file from `WhisperModelManager.test.ts` so the
 * pre-Phase-4 mock infrastructure there doesn't leak into our setup, and
 * vice versa.
 *
 * @see Issue #165 — Local Whisper Windows binary (Phase 4)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock electron — userData lives under a fake root so we can control the
// .last-seen-revision sentinel without touching the real filesystem.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/fake-user-data')
  }
}))

// ---------------------------------------------------------------------------
// Mock fs/promises — we drive `readFile` to simulate the sentinel state
// per-test, and `writeFile` to assert revision-floor bumps.
// ---------------------------------------------------------------------------

const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()
const mockAccess = vi.fn()
const mockMkdir = vi.fn()
const mockRm = vi.fn()
const mockReaddir = vi.fn()
const mockChmod = vi.fn()
const mockUnlink = vi.fn()

vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  access: (...args: unknown[]) => mockAccess(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  rename: vi.fn()
}))

// `fs` (sync) for `createReadStream` used by streaming SHA in verifyAllFiles
// — we don't hit that path in these tests (all 3 tests fail before extract).
vi.mock('fs', () => ({
  createReadStream: vi.fn(() => {
    throw new Error('not expected to reach verifyAllFiles in downgrade tests')
  }),
  constants: { R_OK: 4, X_OK: 1 }
}))

// ---------------------------------------------------------------------------
// Mock Logger
// ---------------------------------------------------------------------------

vi.mock('./LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

// ---------------------------------------------------------------------------
// Mock whisper-assets — force platform to darwin-universal regardless of
// the host OS, and provide a minimal spec for the downgrade-block test.
// ---------------------------------------------------------------------------

const DARWIN_SPEC = {
  filename: 'whisper-macos-universal-v1.8.4-erfana1.tar.gz',
  archiveFormat: 'tar.gz' as const,
  sha256: '78fa53c26f62da7f842def18f57338908641449fcee5da533037237d09bc696b',
  sizeBytes: 744_152,
  files: {
    main: {
      filename: 'whisper-cli',
      sizeBytes: 1_778_400,
      sha256: 'ff6de29f7a5581bea65a87c2437aabc8085cd21a6c476e78e11bc81b1edd8b9f'
    },
    sidecars: []
  }
}

vi.mock('./whisper-assets', () => ({
  ARTIFACTS: {
    'darwin-universal': DARWIN_SPEC,
    'win32-x64': DARWIN_SPEC
  },
  BINARY_ARCHIVE_MAX_BYTES: 20 * 1024 * 1024,
  LAST_SEEN_REVISION_FILENAME: '.last-seen-revision',
  MANIFEST_MAX_BYTES: 64 * 1024,
  MANIFEST_SIG_MAX_BYTES: 8 * 1024,
  MANIFEST_SIG_URL: 'https://example.invalid/manifest.json.minisig',
  MANIFEST_URL: 'https://example.invalid/manifest.json',
  MIN_REVISION_INDEX: 1,
  MODEL_MAX_BYTES: 2 * 1024 * 1024 * 1024,
  SCHEMA_SENTINEL_FILENAME: '.schema-version',
  SCHEMA_VERSION: 1,
  artifactUrl: (filename: string) => `https://example.invalid/${filename}`,
  classifyPlatform: () => ({ supported: true, platform: 'darwin-universal' }),
  // Types are erased at runtime — no value needed for these exports
  FilePin: undefined,
  PlatformArtifactSpec: undefined
}))

// ---------------------------------------------------------------------------
// Mock secureDownloader — each test arranges what `downloadToFile` "writes"
// via `mockReadFile` below (manifest content is read back after download).
// ---------------------------------------------------------------------------

const mockDownloadToFile = vi.fn()

vi.mock('../utils/secureDownloader', () => ({
  downloadToFile: (...args: unknown[]) => mockDownloadToFile(...args),
  SecureDownloaderError: class SecureDownloaderError extends Error {
    constructor(msg: string) { super(msg); this.name = 'SecureDownloaderError' }
  }
}))

// ---------------------------------------------------------------------------
// Mock verifyManifest — returns a fixed success by default; tests override
// to simulate signature-verify failure.
// ---------------------------------------------------------------------------

const mockVerifyManifest = vi.fn()

vi.mock('../utils/verifyManifest', () => ({
  verifyManifest: (...args: unknown[]) => mockVerifyManifest(...args),
  VerifyManifestError: class VerifyManifestError extends Error {
    constructor(msg: string) { super(msg); this.name = 'VerifyManifestError' }
  }
}))

// Archive utilities and real `shared/errors` pass-through — shared/errors is
// the module under test's own error-code contract.
vi.mock('../utils/zipArchive', () => ({ unzip: vi.fn() }))
vi.mock('../utils/tarArchive', () => ({ untarGz: vi.fn() }))

vi.mock('../../shared/errors', async () => {
  const actual = await vi.importActual<typeof import('../../shared/errors')>('../../shared/errors')
  return actual
})

vi.mock('../../shared/constants', () => ({
  LOCAL_WHISPER: {
    BINARY_NAME: 'whisper-cli',
    MODELS_DIR: 'models',
    BIN_DIR: 'bin',
    WHISPER_DIR: 'whisper',
    MODEL_SIZES: {
      tiny: 75_000_000, base: 142_000_000, small: 466_000_000,
      medium: 1_500_000_000, large: 2_900_000_000
    },
    DOWNLOAD_TIMEOUT: 600_000,
    PROCESS_TIMEOUT: 1_800_000,
    HUGGINGFACE_MODEL_BASE_URL: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main',
    GITHUB_RELEASE_BASE_URL: 'https://github.com/ggml-org/whisper.cpp/releases/download'
  }
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Arrange default mocks for a successful manifest path that will fail ONLY
 * on the downgrade / source-pin guard being tested. The main binary is
 * reported as "not installed" so ensureBinary takes the slow path.
 */
function arrangeDefaults(opts: {
  manifestRevisionIndex: number
  lastSeenRevisionOnDisk: number | null
  manifestPlatformSha?: string
}): void {
  // isBinaryInstalled → false (sentinel missing so fast-path skipped)
  const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  mockAccess.mockRejectedValue(enoent)

  // downloadToFile is a no-op — the manifest JSON is provided via readFile below.
  mockDownloadToFile.mockResolvedValue(undefined)

  // verifyManifest passes with primary key.
  mockVerifyManifest.mockResolvedValue({
    signingKeyRole: 'primary',
    signingKeyId: 'test-key-id'
  })

  const manifestBody = {
    schemaVersion: 1,
    revisionIndex: opts.manifestRevisionIndex,
    upstream: { sha: 'deadbeef', label: 'v1.8.4' },
    erfanaRevision: opts.manifestRevisionIndex,
    builtAt: '2026-04-21T00:00:00Z',
    workflowRunUrl: 'https://example.invalid/run/1',
    workflowCommitSha: 'cafef00d',
    artifacts: {
      macosUniversal: {
        filename: DARWIN_SPEC.filename,
        sha256: opts.manifestPlatformSha ?? DARWIN_SPEC.sha256,
        size: DARWIN_SPEC.sizeBytes
      },
      win64: {
        filename: 'whisper-win-x64-v1.8.4-erfana1.zip',
        sha256: '8e3c63e8e7112e3f04304a4d58937696d72881d88ad0c436665e194b7af846f1',
        size: 1_000_000
      }
    },
    signingKey: 'primary' as const
  }

  // Route readFile calls:
  //   - manifest.json path → return manifest JSON bytes
  //   - .last-seen-revision → return sentinel or reject ENOENT
  //   - schema-version sentinel → reject ENOENT (triggers slow path)
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

  mockWriteFile.mockResolvedValue(undefined)
  mockMkdir.mockResolvedValue(undefined)
  mockRm.mockResolvedValue(undefined)
  mockReaddir.mockResolvedValue([])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WhisperModelManager downgrade protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects manifest whose revisionIndex is below MIN_REVISION_INDEX (source floor)', async () => {
    arrangeDefaults({ manifestRevisionIndex: 0, lastSeenRevisionOnDisk: null })

    const { createWhisperModelManager } = await import('./WhisperModelManager')
    const { AppError } = await import('../../shared/errors')
    const manager = createWhisperModelManager()

    await expect(manager.ensureBinary()).rejects.toMatchObject({
      code: 'WHISPER_DOWNGRADE_BLOCKED'
    })

    // Sanity: it's an AppError (not a raw Error) so the renderer error-code
    // mapping lands on the granular message.
    await expect(manager.ensureBinary()).rejects.toBeInstanceOf(AppError)
  })

  it('rejects manifest whose revisionIndex is below persisted lastSeenRevision (replay defense)', async () => {
    arrangeDefaults({ manifestRevisionIndex: 2, lastSeenRevisionOnDisk: 5 })

    const { createWhisperModelManager } = await import('./WhisperModelManager')
    const manager = createWhisperModelManager()

    await expect(manager.ensureBinary()).rejects.toMatchObject({
      code: 'WHISPER_DOWNGRADE_BLOCKED',
      message: expect.stringContaining('below floor 5')
    })
  })

  it('accepts manifest whose revisionIndex equals lastSeenRevision (boundary: >= not strictly >)', async () => {
    // With revision 3 == lastSeen 3, the downgrade guard must NOT reject.
    // It should continue past the guard and reach the SHA-pin check
    // (which we satisfy by providing a matching SHA) and then try to
    // download the archive. Arrange the post-guard failure to be an
    // unrelated, recognisable error so we can assert "we got past the
    // downgrade guard" without standing up the full download flow.
    arrangeDefaults({ manifestRevisionIndex: 3, lastSeenRevisionOnDisk: 3 })

    // Intercept the SECOND downloadToFile call (the archive download after
    // manifest verify) and throw a sentinel error.
    const sentinel = new Error('POST_GUARD_SENTINEL')
    let callCount = 0
    mockDownloadToFile.mockImplementation(async () => {
      callCount++
      if (callCount >= 3) throw sentinel
      return undefined
    })

    const { createWhisperModelManager } = await import('./WhisperModelManager')
    const manager = createWhisperModelManager()

    // Must NOT be WHISPER_DOWNGRADE_BLOCKED — any other error is fine here.
    // Boundary semantics: revisionIndex === lastSeenRevision is legal
    // (re-install of the same version).
    await expect(manager.ensureBinary()).rejects.toSatisfy((err: unknown) => {
      return (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code !== 'WHISPER_DOWNGRADE_BLOCKED'
      )
    })
  })

  it('rejects manifest whose per-platform SHA does not match source pin (SOURCE_PIN_DRIFT)', async () => {
    arrangeDefaults({
      manifestRevisionIndex: 1,
      lastSeenRevisionOnDisk: null,
      manifestPlatformSha: '0000000000000000000000000000000000000000000000000000000000000000'
    })

    const { createWhisperModelManager } = await import('./WhisperModelManager')
    const manager = createWhisperModelManager()

    await expect(manager.ensureBinary()).rejects.toMatchObject({
      code: 'WHISPER_SOURCE_PIN_DRIFT'
    })
  })

  it('wraps verifyManifest failure as WHISPER_MANIFEST_INVALID (granular error code)', async () => {
    arrangeDefaults({ manifestRevisionIndex: 1, lastSeenRevisionOnDisk: null })

    // Make signature verify fail.
    const { VerifyManifestError } = await import('../utils/verifyManifest')
    mockVerifyManifest.mockRejectedValue(
      new VerifyManifestError('signature verification failed for both keys')
    )

    const { createWhisperModelManager } = await import('./WhisperModelManager')
    const manager = createWhisperModelManager()

    await expect(manager.ensureBinary()).rejects.toMatchObject({
      code: 'WHISPER_MANIFEST_INVALID'
    })
  })
})
