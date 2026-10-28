// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What every view's comment service shares, and the registry the IPC handlers
 * find a panel's service in (docs/designs/comments/html-preview-comments.md §4.2, §8).
 *
 * Built once at the composition root (`buildPreviewGraph.ts`) and handed to
 * every live view; a view's service registers itself under its panel and
 * window, and leaves when the view goes.
 */
import type {
  CommentAck,
  CommentAnchorStatus,
  CommentDraftOpened,
  CommentListResult,
  CommentModeChanged,
  CommentSaveRequest,
  CommentSaveResult,
  CommentSaveSettled,
  CommentSetModeResult,
  CommentsChanged
} from '../../../../shared/ipc/preview-comment-schema'
import type { CommentFileJobRunner } from './commentFileJobs'
import type { CommentIdentity } from './CommentWriter'
import type { CommentUnsavedSources } from './commentUnsavedSources'

/** Main → renderer comment events, each to the window that owns the view only. */
export interface PreviewCommentEmitters {
  draftOpened(windowId: number, payload: CommentDraftOpened): void
  commentsChanged(windowId: number, payload: CommentsChanged): void
  anchorStatus(windowId: number, payload: CommentAnchorStatus): void
  modeChanged(windowId: number, payload: CommentModeChanged): void
  /** A save answered `COMMENT_SAVE_PENDING` settled after all. */
  saveSettled(windowId: number, payload: CommentSaveSettled): void
}

/** One panel's state as the e2e hook reports it (`commentE2eHook.ts`). */
export interface CommentE2ePanelState {
  readonly panelId: string
  readonly windowId: number
  readonly mode: boolean
  readonly showIcons: boolean
  readonly hidden: boolean
  /** Reloads this view started, and own-write echoes dropped (M-058). */
  readonly reloads: number
  readonly echoes: number
  readonly lastRestore?: string
  /** Drafts and keys the view holds. */
  readonly drafts: number
  readonly keys: number
  /** Frames that said hello, and how many of them are commentable. */
  readonly frames: number
  readonly commentableFrames: number
}

/** A view's comment service, as the IPC handlers drive it (`PreviewCommentService`). */
export interface CommentServiceApi {
  readonly panelId: string
  readonly windowId: number
  setMode(on: boolean, showIcons: boolean): Promise<CommentSetModeResult>
  list(): Promise<CommentListResult>
  reveal(threadKey: string): CommentAck
  save(request: CommentSaveRequest): Promise<CommentSaveResult>
  e2eState(): CommentE2ePanelState
}

/** Where the IPC handlers find a panel's comment service. */
export interface PreviewCommentRegistry {
  /** The service of `panelId` in `windowId`; another window's panel is not found. */
  get(panelId: string, windowId: number): CommentServiceApi | undefined
  add(service: CommentServiceApi): () => void
  /** Every registered service (the e2e hook). */
  all(): CommentServiceApi[]
}

/** Build the registry. */
export function createPreviewCommentRegistry(): PreviewCommentRegistry {
  const services = new Map<string, CommentServiceApi>()
  return {
    get(panelId, windowId) {
      const service = services.get(panelId)
      return service !== undefined && service.windowId === windowId ? service : undefined
    },
    add(service) {
      services.set(service.panelId, service)
      return () => {
        if (services.get(service.panelId) === service) services.delete(service.panelId)
      }
    },
    all: () => [...services.values()]
  }
}

/** The collaborators every view's comment service shares. */
export interface PreviewCommentShared {
  readonly registry: PreviewCommentRegistry
  readonly unsaved: CommentUnsavedSources
  readonly emit: PreviewCommentEmitters
  /** The reviewer from the app-level settings – never from a request (§7.5 step 2). */
  readonly identity: () => CommentIdentity | undefined
  /** `htmlPreview.comments.enabled`, read per call. */
  readonly isEnabled: () => boolean
  /** The cursor on screen (`screen.getCursorScreenPoint`), for a pick without a screen point. */
  readonly cursor?: () => { readonly x: number; readonly y: number }
  /** Where every comment parse runs; the process-wide comment parse worker by default (§19 R3-12). */
  readonly jobs?: CommentFileJobRunner
}
