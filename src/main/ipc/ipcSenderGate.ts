// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Process-wide IPC sender gate (design sd-074b §7, phase 0).
 *
 * Erfana registers ~118 handlers on the global `ipcMain`, and until now the
 * trust check was per-handler opt-in: only a handful of files called
 * `isTrustedSender` / `isTrustedPreviewSender`, leaving `shell:openExternal`,
 * `terminal:*` and the mutating `file:*` handlers reachable by any renderer
 * frame that could send IPC. Nothing could send today — the HTML preview is
 * sealed with no preload — but sd-074b adds a preload to that sealed page, which
 * gives its **process** an IPC path. A Blink/V8 compromise in a page running
 * untrusted JS would then reach whatever the gate does not cover.
 *
 * This module closes that surface once, at the composition root, so handlers are
 * gated **by default** rather than by author discipline:
 *
 *  - `ipcMain.handle` / `handleOnce` — an untrusted sender never reaches the
 *    listener and the caller's `invoke` rejects.
 *  - `ipcMain.on` / `once` — an untrusted sender is dropped silently (a `send`
 *    channel has no reply path to reject through).
 *
 * WHY A WRAPPER AND NOT A PER-FILE IMPORT: every handler module imports
 * `ipcMain` straight from `electron`, so there is no injection seam short of
 * editing all 25 of them — and an opt-in helper only protects the handlers whose
 * authors remembered it, which is the exact failure this fixes. Wrapping the
 * singleton once, before any `register*Handlers()` call, covers every existing
 * handler and every future one with no per-file discipline.
 *
 * NOT COVERED, deliberately: frame-scoped listeners
 * (`webContents.mainFrame.ipc` — the image-export harness and the screenshot
 * overlay's selection channels). Those never touch global `ipcMain` and already
 * carry a per-call token.
 *
 * @see src/main/ipc/senderValidation.ts — the predicate
 * @see specs/designs/sd-074b-preview-navigation-and-multiview.md §7
 */
import { ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { logger } from '../services/LoggingService'
import { isTrustedAppSender } from './senderValidation'

/** Listener shape accepted by `ipcMain.handle` / `handleOnce`. */
type InvokeListener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/** Listener shape accepted by `ipcMain.on` / `once`. */
type SendListener = (event: IpcMainEvent, ...args: unknown[]) => void

/**
 * Install-once latch. Re-installing would wrap the already-wrapped functions and
 * run the predicate twice per message — harmless but wasteful, and it would make
 * `uninstallIpcSenderGate` restore the wrong originals.
 */
let installed = false

/** Captured originals, kept so tests can restore the singleton. */
let originalHandle: typeof ipcMain.handle | null = null
let originalHandleOnce: typeof ipcMain.handleOnce | null = null
let originalOn: typeof ipcMain.on | null = null
let originalOnce: typeof ipcMain.once | null = null

/**
 * Reject a message from a sender that is not the app's own top-level renderer.
 * The URL is logged because a rejection is always a bug or an attack, and both
 * need the origin to diagnose; it is our own window's URL, never page content.
 */
function rejected(channel: string, event: IpcMainEvent | IpcMainInvokeEvent): void {
  logger.warn('Rejected IPC from untrusted sender', {
    channel,
    url: event.senderFrame?.url ?? '(no frame)'
  })
}

/**
 * Wrap the global `ipcMain` so every handler registered afterwards runs behind
 * {@link isTrustedAppSender}.
 *
 * MUST be called before the first `register*Handlers()` call — handlers
 * registered earlier keep the unwrapped path. Idempotent.
 */
export function installIpcSenderGate(): void {
  if (installed) {
    return
  }
  installed = true

  // Store the RAW references, not bound copies: `uninstallIpcSenderGate` must
  // restore the identical function object, and a bound copy is a different one.
  originalHandle = ipcMain.handle
  originalHandleOnce = ipcMain.handleOnce
  originalOn = ipcMain.on
  originalOnce = ipcMain.once

  const guardInvoke =
    (channel: string, listener: InvokeListener) =>
    (event: IpcMainInvokeEvent, ...args: unknown[]): unknown => {
      if (!isTrustedAppSender(event)) {
        rejected(channel, event)
        // Throwing is the only way to fail an `invoke`: the renderer's promise
        // rejects instead of receiving a forged-looking success value.
        throw new Error(`Untrusted sender for IPC channel "${channel}"`)
      }
      return listener(event, ...args)
    }

  const guardSend =
    (channel: string, listener: SendListener) =>
    (event: IpcMainEvent, ...args: unknown[]): void => {
      if (!isTrustedAppSender(event)) {
        rejected(channel, event)
        return
      }
      listener(event, ...args)
    }

  // `.call(ipcMain, …)` rather than a bound copy, so the originals stay
  // restorable by identity above.
  ipcMain.handle = ((channel: string, listener: InvokeListener) =>
    originalHandle?.call(ipcMain, channel, guardInvoke(channel, listener))) as typeof ipcMain.handle

  ipcMain.handleOnce = ((channel: string, listener: InvokeListener) =>
    originalHandleOnce?.call(
      ipcMain,
      channel,
      guardInvoke(channel, listener)
    )) as typeof ipcMain.handleOnce

  ipcMain.on = ((channel: string, listener: SendListener) =>
    originalOn?.call(ipcMain, channel, guardSend(channel, listener))) as typeof ipcMain.on

  ipcMain.once = ((channel: string, listener: SendListener) =>
    originalOnce?.call(ipcMain, channel, guardSend(channel, listener))) as typeof ipcMain.once
}

/**
 * Restore the unwrapped `ipcMain`. Exists for tests only — production installs
 * the gate once for the life of the process.
 */
export function uninstallIpcSenderGate(): void {
  if (!installed) {
    return
  }
  if (originalHandle) ipcMain.handle = originalHandle
  if (originalHandleOnce) ipcMain.handleOnce = originalHandleOnce
  if (originalOn) ipcMain.on = originalOn
  if (originalOnce) ipcMain.once = originalOnce
  installed = false
  originalHandle = null
  originalHandleOnce = null
  originalOn = null
  originalOnce = null
}
