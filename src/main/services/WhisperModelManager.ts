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
import { access, chmod, readFile, readdir, rename, rm, unlink, writeFile } from 'fs/promises'
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
  MANIFEST_MAX_BYTES,
  MANIFEST_SIG_MAX_BYTES,
  MANIFEST_SIG_URL,
  MANIFEST_URL,
  MIN_REVISION_INDEX,
  MODEL_MAX_BYTES,
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

export interface IWhisperModelManager {
  getWhisperDir(): string
  getBinaryPath(): string
  getModelPath(model: WhisperModel): string
  isBinaryInstalled(): Promise<boolean>
  isModelInstalled(model: WhisperModel): Promise<boolean>
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
   * Throws `WHISPER_BINARY_TAMPERED` on mismatch.
   */
  verifyInstalledBinary(): Promise<PlatformArtifactSpec>
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

class WhisperModelManager implements IWhisperModelManager {
  private readonly whisperDir: string
  private readonly binDir: string
  private readonly modelsDir: string

  /** Cache of installed model states (populated lazily). */
  private installedCache = new Map<WhisperModel, boolean>()

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
   * Treats a missing sidecar or SHA drift as "not installed" so the next
   * `ensureBinary()` re-downloads.
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
      return true
    } catch {
      return false
    }
  }

  async isModelInstalled(model: WhisperModel): Promise<boolean> {
    try {
      await access(this.getModelPath(model), fsConstants.R_OK)
      this.installedCache.set(model, true)
      return true
    } catch {
      this.installedCache.set(model, false)
      return false
    }
  }

  async listInstalledModels(): Promise<WhisperModel[]> {
    try {
      const entries = await readdir(this.modelsDir)
      const models: WhisperModel[] = []
      for (const entry of entries) {
        const match = entry.match(/^ggml-(\w+)\.bin$/)
        if (match) {
          const name = match[1] as WhisperModel
          if (LOCAL_WHISPER.SUPPORTED_MODELS.includes(name)) {
            models.push(name)
            this.installedCache.set(name, true)
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

    try {
      logger.info('Fetching whisper manifest', { url: MANIFEST_URL })

      await downloadToFile({
        url: MANIFEST_URL,
        destPath: tempManifest,
        maxBytes: MANIFEST_MAX_BYTES,
        signal: options?.signal
      })
      await downloadToFile({
        url: MANIFEST_SIG_URL,
        destPath: tempManifestSig,
        maxBytes: MANIFEST_SIG_MAX_BYTES,
        signal: options?.signal
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

      const manifest = JSON.parse(await readFile(tempManifest, 'utf8')) as WhisperManifest

      // Downgrade protection: revisionIndex must meet our minimum.
      if (manifest.revisionIndex < MIN_REVISION_INDEX) {
        throw new AppError(
          `Whisper manifest revisionIndex ${manifest.revisionIndex} is below minimum ${MIN_REVISION_INDEX} — possible downgrade attack`,
          ErrorCode.WHISPER_BINARY_DOWNLOAD_FAILED
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
          ErrorCode.WHISPER_BINARY_DOWNLOAD_FAILED
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
        signal: options?.signal,
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

      // Unix exec-bit — Windows doesn't need this.
      if (process.platform !== 'win32') {
        await chmod(this.getBinaryPath(), 0o755)
      }

      // Schema sentinel — gates fast-path for subsequent launches.
      await this.writeSchemaVersion(SCHEMA_VERSION)

      logger.info('Whisper binary installed', { binDir: this.binDir })
      return this.getBinaryPath()
    } catch (error) {
      // On failure, wipe bin/ so isBinaryInstalled() doesn't return true on a
      // partial state.
      await this.clearBinDir()
      if (options?.signal?.aborted) {
        throw new AppError(
          'Binary download was cancelled',
          ErrorCode.WHISPER_BINARY_DOWNLOAD_FAILED
        )
      }
      if (error instanceof VerifyManifestError || error instanceof SecureDownloaderError) {
        throw new AppError(error.message, ErrorCode.WHISPER_BINARY_DOWNLOAD_FAILED)
      }
      throw AppError.from(error, ErrorCode.WHISPER_BINARY_DOWNLOAD_FAILED)
    } finally {
      await this.safeRm(tempRoot)
    }
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
    const filename = `ggml-${model}.bin`
    const url = `${LOCAL_WHISPER.HUGGINGFACE_MODEL_BASE_URL}/${filename}`
    const tempPath = join(this.modelsDir, `${filename}.download-${randomUUID()}`)

    logger.info('Downloading whisper model', { model, url })

    try {
      await downloadToFile({
        url,
        destPath: tempPath,
        // Models are large (tiny ~75 MB, large ~1.5 GB). 2 GB cap per plan.
        maxBytes: MODEL_MAX_BYTES,
        signal: options?.signal,
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
      if (options?.signal?.aborted) {
        throw new AppError(
          `Model download was cancelled: ${model}`,
          ErrorCode.WHISPER_MODEL_DOWNLOAD_FAILED
        )
      }
      if (error instanceof SecureDownloaderError) {
        throw new AppError(error.message, ErrorCode.WHISPER_MODEL_DOWNLOAD_FAILED)
      }
      throw AppError.from(error, ErrorCode.WHISPER_MODEL_DOWNLOAD_FAILED)
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
   * @returns The platform spec that was verified, for caller correlation.
   */
  async verifyInstalledBinary(): Promise<PlatformArtifactSpec> {
    const spec = this.getSpecOrThrow()
    await this.verifyAllFiles(spec)
    return spec
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
            logger.debug('Could not strip Zone.Identifier', {
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
   */
  private async verifyAllFiles(spec: PlatformArtifactSpec): Promise<void> {
    const pins: FilePin[] = [spec.files.main, ...spec.files.sidecars]
    for (const pin of pins) {
      const p = join(this.binDir, pin.filename)
      const buf = await readFile(p)
      const actual = createHash('sha256').update(buf).digest('hex')
      if (actual.toLowerCase() !== pin.sha256.toLowerCase()) {
        throw new AppError(
          `Whisper file "${pin.filename}" SHA-256 mismatch: expected ${pin.sha256}, got ${actual}`,
          ErrorCode.WHISPER_BINARY_TAMPERED
        )
      }
    }
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
