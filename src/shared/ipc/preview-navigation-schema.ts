// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Same-tab navigation and resize-hold IPC schemas (issue #124, WI-7).
 *
 * New schemas live here rather than in `preview-schema.ts`, which is at its size
 * cap. The rules are the same as there: every object is `.strict()`, every
 * string and number is bounded, and requests are `safeParse`d in the handler
 * and events re-validated before send. The renderer never supplies a URL or a
 * token – only a project path, an anchor, or main's own history generation.
 *
 * - `preview:navigate` (invoke): `check` before anything happens, `commit` once
 *   the renderer has resolved the other tabs showing the target (part 3 §3.1).
 *   A refusal may carry the tab's new history, after main dropped a Back or
 *   Forward entry whose page is gone (part 3 §3.5).
 * - `preview:pageChanged` (event): a load main started has committed.
 * - `preview:resizeHold` (event): a window-edge resize hid the view, or ended
 *   (part 1 §1.5).
 *
 * zod v4: `z.enum(ErrorCode)` – never `z.nativeEnum`.
 *
 * @see docs/design/design-issue-124-part3.md §3.1
 */
import { z } from 'zod'

import { ErrorCode } from '../errors'
import { PREVIEW_LIMITS } from '../preview-limits'
import { PanelIdSchema } from './preview-schema'

/** A project file path, as the tab holds it in `params.filePath`. */
const NavFilePathSchema = z.string().min(1).max(4096)

/**
 * A fragment without its `#`, or `null` for the top of the page. Main cuts a
 * page's own fragment to the same bound (`previewPageNavigator.ts`).
 */
const NavAnchorSchema = z.string().max(PREVIEW_LIMITS.NAV_MAX_ANCHOR_CHARS).nullable()

/** Main's history generation; it increases on every history change. */
const HistoryGenerationSchema = z.number().int().nonnegative()

/** A page in a tab's history: a file, and where in it. */
export const PreviewPageTargetSchema = z
  .object({
    filePath: NavFilePathSchema,
    anchor: NavAnchorSchema
  })
  .strict()

const historyStateShape = {
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  backTarget: PreviewPageTargetSchema.nullable(),
  forwardTarget: PreviewPageTargetSchema.nullable(),
  generation: HistoryGenerationSchema
}

/** A tab's Back and Forward state, from main's own history list. */
export const PreviewHistoryStateSchema = z.object(historyStateShape).strict()

/** `check` asks whether a move may happen; `commit` performs it. */
const NavigatePhaseSchema = z.enum(['check', 'commit'])

/** `preview:navigate` request: show a page in this tab, or step its history. */
export const PreviewNavigateRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      panelId: PanelIdSchema,
      phase: NavigatePhaseSchema,
      action: z.literal('open'),
      filePath: NavFilePathSchema,
      anchor: NavAnchorSchema
    })
    .strict(),
  z
    .object({
      panelId: PanelIdSchema,
      phase: NavigatePhaseSchema,
      action: z.enum(['back', 'forward']),
      /** Must still be main's; a stale one is refused with `PREVIEW_NAV_SKIPPED`. */
      generation: HistoryGenerationSchema
    })
    .strict()
])
export type PreviewNavigateRequest = z.infer<typeof PreviewNavigateRequestSchema>

/**
 * `preview:navigate` answer; the leaf type is `PreviewNavigateResult`. No raw
 * error crosses IPC – a code only.
 */
export const PreviewNavigateResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      target: PreviewPageTargetSchema,
      generation: HistoryGenerationSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      errorCode: z.enum(ErrorCode),
      /** Present only when main dropped a Back or Forward entry whose page is gone. */
      history: PreviewHistoryStateSchema.optional()
    })
    .strict()
])

/** `preview:pageChanged` event payload; the leaf type is `PreviewPageChange`. */
export const PreviewPageChangedPayloadSchema = z
  .object({
    panelId: PanelIdSchema,
    /** From main's gated history entry, never from the URL that committed. */
    filePath: NavFilePathSchema,
    anchor: NavAnchorSchema,
    /** A step inside the same document; per-page state is kept. */
    sameDocument: z.boolean(),
    ...historyStateShape,
    /** The committing load answered 400 or above – a refused page still commits (S15). */
    failed: z.boolean()
  })
  .strict()
export type PreviewPageChangedPayload = z.infer<typeof PreviewPageChangedPayloadSchema>

/**
 * `preview:resizeHold` event payload. `held: true` – a window-edge resize hid
 * the view; `held: false` – it ended, and the renderer answers with a settled
 * bounds push.
 */
export const PreviewResizeHoldPayloadSchema = z
  .object({
    panelId: PanelIdSchema,
    held: z.boolean()
  })
  .strict()
export type PreviewResizeHoldPayload = z.infer<typeof PreviewResizeHoldPayloadSchema>
