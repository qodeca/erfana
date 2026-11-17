// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Fakes of a tab's page side for the `BrowserTabPage` and `BrowserPages`
 * suites: a page `webContents` whose events are fired by hand, a tab, an
 * outlet that records what goes to the window, and a hang source.
 */
import { EventEmitter } from 'node:events'
import { vi, type Mock } from 'vitest'
import type { WidthPresetId } from '../../../../../shared/browser/widthPresets'
import type { HangProbeEvent } from '../../cdp/browserHangProbe'
import type { PageHangSource, PageTab, TabPageOutlet } from '../BrowserTabPage'

export class FakePageContents extends EventEmitter {
  destroyed = false
  zoom = 1
  findInPage = vi.fn((_text: string, _options: { forward: boolean; findNext: boolean }) => 1)
  stopFindInPage = vi.fn()
  forcefullyCrashRenderer = vi.fn()
  executeJavaScriptInIsolatedWorld = vi.fn(async () => undefined)
  setZoomFactor = vi.fn((factor: number) => {
    this.zoom = factor
  })
  getZoomFactor = (): number => this.zoom
  isDestroyed = (): boolean => this.destroyed
}

export interface FakePageTab extends PageTab {
  readonly contents: FakePageContents
  committedUrl: string | null
  erfanaPage: 'empty' | 'certificate' | 'loadError' | 'crashed' | null
  pending: boolean
  readonly history: Mock<(step: 'reload') => void>
  readonly viewFrame: { widthPreset: WidthPresetId; setPreset: Mock<(preset: WidthPresetId) => void> }
}

let nextTab = 1

export function fakePageTab(projectRoot = '/p', committedUrl: string | null = 'http://app.test/'): FakePageTab {
  const contents = new FakePageContents()
  const tab: FakePageTab = {
    id: `browser-tab-${nextTab++}`,
    projectRoot,
    caseSensitive: true,
    contents,
    committedUrl,
    erfanaPage: null,
    pending: false,
    history: vi.fn<(step: 'reload') => void>(),
    viewFrame: {
      widthPreset: 'full',
      setPreset: vi.fn<(preset: WidthPresetId) => void>((preset) => {
        tab.viewFrame.widthPreset = preset
      })
    },
    hasPendingUserNavigation: () => tab.pending,
    state: () => ({ committedUrl: tab.committedUrl, erfanaPage: tab.erfanaPage })
  }
  return tab
}

export type FakeOutlet = { [K in keyof TabPageOutlet]: Mock<TabPageOutlet[K]> }

export function fakeOutlet(): FakeOutlet {
  return {
    strip: vi.fn<TabPageOutlet['strip']>(),
    findResult: vi.fn<TabPageOutlet['findResult']>(),
    stateChanged: vi.fn<TabPageOutlet['stateChanged']>(),
    endPick: vi.fn<TabPageOutlet['endPick']>()
  }
}

export function fakeHang(): PageHangSource & { fire(event: HangProbeEvent): void; waitHang: Mock<() => void>; listeners: number } {
  const listeners = new Set<(event: HangProbeEvent) => void>()
  return {
    onHang: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    waitHang: vi.fn<() => void>(),
    fire: (event) => {
      for (const listener of listeners) listener(event)
    },
    get listeners() {
      return listeners.size
    }
  }
}
