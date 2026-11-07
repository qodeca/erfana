// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page right-click menu, main side (025-FR-057): the event to the owning
 * window, one live menu that takes one offered action, and what each action does.
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { ContextMenuEventSchema } from '../../../../shared/ipc/browser-tab-schema'
import { TabContextMenu, type ContextMenuEvent, type ContextMenuParams } from './TabContextMenu'

class FakeContents extends EventEmitter {
  destroyed = false
  back = false
  forward = false
  copy = vi.fn()
  paste = vi.fn()
  selectAll = vi.fn()
  copyImageAt = vi.fn()
  readonly navigationHistory = { canGoBack: () => this.back, canGoForward: () => this.forward }
  isDestroyed(): boolean {
    return this.destroyed
  }
}

const resolveDomain = (host: string): string => host
const PARAMS: ContextMenuParams = { x: 10.6, y: 20.2, linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false }

function setup(options: { blocked?: boolean; pick?: boolean } = {}) {
  const contents = new FakeContents()
  const events: ContextMenuEvent[] = []
  let n = 0
  const actions = {
    history: vi.fn(),
    inspect: vi.fn(),
    openInNewTab: vi.fn(),
    openInSystemBrowser: vi.fn(),
    writeClipboardText: vi.fn(),
    copied: vi.fn(),
    ...(options.pick ? { pickAt: vi.fn() } : {})
  }
  const menu = new TabContextMenu({
    tabId: 'browser-tab-1',
    contents,
    actions,
    resolveDomain,
    blocked: () => options.blocked === true,
    emit: (e) => events.push(e),
    newId: () => `m${++n}`
  })
  const open = (params: Partial<ContextMenuParams> = {}): ContextMenuEvent => {
    contents.emit('context-menu', {}, { ...PARAMS, ...params })
    return events.at(-1)!
  }
  return { contents, events, actions, menu, open }
}

describe('TabContextMenu', () => {
  it('025-AC-074 sends the menu for a link to the owning window, with its origin and point', () => {
    const { open } = setup()
    const event = open({ linkURL: 'https://docs.app.test/a' })
    expect(event).toEqual({
      tabId: 'browser-tab-1',
      menuId: 'm1',
      items: ['reload', 'selectAll', 'openLinkInNewTab', 'openLinkInSystemBrowser', 'copyLinkAddress', 'inspect'],
      linkOrigin: expect.objectContaining({ kind: 'web' }),
      at: { x: 10.6, y: 20.2 }
    })
    expect(ContextMenuEventSchema.safeParse(event).success).toBe(true)
    expect(open().linkOrigin).toBeNull()
  })

  it('sends nothing in pick mode (025-FR-025)', () => {
    const { events, open } = setup({ blocked: true })
    open()
    expect(events).toEqual([])
  })

  it('offers Back, Forward and Pick this element when they apply', () => {
    const { contents, open } = setup({ pick: true })
    contents.back = true
    contents.forward = true
    expect(open().items).toEqual(['back', 'forward', 'reload', 'selectAll', 'pickThisElement', 'inspect'])
  })

  it('takes one offered action per menu, only on the newest menu, and none after a new document', () => {
    const { actions, contents, menu, open } = setup()
    const first = open({ linkURL: 'https://app.test/a' })
    const second = open({ linkURL: 'https://app.test/b' })
    expect(menu.act(first.menuId, 'openLinkInNewTab')).toBe('unknown')
    expect(menu.act(second.menuId, 'copyImage')).toBe('invalid')
    expect(menu.act(second.menuId, 'openLinkInNewTab')).toBe('unknown')
    const third = open({ linkURL: 'https://app.test/c' })
    expect(menu.act(third.menuId, 'openLinkInNewTab')).toBe('accepted')
    expect(actions.openInNewTab).toHaveBeenCalledExactlyOnceWith('https://app.test/c')
    expect(menu.act(third.menuId, 'openLinkInNewTab')).toBe('unknown')
    const fourth = open()
    contents.emit('did-navigate')
    expect(menu.act(fourth.menuId, 'reload')).toBe('unknown')
  })

  it('025-AC-074 performs every item on the page or through the right path', () => {
    const { actions, contents, menu, open } = setup({ pick: true })
    contents.back = true
    contents.forward = true
    const act = (params: Partial<ContextMenuParams>, action: Parameters<TabContextMenu['act']>[1]) => {
      expect(menu.act(open(params).menuId, action)).toBe('accepted')
    }
    act({}, 'back')
    act({}, 'forward')
    act({}, 'reload')
    expect(actions.history.mock.calls).toEqual([['back'], ['forward'], ['reload']])
    act({ selectionText: 'words' }, 'copy')
    expect(contents.copy).toHaveBeenCalled()
    // S-17: the page's copy is recorded before it runs, so the terminal's paste guard knows the text is the page's
    expect(actions.copied).toHaveBeenCalled()
    expect(actions.copied.mock.invocationCallOrder[0]).toBeLessThan(contents.copy.mock.invocationCallOrder[0])
    act({ isEditable: true }, 'paste')
    expect(contents.paste).toHaveBeenCalled()
    act({}, 'selectAll')
    expect(contents.selectAll).toHaveBeenCalled()
    act({ linkURL: 'mailto:a@b.test' }, 'openLinkInSystemBrowser')
    expect(actions.openInSystemBrowser).toHaveBeenCalledWith('mailto:a@b.test')
    act({ linkURL: 'https://app.test/x' }, 'copyLinkAddress')
    expect(actions.writeClipboardText).toHaveBeenCalledWith('https://app.test/x')
    act({ mediaType: 'image', srcURL: 'https://app.test/i.png' }, 'copyImage')
    expect(contents.copyImageAt).toHaveBeenCalledWith(11, 20)
    act({ mediaType: 'image', srcURL: 'https://app.test/i.png' }, 'openImageInNewTab')
    expect(actions.openInNewTab).toHaveBeenCalledWith('https://app.test/i.png')
    act({}, 'pickThisElement')
    expect(actions.pickAt).toHaveBeenCalledWith({ x: 10.6, y: 20.2 })
    act({}, 'inspect')
    expect(actions.inspect).toHaveBeenCalledWith({ x: 10.6, y: 20.2 })
  })

  it('a failing send is logged, and detach stops listening (a destroyed page is left alone)', () => {
    const contents = new FakeContents()
    const menu = new TabContextMenu({
      tabId: 'browser-tab-1',
      contents,
      actions: { history: vi.fn(), inspect: vi.fn(), openInNewTab: vi.fn(), openInSystemBrowser: vi.fn(), writeClipboardText: vi.fn() },
      resolveDomain,
      blocked: () => false,
      emit: () => {
        throw new Error('window gone')
      }
    })
    expect(() => contents.emit('context-menu', {}, PARAMS)).not.toThrow()
    menu.detach()
    expect(contents.listenerCount('context-menu')).toBe(0)
    const gone = setup()
    gone.contents.destroyed = true
    gone.menu.detach()
    expect(gone.contents.listenerCount('context-menu')).toBe(1)
  })

  it('S-17 holds a page-menu Copy until the clipboard before-state is read', async () => {
    const { actions, contents, menu, open } = setup()
    let release: () => void = () => undefined
    actions.copied.mockReturnValueOnce(new Promise<void>((resolve) => (release = resolve)))
    expect(menu.act(open({ selectionText: 'words' }).menuId, 'copy')).toBe('accepted')
    await Promise.resolve()
    expect(contents.copy).not.toHaveBeenCalled()
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(contents.copy).toHaveBeenCalledTimes(1)
  })

  it('S-17 still copies when reading the clipboard before-state fails', async () => {
    const { actions, contents, menu, open } = setup()
    actions.copied.mockReturnValueOnce(Promise.reject(new Error('clipboard')))
    expect(menu.act(open({ selectionText: 'words' }).menuId, 'copy')).toBe('accepted')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(contents.copy).toHaveBeenCalledTimes(1)
  })
})
