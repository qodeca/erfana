// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One view's two write paths – `preview:commentSave` and
 * `preview:commentBulk` – over ONE `CommentWriter`, so a bulk action passes the
 * same checks as a single save (spec 024 024-FR-028).
 */
import type { CommentBulkRequest, CommentBulkResult } from '../../../../shared/ipc/comment-common-schema'
import type { CommentSaveRequest, CommentSaveResult } from '../../../../shared/ipc/preview-comment-schema'
import { createCommentBulkFlow, type LateBulkSettle } from '../../comments/commentBulkFlow'
import type { HtmlFileJobRunner } from './htmlCommentJobs'
import { createCommentSaveFlow, type LateSettle, type SaveDraft } from '../../comments/commentSaveFlow'
import { CommentWriter, type CommentWriterDeps } from '../../comments/CommentWriter'
import type { CommentBinding, CommentKeyStore } from '../../comments/commentKeyStore'
import type { CommentReloadCoordinator } from './commentReloadCoordinator'
import type { PreviewCommentServiceDeps } from './PreviewCommentService'

/** What the two flows are built from: the view's service dependencies and its parts. */
interface PreviewSaveFlowDeps<D extends SaveDraft> extends Pick<PreviewCommentServiceDeps, 'shared' | 'windowId' | 'realRoot' | 'createWriter' | 'currentPage' | 'platform'> {
  readonly binding: CommentBinding
  readonly jobs: HtmlFileJobRunner
  readonly keys: CommentKeyStore<D>
  readonly coordinator: CommentReloadCoordinator
  readonly onLateSettled: (settled: LateSettle) => void
  readonly onBulkSettled: (settled: LateBulkSettle) => void
}

/**
 * Build the view's write paths.
 *
 * @param deps - {@link PreviewSaveFlowDeps}
 * @returns The save flow, then the bulk flow.
 */
export function createPreviewSaveFlows<D extends SaveDraft>(
  deps: PreviewSaveFlowDeps<D>
): [(request: CommentSaveRequest) => Promise<CommentSaveResult>, (request: CommentBulkRequest) => Promise<CommentBulkResult>] {
  const writerDeps: CommentWriterDeps = {
    identity: deps.shared.identity,
    hasUnsavedSource: realPath => deps.shared.unsaved.has(deps.windowId, realPath),
    jobs: deps.jobs,
    platform: deps.platform
  }
  const { coordinator } = deps
  const flow = {
    binding: deps.binding,
    realRoot: deps.realRoot,
    keys: deps.keys,
    writer: deps.createWriter?.(writerDeps) ?? new CommentWriter(writerDeps),
    captureScroll: () => coordinator.captureScroll(),
    currentPage: deps.currentPage,
    landed: (write: Parameters<CommentReloadCoordinator['arm']>[0]) => coordinator.arm(write),
    platform: deps.platform
  }
  return [createCommentSaveFlow({ ...flow, lateSettled: deps.onLateSettled }), createCommentBulkFlow({ ...flow, lateSettled: deps.onBulkSettled })]
}
