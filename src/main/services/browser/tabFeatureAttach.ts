// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * How `BrowserTabService` attaches a new tab's features, before its first
 * page loads (spec 025; architecture review option A).
 *
 * The order is {@link ATTACH_ORDER}, in one place: the input routers first
 * (the site holds its requests through them, the page's pick pipeline drives
 * them), then the site, the page features – with the pick pipeline wrapped
 * around them by `pick/pickAppSetup.ts` – and the extras last. Each step
 * fills its slot of the tab's {@link TabEntry} and adds itself to the tab's
 * feature list (`tabFeatureRegistry.ts`), which answers strip rows and
 * detaches every feature when the tab goes. A step whose setup is absent
 * attaches nothing; the service's deps say what a tab does without it.
 */
import type { WebContents } from 'electron'
import type { BrowserTab } from './BrowserTab'
import type { BrowserTabServiceDeps, TabCdpLink } from './BrowserTabService'
import { TabPageExtras } from './dialogs/TabPageExtras'
import { AppWindowBrowserKeys } from './input/appWindowBrowserKeys'
import type { BrowserTabInput } from './input/BrowserTabInput'
import { newTabInput } from './input/tabInputFactory'
import type { BrowserTabPage } from './page/BrowserTabPage'
import type { TabSiteLink } from './permissions/BrowserSite'
import type { TabFeatureList, TabOutlet } from './tabFeatureRegistry'

/** What the service holds for one live tab: its outlet, its feature list and the features it calls by name. */
export interface TabEntry {
  readonly outlet: TabOutlet
  readonly features: TabFeatureList
  input: BrowserTabInput | null
  site: TabSiteLink | null
  page: BrowserTabPage | null
  extras: TabPageExtras | null
}

/** The service's own parts a tab's features call back into. */
export interface TabServiceHooks {
  /** One browser-keys listener per window, shared by its tabs (`input/appWindowBrowserKeys.ts`). */
  readonly windowKeys: Map<number, AppWindowBrowserKeys>
  /** The tab's CDP link, whose hang events the page features take; null without a session. */
  readonly hang: TabCdpLink | null
  readonly sendState: () => void
  /** A tab the page opened (`createFromPage`); whether it opened. */
  readonly openTab: (url: string, background: boolean, adopt: WebContents | null) => boolean
  /** **Open link in new tab**. */
  readonly openLink: (url: string) => void
  /** Close the tab without asking the page. */
  readonly forceClose: () => void
}

type Deps = Pick<BrowserTabServiceDeps, 'input' | 'site' | 'pages' | 'extras'>
type AttachStep = (tab: BrowserTab, entry: TabEntry, deps: Deps, hooks: TabServiceHooks) => void

/** The tab's key and mouse routers; none without routing. */
function attachInput(tab: BrowserTab, entry: TabEntry, deps: Deps, hooks: TabServiceHooks): void {
  const setup = deps.input
  if (setup === undefined) return
  const host = entry.outlet.host
  const input = newTabInput(tab, host, setup, (step) => entry.page?.zoom(step), (open) => entry.site?.holdRequests(open))
  entry.input = input
  entry.features.add({
    name: 'input',
    detach: () => {
      hooks.windowKeys.get(tab.windowId)?.clearTarget(input)
      input.dispose()
    }
  })
  if (!hooks.windowKeys.has(host.id) && !host.webContents.isDestroyed()) {
    hooks.windowKeys.set(host.id, new AppWindowBrowserKeys(host.webContents, setup.platform))
  }
}

/** Permission prompts, notices and downloads (`permissions/BrowserSite.ts`). */
function attachSite(tab: BrowserTab, entry: TabEntry, deps: Deps): void {
  const { outlet } = entry
  const site = deps.site?.attachTab(tab, {
    strip: (event) => outlet.strip(event),
    notice: (event) => outlet.notice(event),
    parentWindow: () => (outlet.host.isDestroyed() ? null : outlet.host)
  })
  if (site === undefined) return
  entry.site = site
  entry.features.add({ name: 'site', answerStrip: (id, answer, fields) => site.answerStrip(id, answer, fields), detach: () => site.detach() })
}

/** The tab's page features (`page/BrowserTabPage.ts`). */
function attachPage(tab: BrowserTab, entry: TabEntry, deps: Deps, hooks: TabServiceHooks): void {
  const pages = deps.pages
  if (pages === undefined) return
  const { onHang, waitHang } = hooks.hang ?? {}
  const hang = onHang === undefined || waitHang === undefined ? null : { onHang, waitHang }
  const { outlet } = entry
  const page = pages.attachTab(
    tab,
    {
      strip: (event) => outlet.strip(event),
      findResult: (event) => outlet.findResult(event),
      stateChanged: hooks.sendState,
      endPick: () => entry.input?.dispatch({ type: 'endSilently' })
    },
    hang
  )
  entry.page = page
  entry.features.add({ name: 'page', answerStrip: (id, answer) => page.answerStrip(id, answer), detach: () => pages.detachTab(page) })
}

/** Window open, leave-page prompt and right-click menu (`dialogs/TabPageExtras.ts`). */
function attachExtras(tab: BrowserTab, entry: TabEntry, deps: Deps, hooks: TabServiceHooks): void {
  const setup = deps.extras
  if (setup === undefined) return
  const { outlet } = entry
  const extras = new TabPageExtras(
    tab,
    {
      strip: (event) => outlet.strip(event),
      contextMenu: (event) => outlet.contextMenu(event),
      openTab: hooks.openTab,
      openLink: hooks.openLink,
      forceClose: hooks.forceClose,
      blocked: () => {
        const routing = entry.input?.state()
        return routing !== undefined && (routing.pick || routing.surface !== 'none')
      }
    },
    setup
  )
  entry.extras = extras
  entry.features.add({ name: 'extras', answerStrip: (id, answer) => extras.answerStrip(id, answer), detach: () => extras.detach() })
}

/** The attach order (see the module header). */
export const ATTACH_ORDER: readonly AttachStep[] = [attachInput, attachSite, attachPage, attachExtras]

/** Attach every feature of a new `tab`, in {@link ATTACH_ORDER}. */
export function attachTabFeatures(tab: BrowserTab, entry: TabEntry, deps: Deps, hooks: TabServiceHooks): void {
  for (const step of ATTACH_ORDER) step(tab, entry, deps, hooks)
}
