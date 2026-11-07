// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One tab's top-level loads into a served local folder (spec 025,
 * 025-FR-005 rule 1; ADR 0012 decision 5 and amendment 2026-11-04), moved
 * out of `BrowserTab.ts`.
 *
 * - **Arm**: a load Erfana starts (the open, Reload, Back, Forward) arms its
 *   exact address, so only that document gets the folder's origin.
 * - **Pending load**: until the new page commits, the tab's
 *   `webContents.getURL()` still answers the previous page while the new
 *   page's first images, scripts and frames are already asked about. The
 *   served folders are told the tab's pending load to a folder – one Erfana
 *   armed, or the page's own navigation within its folder – so those
 *   requests go ahead; it is cleared on commit, failure, Stop, the end of
 *   loading and a newer navigation (`LocalFileServers.setPendingLoad`).
 */
import type { TabLocalFiles } from '../BrowserTab'

export class TabLocalLoad {
  /** `contentsId` is kept by value: it still keys the pending load after `destroyed`. */
  constructor(
    private readonly local: TabLocalFiles | undefined,
    private readonly contentsId: number
  ) {}

  /**
   * An Erfana-started top-level load of `url`: armed and recorded as the
   * pending load when it is a served local address; any other address
   * clears the pending load.
   */
  arm(url: string | null): void {
    const local = this.local
    if (local === undefined) return
    if (url !== null && local.isLocalAddress(url)) local.arm(url)
    local.setPendingLoad(this.contentsId, url)
  }

  /** No top-level load is pending in a served folder any more; with `url`, only when that load is the pending one. */
  end(url?: string): void {
    this.local?.endPendingLoad(this.contentsId, url)
  }

  /**
   * A cross-document top-level navigation to `url` started. The page's own
   * one is the pending load when the served-folder gate lets it start from
   * `committedUrl` (a navigation within its folder), and clears it otherwise;
   * one Erfana started keeps what {@link arm} recorded, unless it leaves the
   * served folders.
   */
  navigationStarted(url: string, pageStarted: boolean, committedUrl: string | null): void {
    const local = this.local
    if (local === undefined) return
    if (!local.isLocalAddress(url)) {
      this.end()
      return
    }
    if (!pageStarted) return
    const allowed = local.allowsRequest({ url, resourceType: 'mainFrame', topUrl: committedUrl })
    local.setPendingLoad(this.contentsId, allowed ? url : null)
  }
}
