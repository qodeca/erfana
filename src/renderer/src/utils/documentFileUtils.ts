// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Document file type utilities
 *
 * Pure helper functions for classifying files by type (audio, video, media, document).
 * Used by useImport hook and potentially other import-related components.
 *
 * @see useImport.ts
 * @see Issue #134 - LiteParse frontend UI
 */

import { TRANSCRIPTION, VIDEO_IMPORT } from '../../../shared/constants'
import { useDocumentImportStore } from '../stores/useDocumentImportStore'

/**
 * Check if a file is an audio file based on its extension.
 * Uses the canonical list from TRANSCRIPTION.SUPPORTED_EXTENSIONS.
 */
export function isAudioFile(fileName: string): boolean {
  const ext = extractExtension(fileName)
  if (!ext) return false
  return (TRANSCRIPTION.SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)
}

/**
 * Check if a file is a video file based on its extension.
 * Uses the canonical list from VIDEO_IMPORT.SUPPORTED_EXTENSIONS.
 */
export function isVideoFile(fileName: string): boolean {
  const ext = extractExtension(fileName)
  if (!ext) return false
  return (VIDEO_IMPORT.SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)
}

/**
 * Check if a file is a media file (audio or video) that requires
 * interactive transcription via TranscriptionDialog.
 */
export function isMediaFile(fileName: string): boolean {
  return isAudioFile(fileName) || isVideoFile(fileName)
}

/**
 * Check if a file is a document file that requires interactive import
 * via DocumentImportDialog. Uses the extension cache from the store.
 */
export function isDocumentFile(fileName: string): boolean {
  const ext = extractExtension(fileName)
  if (!ext) return false
  const extensions = useDocumentImportStore.getState().documentExtensions
  return extensions.includes(ext)
}

/**
 * Extract lowercase file extension from a filename.
 * Returns null if no extension is found.
 */
function extractExtension(fileName: string): string | null {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex === -1) return null
  return fileName.slice(dotIndex + 1).toLowerCase()
}
