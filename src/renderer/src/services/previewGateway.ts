// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer HTML-preview gateway (#74): the one place `window.api.preview` is
 * read.
 *
 * Renderer code calls `previewGateway.<method>`, which forwards to the preload
 * bridge with the same contract ({@link PreviewBridge}). Keeping the access in
 * one module gives the renderer a single seam to change or fake.
 *
 * `setVisibility` keeps its single owner: only `services/preview/
 * OverlayGuardService.ts` may call it, and ESLint rejects
 * `previewGateway.setVisibility` anywhere else (design §1.8).
 */
import type { PreviewBridge } from '../../../shared/ipc/preview-bridge-types'
import type { PreviewCommentsBridge } from '../../../shared/ipc/preview-comment-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): PreviewBridge => (window as unknown as { api: { preview: PreviewBridge } }).api.preview

export const previewGateway: PreviewBridge = {
  checkEligibility: (...args) => bridge().checkEligibility(...args),
  open: (...args) => bridge().open(...args),
  close: (...args) => bridge().close(...args),
  setBounds: (...args) => bridge().setBounds(...args),
  setVisibility: (...args) => bridge().setVisibility(...args),
  reload: (...args) => bridge().reload(...args),
  approveHost: (...args) => bridge().approveHost(...args),
  find: (...args) => bridge().find(...args),
  stopFind: (...args) => bridge().stopFind(...args),
  exportPdf: (...args) => bridge().exportPdf(...args),
  navigate: (...args) => bridge().navigate(...args),
  focusPage: (...args) => bridge().focusPage(...args),
  onFailuresChanged: (...args) => bridge().onFailuresChanged(...args),
  onHostBlocked: (...args) => bridge().onHostBlocked(...args),
  onVisibilityApplied: (...args) => bridge().onVisibilityApplied(...args),
  onAllowlistChanged: (...args) => bridge().onAllowlistChanged(...args),
  onFindResult: (...args) => bridge().onFindResult(...args),
  onStillFrameChanged: (...args) => bridge().onStillFrameChanged(...args),
  onLoadStateChanged: (...args) => bridge().onLoadStateChanged(...args),
  onBackdropChanged: (...args) => bridge().onBackdropChanged(...args),
  onBoundsApplied: (...args) => bridge().onBoundsApplied(...args),
  onForwardedShortcut: (...args) => bridge().onForwardedShortcut(...args),
  onOpenFileRequested: (...args) => bridge().onOpenFileRequested(...args),
  onPageChanged: (...args) => bridge().onPageChanged(...args),
  onResizeHold: (...args) => bridge().onResizeHold(...args)
}

/** The comments bridge, read per call like the preview bridge above. */
// `Window['api']` leaves this bridge out of its type too; put back here only
const commentsBridge = (): PreviewCommentsBridge =>
  (window as unknown as { api: { previewComments: PreviewCommentsBridge } }).api.previewComments

/**
 * `window.api.previewComments` (HTML Preview comments, design §8), forwarded
 * with the same contract. Renderer code reaches it only through
 * `services/preview/commentGateway.ts`, which adds the "no bridge" and
 * "rejected invoke" handling every caller would otherwise repeat.
 */
export const previewCommentsGateway: PreviewCommentsBridge = {
  setMode: (...args) => commentsBridge().setMode(...args),
  list: (...args) => commentsBridge().list(...args),
  reveal: (...args) => commentsBridge().reveal(...args),
  keepDraft: (...args) => commentsBridge().keepDraft(...args),
  save: (...args) => commentsBridge().save(...args),
  setUnsavedSources: (...args) => commentsBridge().setUnsavedSources(...args),
  onDraftOpened: (...args) => commentsBridge().onDraftOpened(...args),
  onCommentsChanged: (...args) => commentsBridge().onCommentsChanged(...args),
  onAnchorStatus: (...args) => commentsBridge().onAnchorStatus(...args),
  onModeChanged: (...args) => commentsBridge().onModeChanged(...args),
  onSaveSettled: (...args) => commentsBridge().onSaveSettled(...args)
}
