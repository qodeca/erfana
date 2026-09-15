// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Public types of the preview view service (Issue #74, work item 39; design §1.4,
 * §4.4).
 *
 * Moved out of `PreviewViewService.ts` (issue #124, WI-2) so that file holds
 * behaviour only. `PreviewViewService.ts` re-exports every type declared here, so
 * callers keep importing them from there.
 */
import type {
  PdfExportResult,
  PreviewBounds,
  PreviewEmitters,
  PreviewNavigateResult,
  PreviewOpenResult
} from '../../../shared/ipc/preview-types'
import type { PreviewNavigateRequest } from '../../../shared/ipc/preview-navigation-schema'
import type { IPreviewRootRegistry } from './PreviewRootRegistry'
import type { IPreviewStillFrameCache } from './PreviewStillFrameCache'
import type { IPreviewExportController } from './PreviewExportController'
import type { IPreviewWatchCoordinator } from './PreviewWatchCoordinator'
import type { IPreviewReloadPolicy, ReloadDecision } from './PreviewReloadPolicy'
import type {
  IPreviewFindController,
  PreviewFindCount,
  PreviewFindOptions
} from './PreviewFindController'
import type { IPreviewFailureLog, PreviewFailureEmit } from './PreviewFailureLog'
import type {
  IPreviewSessionFactory,
  PreviewSessionLike,
  PreviewWebContentsHandle
} from './PreviewSessionFactory'
import type { PreviewFileWatcherHandle } from './previewViewLifecycle'
import type { PreviewWindowLike } from './PreviewLiveView'
import type { PreviewEligibilityCheck } from './previewLiveTypes'

/** A `preview:open` request (mirrors `PreviewOpenRequestSchema`, §4.2). */
export interface PreviewOpenRequest {
  panelId: string
  filePath: string
  bounds: PreviewBounds
}

/** The public lifecycle surface (design §1.4 `IPreviewViewService`). */
export interface IPreviewViewService {
  open(req: PreviewOpenRequest, window: PreviewWindowLike): Promise<PreviewOpenResult>
  close(panelId: string): Promise<void>
  /**
   * Apply a renderer bounds push. `settled` marks the forced push that answers
   * the end of a window-edge resize hold (issue #124, part 1 §1.5).
   */
  setBounds(
    panelId: string,
    bounds: PreviewBounds,
    seq: number,
    ack?: boolean,
    settled?: boolean
  ): void
  setVisibility(panelId: string, visible: boolean, reason: string): Promise<void>
  /**
   * A window-edge resize of `windowId` began (`will-resize`, `held` true) or
   * ended (`resized`, `held` false): that window's previews stay hidden until
   * each sits at its settled layout (issue #124, part 1 §1.5).
   */
  setResizeHold(windowId: number, held: boolean): void
  reload(panelId: string, opts?: { ignoreCache?: boolean }): Promise<void>
  /**
   * `preview:navigate` (issue #124, part 3 §3.1): check, or perform, a
   * same-tab move or a history step for a panel of `windowId`. A refusal is an
   * answer with a code, never a rejection.
   */
  navigate(request: PreviewNavigateRequest, windowId: number): Promise<PreviewNavigateResult>
  /**
   * `preview:focusPage` (issue #124, QG-8 U1): put keyboard focus in the page a
   * panel of `windowId` shows. Refuses – no live view, another window's view, a
   * view that is not drawn – with `false`, never a rejection.
   */
  focusPage(panelId: string, windowId: number): boolean
  /** Zoom the previewed page by `step` levels, or back to 100% with `0`. */
  setZoom(panelId: string, step: number): Promise<void>
  /** Tear down every preview hosted by a window that is closing. */
  closeWindow(windowId: number): Promise<void>
  /**
   * Zoom whichever previewed page holds keyboard focus.
   *
   * @returns `true` when a preview took it, so the View menu falls through to
   * the host window only when none did.
   */
  zoomFocused(step: number): Promise<boolean>
  swapStylesheet(panelId: string, relPath: string): Promise<boolean>
  applyApprovedHosts(panelId: string, hosts: readonly string[]): Promise<void>
  destroyAll(reason: string): Promise<void>
  onProjectChanged(oldPath: string | null, newPath: string | null): Promise<void>
  dispose(): Promise<void>
}

/**
 * The find/export surface the find/export IPC handlers drive on the service.
 * Declared here in the service layer (not the ipc layer) so `PreviewViewService`
 * can `implements` it and the compiler verifies these methods — the handlers and
 * the graph import it from here rather than the other way around.
 */
export interface PreviewFindExportService {
  find(panelId: string, text: string, options: PreviewFindOptions): void
  stopFind(panelId: string): void
  exportPdf(panelId: string, suggestedName: string): Promise<PdfExportResult>
}

/**
 * Injected dependencies (design §4.4 `PreviewViewDeps`).
 *
 * Reconciliation with §4.4: the per-view collaborators (watch coordinator, reload
 * policy, find controller, failure log) are injected as FACTORIES, not instances,
 * because each binds to per-view data absent at service-construction time (a
 * coordinator to the new project's realRoot, a find controller to the new view's
 * webContents). The built modules ARE such factories, so this is the natural
 * wiring. `registry`, `getProjectPath` and `getAllowedHosts` are added because
 * §5(c)/§5(f)/§5(c-block) route through them and §4.4 omitted them.
 */
export interface PreviewViewDeps {
  readonly sessionFactory: IPreviewSessionFactory
  readonly registry: Pick<IPreviewRootRegistry, 'rebuildCsp' | 'revoke'>
  readonly stillFrameCache: IPreviewStillFrameCache
  readonly exportController: IPreviewExportController
  readonly storageSeal: { purge(session: PreviewSessionLike): Promise<void> }
  /**
   * The project's approved hosts, read main-side.
   *
   * A narrow reader rather than the whole allowlist store: this service only
   * needs to TELL the renderer what is approved, and handing it `approveHost`
   * would put the write path within reach of code that has no business writing.
   * Correct at install time because `PreviewSessionFactory.create` awaits
   * `allowlistStore.load()` as its very first step.
   */
  readonly getAllowedHosts: () => readonly string[]
  readonly emit: PreviewEmitters
  readonly createWatchCoordinator: (
    realRoot: string,
    onChanged: (paths: readonly string[]) => void
  ) => IPreviewWatchCoordinator
  readonly createReloadPolicy: (
    onDecision: (decision: ReloadDecision) => void
  ) => IPreviewReloadPolicy
  readonly createFindController: (
    wc: PreviewWebContentsHandle,
    onCount: (count: PreviewFindCount) => void
  ) => IPreviewFindController
  readonly createFailureLog: (onEmit: PreviewFailureEmit) => IPreviewFailureLog
  readonly createEntryWatcher: (
    filePath: string,
    handlers: { onChange(): void; onUnlink(): void; onError(error: unknown): void }
  ) => PreviewFileWatcherHandle
  readonly getProjectPath: () => string | null
  /** The zoom to size a view with, read from its host window (issue #124, C3). */
  readonly getZoomFactor: (window: Pick<PreviewWindowLike, 'webContents'>) => number
  readonly now: () => number
  /** Read the entry HTML for the post-load pipeline; defaults to `fs.readFile`. */
  readonly readEntryHtml?: (filePath: string) => Promise<string>
  /** Route a forwarded accelerator (§1.9) to the renderer; defaults to a no-op. */
  readonly onForwardedShortcut?: (panelId: string, key: string) => void
  readonly platform?: NodeJS.Platform
  /**
   * Hand a vetted external URL to the OS browser (sd-074b §5.5), asking first
   * on the window whose preview clicked it. Rejects when refused (a question
   * already open, or the window gone); the live view turns that into a badge.
   */
  readonly openExternal?: (url: string, windowId: number) => Promise<void>
  /**
   * Whether a page may run as a preview (issue #124): a same-tab link, every
   * `preview:navigate` target and a resume need it. Optional so test doubles
   * typed as plain objects stay valid; absent, no page is shown in place.
   */
  readonly checkEligibility?: PreviewEligibilityCheck
}
