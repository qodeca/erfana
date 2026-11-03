// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One popup window, main side (025-FR-011 rule 2, ADR 0011 decision 9,
 * S-7, S-22): host of kind `browserPopup`, content size and the strip, the
 * title from the committed address, the page source's navigation rules, and
 * every way it closes.
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { BrowserPopupWindow, type BrowserPopupWindowDeps, type PopupHost, type Rect } from './BrowserPopupWindow'

const APP = { rendererEntry: 'file:///app/out/renderer/index.html', resourcesDir: '/app/resources', devServerOrigin: null }

class FakePage extends EventEmitter {
  readonly id = 77
  destroyed = false
  url = ''
  windowOpenHandler: unknown = null
  close = vi.fn(() => {
    this.destroyed = true
    this.emit('destroyed')
  })
  setWindowOpenHandler = vi.fn((h: unknown) => (this.windowOpenHandler = h))
  getURL(): string {
    return this.url
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
}

class FakeHost extends EventEmitter {
  readonly id = 9
  destroyed = false
  title = ''
  content: [number, number]
  frame = { width: 0, height: 28 }
  shown = false
  centred = 0
  readonly views: unknown[] = []
  readonly webContents = { id: 501, isDestroyed: () => this.destroyed, once: vi.fn() }
  readonly contentView = { addChildView: (v: unknown) => this.views.push(v) }
  constructor(width: number, height: number) {
    super()
    this.content = [width, height]
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  setTitle(title: string): void {
    this.title = title
  }
  setContentSize(width: number, height: number): void {
    this.content = [width, height]
  }
  getContentSize(): number[] {
    return [...this.content]
  }
  getBounds(): Rect {
    return { x: 0, y: 0, width: this.content[0] + this.frame.width, height: this.content[1] + this.frame.height }
  }
  show(): void {
    this.shown = true
  }
  center(): void {
    this.centred += 1
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('closed')
  }
}

function setup(overrides: Partial<BrowserPopupWindowDeps> = {}) {
  const page = new FakePage()
  let host: FakeHost | null = null
  const viewBounds: Rect[] = []
  const cdp = { detach: vi.fn() }
  const deps: BrowserPopupWindowDeps = {
    openerTabId: 'browser-tab-1',
    openerUrl: 'http://staging.test:8080/popups.html',
    contents: page,
    features: { width: 500, height: 600 },
    workArea: () => ({ width: 1440, height: 900 }),
    stripHeight: 40,
    originMinWidth: 0,
    resolveDomain: (h) => h,
    appAddresses: () => APP,
    isLocalAddress: (url) => url.startsWith('http://127.0.0.1:9999/'),
    createHost: vi.fn(({ contentSize, title }) => {
      host = new FakeHost(contentSize.width, contentSize.height)
      host.title = title
      return host as unknown as PopupHost
    }),
    createView: vi.fn((contents) => ({ webContents: contents, setBounds: (b: Rect) => viewBounds.push(b) })),
    registerHost: vi.fn(),
    windowOpenHandler: vi.fn(() => 'popup-handler'),
    attachCdp: vi.fn(() => cdp),
    onClosed: vi.fn(),
    ...overrides
  }
  const popup = new BrowserPopupWindow(deps)
  return { page, host: host as unknown as FakeHost, viewBounds, cdp, deps, popup }
}

const preventable = () => ({ preventDefault: vi.fn() })

describe('BrowserPopupWindow', () => {
  it('025-AC-011 opens a host of kind browserPopup that grows by the strip, the page view below the strip', () => {
    const { deps, host, page, popup, viewBounds } = setup()
    expect(deps.createHost).toHaveBeenCalledWith({ contentSize: { width: 500, height: 640 }, title: 'about:blank – opened by http://staging.test:8080' })
    expect(deps.registerHost).toHaveBeenCalledWith(host)
    expect(deps.createView).toHaveBeenCalledWith(page)
    expect(viewBounds.at(-1)).toEqual({ x: 0, y: 40, width: 500, height: 600 })
    expect(popup.contentSize()).toEqual({ width: 500, height: 600 })
    expect(popup.workArea).toEqual({ width: 1440, height: 900 })
    expect(host.shown).toBe(true)
    expect(page.windowOpenHandler).toBe('popup-handler')
    expect(deps.attachCdp).toHaveBeenCalledWith(page)
    expect(page.listenerCount('select-bluetooth-device')).toBe(1)
  })

  it('025-AC-011 the title comes from the committed host, never the page title', () => {
    const { host, page, popup } = setup()
    page.emit('did-navigate', {}, 'http://staging.test:8080/popup-child.html')
    expect(host.title).toBe('staging.test – Erfana')
    expect(popup.committed).toBe('http://staging.test:8080/popup-child.html')
    const titleEvent = preventable()
    host.emit('page-title-updated', titleEvent, 'Phishing title')
    expect(titleEvent.preventDefault).toHaveBeenCalled()
    page.emit('did-navigate', {}, '')
    expect(popup.committed).toBeNull()
  })

  it('025-AC-011 shrinks a window whose frame passes the work area, and centres it', () => {
    const { host, popup } = setup({ features: { width: 99_999, height: 99_999 }, stripHeight: 0 })
    expect(host.getBounds().height).toBeLessThanOrEqual(900)
    expect(host.getBounds().width).toBeLessThanOrEqual(1440)
    expect(host.centred).toBe(1)
    expect(popup.contentSize().height).toBe(872)
  })

  it('refuses a page resizeTo or moveTo and re-clamps only the size (ADR 0011 decision 9)', () => {
    const { host, page, viewBounds } = setup()
    const event = preventable()
    page.emit('content-bounds-updated', event, { x: -10_000, y: -10_000, width: 99_999, height: 200 })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(host.getContentSize()).toEqual([1440, 240])
    expect(viewBounds.at(-1)).toEqual({ x: 0, y: 40, width: 1440, height: 200 })
    host.emit('resize')
    expect(viewBounds.at(-1)).toEqual({ x: 0, y: 40, width: 1440, height: 200 })
  })

  it('applies the page source to the popup, its frames and redirects; a served local folder is never reached (S-7)', () => {
    const { page } = setup()
    const allowed = preventable()
    page.emit('will-navigate', allowed, 'https://staging.test/next')
    expect(allowed.preventDefault).not.toHaveBeenCalled()
    for (const url of ['javascript:alert(1)', 'http://127.0.0.1:9999/secret.html', APP.rendererEntry]) {
      const refused = preventable()
      page.emit('will-navigate', refused, url)
      expect(refused.preventDefault).toHaveBeenCalled()
    }
    const frame = { ...preventable(), url: 'chrome://gpu', isMainFrame: false }
    page.emit('will-frame-navigate', frame)
    expect(frame.preventDefault).toHaveBeenCalled()
    const top = { ...preventable(), url: 'chrome://gpu', isMainFrame: true }
    page.emit('will-frame-navigate', top)
    expect(top.preventDefault).not.toHaveBeenCalled()
    const redirect = { ...preventable(), url: 'file:///etc/passwd', isMainFrame: true }
    page.emit('will-redirect', redirect)
    expect(redirect.preventDefault).toHaveBeenCalled()
    const frameRedirect = { ...preventable(), url: 'about:blank', isMainFrame: false }
    page.emit('will-redirect', frameRedirect)
    expect(frameRedirect.preventDefault).not.toHaveBeenCalled()
    // A blob: frame of the committed page's own origin.
    page.emit('did-navigate', {}, 'https://staging.test/page')
    const blob = { ...preventable(), url: 'blob:https://staging.test/1234', isMainFrame: false }
    page.emit('will-frame-navigate', blob)
    expect(blob.preventDefault).not.toHaveBeenCalled()
    const navigateNoUrl = { ...preventable(), url: 'https://staging.test/x' }
    page.emit('will-navigate', navigateNoUrl)
    expect(navigateNoUrl.preventDefault).not.toHaveBeenCalled()
  })

  it('closes for the opener tab without a leave-page prompt, once, and tells its owner', () => {
    const { cdp, deps, host, page, popup } = setup()
    popup.close()
    popup.close()
    expect(cdp.detach).toHaveBeenCalledTimes(1)
    expect(page.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
    expect(host.isDestroyed()).toBe(true)
    expect(deps.onClosed).toHaveBeenCalledTimes(1)
    expect(popup.contentSize()).toEqual({ width: 0, height: 0 })
  })

  it('closes when its page closes itself, or when the user closes the window', () => {
    const first = setup({ attachCdp: undefined })
    first.page.destroyed = true
    first.page.emit('destroyed')
    expect(first.host.isDestroyed()).toBe(true)
    expect(first.page.close).not.toHaveBeenCalled()
    expect(first.deps.onClosed).toHaveBeenCalledTimes(1)

    const second = setup()
    second.host.destroy()
    expect(second.page.close).toHaveBeenCalled()
    expect(second.deps.onClosed).toHaveBeenCalledTimes(1)
    // A late event on a gone host is harmless.
    second.page.emit('did-navigate', {}, 'http://staging.test/late')
    second.page.emit('content-bounds-updated', preventable(), { x: 0, y: 0, width: 400, height: 400 })
  })
})
