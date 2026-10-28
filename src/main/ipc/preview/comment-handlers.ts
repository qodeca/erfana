// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments' renderer → main requests
 * (docs/designs/comments/html-preview-comments.md §7, §8; tests I-001–I-005, SEC-07).
 *
 * Every handler mirrors `focus-handlers.ts`:
 *   1. refuses an untrusted sender (`isTrustedSender`) BEFORE the payload is
 *      read;
 *   2. `safeParse`s the strict, bounded request (`preview-comment-schema.ts`);
 *   3. resolves the SENDER's own window, and finds the panel's comment service
 *      in it only – a panel of another window is not found;
 *   4. re-validates the answer against its strict schema, and never throws:
 *      what it cannot serve is a refusal with an error code.
 *
 * Trust model: the renderer names a panel and main-minted keys, never a path
 * to write, an offset or an author. Logs carry channels and schema issue
 * codes only – never a comment's text, an author or a file name (SEC-20).
 */
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { ZodType } from 'zod'
import { ErrorCode } from '../../../shared/errors'
import { PreviewCommentChannels } from '../../../shared/ipc/preview-comment-channels'
import {
  CommentAckSchema,
  CommentCommandRequestSchema,
  CommentListResultSchema,
  CommentPanelRequestSchema,
  CommentSaveRequestSchema,
  CommentSaveResultSchema,
  CommentSetModeRequestSchema,
  CommentSetModeResultSchema,
  CommentUnsavedSourcesRequestSchema
} from '../../../shared/ipc/preview-comment-schema'
import type { PreviewCommentRegistry } from '../../services/preview/comments/commentServiceTypes'
import type { CommentUnsavedSources } from '../../services/preview/comments/commentUnsavedSources'
import { logger } from '../../services/LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'
import { registerHandle, unregisterHandle } from '../registry'
import { issueCodesOf } from './commentEmit'

/** The slice of a `BrowserWindow` the handlers use. */
export interface CommentHostWindow {
  readonly id: number
  once(event: 'closed', listener: () => void): unknown
}

/** Injected collaborators for the comment handlers. */
export interface PreviewCommentHandlerDeps {
  readonly registry: Pick<PreviewCommentRegistry, 'get'>
  readonly unsaved: CommentUnsavedSources
  readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  /** Resolve the sender's window; defaults to `BrowserWindow.fromWebContents`. */
  readonly resolveWindow?: (event: IpcMainInvokeEvent) => CommentHostWindow | null
}

/** One channel's request and answer schemas, its refusal and its work. */
interface CommentRoute<Request> {
  readonly channel: string
  readonly request: ZodType<Request>
  readonly result: ZodType
  /** The answer for an untrusted sender, a bad request, no window or a failure. */
  readonly refused: unknown
  readonly run: (request: Request, window: CommentHostWindow) => unknown
}

const KEY_INVALID = { ok: false, code: ErrorCode.COMMENT_KEY_INVALID } as const
const WRITE_FAILED = { ok: false, code: ErrorCode.COMMENT_WRITE_FAILED } as const

/** Register the five comment channels. Returns the function that removes them. */
export function registerPreviewCommentHandlers(deps: PreviewCommentHandlerDeps): () => void {
  const { registry, unsaved, isTrustedSender } = deps
  const resolveWindow =
    deps.resolveWindow ??
    ((event: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender) as CommentHostWindow | null)
  /** Windows whose unsaved-source list is forgotten when they close. */
  const watched = new Set<number>()

  function register<Request>(route: CommentRoute<Request>): void {
    registerHandle(route.channel, async (event, arg: unknown) => {
      if (!isTrustedSender(event)) {
        logger.warn('Preview comments: rejected a request from an untrusted sender', { channel: route.channel })
        return route.refused
      }
      try {
        const parsed = route.request.safeParse(arg)
        if (!parsed.success) {
          logger.warn('Preview comments: rejected an invalid request', { channel: route.channel, issues: issueCodesOf(parsed.error) })
          return route.refused
        }
        const window = resolveWindow(event)
        if (window === null) return route.refused
        const answer = await route.run(parsed.data, window)
        const checked = route.result.safeParse(answer)
        if (checked.success) return checked.data
        logger.warn('Preview comments: an answer failed its schema', { channel: route.channel, issues: issueCodesOf(checked.error) })
        return route.refused
      } catch (error) {
        logger.error('Preview comments: a request failed', redactedLogError(error), { channel: route.channel })
        return route.refused
      }
    })
  }

  register({
    channel: PreviewCommentChannels.SET_MODE,
    request: CommentSetModeRequestSchema,
    result: CommentSetModeResultSchema,
    refused: KEY_INVALID,
    // No live view with comments (closed, or comments off): the mode is simply off.
    run: (request, window) =>
      registry.get(request.panelId, window.id)?.setMode(request.on, request.showIcons) ?? {
        ok: true,
        on: false,
        showIcons: request.showIcons
      }
  })

  register({
    channel: PreviewCommentChannels.LIST,
    request: CommentPanelRequestSchema,
    result: CommentListResultSchema,
    refused: KEY_INVALID,
    run: (request, window) =>
      registry.get(request.panelId, window.id)?.list() ?? { ok: true, files: [], unavailable: 'disabled' }
  })

  register({
    channel: PreviewCommentChannels.COMMAND,
    request: CommentCommandRequestSchema,
    result: CommentAckSchema,
    refused: KEY_INVALID,
    run: (request, window) => registry.get(request.panelId, window.id)?.reveal(request.threadKey) ?? KEY_INVALID
  })

  register({
    channel: PreviewCommentChannels.SAVE,
    request: CommentSaveRequestSchema,
    result: CommentSaveResultSchema,
    refused: WRITE_FAILED,
    run: (request, window) => registry.get(request.panelId, window.id)?.save(request) ?? KEY_INVALID
  })

  register({
    channel: PreviewCommentChannels.SET_UNSAVED_SOURCES,
    request: CommentUnsavedSourcesRequestSchema,
    result: CommentAckSchema,
    refused: KEY_INVALID,
    run: async (request, window) => {
      if (!watched.has(window.id)) {
        watched.add(window.id)
        const windowId = window.id
        window.once('closed', () => {
          watched.delete(windowId)
          unsaved.forget(windowId)
        })
      }
      await unsaved.set(window.id, request.paths)
      return { ok: true }
    }
  })

  return () => {
    for (const channel of Object.values(PreviewCommentChannels)) unregisterHandle(channel)
  }
}
