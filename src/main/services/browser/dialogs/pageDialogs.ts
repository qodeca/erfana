// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Page dialogs – `alert`, `confirm`, `prompt` – in v1 (spec 025, 025-FR-058;
 * ADR 0011 decision 7 and its commit-8 probe, ADR 0011 accepted 2026-11-03;
 * owner decision Q6 in solution design § 11).
 *
 * The commit-8 probe showed that Electron always opens its own box for a
 * page's `alert` and `confirm`, even when a CDP client answers the dialog,
 * and that `prompt()` throws. Erfana's own dialog in the strip cannot
 * replace them without patching Electron, so v1 ships the native dialogs
 * (owner decision Q6, accepted with ADR 0011 on 2026-11-03). What Erfana still
 * does is make the hang probe aware of them: with the `Page` domain on, the
 * top target reports `Page.javascriptDialogOpening` and `…Closed`, and the
 * tab's CDP session suspends the probe while a dialog waits
 * (`cdp/BrowserCdpSession.ts`), so a page blocked on a native dialog is never
 * reported as "not responding". `safeDialogs: true` (025-NFR-001) gives the
 * native box Electron's own "prevent more dialogs" checkbox.
 */
import { logger } from '../../LoggingService'

/** The part of `BrowserCdpSession` this module uses. */
export interface DialogCdp {
  send(method: string, params?: unknown): Promise<unknown>
}

/**
 * Turn the `Page` domain on for `cdp`'s top target, so its dialog events
 * reach the hang probe. Never rejects; a refusal leaves the probe without
 * dialog awareness and is logged.
 */
export async function enablePageDialogEvents(cdp: DialogCdp): Promise<void> {
  try {
    await cdp.send('Page.enable')
  } catch (error) {
    logger.warn('Page dialog events could not be turned on', { error: error instanceof Error ? error.message : String(error) })
  }
}
