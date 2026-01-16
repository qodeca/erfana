/**
 * Screenshot IPC Schema
 *
 * Defines Zod schemas and TypeScript types for screenshot capture IPC.
 * Used by both main process (ScreenshotService) and renderer (TerminalPanel).
 *
 * @see Issue #86 - Screenshot capture buttons for terminal panel
 * @see specs/features/screenshot-capture.md - Feature specification
 */

import { z } from 'zod'

/**
 * Screenshot capture mode
 * - 'screen': Captures the primary display instantly (or specific display if displayId provided)
 * - 'window': Interactive window selection
 * - 'area': Interactive rectangular area selection
 */
export const ScreenshotModeSchema = z.enum(['screen', 'window', 'area'])
export type ScreenshotMode = z.infer<typeof ScreenshotModeSchema>

/**
 * Display bounds information
 */
export const DisplayBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})
export type DisplayBounds = z.infer<typeof DisplayBoundsSchema>

/**
 * Display information for multi-monitor support
 * @see Issue #86 enhancement - multi-monitor support
 */
export const DisplayInfoSchema = z.object({
  /** Unique display identifier from Electron */
  id: z.number(),
  /** Human-readable display label */
  label: z.string(),
  /** Whether this is the primary display */
  isPrimary: z.boolean(),
  /** Display bounds (position and size) */
  bounds: DisplayBoundsSchema
})
export type DisplayInfo = z.infer<typeof DisplayInfoSchema>

/**
 * Response payload for screenshot:getDisplays IPC channel
 */
export const GetDisplaysResponseSchema = z.object({
  displays: z.array(DisplayInfoSchema)
})
export type GetDisplaysResponse = z.infer<typeof GetDisplaysResponseSchema>

/**
 * Request payload for screenshot:capture IPC channel
 *
 * Note: terminalId is not included here - it's captured client-side
 * at click time to ensure the correct terminal receives the path
 * even if user switches terminals during interactive selection.
 */
export const ScreenshotCaptureRequestSchema = z.object({
  mode: ScreenshotModeSchema,
  /** Display ID to capture (only used for 'screen' mode, maps to -D flag) */
  displayId: z.number().optional()
})
export type ScreenshotCaptureRequest = z.infer<typeof ScreenshotCaptureRequestSchema>

/**
 * Error codes for screenshot capture failures
 *
 * Note: CANCELLED is not a true error - it means user pressed Escape.
 * This is a normal user action, not an error condition.
 */
export const ScreenshotErrorCodeSchema = z.enum([
  'SCREENSHOT_PERMISSION_DENIED',
  'SCREENSHOT_TIMEOUT',
  'SCREENSHOT_CANCELLED',
  'SCREENSHOT_FAILED',
  'SCREENSHOT_NOT_SUPPORTED'
])
export type ScreenshotErrorCode = z.infer<typeof ScreenshotErrorCodeSchema>

/**
 * Response payload from screenshot:capture IPC channel
 *
 * Pattern deviation: This response uses success/error pattern instead of
 * throwing errors because CANCELLED is a legitimate non-error outcome
 * (user pressed Escape during selection).
 */
export const ScreenshotCaptureResponseSchema = z.object({
  success: z.boolean(),
  /** Absolute path to the saved screenshot file (on success) */
  filePath: z.string().optional(),
  /** Human-readable error message (on failure) */
  error: z.string().optional(),
  /** Machine-readable error code (on failure) */
  errorCode: ScreenshotErrorCodeSchema.optional()
})
export type ScreenshotCaptureResponse = z.infer<typeof ScreenshotCaptureResponseSchema>
