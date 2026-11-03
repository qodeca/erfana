// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Payloads of the built-in browser's chrome (spec 025, solution design § 8,
 * commit 18), kept beside `browser-tab-schema.ts`, which is at its size limit:
 *
 * - `browser-tab:tabClosed` (main → owning window): a tab main held is gone –
 *   the user's close went through (no leave-page prompt, or **Leave**), the
 *   page closed itself, **Forget** or a teardown closed it. The renderer
 *   removes the editor tab only on this event, so a **Stay** keeps it.
 * - `browser-tab:newTabCommand` (main → focused main window): the app menu's
 *   **New browser tab** (025-FR-001). `byKey` says the accelerator fired it,
 *   so the renderer acts only while focus is in the editor area; a pointer
 *   click on the menu item always opens a tab.
 * - `browser-tab:openExternal` answer (025-FR-057): opened, or why not.
 * - `browser-tab:popupChanged` (main → a popup's own host renderer): the
 *   popup's committed address changed; the host asks `popupStrip` again.
 *
 * zod v4, every object `.strict()`, every string capped.
 */
import { z } from 'zod'
import { BrowserTabIdSchema } from './browser-tab-schema'

/** Longest error text in an answer (same cap as `BROWSER_TEXT_MAX_CHARS`). */
const text = z.string().max(2000)

export const TabClosedEventSchema = z.object({ tabId: BrowserTabIdSchema }).strict()

export const NewTabCommandEventSchema = z.object({ byKey: z.boolean() }).strict()

/**
 * `openExternal` answer: `ok`, or `error` – the request was refused (not a
 * tab of this window, no address, a scheme other than `http` or `https`) or
 * the operating system could not open it.
 */
export const OpenExternalResponseSchema = z.union([
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ error: text }).strict()
])

export const PopupChangedEventSchema = z.object({}).strict()

export type TabClosedEvent = z.infer<typeof TabClosedEventSchema>
export type NewTabCommandEvent = z.infer<typeof NewTabCommandEventSchema>
export type OpenExternalResponse = z.infer<typeof OpenExternalResponseSchema>
