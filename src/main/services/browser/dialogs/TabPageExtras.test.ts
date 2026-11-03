// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One tab's window open, leave-page prompt and right-click menu, attached
 * together (025-FR-011, 025-FR-057, 025-FR-058).
 */
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock } from '../../../../shared/clock'
import type { StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import type { TabPopupLink } from '../popups/BrowserPopups'
import { TabPageExtras, type ExtrasOutlet } from './TabPageExtras'

class FakeContents extends EventEmitter {
  destroyed = false
  url = 'https://app.test/form.html'
  close = vi.fn()
  setWindowOpenHandler = vi.fn()
  copy = vi.fn()
  paste = vi.fn()
  selectAll = vi.fn()
  copyImageAt = vi.fn()
  readonly navigationHistory = { canGoBack: () => false, canGoForward: () => false }
  getURL(): string {
    return this.url
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
}

function setup(withPopups = true, pickAt?: (tabId: string, at: { x: number; y: number }) => void) {
  const clock = createManualClock(0)
  const contents = new FakeContents()
  const strip: StripEvent[] = []
  const startTracking = vi.fn()
  const popupLink: TabPopupLink = {
    handlerFor: vi.fn(() => ({ handler: () => ({ action: 'deny' as const }), startTracking })),
    answerStrip: vi.fn((id: string) => (id === 'pb' ? ('accepted' as const) : null)),
    newDocument: vi.fn(),
    detach: vi.fn()
  }
  const attachTab = vi.fn(() => popupLink)
  const tab = { id: 'browser-tab-1', projectRoot: '/p', contents: contents as unknown as WebContents, history: vi.fn(), devTools: vi.fn() }
  const outlet: ExtrasOutlet = {
    strip: (e) => strip.push(e),
    contextMenu: vi.fn(),
    openTab: vi.fn(() => true),
    openLink: vi.fn(),
    forceClose: vi.fn(),
    blocked: () => false
  }
  const menuActions = { openInSystemBrowser: vi.fn(), writeClipboardText: vi.fn(), ...(pickAt ? { pickAt } : {}) }
  const extras = new TabPageExtras(tab, outlet, {
    clock,
    resolveDomain: (h) => h,
    ...(withPopups ? { popups: { attachTab } } : {}),
    menuActions,
    newRowId: () => 'row'
  })
  return { clock, contents, strip, startTracking, popupLink, attachTab, tab, outlet, extras, menuActions }
}

describe('TabPageExtras', () => {
  it('replaces the deny-all handler with the popup policy and starts tracking presses after the routers', () => {
    const { attachTab, contents, popupLink, startTracking, tab } = setup()
    expect(attachTab).toHaveBeenCalledWith(tab, expect.objectContaining({ openTab: expect.any(Function) }))
    expect(popupLink.handlerFor).toHaveBeenCalledWith(contents)
    expect(contents.setWindowOpenHandler).toHaveBeenCalledTimes(1)
    expect(startTracking).toHaveBeenCalled()
    contents.emit('did-navigate')
    expect(popupLink.newDocument).toHaveBeenCalled()
  })

  it('without the popups part leaves the deny-all handler in place', () => {
    const { contents, extras } = setup(false)
    expect(contents.setWindowOpenHandler).not.toHaveBeenCalled()
    expect(extras.answerStrip('pb', 'allowOnce')).toBeNull()
    extras.detach()
  })

  it('025-AC-075 asks to stay on a close by the user, with the page origin; answers reach the right row', () => {
    const { clock, contents, extras, outlet, strip } = setup()
    extras.closeByUser()
    expect(contents.close).toHaveBeenCalledWith({ waitForBeforeUnload: true })
    contents.emit('will-prevent-unload', { preventDefault: vi.fn() })
    expect(strip[0]).toMatchObject({ op: 'add', row: { kind: 'leavePage', requester: { origin: { kind: 'web' }, inside: null } } })
    expect(extras.answerStrip('pb', 'allowOnce')).toBe('accepted')
    clock.advance(500)
    expect(extras.answerStrip('row', 'leave')).toBe('accepted')
    expect(outlet.forceClose).toHaveBeenCalled()
  })

  it('arms the prompt for a load the user started, with no requester on a page without an origin', () => {
    const { contents, extras, strip } = setup()
    contents.url = 'about:blank'
    const repeat = vi.fn()
    extras.arm(repeat)
    contents.emit('will-prevent-unload', { preventDefault: vi.fn() })
    expect(strip[0]).toMatchObject({ row: { kind: 'leavePage' } })
    expect((strip[0] as { row: Record<string, unknown> }).row).not.toHaveProperty('requester')
  })

  it('routes the right-click menu: Open link in new tab opens a contextMenuLink tab; history and Inspect reach the tab', () => {
    const { contents, extras, outlet, tab } = setup()
    const params = { x: 1, y: 2, linkURL: 'https://app.test/a', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false }
    contents.emit('context-menu', {}, params)
    const menu = (outlet.contextMenu as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { menuId: string }
    expect(extras.contextAction(menu.menuId, 'openLinkInNewTab')).toBe('accepted')
    expect(outlet.openLink).toHaveBeenCalledWith('https://app.test/a')
    contents.emit('context-menu', {}, params)
    expect(extras.contextAction('row', 'reload')).toBe('accepted')
    expect(tab.history).toHaveBeenCalledWith('reload')
    contents.emit('context-menu', {}, params)
    extras.contextAction('row', 'inspect')
    expect(tab.devTools).toHaveBeenCalledWith({ x: 1, y: 2 })
  })

  it('detach takes everything away; a destroyed page is left alone', () => {
    const { contents, extras, popupLink } = setup()
    extras.detach()
    expect(popupLink.detach).toHaveBeenCalled()
    expect(contents.listenerCount('did-navigate')).toBe(0)
    const other = setup()
    other.contents.destroyed = true
    other.extras.detach()
    expect(other.contents.listenerCount('did-navigate')).toBeGreaterThan(0)
  })

  it('Open link in system browser and Copy link address reach the shared menu actions with the link', () => {
    const { contents, extras, outlet, menuActions } = setup()
    const params = { x: 1, y: 2, linkURL: 'https://app.test/a', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false }
    const menuOf = (i: number): string =>
      ((outlet.contextMenu as ReturnType<typeof vi.fn>).mock.calls[i]![0] as { menuId: string }).menuId
    contents.emit('context-menu', {}, params)
    expect(extras.contextAction(menuOf(0), 'openLinkInSystemBrowser')).toBe('accepted')
    contents.emit('context-menu', {}, params)
    expect(extras.contextAction(menuOf(1), 'copyLinkAddress')).toBe('accepted')
    expect(menuActions.openInSystemBrowser).toHaveBeenCalledWith('https://app.test/a')
    expect(menuActions.writeClipboardText).toHaveBeenCalledWith('https://app.test/a')
  })

  it('S-17 Copy tells the shared menu actions before the page copies, then copies', async () => {
    const { contents, extras, outlet, menuActions } = setup()
    const order: string[] = []
    const copied = vi.fn(async () => {
      order.push('copied')
    })
    Object.assign(menuActions, { copied })
    contents.copy.mockImplementation(() => order.push('copy'))
    const params = { x: 1, y: 2, linkURL: '', srcURL: '', mediaType: 'none', selectionText: 'rm -rf ~', isEditable: false }
    contents.emit('context-menu', {}, params)
    const menu = (outlet.contextMenu as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { menuId: string; items: string[] }
    expect(menu.items).toContain('copy')
    expect(extras.contextAction(menu.menuId, 'copy')).toBe('accepted')
    await vi.waitFor(() => expect(order).toEqual(['copied', 'copy']))
  })

  it('Pick this element is offered only when pick is wired, and picks in this tab at the menu point', () => {
    const params = { x: 7, y: 9, linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false }
    const plain = setup()
    plain.contents.emit('context-menu', {}, params)
    const plainMenu = (plain.outlet.contextMenu as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { items: string[] }
    expect(plainMenu.items).not.toContain('pickThisElement')

    const pickAt = vi.fn()
    const wired = setup(true, pickAt)
    wired.contents.emit('context-menu', {}, params)
    const menu = (wired.outlet.contextMenu as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { menuId: string; items: string[] }
    expect(menu.items).toContain('pickThisElement')
    expect(wired.extras.contextAction(menu.menuId, 'pickThisElement')).toBe('accepted')
    expect(pickAt).toHaveBeenCalledWith('browser-tab-1', { x: 7, y: 9 })
  })
})
