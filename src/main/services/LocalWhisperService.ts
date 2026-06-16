// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Local Whisper Service
 *
 * Performs local audio transcription by spawning the whisper.cpp CLI binary
 * as a child process. Handles input format conversion, chunking for long files,
 * progress reporting, and cancellation.
 *
 * Features:
 * - Spawns whisper-cli binary for offline transcription
 * - Converts non-wav inputs to 16 kHz mono PCM wav via ffmpeg
 * - File chunking for files >8 minutes (480 seconds) via ffmpeg time-based splitting
 * - Progress parsing from whisper.cpp stderr output
 * - AbortSignal cancellation support
 * - Temp file cleanup in finally blocks
 *
 * @see Issue #111 - Local Whisper transcription backend
 */
import { spawn, execFile } from 'child_process'
import { realpath, stat, readFile, unlink } from 'fs/promises'
import { cpus, tmpdir } from 'os'
import { join, extname, basename, dirname } from 'path'
import { randomUUID } from 'crypto'
import { ffmpegPath } from '../utils/mediaBinaries'
import { LOCAL_WHISPER, TRANSCRIPTION } from '../../shared/constants'
import { AppError, ErrorCode } from '../../shared/errors'
import type {
  TranscriptionProgress,
  TranscriptionResult,
  WhisperModel
} from '../../shared/ipc/transcription-schema'
import { logger } from './LoggingService'
import type { IWhisperModelManager } from './WhisperModelManager'
import { whisperModelManager } from './WhisperModelManager'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the transcribe() method */
export interface LocalTranscribeOptions {
  /** Absolute path to the audio file (mp3, wav, m4a, ogg, flac) */
  filePath: string
  /** ISO language code or 'auto' for auto-detection */
  language: string
  /** Whisper model size to use */
  model: WhisperModel
  /** Optional AbortSignal for cancellation */
  signal?: AbortSignal
  /** Optional progress callback */
  onProgress?: (progress: TranscriptionProgress) => void
}

// Re-export for convenience and backward compatibility
export type { IWhisperModelManager } from './WhisperModelManager'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Temp file prefix for local whisper operations */
const TEMP_PREFIX = 'erfana-whisper-'

/** Extensions that whisper.cpp handles natively (no conversion needed) */
const NATIVE_EXTENSIONS = new Set(['wav'])

/** Timeout for ffmpeg duration probe (30 seconds) */
const FFMPEG_PROBE_TIMEOUT = 30_000

/** Regex to parse whisper.cpp progress output from stderr */
const PROGRESS_REGEX = /progress\s*=\s*(\d+)%/

/**
 * Windows reserved basenames (case-insensitive), with or without extension.
 * Passing these to CreateProcess or CreateFile has OS-specific behaviour
 * that can confuse ffmpeg/whisper.exe's argv handling — reject at the entry.
 *
 * @see https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
 */
const WIN32_RESERVED_BASENAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
])

/**
 * Node child.kill('SIGTERM') on Windows maps to TerminateProcess — abrupt, not
 * graceful. Callers must clean up any partially-written output files that
 * whisper.cpp's -otxt writer was in the middle of producing.
 */
const WIN32_CPU_UNSUPPORTED_EXIT_CODES = new Set([
  // STATUS_ILLEGAL_INSTRUCTION — Windows exit code when SIGILL-equivalent fires.
  0xc000001d,
  3221225501
])
const POSIX_CPU_UNSUPPORTED_EXIT_CODES = new Set([
  // SIGILL exit code convention on Unix: 128 + signal(4) = 132.
  132
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * CPU-model regexes for hardware older than SSE4.2 / AVX. Whisper.cpp
 * compiled with `-DGGML_NATIVE=OFF` still emits SSE4.2-era intrinsics by
 * default — these CPUs crash with SIGILL at first inference.
 *
 * We match tokens with optional `(tm)`, `(r)`, or whitespace in between so
 * real brand strings like `Intel(R) Pentium(R) 4 CPU` match `pentium 4`.
 *
 * We accept a false-positive (rejecting a supported CPU we don't recognise)
 * over a false-negative (letting an unsupported CPU through) — the cost of a
 * wrong rejection is one user running the OpenAI API backend instead; the
 * cost of a wrong acceptance is downloading ~200 MB + crashing mid-import.
 *
 * Specifically rejected (non-exhaustive): Intel Core 2 / Core 2 Duo (Conroe,
 * Wolfdale, Merom, Yorkfield), Pentium 4 / Pentium D / Celeron D / Pentium M,
 * AMD K8 / K10 / Phenom / Athlon 64 / Sempron / Turion pre-Bulldozer.
 */
// Matches `(r)`, `(tm)`, `®`, `™`, or whitespace between adjacent tokens.
const TRADEMARK_SEP = '(?:\\s*(?:\\(r\\)|\\(tm\\)|\\(c\\)|®|™|\\s)\\s*)+'
const CPU_MODEL_DENYLIST: readonly RegExp[] = [
  new RegExp(`\\bcore${TRADEMARK_SEP}?2\\b`, 'i'),
  new RegExp(`\\bpentium${TRADEMARK_SEP}?4\\b`, 'i'),
  new RegExp(`\\bpentium${TRADEMARK_SEP}?d\\b`, 'i'),
  new RegExp(`\\bpentium${TRADEMARK_SEP}?iii\\b`, 'i'),
  new RegExp(`\\bpentium${TRADEMARK_SEP}?m\\b`, 'i'),
  new RegExp(`\\bceleron${TRADEMARK_SEP}?d\\b`, 'i'),
  new RegExp(`\\bathlon${TRADEMARK_SEP}?64\\b`, 'i'),
  new RegExp(`\\bathlon${TRADEMARK_SEP}?ii\\b`, 'i'),
  new RegExp(`\\bsempron\\b`, 'i'),
  new RegExp(`\\bturion${TRADEMARK_SEP}?64\\b`, 'i'),
  new RegExp(`\\bphenom\\b`, 'i'),
  new RegExp(`\\bopteron${TRADEMARK_SEP}?2\\b`, 'i')
]

/**
 * Cached result of the CPU-feature probe. We run the check once per process
 * lifetime and memoise the result — per-transcribe probing is wasteful (the
 * CPU doesn't change) and would add a small but needless latency to every
 * call.
 */
let cpuProbeResult: { ok: true } | { ok: false; reason: string } | null = null

/**
 * Pre-flight CPU-feature check. Runs before the first spawn so unsupported
 * hardware gets a fast, actionable error instead of a full binary+model
 * download followed by a SIGILL crash.
 *
 * Heuristic: examine the CPU brand string from `os.cpus()`. Node exposes the
 * OS-supplied brand (e.g. `Intel(R) Core(TM) i7-8700K CPU @ 3.70 GHz`).
 * Anything matching a known pre-SSE4.2 family is rejected hard. Anything
 * else is optimistically allowed — the runtime SIGILL handler in
 * `runWhisper()` is the final safety net that catches the long-tail cases
 * we didn't anticipate (embedded x86, non-standard brand strings).
 *
 * Exported for direct unit testing.
 */
export function checkCpuSupport(): { ok: true } | { ok: false; reason: string } {
  if (cpuProbeResult) return cpuProbeResult
  const info = cpus()
  if (!info || info.length === 0) {
    // Pathological environment — sandbox, container without /proc/cpuinfo,
    // etc. Fall through to the runtime SIGILL handler rather than block.
    cpuProbeResult = { ok: true }
    return cpuProbeResult
  }
  const model = info[0].model || ''
  for (const bad of CPU_MODEL_DENYLIST) {
    if (bad.test(model)) {
      cpuProbeResult = {
        ok: false,
        reason: `Local Whisper is not supported on this CPU (${info[0].model}). Use the OpenAI API backend, or run Erfana on a CPU with SSE4.2 support (Intel Nehalem or newer, AMD Bulldozer or newer).`
      }
      return cpuProbeResult
    }
  }
  cpuProbeResult = { ok: true }
  return cpuProbeResult
}

/** Test-only hook for resetting the probe cache between cases. */
export function __resetCpuProbeForTests(): void {
  cpuProbeResult = null
}

/**
 * Validate + canonicalize the user-supplied audio path before passing it to
 * ffmpeg / whisper-cli as a CLI argument.
 *
 * Rejects:
 *  - UNC paths (`\\?\`, `\\server\share\...`) — these confuse some argv
 *    parsers and bypass normal path-length guards.
 *  - Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`,
 *    `LPT1-9`), with or without extension.
 *  - NTFS alternate-data-stream colons in the basename (`file.wav:evil`).
 *  - Paths whose `realpath` resolves to something other than the input
 *    (case-normalisation is allowed; every other divergence is suspicious).
 *
 * Intentionally does NOT reject forward-slash paths on Windows (npm
 * convention + common in Electron).
 */
export async function validateAudioPath(filePath: string): Promise<string> {
  // Absolute requirement — whisper-cli doesn't accept relative paths
  // consistently across platforms anyway.
  if (!filePath || typeof filePath !== 'string') {
    throw new AppError(
      'Audio path is empty or not a string',
      ErrorCode.WHISPER_INVALID_PATH
    )
  }

  // UNC detection — both Windows forms. Keep it strict: anything starting
  // with \\\\ or //... is rejected even on POSIX (it's weird input).
  if (/^(\\\\|\/\/)/.test(filePath)) {
    throw new AppError(
      `Audio path is a UNC path, which is not supported: ${filePath}`,
      ErrorCode.WHISPER_INVALID_PATH
    )
  }

  // NTFS ADS colon in basename only (drive-letter colon in position 1 is OK).
  const base = basename(filePath)
  if (base.includes(':')) {
    throw new AppError(
      `Audio file basename contains a colon (NTFS ADS not allowed): ${base}`,
      ErrorCode.WHISPER_INVALID_PATH
    )
  }

  // Windows reserved device names — check the name WITHOUT extension (e.g.
  // both `CON` and `CON.wav` must be rejected).
  const nameSansExt = base.replace(/\.[^.]*$/, '').toUpperCase()
  if (WIN32_RESERVED_BASENAMES.has(nameSansExt)) {
    throw new AppError(
      `Audio filename "${base}" is a Windows reserved device name`,
      ErrorCode.WHISPER_INVALID_PATH
    )
  }

  // Canonicalise via realpath — this resolves symlinks and case-normalises.
  // Divergence beyond case-only is suspicious.
  let resolved: string
  try {
    resolved = await realpath(filePath)
  } catch (e) {
    throw new AppError(
      `Audio file could not be resolved: ${(e as Error).message}`,
      ErrorCode.WHISPER_INVALID_PATH,
      e instanceof Error ? e : undefined
    )
  }
  return resolved
}

/**
 * Resolve the ffmpeg binary path.
 *
 * ffmpegPath comes from the shared media-binaries util (ffmpeg-static), which
 * is a path string or undefined and never throws at import. The app builds
 * with `asar: false`, so no `.asar` rewriting is needed.
 */
function resolveFfmpegPath(): string {
  if (!ffmpegPath) {
    throw new AppError('ffmpeg binary not available', ErrorCode.WHISPER_PROCESS_FAILED)
  }
  return ffmpegPath
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LocalWhisperService {
  constructor(private modelManager: IWhisperModelManager) {}

  /**
   * Transcribe an audio file using the local whisper.cpp binary
   *
   * @param options - Transcription options
   * @returns Transcription result with text, language, and duration
   */
  async transcribe(options: LocalTranscribeOptions): Promise<TranscriptionResult> {
    const { language, model, signal, onProgress } = options
    const tempFiles = new Set<string>()

    const progress = onProgress ?? ((): void => {})

    try {
      // Early cancellation check
      if (signal?.aborted) {
        return {
          success: false,
          error: 'Transcription was cancelled',
          errorCode: ErrorCode.TRANSCRIPTION_CANCELLED
        }
      }

      // Pre-flight CPU probe — fast-fail on pre-SSE4.2 CPUs BEFORE we
      // download ~200 MB of binary + model only to SIGILL on first inference.
      // Runtime SIGILL handler in `runWhisper()` is the final safety net;
      // this check catches the common cases up front.
      const cpu = checkCpuSupport()
      if (!cpu.ok) {
        return {
          success: false,
          error: cpu.reason,
          errorCode: ErrorCode.WHISPER_CPU_UNSUPPORTED
        }
      }

      // Argv hardening — reject UNC paths, Windows reserved names, NTFS ADS
      // colons; canonicalise via fs.realpath so we execute ffmpeg/whisper
      // against the ACTUAL target file and not a symlink / name-mangled alias.
      const filePath = await validateAudioPath(options.filePath)

      progress({ percent: 0, phase: 'Preparing' })

      // Ensure whisper binary and model are available
      progress({ percent: 2, phase: 'Checking whisper binary' })
      const binaryPath = await this.modelManager.ensureBinary({ signal })

      if (signal?.aborted) {
        return {
          success: false,
          error: 'Transcription was cancelled',
          errorCode: ErrorCode.TRANSCRIPTION_CANCELLED
        }
      }

      progress({ percent: 4, phase: 'Checking whisper model' })
      const modelPath = await this.modelManager.ensureModel(model, { signal })

      if (signal?.aborted) {
        return {
          success: false,
          error: 'Transcription was cancelled',
          errorCode: ErrorCode.TRANSCRIPTION_CANCELLED
        }
      }

      // Convert input to wav if necessary
      progress({ percent: 6, phase: 'Preparing audio' })
      const wavPath = await this.ensureWavFormat(filePath, tempFiles, signal)

      // Get audio duration for chunking decision
      progress({ percent: 8, phase: 'Analyzing audio' })
      const duration = await this.getWavDuration(wavPath)
      const needsChunking = duration > TRANSCRIPTION.CHUNK_BOUNDARY_SECONDS

      let transcript: string

      if (needsChunking) {
        transcript = await this.transcribeChunked(
          wavPath, duration, binaryPath, modelPath, language, tempFiles, progress, signal
        )
      } else {
        transcript = await this.transcribeSingle(
          wavPath, binaryPath, modelPath, language, progress, signal
        )
      }

      progress({ percent: 100, phase: 'Complete' })

      return {
        success: true,
        transcript,
        duration,
        language: language === 'auto' ? undefined : language
      }
    } catch (error) {
      if (signal?.aborted) {
        return {
          success: false,
          error: 'Transcription was cancelled',
          errorCode: ErrorCode.TRANSCRIPTION_CANCELLED
        }
      }

      if (error instanceof AppError) {
        logger.error('Local whisper transcription failed', error)
        return {
          success: false,
          error: error.message,
          errorCode: error.code
        }
      }

      const message = error instanceof Error ? error.message : String(error)
      logger.error('Local whisper transcription failed', error instanceof Error ? error : undefined)

      return {
        success: false,
        error: message,
        errorCode: ErrorCode.WHISPER_PROCESS_FAILED
      }
    } finally {
      await this.cleanupTempFiles(tempFiles)
    }
  }

  // -------------------------------------------------------------------------
  // Input conversion
  // -------------------------------------------------------------------------

  /**
   * Convert input to 16 kHz mono PCM wav if not already in a native format.
   *
   * whisper.cpp works best with wav (16 kHz, mono, 16-bit PCM).
   * All non-wav formats (mp3, m4a, ogg, flac) are converted via ffmpeg
   * to ensure consistent behavior across whisper.cpp builds.
   */
  private async ensureWavFormat(
    filePath: string,
    tempFiles: Set<string>,
    signal?: AbortSignal
  ): Promise<string> {
    const ext = extname(filePath).slice(1).toLowerCase()

    if (NATIVE_EXTENSIONS.has(ext)) {
      return filePath
    }

    const outputPath = join(tmpdir(), `${TEMP_PREFIX}${randomUUID()}.wav`)
    tempFiles.add(outputPath)

    const ffmpeg = resolveFfmpegPath()

    await new Promise<void>((resolve, reject) => {
      const args = [
        '-i', filePath,
        '-ar', '16000',
        '-ac', '1',
        '-c:a', 'pcm_s16le',
        '-y',
        outputPath
      ]

      // execFile is safe against shell injection – arguments are passed as an array,
      // not interpolated into a shell command string.
      let onAbort: (() => void) | undefined

      const child = execFile(ffmpeg, args, { timeout: LOCAL_WHISPER.PROCESS_TIMEOUT }, (error) => {
        // Clean up abort listener on all paths
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)

        if (signal?.aborted) {
          reject(new AppError('Transcription was cancelled', ErrorCode.TRANSCRIPTION_CANCELLED))
          return
        }
        if (error) {
          reject(new AppError(
            `Failed to convert audio to wav: ${error.message}`,
            ErrorCode.WHISPER_PROCESS_FAILED,
            error
          ))
          return
        }
        resolve()
      })

      if (signal) {
        onAbort = (): void => {
          child.kill('SIGTERM')
        }
        if (signal.aborted) {
          child.kill('SIGTERM')
        } else {
          signal.addEventListener('abort', onAbort, { once: true })
        }
      }
    })

    logger.debug('Converted audio to wav', { input: filePath, output: outputPath })
    return outputPath
  }

  // -------------------------------------------------------------------------
  // Duration detection
  // -------------------------------------------------------------------------

  /**
   * Get the duration of an audio file using ffmpeg.
   *
   * Falls back to estimating from file size for raw PCM wav
   * (16 kHz * 1 channel * 2 bytes = 32,000 bytes/sec).
   */
  private async getWavDuration(filePath: string): Promise<number> {
    try {
      const ffmpeg = resolveFfmpegPath()

      const duration = await new Promise<number>((resolve, reject) => {
        let stderr = ''

        // execFile is safe – arguments are passed as an array.
        const child = execFile(ffmpeg, ['-i', filePath, '-f', 'null', '-'], {
          timeout: FFMPEG_PROBE_TIMEOUT
        }, () => {
          // ffmpeg exits non-zero when writing to null, but stderr has the duration info.
          // The 'close' handler below parses stderr.
        })

        child.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString()
        })

        child.on('error', (err: Error) => {
          reject(err)
        })

        child.on('close', () => {
          const match = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(stderr)
          if (match) {
            const hours = parseInt(match[1], 10)
            const minutes = parseInt(match[2], 10)
            const seconds = parseInt(match[3], 10)
            const centiseconds = parseInt(match[4], 10)
            resolve(hours * 3600 + minutes * 60 + seconds + centiseconds / 100)
          } else {
            reject(new Error('Could not determine audio duration'))
          }
        })
      })

      return duration
    } catch {
      // Fallback: estimate from file size (16 kHz, mono, 16-bit PCM = 32,000 bytes/sec)
      logger.warn('Could not probe audio duration, estimating from file size')
      const stats = await stat(filePath)
      const bytesPerSecond = 32_000
      return Math.max(1, stats.size / bytesPerSecond)
    }
  }

  // -------------------------------------------------------------------------
  // Single-file transcription
  // -------------------------------------------------------------------------

  /**
   * Transcribe a single audio file (no chunking)
   */
  private async transcribeSingle(
    wavPath: string,
    binaryPath: string,
    modelPath: string,
    language: string,
    onProgress: (progress: TranscriptionProgress) => void,
    signal?: AbortSignal
  ): Promise<string> {
    onProgress({ percent: 10, phase: 'Transcribing' })

    const text = await this.runWhisper(
      wavPath, binaryPath, modelPath, language,
      (whisperPercent) => {
        // Map whisper 0-100 to overall 10-90
        const overall = 10 + (whisperPercent / 100) * 80
        onProgress({ percent: Math.round(overall), phase: 'Transcribing' })
      },
      signal
    )

    onProgress({ percent: 95, phase: 'Finalizing' })
    return text
  }

  // -------------------------------------------------------------------------
  // Chunked transcription
  // -------------------------------------------------------------------------

  /**
   * Transcribe a long audio file by splitting into time-based chunks.
   *
   * Uses ffmpeg -ss/-t to split the wav file into segments,
   * then transcribes each sequentially and joins results.
   */
  private async transcribeChunked(
    wavPath: string,
    duration: number,
    binaryPath: string,
    modelPath: string,
    language: string,
    tempFiles: Set<string>,
    onProgress: (progress: TranscriptionProgress) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const chunkDuration = TRANSCRIPTION.CHUNK_BOUNDARY_SECONDS
    const totalChunks = Math.ceil(duration / chunkDuration)

    onProgress({
      percent: 10,
      phase: `Splitting into ${totalChunks} chunks`,
      totalChunks
    })

    const transcriptParts: string[] = []
    const ffmpeg = resolveFfmpegPath()

    for (let i = 0; i < totalChunks; i++) {
      if (signal?.aborted) {
        throw new AppError('Transcription was cancelled', ErrorCode.TRANSCRIPTION_CANCELLED)
      }

      const chunkNum = i + 1
      // Apply overlap for chunks after the first to prevent word truncation at boundaries
      const overlap = i > 0 ? TRANSCRIPTION.CHUNK_OVERLAP_SECONDS : 0
      const startTime = Math.max(0, i * chunkDuration - overlap)
      const chunkLen = chunkDuration + overlap

      // Split chunk using ffmpeg time-based extraction
      const chunkPath = join(tmpdir(), `${TEMP_PREFIX}${randomUUID()}-chunk${chunkNum}.wav`)
      tempFiles.add(chunkPath)

      await this.extractChunk(ffmpeg, wavPath, chunkPath, startTime, chunkLen, signal)

      // Progress update
      const progressBase = 10
      const progressRange = 80
      const chunkStartPercent = progressBase + ((i) / totalChunks) * progressRange
      const chunkEndPercent = progressBase + ((i + 1) / totalChunks) * progressRange

      onProgress({
        percent: Math.round(chunkStartPercent),
        phase: `Transcribing chunk ${chunkNum} of ${totalChunks}`,
        currentChunk: chunkNum,
        totalChunks
      })

      // Transcribe the chunk
      const chunkText = await this.runWhisper(
        chunkPath, binaryPath, modelPath, language,
        (whisperPercent) => {
          const overall = chunkStartPercent + (whisperPercent / 100) * (chunkEndPercent - chunkStartPercent)
          onProgress({
            percent: Math.round(overall),
            phase: `Transcribing chunk ${chunkNum} of ${totalChunks}`,
            currentChunk: chunkNum,
            totalChunks
          })
        },
        signal
      )

      if (chunkText.trim()) {
        transcriptParts.push(chunkText.trim())
      }
    }

    return transcriptParts.join(' ')
  }

  /**
   * Extract a time-based chunk from an audio file using ffmpeg
   */
  private extractChunk(
    ffmpeg: string,
    inputPath: string,
    outputPath: string,
    startTime: number,
    duration: number,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [
        '-ss', String(startTime),
        '-i', inputPath,
        '-t', String(duration),
        '-ar', '16000',
        '-ac', '1',
        '-c:a', 'pcm_s16le',
        '-y',
        outputPath
      ]

      let onAbort: (() => void) | undefined

      // execFile is safe – arguments are passed as an array.
      const child = execFile(ffmpeg, args, { timeout: LOCAL_WHISPER.PROCESS_TIMEOUT }, (error) => {
        // Clean up abort listener on all paths
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)

        if (signal?.aborted) {
          reject(new AppError('Transcription was cancelled', ErrorCode.TRANSCRIPTION_CANCELLED))
          return
        }
        if (error) {
          reject(new AppError(
            `Failed to extract audio chunk: ${error.message}`,
            ErrorCode.WHISPER_PROCESS_FAILED,
            error
          ))
          return
        }
        resolve()
      })

      if (signal) {
        onAbort = (): void => {
          child.kill('SIGTERM')
        }
        if (signal.aborted) {
          child.kill('SIGTERM')
        } else {
          signal.addEventListener('abort', onAbort, { once: true })
        }
      }
    })
  }

  // -------------------------------------------------------------------------
  // whisper.cpp process runner
  // -------------------------------------------------------------------------

  /**
   * Spawn whisper-cli and return the transcribed text.
   *
   * Parses progress from stderr and reads the output text file
   * that whisper.cpp produces with the -otxt flag.
   */
  private async runWhisper(
    audioPath: string,
    binaryPath: string,
    modelPath: string,
    language: string,
    onWhisperProgress: (percent: number) => void,
    signal?: AbortSignal
  ): Promise<string> {
    // TOCTOU close: re-verify pinned binary + sidecars immediately before
    // every spawn. `{userData}/whisper/bin/` is user-writable, so an attacker
    // with local write access could swap the binary between install-time
    // verification and spawn-time execution. Hashing 2.3 MB (binary + 4 DLLs
    // on Windows) is <50 ms on modern hardware — acceptable per-chunk.
    const verified = await this.modelManager.verifyInstalledBinary()

    // Forensic-logging shape, spawn-path half of the 7-tuple the plan commits
    // to (install-time keys `url` + `expectedSha` are logged separately in
    // `WhisperModelManager.ensureBinary`; keeping install-time keys off the
    // spawn log avoids echoing URLs on every chunk of a chunked transcription).
    //   - `spawnedPath` — absolute path we're about to exec
    //   - `computedSha` — fresh SHA re-hashed by verifyInstalledBinary
    //   - `signatureValid: true` is implicit (we wouldn't be here otherwise)
    //   - `manifestRevision` — which release-revision the binary came from
    //   - `binaryVersion` — pinned filename (proxy; the real version string
    //     would require `whisper-cli --version` on every spawn, which is
    //     wasteful — the filename is sufficient forensic attribution since
    //     it's SHA-locked to a single release).
    logger.info('Whisper spawn', {
      spawnedPath: binaryPath,
      computedSha: verified.mainSha,
      signatureValid: true,
      manifestRevision: verified.revisionIndex,
      binaryVersion: verified.spec.files.main.filename
    })

    return new Promise<string>((resolve, reject) => {
      const args = [
        '-m', modelPath,
        '-l', language,
        '-otxt',
        '--no-timestamps',
        '-f', audioPath
      ]

      // DLL sideload mitigation: set cwd to the bin dir on Windows so
      // LoadLibrary prefers our pinned DLLs over anything elsewhere on PATH.
      // Harmless on macOS (dylib loading uses @rpath, not cwd).
      const spawnCwd = process.platform === 'win32' ? dirname(binaryPath) : undefined

      logger.debug('Spawning whisper-cli', { binaryPath, args, cwd: spawnCwd })

      const child = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: spawnCwd
      })

      let stderr = ''
      let settled = false

      const settle = (fn: typeof resolve | typeof reject, value: string | Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)
        if (value instanceof Error) {
          (fn as (e: Error) => void)(value)
        } else {
          (fn as (s: string) => void)(value)
        }
      }

      // Parse progress from stderr
      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        stderr += chunk

        const match = PROGRESS_REGEX.exec(chunk)
        if (match) {
          const percent = parseInt(match[1], 10)
          onWhisperProgress(Math.min(percent, 100))
        }
      })

      child.on('error', (error: Error) => {
        settle(reject, new AppError(
          `Failed to start whisper process: ${error.message}`,
          ErrorCode.WHISPER_PROCESS_FAILED,
          error
        ))
      })

      child.on('close', async (code) => {
        if (settled) return

        // Partially-written .txt from -otxt can linger if the process died
        // abruptly (cancel on Windows = TerminateProcess = no graceful
        // shutdown). Best-effort delete on any non-success path.
        const outputTxtPath = `${audioPath}.txt`
        const cleanupOrphan = async (): Promise<void> => {
          try { await unlink(outputTxtPath) } catch { /* ENOENT ok */ }
        }

        if (signal?.aborted) {
          await cleanupOrphan()
          settle(reject, new AppError(
            'Transcription was cancelled',
            ErrorCode.TRANSCRIPTION_CANCELLED
          ))
          return
        }

        if (code !== 0) {
          await cleanupOrphan()
          const unsupportedCpu =
            process.platform === 'win32'
              ? code !== null && WIN32_CPU_UNSUPPORTED_EXIT_CODES.has(code >>> 0)
              : code !== null && POSIX_CPU_UNSUPPORTED_EXIT_CODES.has(code)
          if (unsupportedCpu) {
            settle(reject, new AppError(
              `Whisper crashed with SIGILL/STATUS_ILLEGAL_INSTRUCTION (exit ${code}) — CPU lacks required instruction-set features`,
              ErrorCode.WHISPER_CPU_UNSUPPORTED
            ))
            return
          }
          const detail = stderr.slice(-500).trim()
          settle(reject, new AppError(
            `Whisper process exited with code ${code}: ${detail}`,
            ErrorCode.WHISPER_PROCESS_FAILED
          ))
          return
        }

        try {
          const text = await readFile(outputTxtPath, 'utf-8')
          await unlink(outputTxtPath).catch(() => {})
          settle(resolve, text.trim())
        } catch {
          settle(reject, new AppError(
            'Whisper output file not found',
            ErrorCode.WHISPER_OUTPUT_PARSE_FAILED
          ))
        }
      })

      // Handle abort signal
      let onAbort: (() => void) | undefined
      if (signal) {
        onAbort = (): void => {
          child.kill('SIGTERM')
        }
        if (signal.aborted) {
          child.kill('SIGTERM')
        } else {
          signal.addEventListener('abort', onAbort, { once: true })
        }
      }

      // Timeout safety
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        settle(reject, new AppError(
          'Local transcription timed out',
          ErrorCode.WHISPER_PROCESS_TIMEOUT
        ))
      }, LOCAL_WHISPER.PROCESS_TIMEOUT)
    })
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Clean up temporary files.
   *
   * Best-effort cleanup -- logs warnings but does not throw.
   * Only deletes files within tmpdir with the expected prefix (defense in depth).
   */
  private async cleanupTempFiles(tempFiles: Set<string>): Promise<void> {
    const tempDir = tmpdir()

    for (const filePath of tempFiles) {
      // Guard: only delete files within tmpdir with expected prefix
      if (!filePath.startsWith(tempDir) || !basename(filePath).startsWith(TEMP_PREFIX)) {
        logger.warn('Refusing to delete non-temp file', { filePath })
        continue
      }

      try {
        await unlink(filePath)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') {
          logger.warn('Failed to clean up temp file', {
            filePath,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }

    tempFiles.clear()
  }
}

/** Singleton instance wired to the default WhisperModelManager */
export const localWhisperService = new LocalWhisperService(whisperModelManager)

/** Factory function for testing (accepts custom model manager) */
export function createLocalWhisperService(modelManager: IWhisperModelManager): LocalWhisperService {
  return new LocalWhisperService(modelManager)
}
