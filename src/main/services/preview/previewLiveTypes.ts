// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The live-view contract types (Issue #124, WI-1; design §3).
 *
 * Moved out of `PreviewLiveView.ts` unchanged, so the view and the modules split
 * out of it share one definition. `PreviewLiveView.ts` re-exports all three, and
 * `PreviewViewService.ts` keeps re-exporting `PreviewWindowLike` from there, so
 * every existing import path still resolves. WI-29 replaced the view's failure
 * log with its page-scope holder, which also took over the CSP refusal sink.
 * WI-17b (issue #124) added the eligibility check a same-tab link needs and the
 * panel's own history, which the service keeps across a suspend.
 */

import type { PreviewBounds, PreviewEmitters } from '../../../shared/ipc/preview-types'
import type { IPreviewRootRegistry } from './PreviewRootRegistry'
import type { IPreviewStillFrameCache } from './PreviewStillFrameCache'
import type { IPreviewExportController } from './PreviewExportController'
import type { IPreviewWatchCoordinator } from './PreviewWatchCoordinator'
import type { IPreviewReloadPolicy, ReloadDecision } from './PreviewReloadPolicy'
import type { IPreviewFindController, PreviewFindCount } from './PreviewFindController'
import type { PreviewPageScopeHolder } from './previewPageScope'
import type { PreviewEligibilityVerdict } from './PreviewEligibilityService'
import type { PreviewLiveNavigationParams } from './previewPageNavigator'
import type {
  PreviewSession,
  PreviewSessionLike,
  PreviewViewHandle,
  PreviewWebContentsHandle
} from './PreviewSessionFactory'
import type { PreviewFileWatcherHandle } from './previewViewLifecycle'

/**
 * Whether a page may run as a preview: `PreviewEligibilityService.check`, with
 * main's project root (issue #124, part 3 §3.2 row 6 and §3.5).
 */
export type PreviewEligibilityCheck = (
  filePath: string,
  projectPath: string
) => Promise<PreviewEligibilityVerdict>

/** The slice of a `BrowserWindow` a live view uses. Structural for tests. */
export interface PreviewWindowLike {
  /**
   * Whether the host window is gone.
   *
   * REQUIRED, not optional. An optional member fails open — every existing test
   * fake omitted it, and the production object arrives through an unchecked
   * `as PreviewWindowLike` cast in `lifecycle-handlers.ts`, so a typo would pass
   * silently and the guard would never run. Belt-and-braces beside the
   * per-window drain in `PreviewViewService.closeWindow`, which is what actually
   * stops a view outliving its window.
   */
  isDestroyed(): boolean
  /**
   * `BrowserWindow.id`. Stored with the registry entry because panel ids are
   * path-derived, so two windows previewing the same file mint the same id
   * (sd-074b §4.2).
   */
  readonly id: number
  readonly contentView: {
    addChildView(view: PreviewViewHandle): void
    removeChildView(view: PreviewViewHandle): void
  }
  getContentBounds(): { x: number; y: number; width: number; height: number }
  /**
   * The host window's own page, read for its zoom factor: every view is sized
   * with its own window's zoom (issue #124, part 1 §1.4 C3), and the M10
   * tripwire compares against it (§1.2). REQUIRED for the same reason as
   * `isDestroyed`: while optional, it failed open. A `BrowserWindow` satisfies
   * it structurally.
   *
   * `focus` and `isDestroyed` return keyboard focus to the host when a
   * forwarded key moves it into the chrome (`previewHostFocus.ts`, QG-11a H1).
   * Optional, unlike the zoom read: a contents without them only means focus
   * stays where it is – nothing is gated on it.
   */
  readonly webContents: { getZoomFactor(): number; focus?(): void; isDestroyed?(): boolean }
}

/** Shared (non-per-view) collaborators a live view needs. */
export interface PreviewLiveViewDeps {
  readonly emit: PreviewEmitters
  readonly stillFrameCache: IPreviewStillFrameCache
  readonly exportController: IPreviewExportController
  readonly registry: Pick<IPreviewRootRegistry, 'rebuildCsp' | 'revoke'>
  readonly storageSeal: { purge(session: PreviewSessionLike): Promise<void> }
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
  readonly createEntryWatcher: (
    filePath: string,
    handlers: { onChange(): void; onUnlink(): void; onError(error: unknown): void }
  ) => PreviewFileWatcherHandle
  /**
   * The zoom factor to size a view with, read from the window it is handed –
   * the view's host (issue #124, C3). Never another window: with a second one
   * open, the page came out above its panel and at the wrong size.
   */
  readonly getZoomFactor: (window: Pick<PreviewWindowLike, 'webContents'>) => number
  readonly now: () => number
  readonly readEntryHtml?: (filePath: string) => Promise<string>
  readonly onForwardedShortcut?: (panelId: string, key: string) => void
  readonly platform?: NodeJS.Platform
  /**
   * Hand a vetted URL to the OS browser (sd-074b §5.5), asking on the window
   * this view belongs to. Injected rather than importing `shell` here, so link
   * routing is unit-testable without Electron. Absent means external links are
   * refused and badged.
   */
  readonly openExternal?: (url: string, windowId: number) => Promise<void>
  /**
   * Whether a linked page may run as a preview, so the link may stay in its
   * tab (issue #124, part 3 §3.2 row 6). Absent, every link opens a new tab.
   */
  readonly checkEligibility?: PreviewEligibilityCheck
}

/** What the manager hands to a new live view. */
export interface PreviewLiveViewParams {
  readonly panelId: string
  readonly projectPath: string
  readonly entryFilePath: string
  readonly window: PreviewWindowLike
  readonly initialBounds: PreviewBounds
  readonly session: PreviewSession
  /**
   * The view's page scopes (issue #124, WI-29): the committed page and at most
   * one pending one. The service creates the holder before the session; this
   * view's teardown disposes it. No writer keeps a scope – each looks it up at
   * the moment it writes. A CSP refusal reaches the same sink as a filter
   * refusal inside each scope, so that wire cannot go missing (it used to be a
   * required `onBlockedHost` parameter for exactly that reason).
   */
  readonly pageScopes: PreviewPageScopeHolder
  /**
   * The panel's own history, which the service keeps across a suspend, and how
   * the first page is reported (issue #124, part 3 §3.4, §3.5). `entryFilePath`
   * is where that first page is loaded from.
   */
  readonly navigation: PreviewLiveNavigationParams
  readonly deps: PreviewLiveViewDeps
}
