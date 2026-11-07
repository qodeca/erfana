// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Structural types for the parts of Electron's `webContents` and `debugger`
 * that the CDP folder touches (spec 025 solution design § 5, ADR 0007).
 *
 * Structural on purpose: the unit tests drive fake debuggers, and a type test
 * proves `Electron.WebContents` still fits these shapes after an Electron
 * update. Nothing outside `cdp/` should need them except to hand a
 * `webContents` to `BrowserCdpSession.attach`.
 */

/** Electron's `debugger` `message` listener: CDP event method, params, flattened session id. */
export type CdpMessageListener = (event: unknown, method: string, params: unknown, sessionId: string) => void

/** Electron's `debugger` `detach` listener. */
export type CdpDetachListener = (event: unknown, reason: string) => void

/** The part of `Electron.Debugger` the session uses. */
export interface CdpDebugger {
  attach(protocolVersion?: string): void
  detach(): void
  isAttached(): boolean
  // Electron types the params and result as `any`; the session narrows both.
  sendCommand(method: string, commandParams?: unknown, sessionId?: string): Promise<unknown>
  on(event: 'message', listener: CdpMessageListener): unknown
  on(event: 'detach', listener: CdpDetachListener): unknown
  removeListener(event: 'message', listener: CdpMessageListener): unknown
  removeListener(event: 'detach', listener: CdpDetachListener): unknown
}

/** Electron's `did-navigate` listener (main frame, new document only). */
export type DidNavigateListener = (event: unknown, url: string) => void

/** Electron's `did-frame-navigate` listener (any frame, new document only). */
export type DidFrameNavigateListener = (
  event: unknown,
  url: string,
  httpResponseCode: number,
  httpStatusText: string,
  isMainFrame: boolean
) => void

/** The part of `Electron.WebContents` the session uses. */
export interface CdpWebContents {
  readonly debugger: CdpDebugger
  isDestroyed(): boolean
  isDevToolsOpened(): boolean
  on(event: 'did-navigate', listener: DidNavigateListener): unknown
  on(event: 'did-frame-navigate', listener: DidFrameNavigateListener): unknown
  removeListener(event: 'did-navigate', listener: DidNavigateListener): unknown
  removeListener(event: 'did-frame-navigate', listener: DidFrameNavigateListener): unknown
}

/** CDP params as they arrive or leave: a plain JSON object. */
export type CdpParams = Readonly<Record<string, unknown>>

/** True for a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
