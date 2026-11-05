// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:copySelection` – Copy selection in the HTML preview's right-click
 * menu (#463).
 *
 * The page renders in a native `WebContentsView` in its own process, so the app
 * renderer that draws the menu cannot read what the reader selected. Main runs
 * the page's own Copy command instead (`webContents.copy()`, what Ctrl+C / ⌘C
 * runs inside the page): the selection goes straight from the page to the
 * system clipboard and no text travels to the app renderer.
 *
 * The handler mirrors `focus-handlers.ts`:
 *   1. rejects an untrusted sender (`isTrustedSender`) BEFORE the payload is
 *      read;
 *   2. `safeParse`s the strict, bounded request (`PreviewPanelRequestSchema`,
 *      a panel id and nothing else);
 *   3. resolves the SENDER's own window, and lets the service refuse a panel
 *      whose view lives in another one;
 *   4. answers a plain flag and never throws: anything it cannot serve reads
 *      `{ ok: false }`.
 *
 * Trust model: the renderer names a panel, never a window, a view or a page –
 * main resolves all three itself – and it gets back no clipboard contents. Not
 * gated on a real press (`commentContextGate.ts`): that gate guards picks from
 * the PAGE's renderer, and this call comes from the trusted app renderer, which
 * can already write the clipboard (`clipboard:writeText`).
 */
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'

import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import { PreviewPanelRequestSchema } from '../../../shared/ipc/preview-schema'
import type { PreviewCopySelectionResult } from '../../../shared/ipc/preview-types'
import type {
  IPreviewViewService,
  PreviewWindowLike
} from '../../services/preview/PreviewViewService'
import { logger } from '../../services/LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'
import { registerHandle, unregisterHandle } from '../registry'

/** The copy service surface (a slice of {@link IPreviewViewService}). */
export type PreviewCopyService = Pick<IPreviewViewService, 'copySelection'>

/** Injected collaborators for the copy handler. */
export interface PreviewCopyHandlerDeps {
  readonly service: PreviewCopyService
  readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  /** Resolve the sender's window; defaults to `BrowserWindow.fromWebContents`. */
  readonly resolveWindow?: (event: IpcMainInvokeEvent) => Pick<PreviewWindowLike, 'id'> | null
}

/** Every refusal, so the renderer has one shape to read. */
const REFUSED: PreviewCopySelectionResult = { ok: false }

/** Register `preview:copySelection`. Returns the function that removes it. */
export function registerPreviewCopyHandlers(deps: PreviewCopyHandlerDeps): () => void {
  const { service, isTrustedSender } = deps
  const resolveWindow =
    deps.resolveWindow ??
    ((event: IpcMainInvokeEvent) =>
      BrowserWindow.fromWebContents(event.sender) as Pick<PreviewWindowLike, 'id'> | null)

  registerHandle(
    PreviewChannels.COPY_SELECTION,
    async (event, arg: unknown): Promise<PreviewCopySelectionResult> => {
      // No sender URL in the line: main's drop lines carry fixed fields only.
      if (!isTrustedSender(event)) {
        logger.warn('Rejected preview:copySelection from untrusted sender')
        return REFUSED
      }
      try {
        const parsed = PreviewPanelRequestSchema.safeParse(arg)
        if (!parsed.success) {
          logger.warn('Rejected preview:copySelection with invalid payload', {
            error: parsed.error.message
          })
          return REFUSED
        }
        const window = resolveWindow(event)
        if (window === null) {
          return REFUSED
        }
        return { ok: service.copySelection(parsed.data.panelId, window.id) }
      } catch (error) {
        logger.error('preview:copySelection failed', redactedLogError(error))
        return REFUSED
      }
    }
  )

  return () => unregisterHandle(PreviewChannels.COPY_SELECTION)
}
