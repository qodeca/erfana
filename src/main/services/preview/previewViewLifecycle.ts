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
import { classifyConsoleMessage } from './previewConsoleClassify'
import { attachInputForwarding } from './previewInputForward'

/** The disposable single-file watcher the service uses for the entry HTML. */
export interface PreviewFileWatcherHandle {
  close(): Promise<void>
}

/** Callbacks the service supplies for each lifecycle transition. */
export interface PreviewLifecycleHooks {
  onRenderProcessGone(): void
  onUnresponsive(): void
  onDidFinishLoad(): void
  onEntryChange(): void
  onEntryDeleted(): void
  onForwardedShortcut(key: string): void
  /** A page console message already classified as a preview failure. */
  onConsoleMessage(input: PreviewFailureInput): void
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

  const onWillNavigate = (event: PreventableEvent): void => {
    event.preventDefault()
  }
  const onRenderProcessGone = (): void => hooks.onRenderProcessGone()
  const onUnresponsive = (): void => hooks.onUnresponsive()
  const onDidFinishLoad = (): void => hooks.onDidFinishLoad()
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
  wc.on('console-message', onConsoleMessage as (...args: never[]) => void)

  const detachInput = attachInputForwarding(
    wc as never,
    hooks.onForwardedShortcut,
    params.platform
  )

  const entryWatcher = params.createEntryWatcher(params.entryFilePath, {
    onChange: () => hooks.onEntryChange(),
    // A rename fires `unlink` on the old path — treat it as a delete.
    onUnlink: () => hooks.onEntryDeleted(),
    onError: () => {
      // A watcher error is not itself a page failure; the entry read on the next
      // load surfaces a genuinely missing file. Swallow to avoid crashing teardown.
    }
  })

  return {
    async dispose(): Promise<void> {
      detachInput()
      wc.removeListener('will-navigate', onWillNavigate as (...args: never[]) => void)
      wc.removeListener('render-process-gone', onRenderProcessGone as (...args: never[]) => void)
      wc.removeListener('unresponsive', onUnresponsive as (...args: never[]) => void)
      wc.removeListener('did-finish-load', onDidFinishLoad as (...args: never[]) => void)
      wc.removeListener('console-message', onConsoleMessage as (...args: never[]) => void)
      await entryWatcher.close()
    }
  }
}
