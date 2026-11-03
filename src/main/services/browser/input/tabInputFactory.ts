// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Builds one tab's key and mouse routers (`BrowserTabInput.ts`) with its
 * events wired to the owning window (spec 025, ADR 0011 decisions 11–16).
 * Moved out of `BrowserTabService.ts`, which is at its size limit.
 */
import type { Clock } from '../../../../shared/clock'
import { BROWSER_TAB_EVENTS } from '../../../../shared/ipc/browser-tab-channels'
import { FocusEventSchema, ForwardedKeyEventSchema, PickEventSchema } from '../../../../shared/ipc/browser-tab-schema'
import type { BrowserTab, TabHost } from '../BrowserTab'
import { sendTabEvent } from '../tabEventSend'
import { BrowserTabInput } from './BrowserTabInput'
import type { MacAppKeyTargets } from './macAppRoles'

/** What each tab's input routing needs (`input/BrowserTabInput.ts`). */
export interface TabInputSetup {
  /** `process.platform`. */
  readonly platform: string
  readonly clock: Pick<Clock, 'now'>
  /** Where the macOS application keys act for a tab in `host`. */
  readonly macAppKeys: (host: TabHost) => MacAppKeyTargets
}

/** The routers of `tab` in `host`; `zoom` reaches the tab's page features. */
export function newTabInput(
  tab: Pick<BrowserTab, 'id' | 'contents'>,
  host: TabHost,
  setup: TabInputSetup,
  zoom: (step: 'in' | 'out' | 'reset') => void,
  onSurface?: (open: boolean) => void
): BrowserTabInput {
  const tabId = tab.id
  return new BrowserTabInput({
    tabId,
    contents: tab.contents,
    platform: setup.platform,
    clock: setup.clock,
    macAppKeys: setup.macAppKeys(host),
    zoom,
    onSurface,
    events: {
      forwardedKey: (action) => sendTabEvent(host, BROWSER_TAB_EVENTS.forwardedKey, ForwardedKeyEventSchema, { tabId, action }),
      pageFocus: (pageFocused) => sendTabEvent(host, BROWSER_TAB_EVENTS.focus, FocusEventSchema, { tabId, pageFocused }),
      pick: (event) => sendTabEvent(host, BROWSER_TAB_EVENTS.pick, PickEventSchema, event)
    }
  })
}
