// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview leaf type module (Issue #74, work item 4).
 *
 * Protocol- and result-shaped types shared across the preview feature. This is
 * a LEAF module: it depends only on `errors.ts` (item 1) and, nominally,
 * `constants.ts` (item 3), so items 11–39 can consume these types without a
 * forward dependency on the schema module (item 41) — see design §4.4.
 *
 * `PreviewViewDeps` and `PreviewHandlerDeps` are DELIBERATELY not here: they
 * reference `I*` service interfaces from higher work items, so per §4.4 they
 * live in `PreviewViewService.ts` (item 39) and `preview-handlers.ts`
 * (item 47) respectively, keeping this module a true dependency leaf.
 */

import type { ErrorCode } from '../errors'
import type { PreviewBlockedKind } from './previewBlockedKind'

/** A rectangle in the coordinate space of the host window content view. */
export interface PreviewBounds {
  x: number
  y: number
  width: number
  height: number
}

/** How a file path resolves to a dockview panel. */
export type FilePanelKind = 'image' | 'preview' | 'editor'

/** The closed set of preview failure classes surfaced to the renderer (AC20). */
export type PreviewFailureType =
  | 'blocked-host'
  | 'insecure-scheme'
  | 'missing-local-file'
  | 'path-escape'
  | 'excluded-path'
  | 'asset-too-large'
  | 'unsupported-asset-type'
  | 'csp-missing'
  | 'network-error'
  | 'network-timeout'
  | 'script-error'
  | 'render-crash'
  | 'unresolved-specifier'
  | 'allowlist-invalid'
  | 'allowlist-unsupported-version'
  | 'blocked-link'

/** What a producer hands to `PreviewFailureLog.record`; `id`/`timestamp` are added there. */
export interface PreviewFailureInput {
  type: PreviewFailureType
  resourceUrlOrHost: string
  reasonCode: ErrorCode
}

// NOTE: `ConfineVerdict` and `PreviewResolveResult` (a Node `Buffer` body + path
// confinement internals) are MAIN-ONLY and live in
// `src/main/services/preview/previewPathResolve.ts`, not here — this shared leaf
// stays free of Node types and the renderer's type graph stays minimal.

/**
 * Result of `preview:open`. `holderPanelId` is present for
 * `PREVIEW_VIEW_LIMIT_REACHED` so the refused panel can offer "Close the other
 * preview" (NEW-9).
 */
export type PreviewOpenResult =
  | { ok: true }
  | { ok: false; errorCode: ErrorCode; holderPanelId?: string }

/** Result of `preview:approveHost`; the new host set is returned on success. */
export type PreviewApproveResult =
  | { ok: true; hosts: readonly string[] }
  | { ok: false; errorCode: ErrorCode }

/** A single `found-in-page` result forwarded to the renderer. */
export interface PreviewFindResult {
  panelId: string
  requestId: number
  matches: number
  activeMatchOrdinal: number
}

/** Result of a PDF export of the live preview `WebContents`. */
export type PdfExportResult = { ok: true; path: string } | { ok: false; errorCode: ErrorCode }

/** A downscaled still frame captured on hide, or a defined fallback. */
export interface PreviewStillFrame {
  dataUrl: string
  width: number
  height: number
  capturedAt: number
}

/** The watch-set diff outcome: which candidates are watched vs dropped. */
export interface PreviewWatchState {
  watched: string[]
  dropped: string[]
}

/**
 * The main→renderer emitter bundle. Declared HERE (item 4) so `PreviewViewService`
 * (item 39) depends on the emit TYPE from a strictly-lower item, never on the emit
 * IMPLEMENTATION (`emit.ts`, item 43). Members take the item-4 result interfaces
 * above; the concrete zod-validated payloads are re-validated inside `emit.ts`
 * before send, so this type stays free of any item-41 schema import.
 */
export interface PreviewEmitters {
  failuresChanged(
    panelId: string,
    failures: readonly PreviewFailureInput[],
    truncated: boolean
  ): void
  hostBlocked(
    panelId: string,
    host: string,
    approvable: boolean,
    kinds: readonly PreviewBlockedKind[],
    notify: boolean
  ): void
  findResult(r: PreviewFindResult): void
  stillFrameChanged(panelId: string, frame: PreviewStillFrame): void
  loadStateChanged(
    panelId: string,
    state: 'idle' | 'loading' | 'ready' | 'failed' | 'suspended',
    dropped: number
  ): void
  /**
   * The colour behind the page changed. `color` is `#RRGGBB`; the renderer
   * paints it on the placeholder so the DOM and the native view always carry the
   * same value (the invariant replacing sd-074 §1.8's "both are brand black").
   */
  backdropChanged(panelId: string, color: string): void
  /**
   * A bounds push that asked for confirmation has been applied AND the page has
   * repainted at the new size.
   *
   * Only the renderer knows which push it cares about, so the `seq` it sent
   * comes back with it.
   */
  boundsApplied(panelId: string, seq: number): void
  /**
   * A link inside the previewed page resolved to a project file that should
   * open as an Erfana tab (sd-074b §5.4).
   *
   * Deliberately carries NO panel kind: main answers only "is this a real,
   * confined, in-project path", and `resolvePanelKind` in the renderer stays the
   * single owner of which panel type a file opens in — the same rule the project
   * tree and the terminal follow.
   */
  openFileRequested(
    sourcePanelId: string,
    filePath: string,
    anchor: string | null,
    windowId?: number
  ): void
}
