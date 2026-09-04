// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The one place a global IPC handler is registered (sd-074b §7, revised).
 *
 * Erfana registers ~118 handlers on the global `ipcMain`. Until now the trust
 * check was per-handler opt-in — only a handful of files called
 * `isTrustedSender` — which left `shell:openExternal`, `terminal:*` and the
 * mutating `file:*` handlers reachable by any renderer frame that could send
 * IPC. Nothing could send before sd-074b, because the HTML preview was sealed
 * with no preload; adding a preload to that sealed page gives its **process** an
 * IPC path, so a Blink/V8 compromise in a page running untrusted JavaScript
 * would reach whatever is not covered.
 *
 * WHY THIS AND NOT A WRAPPED SINGLETON. The first attempt monkey-patched
 * `ipcMain.handle/handleOnce/on/once` at the composition root. The lens review
 * found three defects that are not fixable without leaving the approach:
 *
 *  - **`removeListener` broke silently (F6).** The patch registered a NEW
 *    closure per call, and `EventEmitter` removal is by reference, so
 *    `ipcMain.removeListener(channel, myListener)` matched nothing and removed
 *    nothing — a missed removal on an EventEmitter is a no-op, not an error.
 *  - **Aliases walked straight around it (F7).** `on` and `addListener` are the
 *    same function on `EventEmitter.prototype`; assigning `ipcMain.on` shadows
 *    only `on`, leaving `addListener`, `prependListener` and
 *    `prependOnceListener` registering completely ungated listeners.
 *  - **Ordering was a comment, not a guarantee.** Anything registered before
 *    the patch installed kept the unwrapped path, with nothing to detect it.
 *
 * An explicit entry point has none of those failure modes, and an ESLint
 * `no-restricted-imports` rule on `src/main/**` keeps `ipcMain` from being
 * imported anywhere else — the same enforcement pattern the repo already uses
 * for `api.preview.setVisibility` and `openFileInPanel`.
 *
 * NOT COVERED, deliberately: frame-scoped listeners (`webContents.ipc` and
 * `webContents.mainFrame.ipc` — the image-export harness, the screenshot
 * overlay's selection channels, and the preview page's link channel). Those
 * never touch global `ipcMain`, are scoped to one `WebContents`, and already
 * carry their own per-call token or frame check.
 *
 * @see src/main/ipc/senderValidation.ts — the predicate
 * @see specs/designs/sd-074b-preview-navigation-and-multiview.md §7
 */
import { ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

import { logger } from '../services/LoggingService'
import { isTrustedAppSender } from './senderValidation'

/**
 * Listener shapes taken FROM Electron rather than restated.
 *
 * Restating them as `(event, ...args: unknown[])` would be stricter than
 * `ipcMain` itself and would reject every handler in the app that declares
 * typed parameters — which is nearly all of them. Deriving the types means this
 * module accepts exactly what it forwards to, and tracks Electron across
 * upgrades for free.
 */
type InvokeListener = Parameters<typeof ipcMain.handle>[1]
type SendListener = Parameters<typeof ipcMain.on>[1]

/**
 * Caller's listener → the guarded wrapper actually registered.
 *
 * `unregisterOn` needs this: the wrapper is what sits on the emitter, and
 * `EventEmitter.removeListener` matches by reference. Weak so a listener that
 * goes out of scope without being unregistered does not pin the wrapper.
 */
const wrappers = new WeakMap<SendListener, SendListener>()

/** Cap on the logged origin, so a hostile URL cannot flood a log line. */
const MAX_LOGGED_URL_CHARS = 256

/**
 * Scheme and host only, for logging.
 *
 * The rejected sender's URL is by definition NOT our own window — that is what
 * being rejected means — so it can carry attacker-influenced content: an
 * `erfana-preview://<token>/<user path>` names a real file in the user's
 * project. Only the origin is written, bounded, matching the redaction
 * convention used elsewhere in the main process (lens review F28, which found
 * the previous implementation logging the whole URL under a comment asserting
 * it was always ours).
 */
function describeSender(event: IpcMainEvent | IpcMainInvokeEvent): string {
  const raw = event.senderFrame?.url
  if (!raw) return '(no frame)'
  try {
    const parsed = new URL(raw)
    const origin = parsed.host ? `${parsed.protocol}//${parsed.host}` : parsed.protocol
    return origin.slice(0, MAX_LOGGED_URL_CHARS)
  } catch {
    return '(unparseable sender url)'
  }
}

/** Record a message from a sender that is not the app's own top-level renderer. */
function rejected(channel: string, event: IpcMainEvent | IpcMainInvokeEvent): void {
  logger.warn('Rejected IPC from untrusted sender', {
    channel,
    origin: describeSender(event)
  })
}

/**
 * Register an `invoke` handler behind the sender check.
 *
 * An untrusted sender never reaches the listener, and the caller's `invoke`
 * rejects — throwing is the only way to fail an `invoke`, so the renderer gets a
 * rejection rather than a forged-looking success value.
 */
export function registerHandle(channel: string, listener: InvokeListener): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args) => {
    if (!isTrustedAppSender(event)) {
      rejected(channel, event)
      throw new Error(`Untrusted sender for IPC channel "${channel}"`)
    }
    return listener(event, ...args)
  })
}

/**
 * Register a one-shot `invoke` handler behind the sender check.
 *
 * Built on `handle` plus an explicit `removeHandler` rather than on
 * `handleOnce`, so a REJECTED message does not consume the registration.
 * `handleOnce` removes the handler before the listener runs, which would let one
 * untrusted message permanently disable the channel for the legitimate caller.
 */
export function registerHandleOnce(channel: string, listener: InvokeListener): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args) => {
    if (!isTrustedAppSender(event)) {
      rejected(channel, event)
      throw new Error(`Untrusted sender for IPC channel "${channel}"`)
    }
    ipcMain.removeHandler(channel)
    return listener(event, ...args)
  })
}

/**
 * Register a `send` listener behind the sender check.
 *
 * An untrusted sender is dropped silently: a `send` channel has no reply path to
 * reject through, and throwing inside an EventEmitter listener in the main
 * process is worse than dropping.
 *
 * Pair with {@link unregisterOn}, never with `ipcMain.removeListener` — the
 * registered function is a wrapper, not the listener passed in.
 */
export function registerOn(channel: string, listener: SendListener): void {
  const wrapper = (event: IpcMainEvent, ...args: unknown[]): void => {
    if (!isTrustedAppSender(event)) {
      rejected(channel, event)
      return
    }
    listener(event, ...args)
  }
  wrappers.set(listener, wrapper)
  ipcMain.on(channel, wrapper)
}

/**
 * Register a one-shot `send` listener behind the sender check.
 *
 * Built on `on` plus an explicit removal for the same reason as
 * {@link registerHandleOnce}: a rejected message must not consume the
 * registration.
 */
export function registerOnce(channel: string, listener: SendListener): void {
  const wrapper = (event: IpcMainEvent, ...args: unknown[]): void => {
    if (!isTrustedAppSender(event)) {
      rejected(channel, event)
      return
    }
    ipcMain.removeListener(channel, wrapper)
    wrappers.delete(listener)
    listener(event, ...args)
  }
  wrappers.set(listener, wrapper)
  ipcMain.on(channel, wrapper)
}

/**
 * Remove a listener registered through {@link registerOn} or
 * {@link registerOnce}.
 *
 * Resolves the caller's listener back to the wrapper that is actually on the
 * emitter. Removing an already-removed or never-registered listener is a no-op,
 * matching `EventEmitter.removeListener`.
 */
export function unregisterOn(channel: string, listener: SendListener): void {
  const wrapper = wrappers.get(listener)
  if (!wrapper) return
  ipcMain.removeListener(channel, wrapper)
  wrappers.delete(listener)
}

/** Remove an `invoke` handler registered through this module. */
export function unregisterHandle(channel: string): void {
  ipcMain.removeHandler(channel)
}
