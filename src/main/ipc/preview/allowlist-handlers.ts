// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview allowlist IPC handler (Issue #74, work item 46; design §3.3, §5(c)).
 *
 * `approveHost`: on approval the store writes the host into the project
 * `.erfana/settings.json` and returns the new sorted host set; the service then
 * rebuilds the CSP, purges storage and reloads (`applyApprovedHosts`).
 *
 * SECURITY (NEW-8): the project root is NEVER a payload field. The request schema
 * is `{ panelId, host }.strict()`; the store resolves the root main-side from its
 * injected `getProjectRoot` accessor (wired to `ProjectService`). A payload that
 * smuggles a `projectRoot` is rejected by `.strict()` before this handler runs.
 *
 * @see docs/designs/sd-074-html-preview.md §3.3, §5(c)
 */
import { type IpcMainInvokeEvent } from 'electron'
import { PreviewApproveHostRequestSchema } from '../../../shared/ipc/preview-schema'
import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import type { PreviewApproveResult } from '../../../shared/ipc/preview-types'
import { AppError, ErrorCode } from '../../../shared/errors'
import type { IPreviewViewService } from '../../services/preview/PreviewViewService'
import type { IPreviewAllowlistStore } from '../../services/preview/PreviewAllowlistStore'
import { logger } from '../../services/LoggingService'
import { TimeoutError, withTimeout } from '../../utils/withTimeout'
import { PREVIEW } from '../../../shared/constants'
import { registerHandle, unregisterHandle } from '../registry'

/** Injected collaborators for the allowlist handler. */
export interface PreviewAllowlistHandlerDeps {
  /** Writes the origin back to the project allowlist; root resolved internally. */
  readonly allowlistStore: Pick<IPreviewAllowlistStore, 'approveOrigin'>
  /** Rebuilds the CSP, purges and reloads the live view for the panel. */
  readonly service: Pick<IPreviewViewService, 'applyApprovedHosts'>
  readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean
}

/**
 * Register `approveHost`. Returns an unregister function.
 */
export function registerPreviewAllowlistHandlers(
  deps: PreviewAllowlistHandlerDeps
): () => void {
  const { allowlistStore, service, isTrustedSender } = deps

  registerHandle(
    PreviewChannels.APPROVE_HOST,
    async (event, arg: unknown): Promise<PreviewApproveResult> => {
      if (!isTrustedSender(event)) {
        logger.warn('Rejected preview:approveHost from untrusted sender', {
          url: event.senderFrame?.url
        })
        return { ok: false, errorCode: ErrorCode.UNKNOWN_ERROR }
      }
      const parsed = PreviewApproveHostRequestSchema.safeParse(arg)
      if (!parsed.success) {
        logger.warn('Rejected preview:approveHost with invalid payload', {
          error: parsed.error.message
        })
        return { ok: false, errorCode: ErrorCode.PREVIEW_HOST_NOT_APPROVABLE }
      }
      try {
        // Root is NOT read from the payload — the store resolves it main-side.
        logger.info('preview:approveHost: approving', { origin: parsed.data.host })
        const origins = await allowlistStore.approveOrigin(parsed.data.host)
        logger.info('preview:approveHost: allowlist written', { count: origins.length })
        // Time-boxed. The grant is on disk and the CSP is rebuilt before the
        // first await inside `applyApprovedHosts`, so on timeout it is already
        // effective and only the reload is late: answer ok, so the band leaves
        // "Saving…" (the Allow freeze on Windows, 2026-09-03). The late
        // continuation, if any, is guarded by the view's own `isDefunct` checks.
        try {
          await withTimeout(
            service.applyApprovedHosts(parsed.data.panelId, origins),
            PREVIEW.APPROVE_TIMEOUT_MS,
            'Preview approval apply'
          )
        } catch (error) {
          if (!(error instanceof TimeoutError)) throw error
          logger.error(
            'preview:approveHost: applying the grant did not complete; it is saved and takes effect on reload',
            error
          )
        }
        return { ok: true, hosts: origins }
      } catch (error) {
        const errorCode = error instanceof AppError ? error.code : ErrorCode.UNKNOWN_ERROR
        logger.error(
          'preview:approveHost failed',
          error instanceof Error ? error : undefined
        )
        return { ok: false, errorCode }
      }
    }
  )

  return () => {
    unregisterHandle(PreviewChannels.APPROVE_HOST)
  }
}
