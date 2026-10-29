// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments for one live view, built from the view's parts
 * (docs/designs/comments/html-preview-comments.md §4.2, §7.5).
 *
 * Built last, once nothing in the view's wiring can throw, and only when both
 * halves exist: the session was built with comments on (its serving and the
 * frame preload) and the composition root wired the shared collaborators. A
 * failure here leaves the view without comments – logged, never thrown: the
 * preview itself must not depend on them.
 */
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import { PreviewCommentService, type CommentServiceContents } from './comments/PreviewCommentService'
import type { PreviewLiveBounds } from './previewLiveBounds'
import type { PreviewLivePage } from './previewLivePage'
import type { PreviewLivePipeline } from './previewLivePipeline'
import type { PreviewLiveViewParams } from './previewLiveTypes'
import type { PreviewLiveVisibility } from './previewLiveVisibility'

/** A new number per live view: drafts and keys are bound to the view that minted them. */
let nextCommentSession = 1

/** The view parts comments read. */
export interface PreviewLiveCommentParts {
  readonly page: Pick<PreviewLivePage, 'currentPage'>
  readonly pipeline: Pick<PreviewLivePipeline, 'reload'>
  readonly bounds: Pick<PreviewLiveBounds, 'lastRect' | 'lastCssSize'>
  readonly visibility: Pick<PreviewLiveVisibility, 'isDrawn'>
}

/** The view's comment service, or `undefined` when comments are not wired for it. */
export function createPreviewLiveComments(
  params: PreviewLiveViewParams,
  parts: PreviewLiveCommentParts
): PreviewCommentService | undefined {
  const shared = params.deps.comments
  const serving = params.session.comments
  if (shared === undefined || serving === undefined) return undefined
  const { deps, window } = params
  try {
    return new PreviewCommentService({
      panelId: params.panelId,
      windowId: window.id,
      session: nextCommentSession++,
      contents: params.session.view.webContents as unknown as CommentServiceContents,
      serving,
      token: params.session.token,
      realRoot: params.session.realRoot,
      projectPath: params.projectPath,
      shared,
      still: {
        stillFrameCache: deps.stillFrameCache,
        lastRect: () => parts.bounds.lastRect(),
        lastCssSize: () => parts.bounds.lastCssSize(),
        isDrawn: () => parts.visibility.isDrawn()
      },
      geometry: {
        viewRect: () => parts.bounds.lastRect(),
        contentBounds: () => window.getContentBounds(),
        hostZoom: () => deps.getZoomFactor(window)
      },
      currentPage: () => parts.page.currentPage(),
      reload: () => parts.pipeline.reload(false),
      now: () => deps.now(),
      platform: deps.platform
    })
  } catch (error) {
    logger.warn('Preview comments could not start for a view', {
      panelId: stablePathDigest(params.panelId),
      error: error instanceof Error ? error.name : typeof error
    })
    return undefined
  }
}
