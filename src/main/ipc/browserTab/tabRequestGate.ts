// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The identity gate every `browser-tab:` handler of Erfana's main window
 * runs before it acts (spec 025, solution design § 8; architecture review
 * "IPC identity gate copy-pasted").
 *
 * On top of the process-wide gate in `registry.ts` (identity, top-level
 * frame, renderer URL and the window kind's channel allow-list), a request is
 * accepted only when:
 * 1. the exact-URL {@link isTrustedSender} passes again;
 * 2. its payload parses with the channel's strict zod schema;
 * 3. the window resolves from the sender – never from the payload;
 * 4. for a tab request, that window owns the named tab.
 * A refusal is logged without the payload and answered with `null`, so the
 * handler can return its own refusal; {@link guarded} turns a throw into a
 * logged fallback, so no handler ever throws.
 *
 * The popup channels (`popup-handlers.ts`) do not use the trust check: a
 * popup host loads the renderer entry with a route hash, which the exact-URL
 * check refuses by design; they are admitted by the registry's `browserPopup`
 * allow-list and resolved by the sending host's id (ADR 0011 decision 9).
 */
import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { logger } from '../../services/LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'

export type GateEvent = IpcMainInvokeEvent | IpcMainEvent

/** A zod schema's `safeParse`, as far as the gate uses it. */
export interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } }
}

/** The sender's window id, or null when it has no live window. */
export function resolveWindowId(event: GateEvent): number | null {
  const window = BrowserWindow.fromWebContents(event.sender)
  return window === null || window.isDestroyed() ? null : window.id
}

/** Run `act`, logging instead of throwing; `fallback` is the answer after a throw. */
export function guarded<R>(channel: string, fallback: R, act: () => R): R {
  try {
    return act()
  } catch (error) {
    logger.error('Browser tab request failed', redactedLogError(error), { channel })
    return fallback
  }
}

export interface TabGateDeps<E extends GateEvent, W, Tab> {
  readonly isTrusted: (event: E) => boolean
  /** The sender's live window, or null. */
  readonly resolveWindow: (event: E) => W | null
  /** The tab `tabId` when `window` owns it, else null; without it {@link TabGate.acceptTab} refuses every request. */
  readonly tabOf?: (window: W, tabId: string) => Tab | null
}

export interface TabGate<E extends GateEvent, W, Tab> {
  /** The sender's window and the parsed payload, or null (refused and logged). */
  accept<T>(channel: string, event: E, schema: Parser<T>, arg: unknown): { window: W; data: T } | null
  /** As {@link accept}, plus the named tab, which the sender's window must own. */
  acceptTab<T extends { readonly tabId: string }>(channel: string, event: E, schema: Parser<T>, arg: unknown): { window: W; tab: Tab; data: T } | null
}

export function createTabGate<E extends GateEvent, W, Tab>(deps: TabGateDeps<E, W, Tab>): TabGate<E, W, Tab> {
  function accept<T>(channel: string, event: E, schema: Parser<T>, arg: unknown): { window: W; data: T } | null {
    if (!deps.isTrusted(event)) {
      logger.warn('Rejected a browser tab request from an untrusted sender', { channel })
      return null
    }
    const parsed = schema.safeParse(arg)
    if (!parsed.success) {
      logger.warn('Rejected a browser tab request with an invalid payload', { channel, error: parsed.error.message })
      return null
    }
    const window = deps.resolveWindow(event)
    return window === null ? null : { window, data: parsed.data }
  }

  return {
    accept,
    acceptTab(channel, event, schema, arg) {
      const accepted = accept(channel, event, schema, arg)
      if (accepted === null) return null
      const tab = deps.tabOf?.(accepted.window, accepted.data.tabId) ?? null
      return tab === null ? null : { window: accepted.window, tab, data: accepted.data }
    }
  }
}
