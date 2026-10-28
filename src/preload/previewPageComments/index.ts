// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments in the preview page's preload
 * (docs/designs/html-preview-comments.md §4.2 "Preload", §7, §8, §9.2;
 * docs/adrs/0005-sub-frame-preload-one-receive-channel.md).
 *
 * Installed only when main built the view with `htmlPreview.comments.enabled`,
 * which it says with the {@link COMMENTS_ARGUMENT} renderer argument
 * ({@link commentsRequested}); with the flag off the preload is today's link
 * and CSP reporter and nothing more. With it on, the overlay runs in EVERY
 * frame of the page – `nodeIntegrationInSubFrames`, which under `sandbox:
 * true` means "run the preload in frames", not Node. Like the rest of this
 * preload it exposes nothing to the page: no `contextBridge`, and every object
 * here lives in the isolated world.
 *
 * It is the preload's only RECEIVE path: one `ipcRenderer.on`, for the
 * literal `preview-page:commentState`, carrying mode, pin keys, tokens and
 * counts – never comment text or emails. What it sends (hello, picks,
 * visibility) only ever asks main to open something; nothing on that path
 * writes a file (§4.1 B1).
 *
 * Imported by `previewPage.ts` as a relative module of the single
 * `previewPage` entry, so the bundle stays one self-contained file (#73).
 */
import { ipcRenderer } from 'electron'
import { COMMENTS_ARGUMENT, COMMENT_STATE_CHANNEL } from './constants'
import { CommentController } from './controller'
import { attachInputGuards } from './input'

/** Whether main asked for the comment overlay in this renderer (the flag is on for the view). */
export function commentsRequested(argv: readonly string[] = process.argv): boolean {
  return argv.includes(COMMENTS_ARGUMENT)
}

/** The installed overlay; `dispose` exists for tests. */
export interface InstalledComments {
  readonly controller: CommentController
  dispose(): void
}

/**
 * Install the comment overlay in this frame: start capturing tokens, attach
 * the capture-phase guards, and listen for main's state.
 */
export function installPreviewPageComments(
  win: Window & typeof globalThis = window,
  doc: Document = document
): InstalledComments {
  const controller = new CommentController({
    win,
    doc,
    isTop: win === win.top,
    now: () => win.performance.now(),
    send: (channel, payload) => ipcRenderer.send(channel, payload)
  })
  controller.start()
  const detach = attachInputGuards(win, doc, controller)
  // Installed after the parse (never in a browser, where the preload runs at
  // document start): no token can be trusted, but main still hears hello.
  if (doc.readyState !== 'loading') controller.documentReady()
  const onState = (_event: unknown, state: unknown): void => controller.applyState(state)
  ipcRenderer.on('preview-page:commentState', onState)
  return {
    controller,
    dispose(): void {
      detach()
      ipcRenderer.removeListener(COMMENT_STATE_CHANNEL, onState)
      controller.dispose()
    }
  }
}
