// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Fakes of a browser page view, its `webContents` and its window, for the
 * BrowserTab and BrowserTabService suites. Events are fired by hand with
 * `emit`, as Electron would.
 */
import { EventEmitter } from 'node:events'
import { vi } from 'vitest'
import type { WebContentsView } from 'electron'
import type { TabHost } from '../BrowserTab'

export interface FakeHistoryEntry {
  url: string
}

export class FakeContents extends EventEmitter {
  static nextId = 5000
  readonly id = FakeContents.nextId++
  destroyed = false
  loading = false
  devToolsOpen = false
  url = ''
  entries: FakeHistoryEntry[] = []
  index = -1
  windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null

  constructor(readonly session: object = {}) {
    super()
  }

  readonly navigationHistory = {
    canGoBack: (): boolean => this.index > 0,
    canGoForward: (): boolean => this.index < this.entries.length - 1,
    getActiveIndex: (): number => this.index,
    getEntryAtIndex: (i: number): FakeHistoryEntry | undefined => this.entries[i],
    goBack: vi.fn(),
    goForward: vi.fn()
  }

  setWindowOpenHandler = vi.fn((handler: (details: { url: string }) => { action: string }) => {
    this.windowOpenHandler = handler
  })
  loadURL = vi.fn(async (_url: string): Promise<void> => undefined)
  stop = vi.fn()
  reload = vi.fn()
  focus = vi.fn()
  getURL = (): string => this.url
  isLoading = (): boolean => this.loading
  isDestroyed = (): boolean => this.destroyed
  isDevToolsOpened = (): boolean => this.devToolsOpen
  openDevTools = vi.fn(() => {
    this.devToolsOpen = true
  })
  closeDevTools = vi.fn(() => {
    this.devToolsOpen = false
  })
  inspectElement = vi.fn()
  close = vi.fn(() => this.destroy())

  /** Mark destroyed and fire 'destroyed', as Electron does. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('destroyed')
  }

  /** Commit `url` as a new history entry. */
  commit(url: string): void {
    this.entries = [...this.entries.slice(0, this.index + 1), { url }]
    this.index = this.entries.length - 1
    this.url = url
    this.emit('did-navigate', {}, url)
  }
}

export interface FakeView {
  view: WebContentsView
  contents: FakeContents
  setBounds: ReturnType<typeof vi.fn>
}

export function fakeView(session: object = {}): FakeView {
  const contents = new FakeContents(session)
  const setBounds = vi.fn()
  return { view: { webContents: contents, setBounds } as unknown as WebContentsView, contents, setBounds }
}

export interface FakeHost {
  host: TabHost
  addChildView: ReturnType<typeof vi.fn>
  removeChildView: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  destroy(): void
  zoom: number
}

let nextWindowId = 1

export function fakeHost(): FakeHost {
  let destroyed = false
  const fake = {
    zoom: 1,
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
    send: vi.fn(),
    destroy: () => {
      destroyed = true
    }
  } as FakeHost
  fake.host = {
    id: nextWindowId++,
    isDestroyed: () => destroyed,
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    contentView: { addChildView: fake.addChildView, removeChildView: fake.removeChildView },
    webContents: { getZoomFactor: () => fake.zoom, send: fake.send, isDestroyed: () => destroyed }
  } as unknown as TabHost
  return fake
}
