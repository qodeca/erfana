// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:navigate` – show another page in a tab, or step its history (issue
 * #124, WI-17b; part 3 §3.1).
 *
 * An invoke in two phases: `check` before anything happens, `commit` once the
 * renderer has resolved the other tabs showing the target. The handler:
 *   1. rejects an untrusted sender (`isTrustedSender`), before the payload is
 *      read;
 *   2. `safeParse`s the strict, bounded request;
 *   3. finds the sender's window, and hands the request to the service, which
 *      runs every other gate – the panel's view in that window, the target,
 *      real-root confinement, `.html`/`.htm`, eligibility, a navigation already
 *      pending (`previewViewNavigation.ts`);
 *   4. re-validates the answer before it goes back.
 *
 * No raw error crosses IPC – a code only – and the handler never throws: a
 * sender, payload or failure it cannot serve reads `PREVIEW_NAV_UNAVAILABLE`,
 * which is also how the renderer reads a rejected invoke.
 *
 * Trust model: the renderer names a project file, an anchor or main's own
 * history generation – never a URL or a token – and main re-confines every
 * path it receives.
 */
import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'

import { ErrorCode } from '../../../shared/errors'
import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import {
  PreviewNavigateRequestSchema,
  PreviewNavigateResultSchema
} from '../../../shared/ipc/preview-navigation-schema'
import type { PreviewNavigateResult } from '../../../shared/ipc/preview-types'
import type {
  IPreviewViewService,
  PreviewWindowLike
} from '../../services/preview/PreviewViewService'
import { logger } from '../../services/LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'
import { registerHandle, unregisterHandle } from '../registry'

/** The navigation service surface (a slice of {@link IPreviewViewService}). */
export type PreviewNavigationService = Pick<IPreviewViewService, 'navigate'>

/** Injected collaborators for the navigation handler. */
export interface PreviewNavigationHandlerDeps {
  readonly service: PreviewNavigationService
  readonly isTrustedSender: (event: IpcMainInvokeEvent | IpcMainEvent) => boolean
  /** Resolve the sender's window; defaults to `BrowserWindow.fromWebContents`. */
  readonly resolveWindow?: (event: IpcMainInvokeEvent) => Pick<PreviewWindowLike, 'id'> | null
}

const UNAVAILABLE: PreviewNavigateResult = {
  ok: false,
  errorCode: ErrorCode.PREVIEW_NAV_UNAVAILABLE
}

/** Register `preview:navigate`. Returns the function that removes it. */
export function registerPreviewNavigationHandlers(deps: PreviewNavigationHandlerDeps): () => void {
  const { service, isTrustedSender } = deps
  const resolveWindow =
    deps.resolveWindow ??
    ((event: IpcMainInvokeEvent) =>
      BrowserWindow.fromWebContents(event.sender) as Pick<PreviewWindowLike, 'id'> | null)

  registerHandle(
    PreviewChannels.NAVIGATE,
    async (event, arg: unknown): Promise<PreviewNavigateResult> => {
      // No sender URL in the line: main's drop lines carry fixed fields only.
      if (!isTrustedSender(event)) {
        logger.warn('Rejected preview:navigate from untrusted sender')
        return UNAVAILABLE
      }
      try {
        const parsed = PreviewNavigateRequestSchema.safeParse(arg)
        if (!parsed.success) {
          logger.warn('Rejected preview:navigate with invalid payload', {
            error: parsed.error.message
          })
          return UNAVAILABLE
        }
        const window = resolveWindow(event)
        if (window === null) {
          return UNAVAILABLE
        }
        const result = await service.navigate(parsed.data, window.id)
        // The tripwire against a wiring regression: a malformed answer (a path
        // past the contract's bounds, say) never reaches the renderer.
        const answer = PreviewNavigateResultSchema.safeParse(result)
        if (!answer.success) {
          logger.warn('Dropped a preview:navigate answer that failed its schema', {
            error: answer.error.message
          })
          return UNAVAILABLE
        }
        return result
      } catch (error) {
        // A Node error quotes the path it failed on; the logged copy has it cut.
        logger.error('preview:navigate failed', redactedLogError(error))
        return UNAVAILABLE
      }
    }
  )

  return () => unregisterHandle(PreviewChannels.NAVIGATE)
}
