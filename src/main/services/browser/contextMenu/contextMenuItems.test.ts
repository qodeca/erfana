// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page right-click menu's items (025-FR-057): which show, in which order.
 */
import { describe, expect, it } from 'vitest'
import { contextMenuItems, isWebAddress, type MenuParams } from './contextMenuItems'

const PLAIN: MenuParams = { linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false }
const NO_HISTORY = { canGoBack: false, canGoForward: false, canPick: false }

describe('contextMenuItems', () => {
  it('on a plain page: Reload, Select all and Inspect; Back and Forward only with history that way', () => {
    expect(contextMenuItems(PLAIN, NO_HISTORY)).toEqual(['reload', 'selectAll', 'inspect'])
    expect(contextMenuItems(PLAIN, { ...NO_HISTORY, canGoBack: true, canGoForward: true })).toEqual([
      'back',
      'forward',
      'reload',
      'selectAll',
      'inspect'
    ])
  })

  it('Copy only with a text selection, Paste only in an editable field', () => {
    expect(contextMenuItems({ ...PLAIN, selectionText: '  ' }, NO_HISTORY)).not.toContain('copy')
    expect(contextMenuItems({ ...PLAIN, selectionText: 'words' }, NO_HISTORY)).toEqual(['reload', 'copy', 'selectAll', 'inspect'])
    expect(contextMenuItems({ ...PLAIN, isEditable: true }, NO_HISTORY)).toEqual(['reload', 'paste', 'selectAll', 'inspect'])
  })

  it('025-AC-074 on a link: open in a new tab (web links only), in the system browser, copy its address', () => {
    expect(contextMenuItems({ ...PLAIN, linkURL: 'https://app.test/a' }, NO_HISTORY)).toEqual([
      'reload',
      'selectAll',
      'openLinkInNewTab',
      'openLinkInSystemBrowser',
      'copyLinkAddress',
      'inspect'
    ])
    expect(contextMenuItems({ ...PLAIN, linkURL: 'mailto:a@b.test' }, NO_HISTORY)).toEqual([
      'reload',
      'selectAll',
      'openLinkInSystemBrowser',
      'copyLinkAddress',
      'inspect'
    ])
  })

  it('025-AC-074 on an image: copy it, and open it in a new tab when it is a web address', () => {
    expect(contextMenuItems({ ...PLAIN, mediaType: 'image', srcURL: 'http://app.test/i.png' }, NO_HISTORY)).toEqual([
      'reload',
      'selectAll',
      'copyImage',
      'openImageInNewTab',
      'inspect'
    ])
    expect(contextMenuItems({ ...PLAIN, mediaType: 'image', srcURL: 'data:image/png;base64,AA' }, NO_HISTORY)).toEqual([
      'reload',
      'selectAll',
      'copyImage',
      'inspect'
    ])
    expect(contextMenuItems({ ...PLAIN, mediaType: 'image', srcURL: '' }, NO_HISTORY)).not.toContain('copyImage')
    expect(contextMenuItems({ ...PLAIN, mediaType: 'video', srcURL: 'http://app.test/v.mp4' }, NO_HISTORY)).not.toContain('copyImage')
  })

  it('Pick this element only where pick is wired, just before Inspect', () => {
    expect(contextMenuItems(PLAIN, { ...NO_HISTORY, canPick: true })).toEqual(['reload', 'selectAll', 'pickThisElement', 'inspect'])
  })
})

describe('isWebAddress', () => {
  it('is true for http and https only', () => {
    expect(isWebAddress('http://a.test/')).toBe(true)
    expect(isWebAddress('https://a.test/')).toBe(true)
    expect(isWebAddress('javascript:alert(1)')).toBe(false)
    expect(isWebAddress('file:///etc/passwd')).toBe(false)
    expect(isWebAddress('not a url')).toBe(false)
  })
})
