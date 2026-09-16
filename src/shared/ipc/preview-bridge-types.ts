// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared contract for the preload preview bridge (`window.api.preview`).
 *
 * Single source of truth consumed by both the preload implementation and the
 * renderer typing, mirroring `ClaudeStatusBridge`. `setBounds` /
 * `setVisibility` are fire-and-forget sends; the rest are invoke round-trips.
 *
 * Moved out of `preview-schema.ts` in issue #124 (WI-7) because that file is at
 * its size cap; it re-exports this interface, so no import path changed. The
 * members #124 adds – `navigate`, `onPageChanged`, `onResizeHold` and the
 * `settled` option – have no caller yet.
 *
 * @see src/preload/previewBridge.ts - the implementation
 */
import type {
  PreviewNavigateRequest,
  PreviewPageChangedPayload,
  PreviewResizeHoldPayload
} from './preview-navigation-schema'
import type {
  PreviewAllowlistChangedPayload,
  PreviewBackdropPayload,
  PreviewBoundsAppliedPayload,
  PreviewBoundsPayload,
  PreviewCheckEligibilityResponse,
  PreviewFailureListPayload,
  PreviewFindRequest,
  PreviewForwardedShortcut,
  PreviewHostBlockedPayload,
  PreviewLoadStatePayload,
  PreviewOpenFileRequestedPayload,
  PreviewOpenRequest,
  PreviewStillFramePayload,
  PreviewVisibilityAppliedPayload
} from './preview-schema'
import type {
  PdfExportResult,
  PreviewApproveResult,
  PreviewFindResult,
  PreviewFocusPageResult,
  PreviewNavigateResult,
  PreviewOpenResult
} from './preview-types'

/** The `window.api.preview` bridge. */
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
    /**
     * `ack` asks for a `boundsApplied` confirmation; `settled` marks the forced
     * push that ends a window-edge resize hold. See `PreviewSetBoundsSchema`.
     */
    options?: { ack?: boolean; settled?: boolean }
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
  /**
   * Show another page in this tab, or step its history (issue #124): `check`
   * first, then `commit`. Main re-checks every path it receives.
   */
  navigate(req: PreviewNavigateRequest): Promise<PreviewNavigateResult>
  /**
   * Put keyboard focus in the previewed page (issue #124, QG-8 U1).
   *
   * Called only from a reader's key press on the panel's placeholder – never on
   * its own, because focus that moves by itself is focus a reader has lost.
   * `{ ok: false }` means the page is not there to enter and focus stays put.
   */
  focusPage(panelId: string): Promise<PreviewFocusPageResult>
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
  /** A load main started committed: this tab's page or history changed (issue #124). */
  onPageChanged(callback: (payload: PreviewPageChangedPayload) => void): () => void
  /** A window-edge resize hid this panel's view, or ended (issue #124). */
  onResizeHold(callback: (payload: PreviewResizeHoldPayload) => void): () => void
}
