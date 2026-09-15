// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Wire contract for "Open in default browser" (issue #124, part 4 §4.1).
 *
 * The renderer sends one absolute file path; main answers with a success flag
 * or a code plus its `ERROR_MESSAGES` text. No raw error crosses IPC, and no
 * address travels either way – the main process launches the confined real
 * path it resolved itself.
 *
 * @see src/shared/ipc/browser-channels.ts for the channel name
 * @see src/main/services/browserLaunch/BrowserLaunchService.ts for the checks
 */
import { z } from 'zod'
import { ErrorCode } from '../errors'

/** Longest path accepted, comfortably over every OS limit (as image export's cap). */
export const MAX_BROWSER_OPEN_PATH_LENGTH = 4096

// ---------------------------------------------------------------------------
// Renderer → main
// ---------------------------------------------------------------------------

/**
 * Request payload for `browser:openFile`.
 *
 * `.strict()` so a renderer cannot smuggle extra keys (an address, a fragment)
 * past validation. The extension, the project and the real path are checked
 * main-side, in that order, by `BrowserLaunchService`.
 */
export const BrowserOpenFileRequestSchema = z
  .object({
    /** Absolute path of the page, as the tree or the preview tab knows it. */
    filePath: z.string().min(1).max(MAX_BROWSER_OPEN_PATH_LENGTH)
  })
  .strict()

export type BrowserOpenFileRequest = z.infer<typeof BrowserOpenFileRequestSchema>

// ---------------------------------------------------------------------------
// Main → renderer
// ---------------------------------------------------------------------------

/**
 * Every error code this channel can return – a subset of {@link ErrorCode},
 * enumerated so the response schema rejects a code from another domain.
 */
export const BROWSER_OPEN_ERROR_CODES = [
  ErrorCode.OPEN_IN_BROWSER_INVALID_REQUEST,
  ErrorCode.OPEN_IN_BROWSER_NO_PROJECT,
  ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT,
  ErrorCode.OPEN_IN_BROWSER_NOT_HTML,
  ErrorCode.OPEN_IN_BROWSER_MISSING,
  ErrorCode.OPEN_IN_BROWSER_LAUNCH_FAILED
] as const

export const BrowserOpenErrorCodeSchema = z.enum(BROWSER_OPEN_ERROR_CODES)

/** One of {@link BROWSER_OPEN_ERROR_CODES}. */
export type BrowserOpenErrorCode = (typeof BROWSER_OPEN_ERROR_CODES)[number]

/**
 * Response for `browser:openFile`.
 *
 * - success: `usedFallback` is `true` when no default browser could be found
 *   and the file went to the app the system uses for `.html` files – the
 *   renderer shows an info notice for it;
 * - failure: `error` is always `ERROR_MESSAGES[errorCode]`.
 *
 * Both branches are `.strict()`: nothing else (a stack, a raw message, a path)
 * may ride along.
 */
export const BrowserOpenFileResponseSchema = z.discriminatedUnion('success', [
  z
    .object({
      success: z.literal(true),
      usedFallback: z.boolean()
    })
    .strict(),
  z
    .object({
      success: z.literal(false),
      errorCode: BrowserOpenErrorCodeSchema,
      /** Always `ERROR_MESSAGES[errorCode]`; safe to show verbatim. */
      error: z.string().min(1)
    })
    .strict()
])

export type BrowserOpenFileResponse = z.infer<typeof BrowserOpenFileResponseSchema>

/**
 * The renderer-side bridge contract (`window.api.browser`), declared here so
 * the preload implementation and its typing cannot drift.
 */
export interface BrowserBridge {
  /** Open the `.html` / `.htm` file at `filePath` in the default browser. Never rejects. */
  openFile(filePath: string): Promise<BrowserOpenFileResponse>
}
