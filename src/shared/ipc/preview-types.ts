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
  // Frame refusals (issue #124, part 2 §2.12)
  | 'frame-remote'
  | 'frame-escape'
  | 'frame-excluded'
  | 'frame-too-deep'
  | 'frame-over-limit'
  | 'frame-link-blocked'

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

/**
 * Result of `preview:focusPage`: whether keyboard focus is now IN the page
 * (issue #124, QG-8 U1).
 *
 * A bare flag, and no error code, because there is nothing for the reader to
 * act on: every refusal – no live view, a view that is not drawn, a panel of
 * another window – means the page is not there to enter, and the renderer's
 * answer is to leave focus where it is. The codes exist for failures a reader
 * can do something about.
 */
export interface PreviewFocusPageResult {
  /** `true` when the previewed page took keyboard focus. */
  readonly ok: boolean
}

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
  /** The view's CSS size at capture (issue #124); the still is drawn at it, top-left. */
  cssWidth?: number
  cssHeight?: number
  /** Real input reached the page after the capture. Omitted when false. */
  stale?: boolean
}

/** The watch-set diff outcome: which candidates are watched vs dropped. */
export interface PreviewWatchState {
  watched: string[]
  dropped: string[]
}

/**
 * Where a link inside the page may open (issue #124, part 3 §3.2). Main answers
 * `same-tab` or `new-tab` where the link itself settles it, and `by-mode` where
 * the tab's link mode – which only the renderer knows – has to decide.
 */
export type PreviewLinkDisposition = 'same-tab' | 'new-tab' | 'by-mode'

/** A page in a tab's history (issue #124): a project file, and where in it. */
export interface PreviewPageTarget {
  filePath: string
  /** The fragment without its `#`, or `null` for the top of the page. */
  anchor: string | null
}

/** A tab's Back and Forward state, from main's own history list (part 3 §3.5). */
export interface PreviewHistoryState {
  canGoBack: boolean
  canGoForward: boolean
  backTarget: PreviewPageTarget | null
  forwardTarget: PreviewPageTarget | null
  /** Increases on every history change; a Back or Forward must name the current one. */
  generation: number
}

/**
 * Result of `preview:navigate` (part 3 §3.1). A refusal carries `history` only
 * when main dropped a Back or Forward entry whose page is gone, so the tab can
 * show the new state.
 */
export type PreviewNavigateResult =
  | { ok: true; target: PreviewPageTarget; generation: number }
  | { ok: false; errorCode: ErrorCode; history?: PreviewHistoryState }

/**
 * A committed page change, as `preview:pageChanged` carries it without the
 * panel id. `filePath` and `anchor` come from main's gated history entry, never
 * from the URL that committed.
 */
export interface PreviewPageChange extends PreviewPageTarget, PreviewHistoryState {
  /** A step inside the same document; per-page state is kept. */
  sameDocument: boolean
  /** The committing load answered 400 or above – a refused page still commits (S15). */
  failed: boolean
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
    truncated: boolean
  ): void
  /** The project's approved-host set changed, or is being seeded on open. */
  allowlistChanged(panelId: string, hosts: readonly string[]): void
  /** A visibility change was APPLIED to the native view. */
  visibilityApplied(panelId: string, visible: boolean): void
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
   *
   * `filePath` is in project space (issue #124, part 3 §3.4), the spelling the
   * project tree uses, so both mint the same tab for one file. `disposition` is
   * where the link table says the page may open; absent means `new-tab`.
   */
  openFileRequested(
    sourcePanelId: string,
    filePath: string,
    anchor: string | null,
    windowId?: number,
    disposition?: PreviewLinkDisposition
  ): void
  /**
   * A window-edge resize hid this panel's view (`held` true), or ended and
   * main now wants the panel's settled bounds (`held` false) (issue #124,
   * part 1 §1.5).
   *
   * Optional HERE only so test doubles typed against this interface stay
   * valid; the real bundle (`PreviewEmitterBundle` in `emit.ts`) requires it.
   */
  resizeHold?(panelId: string, held: boolean): void
  /**
   * A load main started has committed, or the page stepped to another place
   * in itself (issue #124, part 3 §3.5). `change` names a gated history entry,
   * never the URL that committed.
   *
   * Optional HERE for the same reason as `resizeHold`; the real bundle
   * requires it.
   */
  pageChanged?(panelId: string, change: PreviewPageChange): void
}
