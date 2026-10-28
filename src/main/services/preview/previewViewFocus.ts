// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard route into a previewed page (issue #124, QG-8 U1).
 *
 * `preview:focusPage` resolves to exactly one call: give the page a panel shows
 * keyboard focus. The page runs in a native `WebContentsView` that Erfana's own
 * tab order cannot reach, so without this a keyboard-only reader can neither
 * follow a link in the page nor use any of the accelerators main forwards back
 * out of it – all of which need focus to be inside the page already (WCAG SC
 * 2.1.1). Escape is the way back: main returns native focus to the host window
 * before forwarding it (`previewHostFocus.ts`).
 *
 * Its own module rather than a method on `PreviewViewService` for the size cap
 * the service is at (design §3, the same fallback split `previewViewNavigation`
 * took); the service hands the returned function on as its own member.
 *
 * Three refusals, all answered as `false` and never as a throw:
 *   - no live view for the panel (closed, suspended, or never opened);
 *   - the view belongs to ANOTHER window – panel ids are path-derived, so two
 *     windows previewing one file mint the same id (`PreviewViewRegistry`), and
 *     a window must never move focus into the other window's page;
 *   - the view is not drawn (hidden behind an overlay, an inactive tab, a
 *     window-edge resize hold), which `PreviewLiveView.focusPage` decides.
 */
import type { PreviewLiveView } from './PreviewLiveView'

/** The part of a live view this route drives. */
export type PreviewFocusableView = Pick<PreviewLiveView, 'focusPage'>

/** A registry entry, as `PreviewViewRegistry.entry` returns it. */
export interface PreviewFocusableEntry {
  readonly view: PreviewFocusableView
  /** `BrowserWindow.id` of the window whose content view hosts this preview. */
  readonly windowId: number
}

/** What the focus route needs from the service. */
export interface PreviewViewFocusDeps {
  readonly registry: { entry(panelId: string): PreviewFocusableEntry | null }
}

/**
 * Build the service's `focusPage`.
 *
 * @param deps - The live-view registry the panel is looked up in.
 * @returns `focusPage(panelId, windowId)`: `true` only when the page took focus.
 */
export function createPreviewViewFocus(
  deps: PreviewViewFocusDeps
): (panelId: string, windowId: number) => boolean {
  return (panelId: string, windowId: number): boolean => {
    const entry = deps.registry.entry(panelId)
    if (entry === null || entry.windowId !== windowId) {
      return false
    }
    return entry.view.focusPage()
  }
}
