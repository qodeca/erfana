// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview lifecycle IPC handlers (Issue #74, work item 44; design §4.3, §5(a)).
 *
 * The renderer→main control surface for a running preview:
 * `checkEligibility` / `open` / `close` / `setBounds` / `setVisibility` /
 * `reload`. Every handler:
 *   1. rejects an untrusted sender (`isTrustedSender`, §4.3),
 *   2. `safeParse`s the payload against its `.strict()` zod schema, and
 *   3. acts inside try/catch — no handler ever throws.
 *
 * `setBounds` / `setVisibility` are high-frequency fire-and-forget `send`s
 * (`ipcMain.on`); the rest are `invoke` round-trips (`ipcMain.handle`).
 * `setBounds` runs once per frame while a panel moves, so its three drops go
 * through one rate-capped drop reporter rather than one line each (issue #124,
 * M1–M3, part 1 §1.2).
 *
 * Trust model: the project path is resolved main-side (`getProjectPath`); the
 * host `BrowserWindow` comes from the trusted sender, never from the payload.
 *
 * @see docs/designs/sd-074-html-preview.md §4.3, §5(a)
 */
import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  PanelIdSchema,
  PreviewCheckEligibilityRequestSchema,
  PreviewOpenRequestSchema,
  PreviewPanelRequestSchema,
  PreviewSetBoundsSchema,
  PreviewSetVisibilitySchema,
  PreviewReloadRequestSchema,
  type PreviewCheckEligibilityResponse,
  type PreviewSetBounds
} from '../../../shared/ipc/preview-schema'
import type { BoundsDrop } from '../../../shared/dropReporter'
import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewOpenResult } from '../../../shared/ipc/preview-types'
import type { IPreviewViewService, PreviewOpenRequest } from '../../services/preview/PreviewViewService'
import type { PreviewWindowLike } from '../../services/preview/PreviewViewService'
import type { IPreviewEligibilityService } from '../../services/preview/PreviewEligibilityService'
import {
  SET_BOUNDS_DROP_REASON,
  createMainDropReporter
} from '../../services/preview/previewBoundsDropLog'
import { logger } from '../../services/LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'
import { registerHandle, registerOn, unregisterHandle, unregisterOn } from '../registry'

/** The lifecycle service surface (a slice of {@link IPreviewViewService}). */
export type PreviewLifecycleService = Pick<
  IPreviewViewService,
  'open' | 'close' | 'setBounds' | 'setVisibility' | 'reload'
>

/** Injected collaborators for the lifecycle handlers. */
export interface PreviewLifecycleHandlerDeps {
  readonly service: PreviewLifecycleService
  readonly eligibility: IPreviewEligibilityService
  /** Current project root, resolved main-side (never from the renderer). */
  readonly getProjectPath: () => string | null
  readonly isTrustedSender: (event: IpcMainInvokeEvent | IpcMainEvent) => boolean
  /** Resolve the host window from the sender; defaults to `BrowserWindow.fromWebContents`. */
  readonly resolveWindow?: (event: IpcMainInvokeEvent) => PreviewWindowLike | null
  /** Milliseconds for the setBounds drop log's rate cap; defaults to a monotonic clock. */
  readonly now?: () => number
}

/** The push's panel id when that one field is valid, so a malformed push still names its panel. */
function validPanelId(arg: unknown): string | undefined {
  if (typeof arg !== 'object' || arg === null) {
    return undefined
  }
  const parsed = PanelIdSchema.safeParse((arg as { panelId?: unknown }).panelId)
  return parsed.success ? parsed.data : undefined
}

/**
 * Register the six lifecycle handlers. Returns an unregister function that
 * removes all of them (invoke handlers via `removeHandler`, send handlers via
 * `removeListener`).
 */
export function registerPreviewLifecycleHandlers(
  deps: PreviewLifecycleHandlerDeps
): () => void {
  const { service, eligibility, getProjectPath, isTrustedSender } = deps
  const resolveWindow =
    deps.resolveWindow ??
    ((event: IpcMainInvokeEvent) =>
      BrowserWindow.fromWebContents(event.sender) as PreviewWindowLike | null)

  const rejectUntrusted = (channel: string, event: IpcMainInvokeEvent | IpcMainEvent): boolean => {
    if (isTrustedSender(event)) {
      return false
    }
    // No sender URL in the line: main's drop lines carry fixed fields only.
    logger.warn(`Rejected ${channel} from untrusted sender`)
    return true
  }

  registerHandle(
    PreviewChannels.CHECK_ELIGIBILITY,
    async (event, arg: unknown): Promise<PreviewCheckEligibilityResponse> => {
      if (rejectUntrusted(PreviewChannels.CHECK_ELIGIBILITY, event)) {
        return { eligible: false, reason: 'globally-disabled' }
      }
      try {
        const parsed = PreviewCheckEligibilityRequestSchema.safeParse(arg)
        if (!parsed.success) {
          logger.warn('Rejected preview:checkEligibility with invalid payload', {
            error: parsed.error.message
          })
          return { eligible: false, reason: 'not-html' }
        }
        const projectPath = getProjectPath()
        if (projectPath === null) {
          return { eligible: false, reason: 'outside-project' }
        }
        const verdict = await eligibility.check(parsed.data.filePath, projectPath)
        return verdict.eligible ? { eligible: true } : { eligible: false, reason: verdict.reason }
      } catch (error) {
        logger.error('preview:checkEligibility failed', redactedLogError(error))
        return { eligible: false, reason: 'not-html' }
      }
    }
  )

  registerHandle(
    PreviewChannels.OPEN,
    async (event, arg: unknown): Promise<PreviewOpenResult> => {
      if (rejectUntrusted(PreviewChannels.OPEN, event)) {
        return { ok: false, errorCode: ErrorCode.UNKNOWN_ERROR }
      }
      try {
        const parsed = PreviewOpenRequestSchema.safeParse(arg)
        if (!parsed.success) {
          logger.warn('Rejected preview:open with invalid payload', {
            error: parsed.error.message
          })
          return { ok: false, errorCode: ErrorCode.PREVIEW_OPEN_INVALID_REQUEST }
        }
        const window = resolveWindow(event)
        if (window === null) {
          return { ok: false, errorCode: ErrorCode.UNKNOWN_ERROR }
        }
        const req: PreviewOpenRequest = {
          panelId: parsed.data.panelId,
          filePath: parsed.data.filePath,
          bounds: parsed.data.bounds
        }
        return await service.open(req, window)
      } catch (error) {
        logger.error('preview:open failed', redactedLogError(error))
        return { ok: false, errorCode: ErrorCode.UNKNOWN_ERROR }
      }
    }
  )

  registerHandle(PreviewChannels.CLOSE, async (event, arg: unknown): Promise<void> => {
    if (rejectUntrusted(PreviewChannels.CLOSE, event)) {
      return
    }
    try {
      const parsed = PreviewPanelRequestSchema.safeParse(arg)
      if (!parsed.success) {
        logger.warn('Rejected preview:close with invalid payload', {
          error: parsed.error.message
        })
        return
      }
      await service.close(parsed.data.panelId)
    } catch (error) {
      logger.error('preview:close failed', redactedLogError(error))
    }
  })

  registerHandle(PreviewChannels.RELOAD, async (event, arg: unknown): Promise<void> => {
    if (rejectUntrusted(PreviewChannels.RELOAD, event)) {
      return
    }
    try {
      const parsed = PreviewReloadRequestSchema.safeParse(arg)
      if (!parsed.success) {
        logger.warn('Rejected preview:reload with invalid payload', {
          error: parsed.error.message
        })
        return
      }
      await service.reload(parsed.data.panelId, { ignoreCache: parsed.data.ignoreCache })
    } catch (error) {
      logger.error('preview:reload failed', redactedLogError(error))
    }
  })

  // One reporter per registration: the channel is one scope (M1–M3).
  let thrown: Error | undefined
  const boundsDrops = createMainDropReporter({ now: deps.now, errorOf: () => thrown })
  const reportBoundsDrop = (drop: BoundsDrop, error?: unknown): void => {
    // A Node error quotes the path it failed on; the logged copy has it cut.
    thrown = redactedLogError(error)
    try {
      boundsDrops.report(drop)
    } finally {
      thrown = undefined
    }
  }

  const onSetBounds = (event: IpcMainEvent, arg: unknown): void => {
    if (!isTrustedSender(event)) {
      reportBoundsDrop({ reason: SET_BOUNDS_DROP_REASON.untrustedSender, level: 'warn' })
      return
    }
    let push: PreviewSetBounds | undefined
    try {
      const parsed = PreviewSetBoundsSchema.safeParse(arg)
      if (!parsed.success) {
        reportBoundsDrop({
          reason: SET_BOUNDS_DROP_REASON.invalidPayload,
          level: 'warn',
          panelId: validPanelId(arg)
        })
        return
      }
      push = parsed.data
      // `settled` marks the forced push that ends a window-edge resize hold
      // (issue #124): the same call, so it is applied and dropped like any other.
      service.setBounds(push.panelId, push.bounds, push.seq, push.ack, push.settled)
    } catch (error) {
      reportBoundsDrop(
        {
          reason: SET_BOUNDS_DROP_REASON.handlerThrew,
          level: 'error',
          panelId: push?.panelId,
          seq: push?.seq,
          rect: push?.bounds
        },
        error
      )
    }
  }

  const onSetVisibility = (event: IpcMainEvent, arg: unknown): void => {
    if (rejectUntrusted(PreviewChannels.SET_VISIBILITY, event)) {
      return
    }
    try {
      const parsed = PreviewSetVisibilitySchema.safeParse(arg)
      if (!parsed.success) {
        logger.warn('Rejected preview:setVisibility with invalid payload', {
          error: parsed.error.message
        })
        return
      }
      // The `catch` below cannot see this one. `setVisibility` is `async`, so a
      // throw inside it — `addChildView` against a window destroyed in the gap
      // before `drainWindow` runs — becomes a REJECTED PROMISE, not a synchronous
      // throw, and `void` would drop it into the process-level handler. This file
      // promises no handler ever throws; that promise needs both halves.
      void service
        .setVisibility(parsed.data.panelId, parsed.data.visible, parsed.data.reason)
        .catch((error: unknown) => {
          logger.error('preview:setVisibility failed', redactedLogError(error))
        })
    } catch (error) {
      logger.error('preview:setVisibility failed', redactedLogError(error))
    }
  }

  registerOn(PreviewChannels.SET_BOUNDS, onSetBounds)
  registerOn(PreviewChannels.SET_VISIBILITY, onSetVisibility)

  return () => {
    unregisterHandle(PreviewChannels.CHECK_ELIGIBILITY)
    unregisterHandle(PreviewChannels.OPEN)
    unregisterHandle(PreviewChannels.CLOSE)
    unregisterHandle(PreviewChannels.RELOAD)
    unregisterOn(PreviewChannels.SET_BOUNDS, onSetBounds)
    unregisterOn(PreviewChannels.SET_VISIBILITY, onSetVisibility)
  }
}
