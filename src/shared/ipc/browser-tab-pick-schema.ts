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
 */
import { z } from 'zod'
import type { ClosePickRequestSchema, PickModeRequestSchema, RefineRequestSchema } from './browser-tab-schema'

export const PickActionResponseSchema = z.object({ ok: z.boolean() }).strict()

export type PickActionResponse = z.infer<typeof PickActionResponseSchema>
export type PickModeRequest = z.infer<typeof PickModeRequestSchema>
export type RefineMoveRequest = z.infer<typeof RefineRequestSchema>['move']
export type ClosePickReason = z.infer<typeof ClosePickRequestSchema>['reason']
