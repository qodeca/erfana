// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The per-window-kind channel allow-list (spec 025, solution design § 8,
 * panel findings S7 and A16).
 */
import { describe, expect, it } from 'vitest'

import { BROWSER_TAB_CHANNELS, BROWSER_TAB_POPUP_CHANNELS } from '../../shared/ipc/browser-tab-channels'
import type { AppWindowKind } from './appWebContents'
import { isChannelAllowedForKind } from './channelAllowList'

const POPUP = Object.values(BROWSER_TAB_POPUP_CHANNELS)
const APP_CHANNELS = ['terminal:create', 'file:readFile', 'logging:log', 'shell:openExternal', ...Object.values(BROWSER_TAB_CHANNELS)]

describe('isChannelAllowedForKind', () => {
  it('lets the main window use every app channel', () => {
    for (const channel of APP_CHANNELS) expect(isChannelAllowedForKind('main', channel)).toBe(true)
  })

  it('refuses the popup channels to the main window, including any future one under the prefix', () => {
    for (const channel of [...POPUP, 'browser-tab:popupSomethingNew']) {
      expect(isChannelAllowedForKind('main', channel)).toBe(false)
    }
  })

  it('lets a browser popup host use only the browser-tab:popup* channels', () => {
    for (const channel of POPUP) expect(isChannelAllowedForKind('browserPopup', channel)).toBe(true)
    for (const channel of [...APP_CHANNELS, 'browser-tab:popupSomethingNew']) {
      expect(isChannelAllowedForKind('browserPopup', channel)).toBe(false)
    }
  })

  it('keeps the screenshot overlay to exactly the channel it uses today', () => {
    expect(isChannelAllowedForKind('screenshotOverlay', 'logging:log')).toBe(true)
    for (const channel of [...APP_CHANNELS.filter((c) => c !== 'logging:log'), ...POPUP]) {
      expect(isChannelAllowedForKind('screenshotOverlay', channel)).toBe(false)
    }
  })

  it('refuses everything to an unknown kind (fail closed)', () => {
    expect(isChannelAllowedForKind('somethingElse' as AppWindowKind, 'logging:log')).toBe(false)
  })
})
