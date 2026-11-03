// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `window.browserPopupApi` – the whole surface a browser popup's host renderer
 * gets (spec 025, 025-FR-011; ADR 0011 decision 9; commit 18). The host draws
 * the popup's read-only origin strip above the page; it may use only the
 * `browser-tab:popup*` channels, and main names the popup by its sender.
 *
 * @see src/preload/browserPopup.ts for the implementation
 */
import type { PopupStripResponse } from './browser-tab-popup-schema'

export interface BrowserPopupBridge {
  /** The popup's committed address and badge state; `null` when main refused. */
  strip(): Promise<PopupStripResponse | null>
  /** Close the popup (Ctrl/Cmd+W in the host). */
  close(): Promise<void>
  /** The committed address changed: ask {@link BrowserPopupBridge.strip} again. */
  onChanged(callback: () => void): () => void
}
