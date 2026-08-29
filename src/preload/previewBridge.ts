// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload preview bridge (Issue #74, work item 49; design §4).
 *
 * The whole `window.api.preview` surface in its own module, typed as
 * {@link PreviewBridge} (the shared contract in `preview-schema.ts`). `setBounds`
 * / `setVisibility` are fire-and-forget `send`s (high-frequency, no round-trip);
 * the rest are `invoke` round-trips. Event subscriptions wrap the callback so the
 * returned unsubscribe removes the SAME listener reference (identity never
 * drifts), mirroring the `claudeStatus` bridge.
 *
 * @see docs/designs/sd-074-html-preview.md §4
 * @see src/preload/index.ts (the `claudeStatus` bridge this mirrors)
 */
import { ipcRenderer } from 'electron'
import { PreviewChannels, PreviewEvents } from '../shared/ipc/preview-channels'
import type {
  PreviewBridge,
  PreviewBoundsPayload,
  PreviewCheckEligibilityResponse,
  PreviewFailureListPayload,
  PreviewFindRequest,
  PreviewForwardedShortcut,
  PreviewOpenFileRequestedPayload,
  PreviewHostBlockedPayload,
  PreviewBackdropPayload,
  PreviewLoadStatePayload,
  PreviewOpenRequest,
  PreviewStillFramePayload
} from '../shared/ipc/preview-schema'
import type {
  PdfExportResult,
  PreviewApproveResult,
  PreviewFindResult,
  PreviewOpenResult
} from '../shared/ipc/preview-types'

/** Subscribe to a preview event, returning an unsubscribe that removes the same wrapper. */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** The `window.api.preview` bridge object. */
export const previewBridge: PreviewBridge = {
  checkEligibility: (filePath: string): Promise<PreviewCheckEligibilityResponse> =>
    ipcRenderer.invoke(PreviewChannels.CHECK_ELIGIBILITY, { filePath }),

  open: (req: PreviewOpenRequest): Promise<PreviewOpenResult> =>
    ipcRenderer.invoke(PreviewChannels.OPEN, req),

  close: (panelId: string): Promise<void> =>
    ipcRenderer.invoke(PreviewChannels.CLOSE, { panelId }),

  setBounds: (panelId: string, bounds: PreviewBoundsPayload, seq: number): void =>
    ipcRenderer.send(PreviewChannels.SET_BOUNDS, { panelId, bounds, seq }),

  setVisibility: (panelId: string, visible: boolean, reason: string): void =>
    ipcRenderer.send(PreviewChannels.SET_VISIBILITY, { panelId, visible, reason }),

  reload: (panelId: string, opts?: { ignoreCache?: boolean }): Promise<void> =>
    ipcRenderer.invoke(PreviewChannels.RELOAD, {
      panelId,
      ...(opts?.ignoreCache !== undefined ? { ignoreCache: opts.ignoreCache } : {})
    }),

  approveHost: (panelId: string, host: string): Promise<PreviewApproveResult> =>
    ipcRenderer.invoke(PreviewChannels.APPROVE_HOST, { panelId, host }),

  find: (req: PreviewFindRequest): Promise<void> =>
    ipcRenderer.invoke(PreviewChannels.FIND, req),

  stopFind: (panelId: string): Promise<void> =>
    ipcRenderer.invoke(PreviewChannels.STOP_FIND, { panelId }),

  exportPdf: (panelId: string): Promise<PdfExportResult> =>
    ipcRenderer.invoke(PreviewChannels.EXPORT_PDF, { panelId }),

  onFailuresChanged: (callback: (payload: PreviewFailureListPayload) => void): (() => void) =>
    subscribe(PreviewEvents.FAILURES_CHANGED, callback),

  onHostBlocked: (callback: (payload: PreviewHostBlockedPayload) => void): (() => void) =>
    subscribe(PreviewEvents.HOST_BLOCKED, callback),

  onFindResult: (callback: (result: PreviewFindResult) => void): (() => void) =>
    subscribe(PreviewEvents.FIND_RESULT, callback),

  onStillFrameChanged: (callback: (payload: PreviewStillFramePayload) => void): (() => void) =>
    subscribe(PreviewEvents.STILL_FRAME_CHANGED, callback),

  onLoadStateChanged: (callback: (payload: PreviewLoadStatePayload) => void): (() => void) =>
    subscribe(PreviewEvents.LOAD_STATE_CHANGED, callback),

  onBackdropChanged: (callback: (payload: PreviewBackdropPayload) => void): (() => void) =>
    subscribe(PreviewEvents.BACKDROP_CHANGED, callback),

  onForwardedShortcut: (callback: (payload: PreviewForwardedShortcut) => void): (() => void) =>
    subscribe(PreviewEvents.FORWARDED_SHORTCUT, callback),

  onOpenFileRequested: (
    callback: (payload: PreviewOpenFileRequestedPayload) => void
  ): (() => void) => subscribe(PreviewEvents.OPEN_FILE_REQUESTED, callback)
}
