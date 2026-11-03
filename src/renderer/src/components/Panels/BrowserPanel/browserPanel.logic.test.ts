// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import type { BrowserTabState } from '../../../stores/useBrowserTabStore'
import {
  addressDisplay,
  navGroupDescription,
  pathOf,
  refusedMessage,
  securityBadge,
  shownAddress,
  tabLabel,
  tabTooltip
} from './browserPanel.logic'

const WEB = {
  kind: 'web',
  scheme: null,
  subdomain: 'www.',
  registrableDomain: 'example.test',
  port: null,
  punycode: false
} as const

function state(patch: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    tabId: 'browser-tab-1',
    committedUrl: 'https://www.example.test/a/b?q=1',
    pendingUrl: null,
    origin: WEB,
    title: '',
    canGoBack: false,
    canGoForward: false,
    loading: false,
    zoomPercent: 100,
    widthPreset: 'full',
    security: 'secure',
    inUse: { camera: false, microphone: false, screen: false },
    erfanaPage: null,
    devToolsOpen: false,
    ...patch
  }
}

describe('shownAddress', () => {
  it('prefers the pending address and falls back to the committed one', () => {
    expect(shownAddress(null)).toBeNull()
    expect(shownAddress(state())).toBe('https://www.example.test/a/b?q=1')
    expect(shownAddress(state({ pendingUrl: 'https://next.test/' }))).toBe('https://next.test/')
  })
})

describe('tabLabel', () => {
  it('reads "New browser tab" for no state and the empty tab', () => {
    expect(tabLabel(null)).toBe('New browser tab')
    expect(tabLabel(state({ erfanaPage: 'empty' }))).toBe('New browser tab')
  })

  it('shows the title, else the host without the path', () => {
    expect(tabLabel(state({ title: 'Docs' }))).toBe('Docs')
    expect(tabLabel(state())).toBe('www.example.test')
  })

  it('shows a local file by its name, a non-web address by its scheme', () => {
    expect(
      tabLabel(state({ committedUrl: 'file:///p/site/index%20a.html', origin: { kind: 'file' } }))
    ).toBe('index a.html')
    expect(tabLabel(state({ committedUrl: 'file:///', origin: { kind: 'file' } }))).toBe(
      'Local file'
    )
    expect(tabLabel(state({ committedUrl: 'file://%zz', origin: { kind: 'file' } }))).toBe(
      'Local file'
    )
    expect(tabLabel(state({ origin: { kind: 'nonWeb', scheme: 'mailto' } }))).toBe('mailto:')
    expect(tabLabel(state({ origin: null }))).toBe('New browser tab')
  })
})

describe('tabTooltip', () => {
  it('names the formatted address and the title on its own line', () => {
    expect(tabTooltip(state({ title: 'Docs' }))).toBe('www.example.test/a/b?q=1\nTitle: Docs')
    expect(tabTooltip(state())).toBe('www.example.test/a/b?q=1')
    expect(tabTooltip(null)).toBe('New browser tab')
  })

  it('uses the raw address for a non-web origin', () => {
    expect(tabTooltip(state({ committedUrl: 'file:///p/a.html', origin: { kind: 'file' } }))).toBe(
      'file:///p/a.html'
    )
  })
})

describe('pathOf', () => {
  it.each([
    ['https://a.test/', ''],
    ['https://a.test/x?y#z', '/x?y#z'],
    ['not a url', '']
  ])('%s → %s', (url, path) => {
    expect(pathOf(url)).toBe(path)
  })
})

describe('addressDisplay', () => {
  it('splits a web address, shows other kinds as text, and an empty tab as empty', () => {
    expect(addressDisplay(null)).toEqual({ kind: 'empty' })
    expect(addressDisplay(state({ committedUrl: null }))).toEqual({ kind: 'empty' })
    expect(addressDisplay(state())).toEqual({ kind: 'web', parts: WEB, path: '/a/b?q=1' })
    expect(addressDisplay(state({ origin: { kind: 'nonWeb', scheme: 'about' } }))).toEqual({
      kind: 'text',
      text: 'about:'
    })
    expect(
      addressDisplay(state({ committedUrl: 'file:///a.html', origin: { kind: 'file' } }))
    ).toEqual({
      kind: 'text',
      text: 'file:///a.html'
    })
  })
})

describe('securityBadge', () => {
  it.each([
    ['secure', null],
    ['local', null],
    ['notSecureHttp', 'circle-alert'],
    ['warningUp', 'triangle-alert'],
    ['proceeded', 'triangle-alert'],
    ['subresourceFailed', 'triangle-alert'],
    ['file', 'file']
  ] as const)('%s → %s', (security, icon) => {
    expect(securityBadge(security)?.icon ?? null).toBe(icon)
  })

  it('words a remote http page "Not secure" with the full description', () => {
    expect(securityBadge('notSecureHttp')).toMatchObject({ word: 'Not secure', tone: 'warning' })
    expect(securityBadge('proceeded')?.description).toContain('You chose Proceed anyway.')
  })
})

describe('refusedMessage', () => {
  it('is null for anything but a refusal', () => {
    expect(refusedMessage({ ok: true }, 'x')).toBeNull()
    expect(refusedMessage({ error: 'boom' }, 'x')).toBeNull()
  })

  it.each([
    ['scheme', 'javascript:alert(1)', "Browser tabs can't open javascript: addresses."],
    ['scheme', ':odd', "Browser tabs can't open these addresses."],
    ['scheme', 'C:\\site\\index.html', 'Type it as file:///C:/site/index.html to open it.'],
    ['network-path', '\\\\host\\share', "can't open files on a network share"],
    ['app-entry', 'file:///app/index.html', "can't open Erfana's own files"],
    ['local-file', 'file:///x', "can't open this file"]
  ] as const)('%s for %s', (refused, input, text) => {
    expect(refusedMessage({ refused }, input)).toContain(text)
  })
})

describe('navGroupDescription', () => {
  it.each([
    [false, false, 'No earlier or later page'],
    [false, true, 'No earlier page'],
    [true, false, 'No later page'],
    [true, true, null]
  ])('back %s forward %s → %s', (back, forward, text) => {
    expect(navGroupDescription(back, forward)).toBe(text)
  })
})
