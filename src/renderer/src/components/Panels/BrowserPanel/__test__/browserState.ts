// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** A browser tab state for component tests: a loaded `https` page unless patched. */
import type { BrowserTabState } from '../../../../stores/useBrowserTabStore'

export function browserState(patch: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    tabId: 'browser-tab-1',
    committedUrl: 'https://www.example.test/docs',
    pendingUrl: null,
    origin: {
      kind: 'web',
      scheme: null,
      subdomain: 'www.',
      registrableDomain: 'example.test',
      port: null,
      punycode: false
    },
    title: 'Docs',
    canGoBack: false,
    canGoForward: false,
    loading: false,
    zoomPercent: 100,
    widthPreset: 'full',
    security: 'secure',
    erfanaPage: null,
    devToolsOpen: false,
    ...patch
  }
}
