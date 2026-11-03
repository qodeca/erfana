// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { canZoom, contextActionShortcut, findCount, linkHeader, pageMenuEntries, widthPresetItems } from './browserMenus.logic'

describe('browserMenus.logic', () => {
  it('hints the page menu keys per platform; Pick this element has none', () => {
    expect(contextActionShortcut('back', true)).toBe('⌘[')
    expect(contextActionShortcut('back', false)).toBe('Alt+←')
    expect(contextActionShortcut('forward', false)).toBe('Alt+→')
    expect(contextActionShortcut('forward', true)).toBe('⌘]')
    expect(contextActionShortcut('reload', false)).toBe('Ctrl+R')
    expect(contextActionShortcut('copy', true)).toBe('⌘C')
    expect(contextActionShortcut('paste', true)).toBe('⌘V')
    expect(contextActionShortcut('selectAll', false)).toBe('Ctrl+A')
    expect(contextActionShortcut('inspect', true)).toBe('F12')
    expect(contextActionShortcut('pickThisElement', true)).toBeUndefined()
    expect(contextActionShortcut('openLinkInNewTab', true)).toBeUndefined()
  })

  it('puts a separator between groups', () => {
    expect(pageMenuEntries(['back', 'forward', 'reload', 'copy', 'openLinkInNewTab', 'inspect'])).toEqual([
      { separator: false, action: 'back' },
      { separator: false, action: 'forward' },
      { separator: false, action: 'reload' },
      { separator: true },
      { separator: false, action: 'copy' },
      { separator: true },
      { separator: false, action: 'openLinkInNewTab' },
      { separator: true },
      { separator: false, action: 'inspect' }
    ])
    expect(pageMenuEntries([])).toEqual([])
  })

  it('names the link host, a local file and a non-web link', () => {
    expect(linkHeader(null)).toBeUndefined()
    expect(linkHeader({ kind: 'web', scheme: null, subdomain: 'www.', registrableDomain: 'a.test', port: null, punycode: false })).toBe('www.a.test')
    expect(linkHeader({ kind: 'file' })).toBe('Local file')
    expect(linkHeader({ kind: 'nonWeb', scheme: 'mailto' })).toBe('mailto: link – opens your email app')
    expect(linkHeader({ kind: 'nonWeb', scheme: 'zoommtg' })).toBe('zoommtg: link – opens another app')
  })

  it('lists Full width first, with the reason line on Phone and Tablet', () => {
    const items = widthPresetItems()
    expect(items.map(i => i.id)).toEqual(['full', 'phone', 'tablet'])
    expect(items[0]?.reason).toBeUndefined()
    expect(items[1]?.reason).toBe('Width only – touch and mobile mode are in DevTools')
  })

  it('knows the zoom ends and writes the find count', () => {
    expect(canZoom(500, 'in')).toBe(false)
    expect(canZoom(25, 'out')).toBe(false)
    expect(canZoom(100, 'in')).toBe(true)
    expect(findCount(undefined)).toBe('')
    expect(findCount({ active: 2, total: 3 })).toBe('2 of 3')
  })
})
