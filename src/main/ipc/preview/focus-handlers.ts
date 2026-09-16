// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:focusPage` – the keyboard's way into a previewed page (issue #124,
 * QG-8 U1).
 *
 * The page renders in a native `WebContentsView` that Erfana's tab order cannot
 * reach, so a keyboard-only reader could not follow a link in it, and none of
 * the accelerators main forwards back out of it could ever fire – each needs
 * focus to be inside the page already (WCAG SC 2.1.1). The panel's placeholder
 * is the target that asks for this, and Escape is the stated way back.
 *
 * The handler mirrors `navigation-handlers.ts`:
 *   1. rejects an untrusted sender (`isTrustedSender`) BEFORE the payload is
 *      read;
 *   2. `safeParse`s the strict, bounded request (`PreviewPanelRequestSchema`,
 *      shared with `close` / `stopFind` / `exportPdf` – a panel id and nothing
 *      else);
 *   3. resolves the SENDER's own window, and lets the service refuse a panel
 *      whose view lives in another one;
 *   4. answers a plain flag, and never throws: anything it cannot serve reads
 *      `{ ok: false }`. The invoke can still REJECT before this handler runs –
 *      the registry's process-wide sender gate throws, and so does a channel
 *      with no handler – so the renderer catches it and reads it as a refusal.
 *
 * Trust model: the renderer names a panel, never a window, a view or a page –
 * main resolves all three itself.
 */
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'

import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import { PreviewPanelRequestSchema } from '../../../shared/ipc/preview-schema'
import type { PreviewFocusPageResult } from '../../../shared/ipc/preview-types'
import type {
  IPreviewViewService,
  PreviewWindowLike
} from '../../services/preview/PreviewViewService'
import { logger } from '../../services/LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'
import { registerHandle, unregisterHandle } from '../registry'

/** The focus service surface (a slice of {@link IPreviewViewService}). */
export type PreviewFocusService = Pick<IPreviewViewService, 'focusPage'>

/** Injected collaborators for the focus handler. */
export interface PreviewFocusHandlerDeps {
  readonly service: PreviewFocusService
  readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  /** Resolve the sender's window; defaults to `BrowserWindow.fromWebContents`. */
  readonly resolveWindow?: (event: IpcMainInvokeEvent) => Pick<PreviewWindowLike, 'id'> | null
}

/** Every refusal, so the renderer has one shape to read. */
const REFUSED: PreviewFocusPageResult = { ok: false }

/** Register `preview:focusPage`. Returns the function that removes it. */
export function registerPreviewFocusHandlers(deps: PreviewFocusHandlerDeps): () => void {
  const { service, isTrustedSender } = deps
  const resolveWindow =
    deps.resolveWindow ??
    ((event: IpcMainInvokeEvent) =>
      BrowserWindow.fromWebContents(event.sender) as Pick<PreviewWindowLike, 'id'> | null)

  registerHandle(
    PreviewChannels.FOCUS_PAGE,
    async (event, arg: unknown): Promise<PreviewFocusPageResult> => {
      // No sender URL in the line: main's drop lines carry fixed fields only.
      if (!isTrustedSender(event)) {
        logger.warn('Rejected preview:focusPage from untrusted sender')
        return REFUSED
      }
      try {
        const parsed = PreviewPanelRequestSchema.safeParse(arg)
        if (!parsed.success) {
          logger.warn('Rejected preview:focusPage with invalid payload', {
            error: parsed.error.message
          })
          return REFUSED
        }
        const window = resolveWindow(event)
        if (window === null) {
          return REFUSED
        }
        return { ok: service.focusPage(parsed.data.panelId, window.id) }
      } catch (error) {
        // A Node error quotes the path it failed on; the logged copy has it cut.
        logger.error('preview:focusPage failed', redactedLogError(error))
        return REFUSED
      }
    }
  )

  return () => unregisterHandle(PreviewChannels.FOCUS_PAGE)
}
