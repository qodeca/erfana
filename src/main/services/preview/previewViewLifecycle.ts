// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview view lifecycle wiring (Issue #74, work item 39; design §1.4, §5(a)).
 *
 * Extracted from `PreviewViewService` so the event wiring is one cohesive,
 * independently-readable unit and the service stays under the 500-line file cap.
 *
 * It attaches every navigation guard and lifecycle listener a preview view needs
 * and returns a single async disposer:
 *
 *   - `setWindowOpenHandler` ⇒ deny (no popups escape the sealed box)
 *   - `will-navigate`        ⇒ `preventDefault` (the page cannot navigate away)
 *   - `render-process-gone`  ⇒ `onRenderProcessGone` (design: `failed` + badge)
 *   - `unresponsive`         ⇒ `onUnresponsive`      (design: `failed` + badge)
 *   - `did-finish-load`      ⇒ `onDidFinishLoad`     (the rate-limited pipeline)
 *   - `console-message`      ⇒ `onConsoleMessage`    (classified page diagnostics:
 *     uncaught exceptions ⇒ `script-error`, bad ES-module specifiers ⇒
 *     `unresolved-specifier`; design §0/§1.3)
 *   - `before-input-event`   ⇒ the 4 forwarded accelerators (§1.9) via item 36
 *   - entry-file `change`    ⇒ `onEntryChange` (reload the page)
 *   - entry-file `unlink`    ⇒ `onEntryDeleted` (design: `failed` + "file deleted";
 *     a rename fires `unlink` on the old path, so rename is treated as delete)
 *
 * Trust model: `before-input-event` is Chromium's pre-dispatch pipeline, not a
 * page-callable API, and only the 4 enumerated accelerators cross it.
 */

import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import type { PreviewWebContentsHandle } from './PreviewSessionFactory'
import { logger } from '../LoggingService'
import { PREVIEW_PAGE_LINK_CHANNEL } from './previewLinkBridge'
import { PREVIEW_PAGE_CSP_VIOLATION_CHANNEL } from './previewCspViolationBridge'
import { redactPath } from '../../utils/redactUserInput'
import { classifyConsoleMessage } from './previewConsoleClassify'
import { attachInputForwarding } from './previewInputForward'

/** The disposable single-file watcher the service uses for the entry HTML. */
export interface PreviewFileWatcherHandle {
  close(): Promise<void>
}

/** Callbacks the service supplies for each lifecycle transition. */
export interface PreviewLifecycleHooks {
  /** The render process is gone; `reason` is Electron's crash reason if known. */
  onRenderProcessGone(reason?: string): void
  onUnresponsive(): void
  onDidFinishLoad(): void
  /**
   * The frame tree started loading. Fires for the initial navigation AND for
   * every reload, and — because Chromium scopes it to the whole frame tree —
   * again whenever a subframe begins loading.
   */
  onDidStartLoading(): void
  /**
   * The frame tree stopped loading, by success, failure or `window.stop()`.
   *
   * This is the symmetric counterpart of `did-start-loading`. `did-finish-load`
   * is NOT: it is scoped to the primary main frame's `onload`, so pairing the
   * two would leave a page with a lazily-loaded subframe stuck in the loading
   * state for good.
   */
  onDidStopLoading(): void
  /** The load failed or was cancelled. Belt-and-braces beside `onDidStopLoading`. */
  onDidFailLoad(): void
  onEntryChange(): void
  onEntryDeleted(): void
  onForwardedShortcut(key: string): void
  /** A page console message already classified as a preview failure. */
  onConsoleMessage(input: PreviewFailureInput): void
  /**
   * A link was activated in the page and reported by the preview preload
   * (sd-074b §5.1). The payload is UNVALIDATED — the bridge parses it.
   */
  onLinkActivated?(payload: unknown): void
  /** The page's CSP refused a subresource (see previewCspViolationBridge). */
  onCspViolation?(payload: unknown): void
  /**
   * The page tried to navigate itself. The navigation is still cancelled; the
   * URL is handed on so a plain link works even when the preload is absent.
   */
  onNavigationAttempt?(url: string): void
}

/**
 * The slice of Electron 39's `console-message` event details this wiring reads
 * (`Event<WebContentsConsoleMessageEventParams>`). `level` is the STRING severity
 * ('info' | 'warning' | 'error' | 'debug') — the numeric `level` positional arg is
 * deprecated — and `sourceId` is the URL of the log source.
 */
interface PreviewConsoleMessageDetails {
  readonly level: 'info' | 'warning' | 'error' | 'debug'
  readonly message: string
  readonly sourceId: string
}

/**
 * Map the string console severity to the numeric level the classifier expects
 * (0 verbose/debug, 1 info, 2 warning, 3 error — `electron.d.ts`). Only `error`
 * (3) is classified; everything else is page-normal noise.
 */
const CONSOLE_LEVEL_TO_NUMBER: Readonly<Record<string, number>> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3
}

/** Everything the wiring needs beyond the hooks. */
export interface PreviewLifecycleParams {
  readonly webContents: PreviewWebContentsHandle
  readonly entryFilePath: string
  readonly createEntryWatcher: (
    filePath: string,
    handlers: { onChange: () => void; onUnlink: () => void; onError: (error: unknown) => void }
  ) => PreviewFileWatcherHandle
  readonly platform?: NodeJS.Platform
}

/** A `will-navigate`-style event carrying `preventDefault`. */
interface PreventableEvent {
  preventDefault(): void
}

/**
 * Wire every lifecycle listener + guard onto `params.webContents` and start the
 * entry-file watcher. Returns an async disposer that removes the listeners and
 * closes the watcher.
 */
export function wirePreviewLifecycle(
  params: PreviewLifecycleParams,
  hooks: PreviewLifecycleHooks
): { dispose(): Promise<void> } {
  const wc = params.webContents

  // No popups: every window-open request is denied.
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))

  const onWillNavigate = (event: PreventableEvent, url?: unknown): void => {
    // The page never navigates itself; Erfana decides what a link means.
    event.preventDefault()
    if (typeof url === 'string' && url !== '') {
      hooks.onNavigationAttempt?.(url)
    }
  }
  // Electron delivers `(event, details)`; `details.reason` distinguishes a crash
  // ('crashed'/'oom'/'killed'/…) from a clean exit — carried through for the badge.
  const onRenderProcessGone = (...args: unknown[]): void => {
    const details = args[1] as { reason?: string } | undefined
    hooks.onRenderProcessGone(details?.reason)
  }
  const onUnresponsive = (): void => hooks.onUnresponsive()
  const onDidFinishLoad = (): void => hooks.onDidFinishLoad()
  const onDidStartLoading = (): void => hooks.onDidStartLoading()
  const onDidStopLoading = (): void => hooks.onDidStopLoading()
  const onDidFailLoad = (): void => hooks.onDidFailLoad()
  // Page console output is untrusted DATA: it is only classified, never executed.
  const onConsoleMessage = (details: PreviewConsoleMessageDetails): void => {
    const input = classifyConsoleMessage(
      CONSOLE_LEVEL_TO_NUMBER[details.level] ?? 0,
      details.message,
      details.sourceId
    )
    if (input !== null) {
      hooks.onConsoleMessage(input)
    }
  }

  wc.on('will-navigate', onWillNavigate as (...args: never[]) => void)
  wc.on('render-process-gone', onRenderProcessGone as (...args: never[]) => void)
  wc.on('unresponsive', onUnresponsive as (...args: never[]) => void)
  wc.on('did-finish-load', onDidFinishLoad as (...args: never[]) => void)
  // Registered as SIBLINGS of `did-finish-load`, deliberately not routed through
  // it: `onDidFinishLoad` delegates to the rate-limited post-load pipeline,
  // which drops events during a save burst. A dropped backdrop transition
  // leaves the page unreadable, so it must not share that budget.
  wc.on('did-start-loading', onDidStartLoading as (...args: never[]) => void)
  wc.on('did-stop-loading', onDidStopLoading as (...args: never[]) => void)
  wc.on('did-fail-load', onDidFailLoad as (...args: never[]) => void)
  wc.on('console-message', onConsoleMessage as (...args: never[]) => void)

  // Page → main link reports. Registered on the WebContents-scoped `ipc`, never
  // on the global `ipcMain`: it is invisible to every other handler in the app
  // and needs no sender predicate, because only this WebContents can reach it.
  // WebContents-scoped rather than frame-scoped because a `WebFrameMain` is
  // replaced when a navigated page replaces it (sd-074b §5.3).
  const onLinkActivated = (event: unknown, payload: unknown): void => {
    // Sub-frames are not trusted to speak for the page.
    const senderFrame = (event as { senderFrame?: unknown })?.senderFrame
    if (senderFrame !== undefined && senderFrame !== wc.mainFrame) {
      return
    }
    hooks.onLinkActivated?.(payload)
  }
  wc.ipc?.on(PREVIEW_PAGE_LINK_CHANNEL, onLinkActivated as (...args: never[]) => void)

  // Same channel discipline as the link one above, and the same main-frame gate:
  // a sub-frame does not speak for the page. This is the CSP half of the
  // blocked-host signal — the half `onBeforeRequest` structurally cannot see.
  const onCspViolation = (event: unknown, payload: unknown): void => {
    const senderFrame = (event as { senderFrame?: unknown })?.senderFrame
    if (senderFrame !== undefined && senderFrame !== wc.mainFrame) {
      return
    }
    hooks.onCspViolation?.(payload)
  }
  wc.ipc?.on(PREVIEW_PAGE_CSP_VIOLATION_CHANNEL, onCspViolation as (...args: never[]) => void)

  const detachInput = attachInputForwarding(
    wc as never,
    hooks.onForwardedShortcut,
    params.platform
  )

  const entryWatcher = params.createEntryWatcher(params.entryFilePath, {
    onChange: () => hooks.onEntryChange(),
    // A rename fires `unlink` on the old path — treat it as a delete.
    onUnlink: () => hooks.onEntryDeleted(),
    onError: (error) => {
      // A watcher error is not itself a page failure (the next load surfaces a
      // genuinely missing file), so it is still swallowed to avoid crashing
      // teardown — but it is logged now, filename redacted, so an EMFILE or
      // permission fault on the entry watch leaves a diagnostic trail.
      logger.warn('Preview entry watcher error', {
        path: redactPath(params.entryFilePath),
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })

  return {
    async dispose(): Promise<void> {
      detachInput()
      wc.removeListener('will-navigate', onWillNavigate as (...args: never[]) => void)
      wc.removeListener('render-process-gone', onRenderProcessGone as (...args: never[]) => void)
      wc.removeListener('unresponsive', onUnresponsive as (...args: never[]) => void)
      wc.removeListener('did-finish-load', onDidFinishLoad as (...args: never[]) => void)
      wc.removeListener('did-start-loading', onDidStartLoading as (...args: never[]) => void)
      wc.removeListener('did-stop-loading', onDidStopLoading as (...args: never[]) => void)
      wc.removeListener('did-fail-load', onDidFailLoad as (...args: never[]) => void)
      wc.removeListener('console-message', onConsoleMessage as (...args: never[]) => void)
      wc.ipc?.removeListener(
        PREVIEW_PAGE_LINK_CHANNEL,
        onLinkActivated as (...args: never[]) => void
      )
      wc.ipc?.removeListener(
        PREVIEW_PAGE_CSP_VIOLATION_CHANNEL,
        onCspViolation as (...args: never[]) => void
      )
      await entryWatcher.close()
    }
  }
}
