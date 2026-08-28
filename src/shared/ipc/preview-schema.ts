// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview IPC payload schemas (Issue #74, work item 41; design §4.2).
 *
 * Every schema here is validated at the trust boundary: renderer → main
 * requests are `safeParse`d in the handlers, and main → renderer events are
 * re-validated in `emit.ts` before send. Every object schema is `.strict()`
 * (per the work-item directive and design NEW-14) so a drifting extra key is
 * rejected rather than silently accepted.
 *
 * zod v4: `z.enum(ErrorCode)` — never `z.nativeEnum`.
 *
 * @see docs/designs/sd-074-html-preview.md §4.2 - Schemas
 */
import { z } from 'zod'
import { ErrorCode } from '../errors'
import { PreviewHostSchema } from './preview-settings-schema'
import type {
  PdfExportResult,
  PreviewApproveResult,
  PreviewFindResult,
  PreviewOpenResult
} from './preview-types'

/** A panel id: non-empty, bounded. */
export const PanelIdSchema = z.string().min(1).max(256)

/** A rectangle in the host window content-view coordinate space. */
export const PreviewBoundsSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number()
  })
  .strict()
export type PreviewBoundsPayload = z.infer<typeof PreviewBoundsSchema>

/**
 * `preview:checkEligibility` request. The path is checked main-side against the
 * five ordered eligibility rules (§1.5).
 */
export const PreviewCheckEligibilityRequestSchema = z
  .object({
    filePath: z.string().min(1)
  })
  .strict()
export type PreviewCheckEligibilityRequest = z.infer<typeof PreviewCheckEligibilityRequestSchema>

/** The closed set of reasons a path is ineligible to preview (§1.5). */
export const PreviewEligibilityReasonSchema = z.enum([
  'globally-disabled',
  'not-html',
  'outside-project',
  'excluded-directory',
  'gitignored'
])
export type PreviewEligibilityReason = z.infer<typeof PreviewEligibilityReasonSchema>

/** `preview:checkEligibility` response. `reason` is present only when ineligible. */
export const PreviewCheckEligibilityResponseSchema = z
  .object({
    eligible: z.boolean(),
    reason: PreviewEligibilityReasonSchema.optional()
  })
  .strict()
export type PreviewCheckEligibilityResponse = z.infer<
  typeof PreviewCheckEligibilityResponseSchema
>

/** No `projectPath` (X10). A test asserts rejection when one is present. */
export const PreviewOpenRequestSchema = z
  .object({
    panelId: PanelIdSchema,
    filePath: z.string().min(1),
    bounds: PreviewBoundsSchema
  })
  .strict()
export type PreviewOpenRequest = z.infer<typeof PreviewOpenRequestSchema>

/** No `projectRoot` (NEW-8). Root resolved main-side from ProjectService. */
export const PreviewApproveHostRequestSchema = z
  .object({
    panelId: PanelIdSchema,
    // Validate approvability (and reject CSP-delimiter / CRLF chars) AT the
    // boundary via the shared host schema, not only downstream in the store.
    host: PreviewHostSchema
  })
  .strict()
export type PreviewApproveHostRequest = z.infer<typeof PreviewApproveHostRequestSchema>

/** `preview:setBounds` request. Main drops `seq <= last applied`. */
export const PreviewSetBoundsSchema = z
  .object({
    panelId: PanelIdSchema,
    bounds: PreviewBoundsSchema,
    seq: z.number().int().nonnegative()
  })
  .strict()
export type PreviewSetBounds = z.infer<typeof PreviewSetBoundsSchema>

export const PreviewSetVisibilitySchema = z
  .object({
    panelId: PanelIdSchema,
    visible: z.boolean(),
    /** Diagnostics ONLY — a bounded string, NOT an enum (X14): a closed enum fails OPEN. */
    reason: z.string().max(32)
  })
  .strict()
export type PreviewSetVisibility = z.infer<typeof PreviewSetVisibilitySchema>

export const PreviewFindRequestSchema = z
  .object({
    panelId: PanelIdSchema,
    text: z.string().min(1).max(1024),
    forward: z.boolean(),
    findNext: z.boolean(),
    matchCase: z.boolean()
    // no wholeWord — FindInPageOptions in 39.8.9 is exactly {forward?, findNext?, matchCase?}
  })
  .strict()
export type PreviewFindRequest = z.infer<typeof PreviewFindRequestSchema>

/** `preview:reload` request. */
export const PreviewReloadRequestSchema = z
  .object({
    panelId: PanelIdSchema,
    ignoreCache: z.boolean().optional()
  })
  .strict()
export type PreviewReloadRequest = z.infer<typeof PreviewReloadRequestSchema>

/** `preview:close` / `preview:stopFind` / `preview:exportPdf` request. */
export const PreviewPanelRequestSchema = z
  .object({
    panelId: PanelIdSchema
  })
  .strict()
export type PreviewPanelRequest = z.infer<typeof PreviewPanelRequestSchema>

/**
 * The host here is a REPORTING value, not an approval value (SEC-019).
 * `PreviewHostSchema` gates the APPROVE path only.
 */
export const PreviewHostBlockedPayloadSchema = z
  .object({
    panelId: PanelIdSchema,
    host: z.string().min(1).max(253),
    approvable: z.boolean()
  })
  .strict()
export type PreviewHostBlockedPayload = z.infer<typeof PreviewHostBlockedPayloadSchema>

/** AC20 entry shape. `z.enum(ErrorCode)` — NOT `z.nativeEnum` (zod v4). */
export const PreviewFailureSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      'blocked-host',
      'insecure-scheme',
      'missing-local-file',
      'path-escape',
      'excluded-path',
      'asset-too-large',
      'unsupported-asset-type',
      'csp-missing',
      'network-error',
      'network-timeout',
      'script-error',
      'render-crash',
      'unresolved-specifier',
      'allowlist-invalid',
      'allowlist-unsupported-version',
      'blocked-link'
    ]),
    // Page-influenced value. The `record()` producer strips control chars; this
    // regex is the emit-time tripwire that actually enforces "no CR/LF", so a
    // stripping regression is caught here rather than shipped to the renderer.
    resourceUrlOrHost: z
      .string()
      .max(2048)
      .regex(/^[^\r\n]*$/, 'must not contain line breaks'),
    reasonCode: z.enum(ErrorCode),
    timestamp: z.number().int().nonnegative()
  })
  .strict()
export type PreviewFailure = z.infer<typeof PreviewFailureSchema>

/** `preview:failuresChanged` event payload. */
export const PreviewFailureListPayloadSchema = z
  .object({
    panelId: PanelIdSchema,
    failures: z.array(PreviewFailureSchema),
    truncated: z.boolean()
  })
  .strict()
export type PreviewFailureListPayload = z.infer<typeof PreviewFailureListPayloadSchema>

/** `preview:findResult` event payload. */
export const PreviewFindResultSchema = z
  .object({
    panelId: PanelIdSchema,
    requestId: z.number().int().nonnegative(),
    matches: z.number().int().nonnegative(),
    activeMatchOrdinal: z.number().int().nonnegative()
  })
  .strict()

/** `preview:stillFrameChanged` event payload. */
export const PreviewStillFrameSchema = z
  .object({
    panelId: PanelIdSchema,
    dataUrl: z.string(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    capturedAt: z.number().int().nonnegative()
  })
  .strict()
export type PreviewStillFramePayload = z.infer<typeof PreviewStillFrameSchema>

/** `preview:loadStateChanged` event payload. */
export const PreviewLoadStatePayloadSchema = z
  .object({
    panelId: PanelIdSchema,
    state: z.enum(['idle', 'loading', 'ready', 'failed', 'suspended']),
    dropped: z.number().int().nonnegative()
  })
  .strict()
export type PreviewLoadStatePayload = z.infer<typeof PreviewLoadStatePayloadSchema>

/**
 * `preview:openFileRequested` event payload (sd-074b §5.4).
 *
 * `filePath` is absolute and has ALREADY been confined to the project root by
 * main; the renderer still routes it through `resolvePanelKind` +
 * `openFileInPanel` like any other open, so eligibility stays a renderer
 * decision and `preview-` ids stay minted in one place.
 */
export const PreviewOpenFileRequestedSchema = z
  .object({
    sourcePanelId: PanelIdSchema,
    filePath: z.string().min(1).max(4096),
    anchor: z.string().max(512).nullable()
  })
  .strict()
export type PreviewOpenFileRequestedPayload = z.infer<typeof PreviewOpenFileRequestedSchema>

/** `preview:forwardedShortcut` event payload — the 4 accelerators of §1.9. */
export const PreviewForwardedShortcutSchema = z
  .object({
    panelId: PanelIdSchema,
    key: z.enum(['f', 's', 'w', 'Escape']),
    accel: z.boolean()
  })
  .strict()
export type PreviewForwardedShortcut = z.infer<typeof PreviewForwardedShortcutSchema>

/**
 * Shared contract for the preload preview bridge (`window.api.preview`).
 *
 * Single source of truth consumed by both the preload implementation and the
 * renderer typing, mirroring {@link ClaudeStatusBridge}. `setBounds` /
 * `setVisibility` are fire-and-forget sends; the rest are invoke round-trips.
 */
export interface PreviewBridge {
  /** Check whether a path may open as a running preview. */
  checkEligibility(filePath: string): Promise<PreviewCheckEligibilityResponse>
  /** Open a preview for a panel; may refuse when a preview is already live. */
  open(req: PreviewOpenRequest): Promise<PreviewOpenResult>
  /** Close and destroy the preview for a panel. */
  close(panelId: string): Promise<void>
  /** Update the native view bounds (fire-and-forget; stale seqs dropped). */
  setBounds(panelId: string, bounds: PreviewBoundsPayload, seq: number): void
  /** Update view visibility with a diagnostic reason (fire-and-forget). */
  setVisibility(panelId: string, visible: boolean, reason: string): void
  /** Reload the previewed page. */
  reload(panelId: string, opts?: { ignoreCache?: boolean }): Promise<void>
  /** Approve a remote host, writing back to the project allowlist. */
  approveHost(panelId: string, host: string): Promise<PreviewApproveResult>
  /** Start / advance an in-page find. */
  find(req: PreviewFindRequest): Promise<void>
  /** Stop the active in-page find. */
  stopFind(panelId: string): Promise<void>
  /** Export the live previewed page to PDF. */
  exportPdf(panelId: string): Promise<PdfExportResult>
  /** Subscribe to failure-log changes; returns an unsubscribe. */
  onFailuresChanged(callback: (payload: PreviewFailureListPayload) => void): () => void
  /** Subscribe to host-block events; returns an unsubscribe. */
  onHostBlocked(callback: (payload: PreviewHostBlockedPayload) => void): () => void
  /** Subscribe to in-page find results; returns an unsubscribe. */
  onFindResult(callback: (result: PreviewFindResult) => void): () => void
  /** Subscribe to still-frame changes; returns an unsubscribe. */
  onStillFrameChanged(callback: (payload: PreviewStillFramePayload) => void): () => void
  /** Subscribe to load-state changes; returns an unsubscribe. */
  onLoadStateChanged(callback: (payload: PreviewLoadStatePayload) => void): () => void
  /** Subscribe to forwarded keyboard accelerators; returns an unsubscribe. */
  onForwardedShortcut(callback: (payload: PreviewForwardedShortcut) => void): () => void
  /**
   * A link in a previewed page resolved to a project file. The renderer decides
   * the panel kind and opens the tab (sd-074b §5.4).
   */
  onOpenFileRequested(callback: (payload: PreviewOpenFileRequestedPayload) => void): () => void
}
