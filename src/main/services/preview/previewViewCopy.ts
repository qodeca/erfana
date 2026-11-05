// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Copy from the HTML preview's right-click menu (#463).
 *
 * `preview:copySelection` resolves to exactly one call: run the page's own Copy
 * command (`webContents.copy()`) on the view a panel shows. The app renderer
 * cannot reach the page's selection – the page runs in its own process – so the
 * menu asks main, and main copies inside Chromium. No text travels back.
 *
 * Its own module rather than a method on `PreviewViewService` for the size cap
 * the service is at (the `previewViewFocus` split); the service hands the
 * returned function on as its own member.
 *
 * Refusals, all answered as `false` and never as a throw:
 *   - no live view for the panel (closed, suspended, or never opened);
 *   - the view belongs to ANOTHER window – panel ids are path-derived, so two
 *     windows previewing one file mint the same id (`PreviewViewRegistry`), and
 *     a window must never act on the other window's page;
 *   - the view is being torn down, which `PreviewLiveView.copySelection` decides.
 */
import type { PreviewLiveView } from './PreviewLiveView'

/** The part of a live view this route drives. */
export type PreviewCopyableView = Pick<PreviewLiveView, 'copySelection'>

/** A registry entry, as `PreviewViewRegistry.entry` returns it. */
export interface PreviewCopyableEntry {
  readonly view: PreviewCopyableView
  /** `BrowserWindow.id` of the window whose content view hosts this preview. */
  readonly windowId: number
}

/** What the copy route needs from the service. */
export interface PreviewViewCopyDeps {
  readonly registry: { entry(panelId: string): PreviewCopyableEntry | null }
}

/**
 * Build the service's `copySelection`.
 *
 * @param deps - The live-view registry the panel is looked up in.
 * @returns `copySelection(panelId, windowId)`: `true` only when the page was told to copy.
 */
export function createPreviewViewCopy(
  deps: PreviewViewCopyDeps
): (panelId: string, windowId: number) => boolean {
  return (panelId: string, windowId: number): boolean => {
    const entry = deps.registry.entry(panelId)
    if (entry === null || entry.windowId !== windowId) {
      return false
    }
    return entry.view.copySelection()
  }
}
