// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments in renderer-hosted previews – the `file-comment:*` requests
 * (spec 024 architecture note 001 § 4, § 8 C17, C18; 024-NFR-005 items 4–6;
 * `docs/ipc-patterns.md` § File comments).
 *
 * Every request, in this order, before any work:
 *   1. `registerHandle` – the process-wide gate on Erfana's own renderer;
 *   2. `isTrustedSender` – the app's own TOP-LEVEL frame, as
 *      `image-export:run` – BEFORE the payload is read;
 *   3. the strict, capped schema (`file-comment-schema.ts`);
 *   4. a named `filePath` through the confinement check every `file:*` path
 *      passes (`resolveConfinedPath`: inside the open project, an existing
 *      file, from the window that owns the project), then the comment rules
 *      of this family's kinds (`FileCommentService` → `commentFileAccess`);
 *   5. the sender's OWN window, resolved from the event – the file must be
 *      open in that window's panel (C17); thread operations name keys only.
 * The author is read from the app settings in main, never from a request.
 *
 * Answers are re-validated against their schema and never thrown: every
 * refusal is `{ ok: false, code, reason }`. Logs carry the channel, the
 * reason and schema issue codes – never a path, a comment's text, words, a
 * name or an e-mail (C20).
 */
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { ZodType } from 'zod'
import { FileCommentChannels, FileCommentEvents } from '../../../shared/ipc/file-comment-channels'
import {
  FileCommentChangedSchema,
  FileCommentListRequestSchema,
  FileCommentListResultSchema,
  FileCommentOpenDraftRequestSchema,
  FileCommentOpenDraftResultSchema,
  FileCommentSaveRequestSchema,
  FileCommentSaveResultSchema,
  type FileCommentChanged
} from '../../../shared/ipc/file-comment-schema'
import type { CommentReasonedRefusal } from '../../../shared/ipc/comment-common-schema'
import { logger } from '../../services/LoggingService'
import { refusalCode, type CommentRefusal } from '../../services/comments/commentRefusals'
import type { FileCommentCaller, FileCommentService } from '../../services/comments/FileCommentService'
import type { ProjectSession } from '../../services/session/ProjectSession'
import { redactedLogError } from '../../utils/redactUserInput'
import { ConfinementError } from '../confinement/ConfinementError'
import { defaultConfinementDeps, resolveConfinedPath, type ConfinementDeps } from '../confinement/resolveConfinedPath'
import { issueCodesOf } from '../preview/commentEmit'
import { registerHandle, unregisterHandle } from '../registry'
import { isTrustedSender as defaultIsTrustedSender } from '../senderValidation'

/** The slice of a `BrowserWindow` the handlers use. */
export interface FileCommentHostWindow {
  readonly id: number
  once(event: 'closed', listener: () => void): unknown
}

/** Injected collaborators. */
export interface FileCommentHandlerDeps {
  readonly service: Pick<FileCommentService, 'list' | 'openDraft' | 'save' | 'forgetWindow'>
  /** The open project: its roots, and the window that owns it. */
  readonly session: Pick<ProjectSession, 'current'>
  /** The top-level-frame gate; {@link defaultIsTrustedSender} by default. */
  readonly isTrustedSender?: (event: IpcMainInvokeEvent) => boolean
  /** The sender's window; `BrowserWindow.fromWebContents` by default. */
  readonly resolveWindow?: (event: IpcMainInvokeEvent) => FileCommentHostWindow | null
  /** File system and path flavour of the confinement check; the real ones by default. */
  readonly confinement?: ConfinementDeps
}

/** One channel: its schemas and its work, given the caller and the confined path. */
interface FileCommentRoute<Request> {
  readonly channel: string
  readonly request: ZodType<Request>
  readonly result: ZodType
  /** The request's file path, when it names one; it is confined before {@link FileCommentRoute.run}. */
  readonly pathOf: (request: Request) => string | undefined
  readonly run: (caller: FileCommentCaller, request: Request) => Promise<unknown>
}

function refusal(reason: CommentRefusal): CommentReasonedRefusal {
  return { ok: false, code: refusalCode(reason), reason }
}

/** A refused confinement check as a comment refusal: a missing file is `missing`, anything else outside the project. */
function confinementRefusal(error: unknown): CommentReasonedRefusal {
  if (error instanceof ConfinementError && error.code === 'NOT_FOUND') return refusal('missing')
  return refusal('outside-project')
}

/** Send `file-comment:changed` to one window, re-validated; nothing to a window that is gone. */
export function sendFileCommentChanged(windowId: number, payload: FileCommentChanged): void {
  const checked = FileCommentChangedSchema.safeParse(payload)
  if (!checked.success) {
    logger.warn('File comments: an event failed its schema', { channel: FileCommentEvents.CHANGED, issues: issueCodesOf(checked.error) })
    return
  }
  const window = BrowserWindow.fromId(windowId)
  if (window === null || window.isDestroyed()) return
  window.webContents.send(FileCommentEvents.CHANGED, checked.data)
}

/** Register the three `file-comment:*` channels. Returns the function that removes them. */
export function registerFileCommentHandlers(deps: FileCommentHandlerDeps): () => void {
  const { service, session } = deps
  const isTrustedSender = deps.isTrustedSender ?? defaultIsTrustedSender
  const confinement = deps.confinement ?? defaultConfinementDeps
  const resolveWindow =
    deps.resolveWindow ??
    ((event: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender) as FileCommentHostWindow | null)
  /** Windows whose panels are forgotten when they close. */
  const watched = new Set<number>()

  function watchClose(window: FileCommentHostWindow): void {
    if (watched.has(window.id)) return
    watched.add(window.id)
    const windowId = window.id
    window.once('closed', () => {
      watched.delete(windowId)
      service.forgetWindow(windowId)
    })
  }

  /** Steps 4–5: the caller and the confined path, or why not. */
  async function callerOf(
    event: IpcMainInvokeEvent,
    filePath: string | undefined
  ): Promise<{ readonly caller: FileCommentCaller; readonly filePath?: string } | CommentReasonedRefusal> {
    const window = resolveWindow(event)
    const snapshot = session.current()
    if (window === null) return refusal('not-open')
    if (snapshot === null) return refusal('outside-project')
    const caller: FileCommentCaller = { windowId: window.id, root: snapshot.root, realRoot: snapshot.realRoot }
    if (filePath === undefined) return { caller }
    try {
      const resolved = await resolveConfinedPath(
        filePath,
        { session: snapshot, senderId: event.sender?.id ?? null },
        { mode: 'project', mustExist: true, kind: 'file' },
        confinement
      )
      watchClose(window)
      return { caller, filePath: resolved.requested }
    } catch (error) {
      return confinementRefusal(error)
    }
  }

  function register<Request>(route: FileCommentRoute<Request>): void {
    registerHandle(route.channel, async (event: IpcMainInvokeEvent, arg: unknown) => {
      if (!isTrustedSender(event)) {
        logger.warn('File comments: rejected a request from an untrusted sender', { channel: route.channel })
        return refusal('untrusted-sender')
      }
      try {
        const parsed = route.request.safeParse(arg)
        if (!parsed.success) {
          logger.warn('File comments: rejected an invalid request', { channel: route.channel, issues: issueCodesOf(parsed.error) })
          return refusal('bad-request')
        }
        const found = await callerOf(event, route.pathOf(parsed.data))
        if ('ok' in found) return found
        const request = found.filePath === undefined ? parsed.data : { ...parsed.data, filePath: found.filePath }
        const answer = await route.run(found.caller, request)
        const checked = route.result.safeParse(answer)
        if (checked.success) return checked.data
        logger.warn('File comments: an answer failed its schema', { channel: route.channel, issues: issueCodesOf(checked.error) })
        return refusal('invalid')
      } catch (error) {
        logger.error('File comments: a request failed', redactedLogError(error), { channel: route.channel })
        return refusal('io')
      }
    })
  }

  register({
    channel: FileCommentChannels.LIST,
    request: FileCommentListRequestSchema,
    result: FileCommentListResultSchema,
    pathOf: request => request.filePath,
    run: (caller, request) => service.list(caller, request)
  })

  register({
    channel: FileCommentChannels.OPEN_DRAFT,
    request: FileCommentOpenDraftRequestSchema,
    result: FileCommentOpenDraftResultSchema,
    pathOf: request => request.filePath,
    run: (caller, request) => service.openDraft(caller, request)
  })

  register({
    channel: FileCommentChannels.SAVE,
    request: FileCommentSaveRequestSchema,
    result: FileCommentSaveResultSchema,
    // Thread operations name keys only (C17): no path to confine, the key names the file.
    pathOf: request => (request.op === 'add' ? request.filePath : undefined),
    run: (caller, request) => service.save(caller, request)
  })

  return () => {
    for (const channel of Object.values(FileCommentChannels)) unregisterHandle(channel)
  }
}
