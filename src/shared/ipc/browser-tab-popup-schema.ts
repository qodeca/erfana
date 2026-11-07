// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Payloads of the popup window's channels (spec 025, 025-FR-011; ADR 0011
 * decision 9; solution design § 8): what `browser-tab:popupStrip` answers to
 * a popup host's renderer. The requests themselves (`PopupStripRequestSchema`,
 * `PopupAnswerRequestSchema`, `PopupCloseRequestSchema`) live in
 * `browser-tab-schema.ts`.
 *
 * The popup is named by its sender, never by a payload field, so nothing here
 * carries a tab or window id.
 */
import { z } from 'zod'
import { BROWSER_URL_MAX_CHARS, OriginPartsSchema } from './browser-tab-schema'

/** `popupStrip`: the read-only top of the popup's strip – its committed address and origin. */
export const PopupStripResponseSchema = z
  .object({
    /** The committed address, or `null` before the first commit (the strip shows the opener then). */
    committedUrl: z.string().min(1).max(BROWSER_URL_MAX_CHARS).nullable(),
    origin: OriginPartsSchema.nullable(),
    /** The address bar's badge state for the committed address. */
    security: z.enum(['secure', 'local', 'file', 'notSecureHttp']),
    /**
     * Who opened the popup, through the origin formatter: the opening frame's
     * origin, or "a page". Shown while the popup has no web address – before
     * its first commit, or a document its opener wrote (S-22).
     */
    openedBy: z.string().min(1).max(BROWSER_URL_MAX_CHARS)
  })
  .strict()

export type PopupStripResponse = z.infer<typeof PopupStripResponseSchema>
