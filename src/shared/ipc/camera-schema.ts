// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Camera IPC Schema
 *
 * Defines Zod schemas and TypeScript types for camera capture IPC.
 * Used by both main process (CameraService) and renderer (TerminalPanel).
 *
 * @see Spec #014 - Camera photo capture specification
 */

import { z } from 'zod'

/**
 * Request payload for camera:save IPC channel
 *
 * Contains the captured image data URL and optional timestamp.
 */
export const CameraSaveRequestSchema = z.object({
  /** Base64-encoded JPEG data URL from canvas.toDataURL() */
  dataUrl: z.string().refine(
    (val) => val.startsWith('data:image/jpeg;base64,'),
    { message: 'Data URL must be a JPEG base64 string' }
  ),
  /** Optional timestamp for filename generation (uses current time if not provided) */
  timestamp: z.number().optional()
})
export type CameraSaveRequest = z.infer<typeof CameraSaveRequestSchema>

/**
 * Response payload from camera:save IPC channel
 *
 * Pattern deviation: This response uses success/error pattern instead of
 * throwing errors because camera operations can have multiple non-error
 * outcomes (permission denied, device disconnected, etc.).
 */
export const CameraSaveResponseSchema = z.object({
  success: z.boolean(),
  /** Absolute path to the saved photo file (on success) */
  filePath: z.string().optional(),
  /** Human-readable error message (on failure) */
  error: z.string().optional(),
  /** Machine-readable error code (on failure) */
  errorCode: z.string().optional()
})
export type CameraSaveResponse = z.infer<typeof CameraSaveResponseSchema>
