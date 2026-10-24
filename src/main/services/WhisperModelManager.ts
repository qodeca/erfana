// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Whisper model manager
 *
 * Manages the whisper.cpp binary and GGML model files — downloading,
 * verifying, storing, listing, and deleting them. All files live under
 * `app.getPath('userData')/whisper/`.
 *
 * Binary download flow (Phase 4 Option A):
 *   1. Fetch + verify pinned manifest (minisign Ed25519, dual-key trust).
 *   2. Assert manifest `revisionIndex` ≥ `MIN_REVISION_INDEX` (downgrade block).
 *   3. Assert manifest's per-platform SHA matches our source-pinned SHA
 *      (catches signed-but-wrong-build drift).
 *   4. Download archive via `SecureDownloader` (hostname allowlist + size cap
 *      + SHA-256 verification).
 *   5. Extract via platform-specific wrapper (`zipArchive.unzip` for Windows
 *      zips, `tarArchive.untarGz` for macOS tar.gz).
 *   6. Strip MOTW / quarantine from extracted binaries.
 *   7. Verify every pinned file's SHA-256 after extraction (main + sidecars).
 *   8. Write schema-version sentinel so subsequent launches skip the work.
 *
 * Storage layout:
 *   {userData}/whisper/
 *   ├── .schema-version         # "1" once binaries are verified-installed
 *   ├── bin/
 *   │   ├── whisper-cli         # (darwin) or whisper.exe (win32)
 *   │   └── *.dll               # (win32) sidecars — each SHA-pinned
 *   └── models/
 *       ├── ggml-tiny.bin
 *       └── …
 *
 * @see Issue #165 — Local Whisper Windows binary
 * @see Issue #111 — Local Whisper transcription backend
 */
import { app } from 'electron'
import { createHash } from 'crypto'
import { access, chmod, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

import { LOCAL_WHISPER } from '../../shared/constants'
import { AppError, ErrorCode } from '../../shared/errors'
import type { WhisperModel } from '../../shared/ipc/transcription-schema'

import { logger } from './LoggingService'
import {
  ARTIFACTS,
  BINARY_ARCHIVE_MAX_BYTES,
  LAST_SEEN_REVISION_FILENAME,
  MANIFEST_MAX_BYTES,
  MANIFEST_SIG_MAX_BYTES,
  MANIFEST_SIG_URL,
  MANIFEST_URL,
  MIN_REVISION_INDEX,
  MODEL_PINS,
  MODEL_SIZE_MARGIN_BYTES,
  SCHEMA_SENTINEL_FILENAME,
  SCHEMA_VERSION,
  artifactUrl,
  classifyPlatform,
  type FilePin,
  type PlatformArtifactSpec
} from './whisper-assets'
import { downloadToFile, SecureDownloaderError } from '../utils/secureDownloader'
import { unzip } from '../utils/zipArchive'
import { untarGz } from '../utils/tarArchive'
import { verifyManifest, VerifyManifestError } from '../utils/verifyManifest'

/** Progress callback for download operations */
export type ProgressCallback = (progress: {
  percent: number
  downloadedBytes: number
  totalBytes: number
}) => void

/**
 * Forensic-logging context returned by `verifyInstalledBinary()`. Used by
 * `LocalWhisperService.runWhisper()` to emit a single INFO log per spawn
 * containing `{spawnedPath, manifestRevision, computedSha, signatureValid,
 * binaryVersion}`. `signatureValid` is implicit — a non-tampered install
 * necessarily passed signature verification at ensureBinary() time.
 */
export interface VerifiedBinary {
  spec: PlatformArtifactSpec
  /** Freshly-computed SHA-256 of the main binary. Lower-case hex. */
  mainSha: string
  /**
   * The `revisionIndex` persisted in `{userData}/whisper/.last-seen-revision`
   * at the moment of verification, or `null` if the sentinel is absent.
   * A fresh install that has not yet been through `ensureBinary()` will have
   * no sentinel; that case is legal only during the very first install.
   */
  revisionIndex: number | null
}

export interface IWhisperModelManager {
  getWhisperDir(): string
  getBinaryPath(): string
  getModelPath(model: WhisperModel): string
  isBinaryInstalled(): Promise<boolean>
  isModelInstalled(model: WhisperModel): Promise<boolean>
  /**
   * Hash-check an installed model file against its pin before it is handed to
   * whisper-cli. Nothing is cached: call it once per transcription job. On a
   * mismatch the file is deleted and `WHISPER_MODEL_INTEGRITY_FAILED` is
   * thrown, so the user re-downloads it deliberately.
   */
  verifyInstalledModelFile(
    model: WhisperModel,
    options?: { signal?: AbortSignal }
  ): Promise<VerifiedModelFile>
  /**
   * Re-stat the model path and require the state returned by
   * `verifyInstalledModelFile`. Call before each spawn of a job. A mismatch
   * throws `WHISPER_MODEL_CHANGED_DURING_CHECK` and deletes nothing.
   */
  assertVerifiedModelUnchanged(model: WhisperModel, verified: VerifiedModelFile): Promise<void>
  /** Abort in-flight model downloads and remove their temp files (app quit). */
  dispose(): Promise<void>
  /**
   * Abort every binary or model download in flight (Settings → Cancel).
   * @returns How many downloads were running
   */
  cancelDownloads(): number
  listInstalledModels(): Promise<WhisperModel[]>
  ensureBinary(options?: {
    onProgress?: ProgressCallback
    signal?: AbortSignal
  }): Promise<string>
  ensureModel(
    model: WhisperModel,
    options?: { onProgress?: ProgressCallback; signal?: AbortSignal }
  ): Promise<string>
  deleteModel(model: WhisperModel): Promise<void>
  getModelInfo(model: WhisperModel): { size: number; installed: boolean }
  /**
   * Re-hash every pinned file (main binary + sidecars) against its source-
   * pinned SHA-256. Called by consumers immediately before spawning the
   * binary to close the TOCTOU window in `{userData}/whisper/bin/`.
   *
   * Throws `WHISPER_BINARY_TAMPERED` on mismatch.
   *
   * Returns the verified platform spec plus forensic-logging context:
   *  - `mainSha` — the freshly-computed SHA-256 of the main binary.
   *  - `revisionIndex` — the `lastSeenRevision` on-disk sentinel at the
   *    moment of verification, or `null` if no install has completed.
   *    Used by `LocalWhisperService` for the spawn-path INFO log.
   */
  verifyInstalledBinary(): Promise<VerifiedBinary>
}

/**
 * Minisign manifest payload shape. See workflow's `publish-release` job for
 * how this is produced. `schemaVersion` is the MANIFEST schema (unrelated to
 * our local on-disk `SCHEMA_VERSION`).
 */
interface WhisperManifest {
  schemaVersion: number
  revisionIndex: number
  upstream: { sha: string; label: string }
  erfanaRevision: number
  builtAt: string
  artifacts: {
    macosUniversal: { filename: string; sha256: string; size: number }
    win64: { filename: string; sha256: string; size: number }
  }
  signingKey: 'primary' | 'rotation'
}

const SHA256_HEX = /^[0-9a-f]{64}$/i

function invalidManifest(detail: string): AppError {
  return new AppError(
    `Whisper manifest has an invalid shape: ${detail}`,
    ErrorCode.WHISPER_MANIFEST_INVALID
  )
}

/** Parse + shape-check the signature-verified manifest bytes. */
function parseVerifiedManifest(content: Buffer): WhisperManifest {
  const parsed: unknown = JSON.parse(content.toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null) throw invalidManifest('not an object')
  const m = parsed as Record<string, unknown>
  if (!Number.isSafeInteger(m.revisionIndex) || (m.revisionIndex as number) < 0) {
    throw invalidManifest('revisionIndex must be a non-negative safe integer')
  }
  const artifacts = m.artifacts as Record<string, unknown> | null | undefined
  if (typeof artifacts !== 'object' || artifacts === null) {
    throw invalidManifest('artifacts missing')
  }
  for (const key of ['macosUniversal', 'win64']) {
    const a = artifacts[key] as Record<string, unknown> | null | undefined
    if (
      typeof a !== 'object' ||
      a === null ||
      typeof a.filename !== 'string' ||
      typeof a.sha256 !== 'string' ||
      !SHA256_HEX.test(a.sha256) ||
      !Number.isSafeInteger(a.size)
    ) {
      throw invalidManifest(`artifacts.${key} needs filename, 64-hex sha256 and integer size`)
    }
  }
  const upstream = m.upstream as Record<string, unknown> | null | undefined
  if (
    typeof upstream !== 'object' ||
    upstream === null ||
    typeof upstream.sha !== 'string' ||
    typeof upstream.label !== 'string'
  ) {
    throw invalidManifest('upstream needs sha and label')
  }
  return parsed as WhisperManifest
}

/** A pid-marked temp file untouched for this long is stale even if its pid is alive. */
const STALE_TEMP_MAX_AGE_MS = 60 * 60 * 1000

/** Read size when hashing a model through its handle. */
const HASH_CHUNK_BYTES = 1024 * 1024

/** An unmarked temp file changed more recently than this may belong to a live download. */
const STALE_TEMP_MIN_AGE_MS = 10 * 60 * 1000

/** Identity + version of a model file at the moment it was hashed. */
export interface VerifiedModelFile {
  /** The path that was hashed; the spawn must use exactly this one. */
  path: string
  dev: number | bigint
  ino: number | bigint
  size: number | bigint
  mtimeMs: number | bigint
  ctimeMs: number | bigint
}

function fileState(path: string, s: Omit<VerifiedModelFile, 'path'>): VerifiedModelFile {
  return { path, dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs }
}

/** Same file, same content window: dev, ino, size, mtime and ctime all equal. */
function sameFileState(
  a: { dev: number | bigint; ino: number | bigint; size: number | bigint; mtimeMs: number | bigint; ctimeMs: number | bigint },
  b: { dev: number | bigint; ino: number | bigint; size: number | bigint; mtimeMs: number | bigint; ctimeMs: number | bigint }
): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  )
}

/** True when a process with this pid exists (EPERM means it exists but is not ours). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

class WhisperModelManager implements IWhisperModelManager {
  private readonly whisperDir: string
  private readonly binDir: string
  private readonly modelsDir: string

  /** Cache of installed model states (populated lazily). */
  private installedCache = new Map<WhisperModel, boolean>()

  /** In-flight model downloads: temp path -> abort handle + settled promise. */
  private activeDownloads = new Map<string, { controller: AbortController; done: Promise<void> }>()

  constructor() {
    this.whisperDir = join(app.getPath('userData'), LOCAL_WHISPER.WHISPER_DIR)
    this.binDir = join(this.whisperDir, LOCAL_WHISPER.BIN_DIR)
    this.modelsDir = join(this.whisperDir, LOCAL_WHISPER.MODELS_DIR)
  }

  getWhisperDir(): string {
    return this.whisperDir
  }

  /**
   * Path to the main executable. Platform-aware — `.exe` on Windows,
   * no-extension on macOS.
   */
  getBinaryPath(): string {
    const spec = this.getSpecOrThrow()
    return join(this.binDir, spec.files.main.filename)
  }

  /**
   * Accessor for the pinned spec the current process needs; throws
   * a clear `WHISPER_UNSUPPORTED_PLATFORM` on any unsupported combo.
   */
  getPinnedSpec(): PlatformArtifactSpec {
    return this.getSpecOrThrow()
  }

  getModelPath(model: WhisperModel): string {
    return join(this.modelsDir, `ggml-${model}.bin`)
  }

  /**
   * Ensure binary + all pinned sidecars exist AND match their pinned SHAs.
   *
   * Contract: returns `true` only when every pinned file (main + sidecars)
   * exists AND hashes match source-pinned SHA-256s AND the schema sentinel
   * is current. Any deviation returns `false`, which makes `ensureBinary()`
   * treat the bin/ dir as unverified and re-download.
   *
   * Cost: reads ~2.3 MB (win32: main + 4 DLLs) through a streaming SHA-256
   * pipe once per session. Measured <50 ms on modern hardware — acceptable
   * for startup.
   */
  async isBinaryInstalled(): Promise<boolean> {
    const spec = this.safeSpec()
    if (!spec) return false
    try {
      await access(this.getBinaryPath(), fsConstants.R_OK)
      for (const sidecar of spec.files.sidecars) {
        await access(join(this.binDir, sidecar.filename), fsConstants.R_OK)
      }
      // Schema sentinel gates "verified install" — if it's missing or stale,
      // treat the bin/ dir as suspect (legacy cruft from v0.8.0–v0.9.3 had a
      // broken URL that never produced a verified binary).
      const sentinel = await this.readSchemaVersion()
      if (sentinel !== SCHEMA_VERSION) return false
      // Full SHA re-verify — closes the "corrupted file, sentinel intact"
      // gap. `verifyAllFiles` throws on any mismatch; we convert the throw
      // to a `false` return so the caller triggers a fresh install.
      await this.verifyAllFiles(spec)
      return true
    } catch {
      return false
    }
  }

  /**
   * A model counts as installed only when the file is readable AND has exactly
   * the pinned size. The content hash is checked separately, right before a
   * spawn (`verifyInstalledModelFile`), because hashing up to 3 GB is too slow
   * for a status query.
   */
  async isModelInstalled(model: WhisperModel): Promise<boolean> {
    try {
      const modelPath = this.getModelPath(model)
      await access(modelPath, fsConstants.R_OK)
      const info = await stat(modelPath)
      const ok = info.size === MODEL_PINS[model].sizeBytes
      this.installedCache.set(model, ok)
      return ok
    } catch {
      this.installedCache.set(model, false)
      return false
    }
  }

  async listInstalledModels(): Promise<WhisperModel[]> {
    await this.removeStaleModelTemps()
    try {
      const entries = await readdir(this.modelsDir)
      const models: WhisperModel[] = []
      for (const entry of entries) {
        const match = entry.match(/^ggml-(\w+)\.bin$/)
        if (match) {
          const name = match[1] as WhisperModel
          if (LOCAL_WHISPER.SUPPORTED_MODELS.includes(name)) {
            if (await this.hasPinnedSize(name)) {
              models.push(name)
              this.installedCache.set(name, true)
            }
          }
        }
      }
      for (const m of LOCAL_WHISPER.SUPPORTED_MODELS) {
        if (!models.includes(m)) this.installedCache.set(m, false)
      }
      return models
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  /**
   * Ensure the whisper.cpp binary + sidecars are available and integrity-verified.
   *
   * @returns Absolute path to the main executable.
   */
  async ensureBinary(options?: {
    onProgress?: ProgressCallback
    signal?: AbortSignal
  }): Promise<string> {
    const spec = this.getSpecOrThrow()

    // Fast path: already verified-installed.
    if (await this.isBinaryInstalled()) {
      logger.debug('Whisper binary already installed', { binDir: this.binDir })
      return this.getBinaryPath()
    }

    // Slow path: do the full install.
    await this.performLegacyCruftMigration()
    await this.ensureDirs()

    const tempRoot = join(tmpdir(), `erfana-whisper-${randomUUID()}`)
    const tempManifest = join(tempRoot, 'manifest.json')
    const tempManifestSig = join(tempRoot, 'manifest.json.minisig')
    const tempArchive = join(tempRoot, spec.filename)

    await this.ensureDir(tempRoot)

    // Own controller, as for a model download: `dispose()` and
    // `cancelDownloads()` abort it; the caller's signal feeds into it.
    const controller = new AbortController()
    const callerSignal = options?.signal
    const onCallerAbort = (): void => controller.abort()
    if (callerSignal?.aborted) controller.abort()
    else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
    let finish: () => void = () => {}
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    this.activeDownloads.set(tempRoot, { controller, done })

    try {
      logger.info('Fetching whisper manifest', { url: MANIFEST_URL })

      await downloadToFile({
        url: MANIFEST_URL,
        destPath: tempManifest,
        maxBytes: MANIFEST_MAX_BYTES,
        signal: controller.signal
      })
      await downloadToFile({
        url: MANIFEST_SIG_URL,
        destPath: tempManifestSig,
        maxBytes: MANIFEST_SIG_MAX_BYTES,
        signal: controller.signal
      })

      // Signature first — we do NOT read the manifest content until we know
      // it was signed by a trusted key.
      const verifyResult = await verifyManifest({
        contentPath: tempManifest,
        signaturePath: tempManifestSig
      })
      logger.info('Whisper manifest signature verified', {
        signingKeyRole: verifyResult.signingKeyRole,
        signingKeyId: verifyResult.signingKeyId
      })

      // Parse the exact bytes that were verified — never re-read the file.
      const manifest = parseVerifiedManifest(verifyResult.content)

      // Downgrade protection — two-layer:
      //   1. Source floor `MIN_REVISION_INDEX` hard-codes the lowest revision
      //      this app version will EVER accept. Bumping the code pin here is
      //      a deliberate irreversible decision.
      //   2. Persistent monotonic floor `lastSeenRevision` — records the
      //      highest revisionIndex this install has ever successfully fetched.
      //      Defeats manifest-replay where a compromised delivery path hands
      //      back a legitimately-signed but superseded manifest to roll the
      //      user back to a known-exploitable whisper.cpp version.
      const lastSeenRevision = await this.readLastSeenRevision()
      const effectiveFloor = Math.max(MIN_REVISION_INDEX, lastSeenRevision ?? 0)
      if (manifest.revisionIndex < effectiveFloor) {
        throw new AppError(
          `Whisper manifest revisionIndex ${manifest.revisionIndex} is below floor ${effectiveFloor} ` +
            `(source minimum ${MIN_REVISION_INDEX}, lastSeen ${lastSeenRevision ?? 'unset'}) — possible downgrade / replay attack`,
          ErrorCode.WHISPER_DOWNGRADE_BLOCKED
        )
      }

      // Source-drift guard: the manifest's per-platform SHA MUST match our
      // hard-coded pin. If it doesn't, the release contents changed without
      // `whisper-assets.ts` being updated in lockstep.
      const platformKey =
        spec.filename.includes('macos') ? 'macosUniversal' : 'win64'
      const manifestSha = manifest.artifacts[platformKey].sha256.toLowerCase()
      if (manifestSha !== spec.sha256.toLowerCase()) {
        throw new AppError(
          `Whisper manifest SHA-256 for ${platformKey} (${manifestSha}) does not match source pin (${spec.sha256}). Update src/main/services/whisper-assets.ts.`,
          ErrorCode.WHISPER_SOURCE_PIN_DRIFT
        )
      }

      // Download the archive. SecureDownloader verifies SHA-256 itself.
      logger.info('Downloading whisper archive', {
        url: artifactUrl(spec.filename),
        expectedSha256: spec.sha256
      })
      await downloadToFile({
        url: artifactUrl(spec.filename),
        destPath: tempArchive,
        maxBytes: BINARY_ARCHIVE_MAX_BYTES,
        expectedSha256: spec.sha256,
        signal: controller.signal,
        onProgress: options?.onProgress
          ? (bytes, total): void => {
              options.onProgress!({
                percent: total ? Math.round((bytes / total) * 100) : 0,
                downloadedBytes: bytes,
                totalBytes: total ?? 0
              })
            }
          : undefined
      })

      // Extract into bin/ directly — preserves the sidecar DLL layout so DLL
      // sideloading defense (`cwd: binDir` on spawn) works.
      await this.clearBinDir()
      if (spec.archiveFormat === 'zip') {
        await unzip(tempArchive, this.binDir)
      } else {
        await untarGz(tempArchive, this.binDir)
      }

      // Strip MOTW / quarantine off extracted binaries so SmartScreen /
      // Gatekeeper don't block on spawn.
      await this.stripDownloadMarks()

      // Sidecar + main-binary integrity check post-extraction.
      await this.verifyAllFiles(spec)

      // Unix exec-bit — gated on the target binary's archive format, not the
      // real host OS. zip = Windows binary, no exec-bit needed; tar.gz = posix
      // binary, needs 0o755. This keeps the test suite host-agnostic (cross-
      // platform extraction tests previously coupled to test-host platform).
      if (spec.archiveFormat !== 'zip') {
        await chmod(this.getBinaryPath(), 0o755)
      }

      // Schema sentinel — gates fast-path for subsequent launches.
      await this.writeSchemaVersion(SCHEMA_VERSION)

      // Bump persistent revision floor — strictly monotonic, so a future
      // replayed-older manifest is rejected by the downgrade guard above.
      await this.writeLastSeenRevision(
        Math.max(manifest.revisionIndex, lastSeenRevision ?? 0)
      )

      logger.info('Whisper binary installed', {
        binDir: this.binDir,
        manifestRevision: manifest.revisionIndex,
        signingKeyRole: verifyResult.signingKeyRole,
        upstreamSha: manifest.upstream.sha,
        upstreamLabel: manifest.upstream.label
      })
      return this.getBinaryPath()
    } catch (error) {
      // On failure, wipe bin/ so isBinaryInstalled() doesn't return true on a
      // partial state.
      await this.clearBinDir()
      if (controller.signal.aborted) {
        throw new AppError(
          'Binary download was cancelled',
          ErrorCode.WHISPER_BINARY_DOWNLOAD_FAILED
        )
      }
      // Route the specific trust-chain failure classes to granular codes so
      // user-facing copy + forensic logs can distinguish them. Pass-through
      // errors that already use granular codes (raised from downgrade /
      // source-pin-drift guards above).
      if (error instanceof AppError) {
        throw error
      }
      if (error instanceof VerifyManifestError) {
        // Signature-verify failures or malformed-signature structure land here.
        throw new AppError(error.message, ErrorCode.WHISPER_MANIFEST_INVALID)
      }
      if (error instanceof SyntaxError) {
        // Manifest JSON parse failure after signature check — malformed payload.
        throw new AppError(
          `Whisper manifest JSON parse failed: ${error.message}`,
          ErrorCode.WHISPER_MANIFEST_INVALID
        )
      }
      if (error instanceof SecureDownloaderError) {
        // Network / hostname-allowlist / SHA-mismatch at download time.
        throw new AppError(error.message, ErrorCode.WHISPER_BINARY_DOWNLOAD_FAILED)
      }
      throw AppError.from(error, ErrorCode.WHISPER_BINARY_DOWNLOAD_FAILED)
    } finally {
      callerSignal?.removeEventListener('abort', onCallerAbort)
      await this.safeRm(tempRoot)
      this.activeDownloads.delete(tempRoot)
      finish()
    }
  }

  async verifyInstalledModelFile(
    model: WhisperModel,
    options?: { signal?: AbortSignal }
  ): Promise<VerifiedModelFile> {
    if (!LOCAL_WHISPER.SUPPORTED_MODELS.includes(model)) {
      throw new AppError(
        `Not a known whisper model: ${String(model)}`,
        ErrorCode.WHISPER_MODEL_NOT_FOUND
      )
    }
    const modelPath = this.getModelPath(model)
    const pin = MODEL_PINS[model]

    let handle
    try {
      handle = await open(modelPath, 'r')
    } catch {
      this.installedCache.set(model, false)
      throw new AppError(
        `Model not found: ${model}. Download it from Settings.`,
        ErrorCode.WHISPER_MODEL_NOT_FOUND
      )
    }

    // `badContent` = the bytes we read are wrong (size or hash); `changed` = the
    // file moved or was rewritten while we looked, which proves nothing about
    // the content. Only the first deletes, and only if the path still names the
    // exact file we read (same dev and ino).
    let badContent: string | null = null
    let changed = false
    let state: VerifiedModelFile | null = null
    try {
      const before = await handle.stat()
      let sha: string | null = null
      if (before.size !== pin.sizeBytes) {
        badContent = `size ${before.size} does not match the expected ${pin.sizeBytes}`
      } else {
        sha = await this.hashHandle(handle, options?.signal)
        if (sha !== pin.sha256) badContent = 'SHA-256 does not match the pinned hash'
      }
      const after = await handle.stat()
      const onPath = await stat(modelPath).catch(() => null)
      const samePathFile = onPath !== null && onPath.dev === before.dev && onPath.ino === before.ino

      if (badContent !== null) {
        if (!samePathFile) {
          // The path no longer names the file we read: leave whatever is there.
          badContent = null
          changed = true
        }
      } else if (!onPath || !sameFileState(before, after) || !sameFileState(before, onPath)) {
        changed = true
      } else {
        state = fileState(modelPath, before)
      }
    } finally {
      await handle.close().catch(() => undefined)
    }

    if (badContent !== null) {
      this.installedCache.set(model, false)
      await this.safeUnlink(modelPath)
      logger.warn('Whisper model failed its integrity check and was removed', {
        model,
        reason: badContent
      })
      throw new AppError(
        `The ${model} model failed its integrity check and was removed. Download it again from Settings.`,
        ErrorCode.WHISPER_MODEL_INTEGRITY_FAILED
      )
    }
    if (changed || state === null) {
      // Nothing is deleted: the next job checks again.
      logger.warn('Whisper model changed while it was being verified', { model })
      throw new AppError(
        `The ${model} model changed while it was being checked. Try again.`,
        ErrorCode.WHISPER_MODEL_CHANGED_DURING_CHECK
      )
    }
    return state
  }

  async assertVerifiedModelUnchanged(
    model: WhisperModel,
    verified: VerifiedModelFile
  ): Promise<void> {
    const onPath = await stat(this.getModelPath(model)).catch(() => null)
    if (!onPath || !sameFileState(verified, onPath)) {
      // Not deleted: this only says the file is no longer the one we hashed.
      logger.warn('Whisper model changed after it was verified', { model })
      throw new AppError(
        `The ${model} model changed after it was checked. Try again.`,
        ErrorCode.WHISPER_MODEL_CHANGED_DURING_CHECK
      )
    }
  }

  async dispose(): Promise<void> {
    const pending = [...this.activeDownloads.values()]
    for (const d of pending) d.controller.abort()
    await Promise.allSettled(pending.map((d) => d.done))
  }

  /**
   * Abort every binary or model download in flight (Settings → Cancel). Each
   * one deletes its partial files and rejects as cancelled.
   *
   * @returns How many downloads were running
   */
  cancelDownloads(): number {
    const running = [...this.activeDownloads.values()]
    for (const d of running) d.controller.abort()
    return running.length
  }

  async ensureModel(
    model: WhisperModel,
    options?: { onProgress?: ProgressCallback; signal?: AbortSignal }
  ): Promise<string> {
    const modelPath = this.getModelPath(model)
    if (await this.isModelInstalled(model)) {
      logger.debug('Whisper model already installed', { model })
      return modelPath
    }

    await this.ensureDirs()
    await this.removeStaleModelTemps()
    const pin = MODEL_PINS[model]
    const filename = `ggml-${model}.bin`
    const url = `${LOCAL_WHISPER.HUGGINGFACE_MODEL_BASE_URL}/${pin.remoteFilename}`
    const tempPath = join(this.modelsDir, `${filename}.download-p${process.pid}-${randomUUID()}`)

    logger.info('Downloading whisper model', { model, url })

    // Own controller so `dispose()` can abort the download at quit; the
    // caller's signal feeds into it.
    const controller = new AbortController()
    const callerSignal = options?.signal
    const onCallerAbort = (): void => controller.abort()
    if (callerSignal?.aborted) controller.abort()
    else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })

    let finish: () => void = () => {}
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    this.activeDownloads.set(tempPath, { controller, done })

    try {
      await downloadToFile({
        url,
        destPath: tempPath,
        // Cap at the pinned size plus a small margin (large-v3 is ~3.1 GB).
        maxBytes: pin.sizeBytes + MODEL_SIZE_MARGIN_BYTES,
        // A mismatch deletes the temp file (catch below) and fails the download.
        expectedSha256: pin.sha256,
        signal: controller.signal,
        onProgress: options?.onProgress
          ? (bytes, total): void => {
              options.onProgress!({
                percent: total ? Math.round((bytes / total) * 100) : 0,
                downloadedBytes: bytes,
                totalBytes: total ?? 0
              })
            }
          : undefined
      })
      await rename(tempPath, modelPath)
      this.installedCache.set(model, true)
      return modelPath
    } catch (error) {
      await this.safeUnlink(tempPath)
      if (controller.signal.aborted) {
        throw new AppError(
          `Model download was cancelled: ${model}`,
          ErrorCode.WHISPER_MODEL_DOWNLOAD_FAILED
        )
      }
      if (error instanceof SecureDownloaderError) {
        throw new AppError(error.message, ErrorCode.WHISPER_MODEL_DOWNLOAD_FAILED)
      }
      throw AppError.from(error, ErrorCode.WHISPER_MODEL_DOWNLOAD_FAILED)
    } finally {
      callerSignal?.removeEventListener('abort', onCallerAbort)
      this.activeDownloads.delete(tempPath)
      finish()
    }
  }

  async deleteModel(model: WhisperModel): Promise<void> {
    const modelPath = this.getModelPath(model)
    try {
      await unlink(modelPath)
      this.installedCache.set(model, false)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError(
          `Model not found: ${model}`,
          ErrorCode.WHISPER_MODEL_NOT_FOUND
        )
      }
      throw AppError.from(error, ErrorCode.WHISPER_MODEL_NOT_FOUND)
    }
  }

  getModelInfo(model: WhisperModel): { size: number; installed: boolean } {
    return {
      size: LOCAL_WHISPER.MODEL_SIZES[model],
      installed: this.installedCache.get(model) ?? false
    }
  }

  /**
   * Re-hash every pinned file against its SHA. Used by `LocalWhisperService`
   * before every spawn to close the TOCTOU window.
   *
   * Also reads `.last-seen-revision` so the caller can log forensic context
   * alongside the spawn (which manifest revision the binary came from).
   *
   * @returns Spec, main-binary SHA, and persisted revision sentinel.
   */
  async verifyInstalledBinary(): Promise<VerifiedBinary> {
    const spec = this.getSpecOrThrow()
    const mainSha = await this.verifyAllFiles(spec)
    const revisionIndex = await this.readLastSeenRevision()
    return { spec, mainSha, revisionIndex }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getSpecOrThrow(): PlatformArtifactSpec {
    const c = classifyPlatform()
    if (!c.supported) {
      throw new AppError(c.reason, ErrorCode.WHISPER_UNSUPPORTED_PLATFORM)
    }
    return ARTIFACTS[c.platform]
  }

  private safeSpec(): PlatformArtifactSpec | null {
    const c = classifyPlatform()
    return c.supported ? ARTIFACTS[c.platform] : null
  }

  /** True when `ggml-<model>.bin` exists with exactly the pinned size. */
  private async hasPinnedSize(model: WhisperModel): Promise<boolean> {
    try {
      const info = await stat(this.getModelPath(model))
      return info.size === MODEL_PINS[model].sizeBytes
    } catch {
      return false
    }
  }

  /**
   * Streaming SHA-256 through an open handle; never buffers the whole model.
   * Aborts between chunks when `signal` fires.
   */
  private async hashHandle(
    handle: Awaited<ReturnType<typeof open>>,
    signal?: AbortSignal
  ): Promise<string> {
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES)
    let position = 0
    for (;;) {
      if (signal?.aborted) {
        throw new AppError('Model verification was cancelled', ErrorCode.TRANSCRIPTION_CANCELLED)
      }
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('hex')
  }

  /**
   * Remove `ggml-*.bin.download-*` files an earlier run left behind (quit or
   * crash mid-download). Never touches a download that is running now: this
   * process's own (tracked), another live Erfana instance sharing userData
   * (`-p<pid>-` in the name and that pid is alive), or an unmarked file
   * changed within the last `STALE_TEMP_MIN_AGE_MS`.
   */
  private async removeStaleModelTemps(): Promise<void> {
    try {
      const entries = await readdir(this.modelsDir)
      if (!Array.isArray(entries)) return
      for (const entry of entries) {
        const match = /^ggml-\w+\.bin\.download-(?:p(\d+)-)?[\w-]+$/.exec(entry)
        if (!match) continue
        const full = join(this.modelsDir, entry)
        if (this.activeDownloads.has(full)) continue
        const info = await stat(full).catch(() => null)
        if (!info) continue
        const ageMs = Date.now() - info.mtimeMs
        if (match[1] !== undefined) {
          const pid = Number(match[1])
          // A live pid protects its file, but a download that has not written
          // for an hour is dead whatever its pid says (pid reuse, hung process).
          if (pid !== process.pid && isProcessAlive(pid) && ageMs < STALE_TEMP_MAX_AGE_MS) continue
        } else if (ageMs < STALE_TEMP_MIN_AGE_MS) {
          continue
        }
        await this.safeUnlink(full)
      }
    } catch {
      // Best effort: a failed sweep must not block a download.
    }
  }

  private async ensureDirs(): Promise<void> {
    const { mkdir } = await import('fs/promises')
    await mkdir(this.binDir, { recursive: true })
    await mkdir(this.modelsDir, { recursive: true })
  }

  private async ensureDir(dir: string): Promise<void> {
    const { mkdir } = await import('fs/promises')
    await mkdir(dir, { recursive: true })
  }

  private async clearBinDir(): Promise<void> {
    await this.safeRm(this.binDir)
    await this.ensureDir(this.binDir)
  }

  /**
   * Strip `Zone.Identifier` ADS on Windows (MOTW) and `com.apple.quarantine`
   * xattr on macOS. Both are hints SmartScreen / Gatekeeper read to decide
   * whether to prompt on spawn. We've already SHA-verified the file, so
   * the marks are noise.
   */
  private async stripDownloadMarks(): Promise<void> {
    if (process.platform === 'win32') {
      // Zone.Identifier lives as an NTFS alternate data stream `:Zone.Identifier`.
      // Deleting the stream is a simple `rm` on the stream path.
      const binPath = this.getBinaryPath()
      const spec = this.getSpecOrThrow()
      const paths = [binPath, ...spec.files.sidecars.map((s) => join(this.binDir, s.filename))]
      for (const p of paths) {
        const adsPath = `${p}:Zone.Identifier`
        try {
          await unlink(adsPath)
        } catch (e) {
          // ENOENT = no MOTW on this file, fine.
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
            // Non-ENOENT failure usually means permission denied — if
            // bin/ ownership is wrong SmartScreen will keep prompting.
            // Surface at warn so operators can notice in production logs
            // rather than only during local debug.
            logger.warn('Could not strip Zone.Identifier', {
              path: adsPath,
              error: (e as Error).message
            })
          }
        }
      }
    } else if (process.platform === 'darwin') {
      // xattr -d com.apple.quarantine <path>
      try {
        const { execFile } = await import('child_process')
        const { promisify } = await import('util')
        const run = promisify(execFile)
        await run('xattr', ['-d', 'com.apple.quarantine', this.getBinaryPath()])
      } catch (e) {
        // Error 93 / "No such xattr" = not quarantined, fine. Any other error
        // is non-fatal — Gatekeeper may still prompt the first time, but the
        // signed-notarized binary should be accepted.
        logger.debug('Could not strip com.apple.quarantine', {
          error: (e as Error).message
        })
      }
    }
  }

  /**
   * Re-hash every pinned file under `binDir` and assert equality with the
   * source pin. Throws `WHISPER_BINARY_TAMPERED` on any mismatch.
   *
   * Streaming implementation — avoids slurping the whole file into memory so
   * future additions (e.g. GPU kernel blobs) don't balloon RSS on every
   * spawn.
   *
   * Returns the main-binary SHA for forensic-logging reuse. Sidecar SHAs
   * are not returned (they're derivable from the spec + still in the
   * denylist at the call site).
   */
  private async verifyAllFiles(spec: PlatformArtifactSpec): Promise<string> {
    const pins: FilePin[] = [spec.files.main, ...spec.files.sidecars]
    const { createReadStream } = await import('fs')
    let mainSha = ''
    for (const pin of pins) {
      const p = join(this.binDir, pin.filename)
      const actual = await new Promise<string>((resolve, reject) => {
        const hash = createHash('sha256')
        const stream = createReadStream(p)
        stream.on('data', (c) => hash.update(c))
        stream.on('error', reject)
        stream.on('end', () => resolve(hash.digest('hex')))
      })
      if (actual.toLowerCase() !== pin.sha256.toLowerCase()) {
        throw new AppError(
          `Whisper file "${pin.filename}" SHA-256 mismatch: expected ${pin.sha256}, got ${actual}`,
          ErrorCode.WHISPER_BINARY_TAMPERED
        )
      }
      // First pin is always the main binary by convention (see `PlatformArtifactSpec.files.main`).
      if (pin === spec.files.main) {
        mainSha = actual.toLowerCase()
      }
    }
    return mainSha
  }

  private async readSchemaVersion(): Promise<number | null> {
    try {
      const raw = await readFile(join(this.whisperDir, SCHEMA_SENTINEL_FILENAME), 'utf8')
      const n = Number.parseInt(raw.trim(), 10)
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  }

  private async writeSchemaVersion(n: number): Promise<void> {
    await writeFile(join(this.whisperDir, SCHEMA_SENTINEL_FILENAME), String(n), 'utf8')
  }

  /**
   * Read the persistent monotonic-revision floor. Returns `null` when the
   * sentinel is absent (fresh install) or unparseable (corrupt — treated as
   * "no floor yet", `MIN_REVISION_INDEX` takes over).
   */
  private async readLastSeenRevision(): Promise<number | null> {
    try {
      const raw = await readFile(
        join(this.whisperDir, LAST_SEEN_REVISION_FILENAME),
        'utf8'
      )
      const n = Number.parseInt(raw.trim(), 10)
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  }

  private async writeLastSeenRevision(n: number): Promise<void> {
    await this.ensureDir(this.whisperDir)
    await writeFile(
      join(this.whisperDir, LAST_SEEN_REVISION_FILENAME),
      String(n),
      'utf8'
    )
  }

  /**
   * One-time migration for v0.8.0–v0.9.3 users whose `{userData}/whisper/bin/`
   * contains partial/corrupt artifacts from the broken ggml-org URL path.
   * If schema sentinel is absent AND bin/ has content, wipe bin/ so Phase 4
   * can re-populate it from the signed release. Preserves `models/`.
   */
  private async performLegacyCruftMigration(): Promise<void> {
    const sentinelVersion = await this.readSchemaVersion()
    if (sentinelVersion === SCHEMA_VERSION) return

    let binDirHasContent = false
    try {
      const entries = await readdir(this.binDir)
      binDirHasContent = entries.length > 0
    } catch {
      // bin/ doesn't exist yet — nothing to migrate.
    }
    if (binDirHasContent) {
      logger.info('Clearing legacy whisper/bin/ for Phase 4 schema upgrade', {
        binDir: this.binDir
      })
      await this.safeRm(this.binDir)
    }
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await unlink(filePath)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to clean up file', { filePath })
      }
    }
  }

  private async safeRm(dirPath: string): Promise<void> {
    try {
      await rm(dirPath, { recursive: true, force: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to clean up directory', { dirPath })
      }
    }
  }
}

/** Singleton instance */
export const whisperModelManager = new WhisperModelManager()

/** Factory function for testing */
export function createWhisperModelManager(): IWhisperModelManager {
  return new WhisperModelManager()
}
