/**
 * Whisper model manager
 *
 * Manages the whisper.cpp binary and GGML model files – downloading,
 * storing, listing, and deleting them. All files live under
 * `app.getPath('userData')/whisper/`.
 *
 * Storage layout:
 *   {userData}/whisper/
 *   ├── bin/
 *   │   └── whisper-cli          # The whisper.cpp CLI binary
 *   └── models/
 *       ├── ggml-tiny.bin
 *       ├── ggml-base.bin
 *       └── ggml-small.bin       # etc – downloaded on demand
 *
 * @see Issue #111 – Local Whisper transcription backend
 */
import { app } from 'electron'
import { join } from 'path'
import { createWriteStream } from 'fs'
import {
  mkdir,
  access,
  chmod,
  readdir,
  unlink,
  rename,
  rm
} from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { LOCAL_WHISPER } from '../../shared/constants'
import { AppError, ErrorCode } from '../../shared/errors'
import type { WhisperModel } from '../../shared/ipc/transcription-schema'
import { logger } from './LoggingService'

const execFileAsync = promisify(execFile)

/** Progress callback for download operations */
export type ProgressCallback = (progress: {
  percent: number
  downloadedBytes: number
  totalBytes: number
}) => void

/**
 * Whisper model manager interface
 */
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
}

/**
 * Map `process.arch` to whisper.cpp release arch suffix
 */
function getArchSuffix(): string {
  if (process.platform !== 'darwin') {
    throw new AppError(
      `Local Whisper transcription is only supported on macOS (current platform: ${process.platform})`,
      ErrorCode.WHISPER_UNSUPPORTED_PLATFORM
    )
  }

  switch (process.arch) {
    case 'arm64':
      return 'arm64'
    case 'x64':
      return 'x86_64'
    default:
      throw new AppError(
        `Unsupported architecture: ${process.arch}`,
        ErrorCode.WHISPER_UNSUPPORTED_PLATFORM
      )
  }
}

/**
 * Whisper model manager implementation
 */
class WhisperModelManager implements IWhisperModelManager {
  private readonly whisperDir: string
  private readonly binDir: string
  private readonly modelsDir: string

  /** Cache of installed model states (populated lazily) */
  private installedCache = new Map<WhisperModel, boolean>()

  constructor() {
    this.whisperDir = join(app.getPath('userData'), LOCAL_WHISPER.WHISPER_DIR)
    this.binDir = join(this.whisperDir, LOCAL_WHISPER.BIN_DIR)
    this.modelsDir = join(this.whisperDir, LOCAL_WHISPER.MODELS_DIR)
  }

  /**
   * Ensure the directory structure exists
   */
  private async ensureDirs(): Promise<void> {
    await mkdir(this.binDir, { recursive: true })
    await mkdir(this.modelsDir, { recursive: true })
  }

  getWhisperDir(): string {
    return this.whisperDir
  }

  getBinaryPath(): string {
    return join(this.binDir, LOCAL_WHISPER.BINARY_NAME)
  }

  getModelPath(model: WhisperModel): string {
    return join(this.modelsDir, `ggml-${model}.bin`)
  }

  async isBinaryInstalled(): Promise<boolean> {
    try {
      await access(this.getBinaryPath(), fsConstants.X_OK)
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

      // Mark models not found as not installed
      for (const m of LOCAL_WHISPER.SUPPORTED_MODELS) {
        if (!models.includes(m)) {
          this.installedCache.set(m, false)
        }
      }

      return models
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return []
      }
      throw error
    }
  }

  /**
   * Ensure the whisper.cpp binary is available, downloading if necessary
   *
   * @returns Path to the executable binary
   */
  async ensureBinary(options?: {
    onProgress?: ProgressCallback
    signal?: AbortSignal
  }): Promise<string> {
    const binaryPath = this.getBinaryPath()

    // Already installed?
    if (await this.isBinaryInstalled()) {
      logger.debug('Whisper binary already installed', { path: binaryPath })
      return binaryPath
    }

    await this.ensureDirs()

    const arch = getArchSuffix()
    const zipFilename = `whisper-cli-v${LOCAL_WHISPER.VERSION}-bin-macos-${arch}.zip`
    const url = `${LOCAL_WHISPER.GITHUB_RELEASE_BASE_URL}/v${LOCAL_WHISPER.VERSION}/${zipFilename}`
    const tempZip = join(tmpdir(), `erfana-whisper-${randomUUID()}.zip`)
    const extractDir = join(tmpdir(), `erfana-whisper-extract-${randomUUID()}`)

    logger.info('Downloading whisper binary', { url, arch })

    try {
      // Download zip
      await this.downloadFile(url, tempZip, options?.onProgress, options?.signal)

      // Extract zip
      await mkdir(extractDir, { recursive: true })
      await execFileAsync('unzip', ['-o', tempZip, '-d', extractDir])

      // Find the binary in the extracted content
      const extractedBinaryPath = await this.findExtractedBinary(extractDir)

      // Move binary to final location
      await this.copyFile(extractedBinaryPath, binaryPath)
      await chmod(binaryPath, 0o755)

      logger.info('Whisper binary installed', { path: binaryPath })
      return binaryPath
    } catch (error) {
      // Clean up partial binary on failure
      await this.safeUnlink(binaryPath)

      if (options?.signal?.aborted) {
        throw new AppError(
          'Binary download was cancelled',
          ErrorCode.WHISPER_BINARY_DOWNLOAD_FAILED
        )
      }

      throw AppError.from(error, ErrorCode.WHISPER_BINARY_DOWNLOAD_FAILED)
    } finally {
      // Always clean up temp files
      await this.safeUnlink(tempZip)
      await this.safeRm(extractDir)
    }
  }

  /**
   * Ensure a GGML model is available, downloading if necessary
   *
   * @param model - Model size to download
   * @returns Path to the model file
   */
  async ensureModel(
    model: WhisperModel,
    options?: { onProgress?: ProgressCallback; signal?: AbortSignal }
  ): Promise<string> {
    const modelPath = this.getModelPath(model)

    // Already installed?
    if (await this.isModelInstalled(model)) {
      logger.debug('Whisper model already installed', { model, path: modelPath })
      return modelPath
    }

    await this.ensureDirs()

    const filename = `ggml-${model}.bin`
    const url = `${LOCAL_WHISPER.HUGGINGFACE_MODEL_BASE_URL}/${filename}`
    const tempPath = join(this.modelsDir, `${filename}.download-${randomUUID()}`)

    logger.info('Downloading whisper model', { model, url })

    try {
      // Download to temp file first (atomic write)
      await this.downloadFile(url, tempPath, options?.onProgress, options?.signal)

      // Atomic rename to final path
      await rename(tempPath, modelPath)

      this.installedCache.set(model, true)
      logger.info('Whisper model installed', { model, path: modelPath })
      return modelPath
    } catch (error) {
      // Clean up partial download
      await this.safeUnlink(tempPath)

      if (options?.signal?.aborted) {
        throw new AppError(
          `Model download was cancelled: ${model}`,
          ErrorCode.WHISPER_MODEL_DOWNLOAD_FAILED
        )
      }

      throw AppError.from(error, ErrorCode.WHISPER_MODEL_DOWNLOAD_FAILED)
    }
  }

  /**
   * Delete an installed model
   *
   * @throws AppError with WHISPER_MODEL_NOT_FOUND if model is not installed
   */
  async deleteModel(model: WhisperModel): Promise<void> {
    const modelPath = this.getModelPath(model)

    try {
      await unlink(modelPath)
      this.installedCache.set(model, false)
      logger.info('Whisper model deleted', { model, path: modelPath })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new AppError(
          `Model not found: ${model}`,
          ErrorCode.WHISPER_MODEL_NOT_FOUND
        )
      }
      throw AppError.from(error, ErrorCode.WHISPER_MODEL_NOT_FOUND)
    }
  }

  /**
   * Get model info (size and installation status)
   *
   * Returns cached installation status. Call `isModelInstalled()` or
   * `listInstalledModels()` first to populate the cache.
   */
  getModelInfo(model: WhisperModel): { size: number; installed: boolean } {
    return {
      size: LOCAL_WHISPER.MODEL_SIZES[model],
      installed: this.installedCache.get(model) ?? false
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Download a file from a URL to a local path with progress reporting
   *
   * Uses Node.js native fetch() (available in Electron's Node 22).
   * Streams response body to a WriteStream for memory efficiency.
   */
  private async downloadFile(
    url: string,
    destPath: string,
    onProgress?: ProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    // Combine user-provided abort signal with download timeout
    const timeoutSignal = AbortSignal.timeout(LOCAL_WHISPER.DOWNLOAD_TIMEOUT)
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal

    const response = await fetch(url, { signal: combinedSignal })

    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('Download failed: empty response body')
    }

    const totalBytes = Number(response.headers.get('content-length') || 0)
    let downloadedBytes = 0

    const fileStream = createWriteStream(destPath)

    // Create a transform that tracks progress
    const reader = response.body.getReader()
    const progressStream = new Readable({
      async read(): Promise<void> {
        try {
          const { done, value } = await reader.read()
          if (done) {
            this.push(null)
            return
          }
          downloadedBytes += value.byteLength
          if (onProgress && totalBytes > 0) {
            onProgress({
              percent: Math.round((downloadedBytes / totalBytes) * 100),
              downloadedBytes,
              totalBytes
            })
          }
          this.push(Buffer.from(value))
        } catch (error) {
          this.destroy(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })

    try {
      await pipeline(progressStream, fileStream)
    } catch (error) {
      // Clean up partial file on error
      await this.safeUnlink(destPath)
      throw error
    }
  }

  /**
   * Find the whisper-cli binary inside an extracted zip directory
   *
   * Searches recursively for a file named 'whisper-cli' (or 'main' as
   * some releases name it).
   */
  private async findExtractedBinary(extractDir: string): Promise<string> {
    const candidates = [LOCAL_WHISPER.BINARY_NAME, 'main']

    // Check top-level and one level deep
    const topEntries = await readdir(extractDir, { withFileTypes: true })

    for (const entry of topEntries) {
      if (entry.isFile() && candidates.includes(entry.name)) {
        return join(extractDir, entry.name)
      }
      if (entry.isDirectory()) {
        try {
          const subEntries = await readdir(join(extractDir, entry.name))
          for (const sub of subEntries) {
            if (candidates.includes(sub)) {
              return join(extractDir, entry.name, sub)
            }
          }
        } catch {
          // Skip unreadable subdirs
        }
      }
    }

    throw new Error(
      `Could not find whisper binary in extracted archive (looked for: ${candidates.join(', ')})`
    )
  }

  /**
   * Copy a file using rename (same filesystem) or read+write (cross-filesystem)
   */
  private async copyFile(src: string, dest: string): Promise<void> {
    try {
      await rename(src, dest)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EXDEV') {
        // Cross-filesystem – fall back to copy
        const { copyFile } = await import('fs/promises')
        await copyFile(src, dest)
      } else {
        throw error
      }
    }
  }

  /**
   * Safe unlink – ignores ENOENT
   */
  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await unlink(filePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        logger.warn('Failed to clean up file', { filePath })
      }
    }
  }

  /**
   * Safe recursive directory removal – ignores ENOENT
   */
  private async safeRm(dirPath: string): Promise<void> {
    try {
      await rm(dirPath, { recursive: true, force: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
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
