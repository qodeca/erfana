// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview find + PDF-export IPC handlers (Issue #74, work item 45; design §5(e), §1.7).
 *
 * `find` / `stopFind` / `exportPdf`. Each is sender-gated (`isTrustedSender`,
 * §4.3) and `safeParse`d against its `.strict()` zod schema, and acts inside
 * try/catch — no handler throws.
 *
 * Reconciliation with §7 item 45's dep list (35, 37): the built
 * `PreviewFindController` / `PreviewExportController` bind to the LIVE view's
 * `WebContents`, which is owned per-view inside `PreviewViewService`. The service
 * therefore exposes `find` / `stopFind` / `exportPdf` and these handlers route
 * through it, rather than holding the controllers directly (whose target does
 * not exist until a view is open).
 *
 * @see docs/designs/sd-074-html-preview.md §5(e), §1.7, §7 item 45
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  PreviewFindRequestSchema,
  PreviewPanelRequestSchema
} from '../../../shared/ipc/preview-schema'
import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import type { PdfExportResult } from '../../../shared/ipc/preview-types'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFindOptions } from '../../services/preview/PreviewFindController'
import { logger } from '../../services/LoggingService'

/**
 * Default suggested export filename. The strict `exportPdf` schema carries no
 * filename (only `panelId`), so the handler supplies a stable default that the
 * export controller's `deriveSafeFilename` further sanitises (#161).
 */
const DEFAULT_EXPORT_SUGGESTED_NAME = 'preview'

/** The find/export surface these handlers drive on the view service. */
export interface PreviewFindExportService {
  find(panelId: string, text: string, options: PreviewFindOptions): void
  stopFind(panelId: string): void
  exportPdf(panelId: string, suggestedName: string): Promise<PdfExportResult>
}

/** Injected collaborators for the find/export handlers. */
export interface PreviewFindHandlerDeps {
  readonly service: PreviewFindExportService
  readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean
}

/**
 * Register `find` / `stopFind` / `exportPdf`. Returns an unregister function.
 */
export function registerPreviewFindHandlers(deps: PreviewFindHandlerDeps): () => void {
  const { service, isTrustedSender } = deps

  const rejectUntrusted = (channel: string, event: IpcMainInvokeEvent): boolean => {
    if (isTrustedSender(event)) {
      return false
    }
    logger.warn(`Rejected ${channel} from untrusted sender`, { url: event.senderFrame?.url })
    return true
  }

  ipcMain.handle(PreviewChannels.FIND, async (event, arg: unknown): Promise<void> => {
    if (rejectUntrusted(PreviewChannels.FIND, event)) {
      return
    }
    try {
      const parsed = PreviewFindRequestSchema.safeParse(arg)
      if (!parsed.success) {
        logger.warn('Rejected preview:find with invalid payload', { error: parsed.error.message })
        return
      }
      const { panelId, text, forward, findNext, matchCase } = parsed.data
      service.find(panelId, text, { forward, findNext, matchCase })
    } catch (error) {
      logger.error('preview:find failed', error instanceof Error ? error : undefined)
    }
  })

  ipcMain.handle(PreviewChannels.STOP_FIND, async (event, arg: unknown): Promise<void> => {
    if (rejectUntrusted(PreviewChannels.STOP_FIND, event)) {
      return
    }
    try {
      const parsed = PreviewPanelRequestSchema.safeParse(arg)
      if (!parsed.success) {
        logger.warn('Rejected preview:stopFind with invalid payload', {
          error: parsed.error.message
        })
        return
      }
      service.stopFind(parsed.data.panelId)
    } catch (error) {
      logger.error('preview:stopFind failed', error instanceof Error ? error : undefined)
    }
  })

  ipcMain.handle(
    PreviewChannels.EXPORT_PDF,
    async (event, arg: unknown): Promise<PdfExportResult> => {
      if (rejectUntrusted(PreviewChannels.EXPORT_PDF, event)) {
        return { ok: false, errorCode: ErrorCode.UNKNOWN_ERROR }
      }
      try {
        const parsed = PreviewPanelRequestSchema.safeParse(arg)
        if (!parsed.success) {
          logger.warn('Rejected preview:exportPdf with invalid payload', {
            error: parsed.error.message
          })
          return { ok: false, errorCode: ErrorCode.UNKNOWN_ERROR }
        }
        return await service.exportPdf(parsed.data.panelId, DEFAULT_EXPORT_SUGGESTED_NAME)
      } catch (error) {
        logger.error('preview:exportPdf failed', error instanceof Error ? error : undefined)
        return { ok: false, errorCode: ErrorCode.PDF_EXPORT_FAILED }
      }
    }
  )

  return () => {
    ipcMain.removeHandler(PreviewChannels.FIND)
    ipcMain.removeHandler(PreviewChannels.STOP_FIND)
    ipcMain.removeHandler(PreviewChannels.EXPORT_PDF)
  }
}
