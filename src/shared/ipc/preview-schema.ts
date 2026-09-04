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

import { PREVIEW_BLOCKED_KINDS } from './previewBlockedKind'
import { ErrorCode } from '../errors'
import { MAX_ALLOWLIST_HOSTS, PreviewOriginSchema } from './preview-settings-schema'
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
    /*
     * Validate approvability (and reject CSP-delimiter / CRLF chars) AT the
     * boundary, not only downstream in the store.
     *
     * The field is named `host` for wire compatibility but carries an ORIGIN —
     * scheme, host and port. It MUST be the origin schema: the renderer sends
     * what it was told was blocked, and that is now `https://example.com:8443`,
     * which the hostname schema refuses outright. Left as a host schema this
     * rejects every approval the band can make, and the renderer surfaces that
     * as a bare "Not saved".
     */
    host: PreviewOriginSchema
  })
  .strict()
export type PreviewApproveHostRequest = z.infer<typeof PreviewApproveHostRequestSchema>

/** `preview:setBounds` request. Main drops `seq <= last applied`. */
export const PreviewSetBoundsSchema = z
  .object({
    panelId: PanelIdSchema,
    bounds: PreviewBoundsSchema,
    seq: z.number().int().nonnegative(),
    /**
     * Ask for a `boundsApplied` confirmation once the page has repainted at the
     * new size.
     *
     * OPTIONAL, and set only on the pushes that need it — a transition that
     * reveals Erfana's chrome. The bounds pump sends one of these per frame
     * while a panel is resizing, and confirming every one would cost a round
     * trip into the page for each. Absent means today's fire-and-forget.
     */
    ack: z.boolean().optional()
  })
  .strict()
export type PreviewSetBounds = z.infer<typeof PreviewSetBoundsSchema>

/**
 * Sent once for a push that asked for it, AFTER the page has painted at its new
 * size — never merely after `view.setBounds` returned.
 *
 * The distinction is the whole point. Whether a view's composited texture is
 * clipped to its bounds in the same frame the call returns could not be
 * measured from inside the app: `capturePage` on the host does not include
 * native child views, so the host cannot observe what the compositor did.
 * Rather than rest on an unverifiable claim, the confirmation asks the page
 * itself — two animation frames in an isolated world — which is directly
 * observable. Measured on Electron 39: ~17 ms for an idle page, ~130 ms for a
 * heavy one, and never for a page that refuses to yield, which is why every
 * caller needs a timeout and a safe fallback.
 */
/**
 * The project's approved hosts, as main knows them.
 *
 * Validated with the SAME `PreviewOriginSchema` that gates the WRITE path, so this
 * emitter is a tripwire on anything the load path let through — `load()` already
 * fails closed to `[]`, so a valid set is the only thing that should reach here.
 *
 * The whole set, never a delta: the on-disk allowlist is the record, and a delta
 * protocol would need the renderer to hold a correct running copy across a
 * project switch, a reload and a second panel.
 */
/**
 * A visibility change landed. `visible` is what was APPLIED, not what was asked.
 *
 * Sent for the hide path only when the hide actually completed — a hide that was
 * superseded by a show mid-capture emits nothing, so silence continues to mean
 * "assume the page is still there", which is the only safe reading.
 */
export const PreviewVisibilityAppliedPayloadSchema = z
  .object({
    panelId: PanelIdSchema,
    visible: z.boolean()
  })
  .strict()

export type PreviewVisibilityAppliedPayload = z.infer<
  typeof PreviewVisibilityAppliedPayloadSchema
>

export const PreviewAllowlistChangedPayloadSchema = z
  .object({
    panelId: PanelIdSchema,
    /*
     * ORIGINS, under a legacy field name. This is a TRIPWIRE as much as a
     * validator: the store is the only writer, so anything failing here is
     * something the load path let through, and the event is dropped rather than
     * shown. Which is exactly why it has to match what the store now emits —
     * against the hostname schema every allowlist event would be discarded and
     * the renderer would never learn that anything had been approved.
     */
    hosts: z.array(PreviewOriginSchema).max(MAX_ALLOWLIST_HOSTS)
  })
  .strict()

export type PreviewAllowlistChangedPayload = z.infer<
  typeof PreviewAllowlistChangedPayloadSchema
>

export const PreviewBoundsAppliedPayloadSchema = z
  .object({
    panelId: PanelIdSchema,
    seq: z.number().int().nonnegative()
  })
  .strict()
export type PreviewBoundsAppliedPayload = z.infer<typeof PreviewBoundsAppliedPayloadSchema>

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
 * `PreviewOriginSchema` gates the APPROVE path only.
 *
 * Deliberately loose, because this is what was OBSERVED rather than what may be
 * granted — a refusal must be reportable even when the thing refused could never
 * be approved. The length allows a full origin: a 253-character host plus a
 * scheme and a `:65535`. At the old 253 a long host's blocked event silently
 * failed to parse and the row never appeared at all.
 */
export const PreviewHostBlockedPayloadSchema = z
  .object({
    panelId: PanelIdSchema,
    host: z.string().min(1).max(300),
    approvable: z.boolean(),
    /**
     * What the host was refused FOR, accumulated across sightings.
     *
     * A hostname alone is not something most people can judge. One host is
     * often refused for several things, so this grows rather than recording
     * only the first — labelling a host that will run scripts as "font" would
     * misinform the reader through the very surface built to inform them.
     */
    kinds: z.array(z.enum(PREVIEW_BLOCKED_KINDS)).min(1).max(PREVIEW_BLOCKED_KINDS.length),
    /**
     * This view has reached its distinct-host cap; further hosts are not reported.
     *
     * Rides the event for the LAST host that fits, because the events for the
     * ones that do not fit are exactly what is being suppressed. Without it the
     * band would present a truncated list as complete, which for a permission
     * surface is worse than admitting the limit.
     *
     * REPLACED `notify`, a three-toast budget verdict. That field was a hint the
     * renderer could ignore; this one is a fact about completeness it must show.
     */
    truncated: z.boolean()
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
 * `preview:backdropChanged` event payload.
 *
 * The colour painted BEHIND the previewed page — Erfana's chrome black before
 * the page paints, the page's own resolved paper afterwards. The renderer paints
 * the same value on `.html-preview-placeholder` so the DOM and the native view
 * never disagree; that equality is what keeps a bounds update, a hide without a
 * cached still frame, and a show all seamless.
 *
 * `color` is derived main-side from an UNTRUSTED page's computed style, so it is
 * bounded to a strict 6-digit hex here rather than trusted as a CSS string: it is
 * interpolated into a style property in the renderer.
 */
export const PreviewBackdropPayloadSchema = z
  .object({
    panelId: PanelIdSchema,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
  })
  .strict()
export type PreviewBackdropPayload = z.infer<typeof PreviewBackdropPayloadSchema>

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
  setBounds(
    panelId: string,
    bounds: PreviewBoundsPayload,
    seq: number,
    /** Ask for a `boundsApplied` confirmation; see {@link PreviewSetBoundsSchema}. */
    options?: { ack?: boolean }
  ): void
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
  /** Subscribe to applied visibility changes; returns an unsubscribe. */
  onVisibilityApplied(
    callback: (payload: PreviewVisibilityAppliedPayload) => void
  ): () => void
  /** Subscribe to the project's approved-host set; returns an unsubscribe. */
  onAllowlistChanged(
    callback: (payload: PreviewAllowlistChangedPayload) => void
  ): () => void
  /** Subscribe to in-page find results; returns an unsubscribe. */
  onFindResult(callback: (result: PreviewFindResult) => void): () => void
  /** Subscribe to still-frame changes; returns an unsubscribe. */
  onStillFrameChanged(callback: (payload: PreviewStillFramePayload) => void): () => void
  /** Subscribe to load-state changes; returns an unsubscribe. */
  onLoadStateChanged(callback: (payload: PreviewLoadStatePayload) => void): () => void
  /** Subscribe to backdrop-colour changes; returns an unsubscribe. */
  onBackdropChanged(callback: (payload: PreviewBackdropPayload) => void): () => void
  /** The page has repainted at the size a prior `ack` push asked about. */
  onBoundsApplied(callback: (payload: PreviewBoundsAppliedPayload) => void): () => void
  /** Subscribe to forwarded keyboard accelerators; returns an unsubscribe. */
  onForwardedShortcut(callback: (payload: PreviewForwardedShortcut) => void): () => void
  /**
   * A link in a previewed page resolved to a project file. The renderer decides
   * the panel kind and opens the tab (sd-074b §5.4).
   */
  onOpenFileRequested(callback: (payload: PreviewOpenFileRequestedPayload) => void): () => void
}
