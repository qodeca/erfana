// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Payloads of the built-in browser's page features (spec 025, 025-FR-008,
 * 025-FR-012, 025-FR-023, 025-FR-056, 025-FR-059, 025-FR-063; solution design
 * § 13 commit 12h): the load-error page's parts in `state`, and the answers of
 * `browser-tab:clearData` and `browser-tab:forget`. The requests themselves
 * (`find`, `stopFind`, `zoom`, `widthPreset`, `clearData`, `forget`,
 * `suggest`) and the `findResult` event are in `browser-tab-schema.ts`.
 *
 * Own module so the main schema file stays within its line budget; it imports
 * nothing from that file, so there is no import cycle. zod v4, every object
 * `.strict()`, every string capped.
 */
import { z } from 'zod'

/** Longest error or path text in an answer (same cap as `BROWSER_TEXT_MAX_CHARS`). */
const text = z.string().max(2000)

/**
 * `state.loadError`: the load-error page's parts, with `erfanaPage: 'loadError'`
 * (025-FR-059). The page names `state.committedUrl` – the address that
 * failed – and composes the sentence from `code` (`netErrorMessages.ts`).
 * `focus` says where keyboard focus goes when the page appears: **Reload**
 * when the user started the load (025-FR-002), the page's heading otherwise.
 */
export const LoadErrorPageSchema = z
  .object({
    /** Chromium's net error code, negative, e.g. -102 for `ERR_CONNECTION_REFUSED`. */
    code: z.number().int().min(-1000).max(-1),
    focus: z.enum(['reload', 'heading'])
  })
  .strict()

/** The five kinds of data **Clear browsing data** removes (025-FR-023), as `ClearDataRequestSchema` names them. */
export const ClearDataCategorySchema = z.enum(['cookies', 'cache', 'permissions', 'credentials', 'captures'])

/**
 * `clearData` answer. `failed` lists every ticked kind whose step timed out
 * after 10 s or failed – one error toast each, naming the kind and the
 * reason; an empty list means everything ticked was cleared. `error`: the
 * request was refused or the project's browser data could not be reached.
 */
export const ClearDataResponseSchema = z.union([
  z
    .object({
      failed: z
        .array(z.object({ category: ClearDataCategorySchema, reason: z.enum(['timeout', 'failed']) }).strict())
        .max(ClearDataCategorySchema.options.length)
    })
    .strict(),
  z.object({ error: text }).strict()
])

/**
 * `forget` answer. `deleted`: `.erfana/browser/` is gone (`deleted`), was not
 * there (`absent`), or – on Windows, where the running session holds files
 * open – is deleted at the next start (`pending`: the toast says so). `error`
 * names the reason, and `path` the project-relative path that could not be
 * deleted, when one is known.
 */
export const ForgetResponseSchema = z.union([
  z.object({ deleted: z.enum(['deleted', 'absent', 'pending']) }).strict(),
  z.object({ error: text, path: text.nullable() }).strict()
])

/** `pageClipboard` (025-FR-009, S-17): no payload – main reads the clipboard itself; the text never crosses IPC. */
export const PageClipboardRequestSchema = z.object({}).strict()
/** `pageClipboard` answer: whether a browser page wrote the text now on the clipboard. */
export const PageClipboardResponseSchema = z.object({ pageWritten: z.boolean() }).strict()

export type LoadErrorPage = z.infer<typeof LoadErrorPageSchema>
export type ClearDataCategory = z.infer<typeof ClearDataCategorySchema>
export type ClearDataResponse = z.infer<typeof ClearDataResponseSchema>
export type ForgetResponse = z.infer<typeof ForgetResponseSchema>
export type PageClipboardResponse = z.infer<typeof PageClipboardResponseSchema>
