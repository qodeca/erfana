// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick-and-send IPC shapes beyond `browser-tab-schema.ts` (spec 025,
 * solution design § 8, commits 14–15), kept here because that file is at the
 * size limit. The request schemas themselves (`PickModeRequestSchema`,
 * `RefineRequestSchema`, `ClosePickRequestSchema`,
 * `WriteCaptureRequestSchema`, `DiscardCaptureFilesRequestSchema`,
 * `TargetStatusRequestSchema`) live there.
 *
 * - `pickMode`, `refine`, `closePick` and `discardCaptureFiles` answer
 *   {@link PickActionResponseSchema}: `ok: false` when the tab, the capture or
 *   the request is refused (a stale capture id after the pick ended).
 * - `closePick` with reason `sent` tells main a send succeeded: pick mode
 *   ends, the page unfreezes and the capture is released (025-FR-032).
 * - `pickSurface` (commit 19) tells main the held capture's surface changed
 *   between the prompt-actions panel and the instruction dialog, so a page
 *   navigation keeps a dialog's capture (025-FR-053) and closes a panel's.
 * - `still` (commit 19) is the page as a still image, for an Erfana surface
 *   that must draw over the page area (ADR 0011 decisions 1 and 3): a raw
 *   BGRA bitmap as the pick's `captured` event carries it, or `{ error }`.
 */
import { z } from 'zod'
import {
  BROWSER_STILL_MAX_BYTES,
  BrowserTabIdSchema,
  CaptureIdSchema,
  type ClosePickRequestSchema,
  type PickModeRequestSchema,
  type RefineRequestSchema
} from './browser-tab-schema'

export const PickActionResponseSchema = z.object({ ok: z.boolean() }).strict()

/** The held capture's surface: the panel (`menu`) or the instruction dialog. */
export const PickSurfaceRequestSchema = z
  .object({ tabId: BrowserTabIdSchema, captureId: CaptureIdSchema, surface: z.enum(['menu', 'dialog']) })
  .strict()

export const StillRequestSchema = z.object({ tabId: BrowserTabIdSchema }).strict()

/** Longest still-image side; 4096² × 4 bytes is {@link BROWSER_STILL_MAX_BYTES}. */
export const STILL_MAX_EDGE = 4096

export const StillResponseSchema = z.union([
  z
    .object({
      still: z
        .instanceof(Uint8Array)
        .refine(b => b.byteLength <= BROWSER_STILL_MAX_BYTES, 'Still image too large') as z.ZodType<Uint8Array>,
      width: z.number().int().min(1).max(STILL_MAX_EDGE),
      height: z.number().int().min(1).max(STILL_MAX_EDGE)
    })
    .strict(),
  z.object({ error: z.string().max(200) }).strict()
])

export type PickActionResponse = z.infer<typeof PickActionResponseSchema>
export type PickModeRequest = z.infer<typeof PickModeRequestSchema>
export type RefineMoveRequest = z.infer<typeof RefineRequestSchema>['move']
export type ClosePickReason = z.infer<typeof ClosePickRequestSchema>['reason']
export type PickSurfaceRequest = z.infer<typeof PickSurfaceRequestSchema>
export type PickSurfaceName = PickSurfaceRequest['surface']
export type StillResponse = z.infer<typeof StillResponseSchema>
