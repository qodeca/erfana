/**
 * Transcription IPC Handlers
 *
 * Registers all transcription-related IPC handlers for audio import,
 * progress streaming, cancellation, and API key management.
 *
 * Channels:
 * - transcription:import     - Full import with progress streaming
 * - transcription:cancel     - Cancel active transcription
 * - transcription:validate   - Quick audio file validation
 * - transcription:setApiKey  - Store API key in safeStorage
 * - transcription:hasApiKey  - Check if API key exists
 * - transcription:clearApiKey - Remove stored API key
 *
 * @see Issue #75 - Media import with transcription
 */
import { ipcMain } from 'electron'
import { writeFile, mkdir } from 'fs/promises'
import { join, basename, extname, isAbsolute, normalize } from 'path'
import { TRANSCRIPTION_CHANNELS } from '../../shared/ipc/transcription-channels'
import {
  TranscriptionImportRequestSchema,
  type TranscriptionImportResult,
  type TranscriptionProgress
} from '../../shared/ipc/transcription-schema'
import { ErrorCode, getUserFriendlyMessage } from '../../shared/errors'
import { IMPORT, VIDEO_IMPORT } from '../../shared/constants'
import { transcriptionService } from '../services/TranscriptionService'
import { audioMetadataService } from '../services/AudioMetadataService'
import { audioExtractionService } from '../services/AudioExtractionService'
import { apiKeyService } from '../services/ApiKeyService'
import { globalSettingsService } from '../services/GlobalSettingsService'
import { fileService } from '../services/FileService'
import { logger } from '../services/LoggingService'
import { changeExtension, sanitizeFileName, findAvailableFileName, formatDuration } from '../utils/fileUtils'
import { isVideoExtension } from '../services/import/extensions'

/** Active AbortController for current transcription */
let activeController: AbortController | null = null

/**
 * Register all transcription IPC handlers
 */
export function registerTranscriptionHandlers(): void {
  /**
   * Full import with progress streaming
   *
   * 1. Validates request with Zod
   * 2. Checks API key exists
   * 3. Validates audio file
   * 4. Gets project path
   * 5. Creates AbortController
   * 6. Calls transcriptionService.transcribe() with progress callback
   * 7. Writes markdown to import/ directory
   * 8. Returns result
   */
  ipcMain.handle(
    TRANSCRIPTION_CHANNELS.IMPORT,
    async (event, request: unknown): Promise<TranscriptionImportResult> => {
      // Validate request schema
      const parseResult = TranscriptionImportRequestSchema.safeParse(request)
      if (!parseResult.success) {
        logger.error('Transcription import validation error', parseResult.error)
        return {
          success: false,
          error: 'Invalid request: ' + parseResult.error.issues[0]?.message,
          errorCode: ErrorCode.TRANSCRIPTION_FAILED
        }
      }

      const { filePath, language } = parseResult.data

      // Validate file path (prevent path traversal)
      if (!isAbsolute(filePath) || normalize(filePath) !== filePath) {
        return {
          success: false,
          error: 'Invalid file path',
          errorCode: ErrorCode.TRANSCRIPTION_FAILED
        }
      }

      // Prevent concurrent transcriptions
      if (activeController) {
        return {
          success: false,
          error: 'A transcription is already in progress',
          errorCode: ErrorCode.TRANSCRIPTION_FAILED
        }
      }

      // Check API key
      const apiKey = await apiKeyService.getKey('openai')
      if (!apiKey) {
        return {
          success: false,
          error: 'No API key configured. Add your OpenAI API key in Settings.',
          errorCode: ErrorCode.TRANSCRIPTION_NO_API_KEY
        }
      }

      // Check project is open
      const projectPath = fileService.getProjectPath()
      if (!projectPath) {
        return {
          success: false,
          error: 'No project is currently open.',
          errorCode: ErrorCode.TRANSCRIPTION_FAILED
        }
      }

      // Create AbortController
      activeController = new AbortController()

      // Progress callback that streams to renderer
      const webContents = event.sender
      const sendProgress = (progress: TranscriptionProgress): void => {
        try {
          if (!webContents.isDestroyed()) {
            webContents.send(TRANSCRIPTION_CHANNELS.PROGRESS, progress)
          }
        } catch {
          // WebContents may be destroyed during transcription
        }
      }

      // Detect video vs. audio path
      const ext = extname(filePath).slice(1).toLowerCase()
      const isVideo = isVideoExtension(ext)

      try {
        if (isVideo) {
          // Video path: check ffmpeg, extract audio, then transcribe
          if (!audioExtractionService.isAvailable()) {
            return {
              success: false,
              error: 'Video import requires ffmpeg which is not available.',
              errorCode: ErrorCode.VIDEO_FFMPEG_UNAVAILABLE
            }
          }

          const hasAudio = await audioExtractionService.hasAudioStream(filePath)
          if (!hasAudio) {
            return {
              success: false,
              error: 'This video file contains no audio track to transcribe.',
              errorCode: ErrorCode.VIDEO_NO_AUDIO_TRACK
            }
          }

          // Get video metadata for frontmatter (best-effort)
          let resolution: string | undefined
          let videoCodec: string | undefined
          let videoDuration = 0
          try {
            const videoMetadata = await audioExtractionService.getVideoMetadata(filePath)
            resolution = videoMetadata.resolution
            videoCodec = videoMetadata.videoCodec
            videoDuration = videoMetadata.durationSeconds
          } catch {
            // Metadata is optional – continue without it
          }

          // Extract audio with progress mapped to 0–20%
          const extraction = await audioExtractionService.extractAudio(
            filePath,
            (extractionPercent) => {
              sendProgress({
                percent: extractionPercent * VIDEO_IMPORT.EXTRACTION_PROGRESS_WEIGHT,
                phase: 'Extracting audio...'
              })
            },
            activeController.signal
          )

          try {
            // Transcribe the extracted audio with progress mapped to 20–100%
            const result = await transcriptionService.transcribe(
              extraction.audioPath,
              language,
              (progress) => {
                sendProgress({
                  percent: Math.min(
                    VIDEO_IMPORT.EXTRACTION_PROGRESS_WEIGHT * 100 +
                    progress.percent * (1 - VIDEO_IMPORT.EXTRACTION_PROGRESS_WEIGHT),
                    100
                  ),
                  phase: progress.phase
                })
              },
              activeController.signal
            )

            if (!result.success || !result.transcript) {
              return {
                success: false,
                error: result.error || 'Transcription failed',
                errorCode: result.errorCode || ErrorCode.TRANSCRIPTION_FAILED
              }
            }

            const duration = videoDuration || extraction.durationSeconds
            const fileName = basename(filePath)
            const durationFormatted = formatDuration(duration)
            const date = new Date().toISOString()

            const frontmatterLines = [
              '---',
              `source: "${fileName}"`,
              `type: video`,
              `duration: "${durationFormatted}"`,
              `date: "${date}"`,
              `language: ${language === 'auto' ? (result.language || 'auto') : language}`,
              `transcription_backend: openai`
            ]

            if (resolution) {
              frontmatterLines.push(`resolution: "${resolution}"`)
            }

            if (videoCodec) {
              frontmatterLines.push(`video_codec: "${videoCodec}"`)
            }

            frontmatterLines.push('---', '', result.transcript, '')

            const markdown = frontmatterLines.join('\n')

            // Write to import/ directory
            const importDir = join(projectPath, IMPORT.DIR_NAME)
            await mkdir(importDir, { recursive: true })

            const outputFileName = sanitizeFileName(changeExtension(fileName, '.md'))
            const outputPath = await findAvailableFileName(importDir, outputFileName)
            await writeFile(outputPath, markdown, 'utf-8')

            logger.info('Video transcription import complete', { outputPath })

            return {
              success: true,
              outputPath
            }
          } finally {
            // Always clean up the temp audio file
            await audioExtractionService.cleanupTempFile(extraction.audioPath)
          }
        } else {
          // Audio path: existing flow unchanged
          const result = await transcriptionService.transcribe(
            filePath,
            language,
            sendProgress,
            activeController.signal
          )

          if (!result.success || !result.transcript) {
            return {
              success: false,
              error: result.error || 'Transcription failed',
              errorCode: result.errorCode || ErrorCode.TRANSCRIPTION_FAILED
            }
          }

          // Get duration for frontmatter
          let duration = result.duration || 0
          try {
            if (!duration) {
              duration = await audioMetadataService.getDuration(filePath)
            }
          } catch {
            // Duration is optional in frontmatter
          }

          // Format markdown with YAML frontmatter
          const fileName = basename(filePath)
          const durationFormatted = formatDuration(duration)
          const date = new Date().toISOString()

          const markdown = [
            '---',
            `source: "${fileName}"`,
            `duration: "${durationFormatted}"`,
            `date: "${date}"`,
            `language: ${language === 'auto' ? (result.language || 'auto') : language}`,
            `transcription_backend: openai`,
            '---',
            '',
            result.transcript,
            ''
          ].join('\n')

          // Write to import/ directory
          const importDir = join(projectPath, IMPORT.DIR_NAME)
          await mkdir(importDir, { recursive: true })

          const outputFileName = sanitizeFileName(changeExtension(fileName, '.md'))
          const outputPath = await findAvailableFileName(importDir, outputFileName)
          await writeFile(outputPath, markdown, 'utf-8')

          logger.info('Transcription import complete', { outputPath })

          return {
            success: true,
            outputPath
          }
        }
      } catch (error) {
        logger.error('Transcription import failed', error instanceof Error ? error : undefined)

        return {
          success: false,
          error: getUserFriendlyMessage(error),
          errorCode: ErrorCode.TRANSCRIPTION_FAILED
        }
      } finally {
        activeController = null
      }
    }
  )

  /**
   * Cancel active transcription
   */
  ipcMain.handle(
    TRANSCRIPTION_CHANNELS.CANCEL,
    async (): Promise<{ success: boolean; error?: string }> => {
      if (activeController) {
        activeController.abort()
        activeController = null
        logger.info('Transcription cancelled by user')
        return { success: true }
      }
      return { success: false, error: 'No active transcription' }
    }
  )

  /**
   * Quick validation of audio file
   */
  ipcMain.handle(
    TRANSCRIPTION_CHANNELS.VALIDATE,
    async (
      _event,
      filePath: string
    ): Promise<{
      valid: boolean
      error?: string
      durationSeconds?: number
      sizeInMB: number
    }> => {
      if (!filePath || typeof filePath !== 'string') {
        return { valid: false, error: 'Invalid file path', sizeInMB: 0 }
      }

      // Validate file path (prevent path traversal)
      if (!isAbsolute(filePath) || normalize(filePath) !== filePath) {
        return { valid: false, error: 'Invalid file path', sizeInMB: 0 }
      }

      try {
        const result = await audioMetadataService.validate(filePath)
        return {
          valid: result.valid,
          error: result.error,
          durationSeconds: result.durationSeconds,
          sizeInMB: result.sizeInMB
        }
      } catch (error) {
        logger.error('Validation failed', error instanceof Error ? error : undefined)
        return {
          valid: false,
          error: 'Validation failed',
          sizeInMB: 0
        }
      }
    }
  )

  /**
   * Store API key in safeStorage
   */
  ipcMain.handle(
    TRANSCRIPTION_CHANNELS.SET_API_KEY,
    async (_event, apiKey: string): Promise<{ success: boolean; error?: string }> => {
      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return { success: false, error: 'Invalid API key' }
      }

      try {
        await apiKeyService.storeKey('openai', apiKey.trim())

        // Update global settings to reflect key stored status
        const currentSettings = globalSettingsService.getSetting('transcription')
        await globalSettingsService.setSetting('transcription', {
          ...currentSettings,
          openaiApiKeyStored: true
        })

        return { success: true }
      } catch (error) {
        logger.error('Failed to store API key', error instanceof Error ? error : undefined)
        return {
          success: false,
          error: 'Failed to store API key'
        }
      }
    }
  )

  /**
   * Check if API key exists
   */
  ipcMain.handle(
    TRANSCRIPTION_CHANNELS.HAS_API_KEY,
    async (): Promise<boolean> => {
      try {
        const key = await apiKeyService.getKey('openai')
        return key !== null
      } catch {
        return false
      }
    }
  )

  /**
   * Remove stored API key
   */
  ipcMain.handle(
    TRANSCRIPTION_CHANNELS.CLEAR_API_KEY,
    async (): Promise<{ success: boolean; error?: string }> => {
      try {
        await apiKeyService.clearKey('openai')

        // Update global settings
        const currentSettings = globalSettingsService.getSetting('transcription')
        await globalSettingsService.setSetting('transcription', {
          ...currentSettings,
          openaiApiKeyStored: false
        })

        return { success: true }
      } catch (error) {
        logger.error('Failed to clear API key', error instanceof Error ? error : undefined)
        return {
          success: false,
          error: 'Failed to clear API key'
        }
      }
    }
  )
}

