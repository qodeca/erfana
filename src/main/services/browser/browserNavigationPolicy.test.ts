// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** Navigation sources and their schemes (spec 025, 025-FR-005, § 3.4, S2). */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { NavigationSourceSchema } from '../../../shared/ipc/browser-tab-schema'
import {
  checkNavigation,
  isAppAddress,
  isUserStarted,
  securityStateOf,
  type AppAddresses
} from './browserNavigationPolicy'

const RESOURCES = join('/', 'Applications', 'Erfana.app', 'Contents', 'Resources')
const ENTRY = pathToFileURL(join(RESOURCES, 'app.asar', 'out', 'renderer', 'index.html')).href
const APP: AppAddresses = { rendererEntry: ENTRY, resourcesDir: RESOURCES, devServerOrigin: null }
const DEV: AppAddresses = { ...APP, devServerOrigin: 'http://localhost:5173' }
const USER_SOURCES = NavigationSourceSchema.options.filter((s) => s !== 'page' && s !== 'previewOpen')

describe('isUserStarted', () => {
  it('is true for every source except page', () => {
    for (const source of NavigationSourceSchema.options) expect(isUserStarted(source)).toBe(source !== 'page')
  })
})

describe('isAppAddress (025-FR-005 rule 3)', () => {
  it('matches the renderer entry with any hash or query and in another letter case', () => {
    expect(isAppAddress(ENTRY, APP)).toBe(true)
    expect(isAppAddress(`${ENTRY}#/overlay?x=1`, APP)).toBe(true)
    expect(isAppAddress(`${ENTRY}?q`, APP)).toBe(true)
    expect(isAppAddress(ENTRY.toUpperCase().replace('FILE:', 'file:'), APP)).toBe(true)
  })

  it('matches anything under the resources folder, not a sibling with the same prefix', () => {
    expect(isAppAddress(pathToFileURL(join(RESOURCES, 'icon.png')).href, APP)).toBe(true)
    expect(isAppAddress(pathToFileURL(`${RESOURCES}-other/x.html`).href, APP)).toBe(false)
  })

  it('matches the dev-server origin only when there is one', () => {
    expect(isAppAddress('http://localhost:5173/src/main.tsx', DEV)).toBe(true)
    expect(isAppAddress('http://localhost:5173/', APP)).toBe(false)
    expect(isAppAddress('http://localhost:5174/', DEV)).toBe(false)
  })

  it('is false for an unparsable address', () => {
    expect(isAppAddress('not a url', DEV)).toBe(false)
  })
})

describe('checkNavigation', () => {
  it('lets every user source load http and https in the main frame', () => {
    for (const source of USER_SOURCES) {
      expect(checkNavigation('https://example.com/', source, 'main', APP)).toEqual({ allowed: true })
      expect(checkNavigation('http://localhost:3000/', source, 'main', APP)).toEqual({ allowed: true })
    }
  })

  it.each(['javascript:alert(1)', 'chrome://settings', 'devtools://devtools/x', 'data:text/html,x', 'about:blank', 'blob:https://a.test/u', 'erfana-local://x/y', 'vscode://file/x', 'mailto:a@b.c'])(
    'refuses %s for a user source and for the page main frame',
    (url) => {
      expect(checkNavigation(url, 'address', 'main', APP)).toEqual({ allowed: false, reason: 'scheme' })
      expect(checkNavigation(url, 'page', 'main', APP)).toEqual({ allowed: false, reason: 'scheme' })
    }
  )

  it('refuses the app entry and the dev-server origin before anything else (025-AC-068)', () => {
    for (const source of NavigationSourceSchema.options) {
      expect(checkNavigation(ENTRY, source, 'main', DEV)).toEqual({ allowed: false, reason: 'app-entry' })
      expect(checkNavigation('http://localhost:5173/', source, 'main', DEV)).toEqual({ allowed: false, reason: 'app-entry' })
      expect(checkNavigation('http://localhost:5173/', source, 'frame', DEV)).toEqual({ allowed: false, reason: 'app-entry' })
    }
  })

  it('refuses local files until confinement lands, and network paths always', () => {
    expect(checkNavigation('file:///Users/me/site/index.html', 'address', 'main', APP)).toEqual({ allowed: false, reason: 'local-file' })
    expect(checkNavigation('file:///Users/me/site/index.html', 'page', 'frame', APP)).toEqual({ allowed: false, reason: 'local-file' })
    expect(checkNavigation('file://host/share/x.html', 'address', 'main', APP)).toEqual({ allowed: false, reason: 'network-path' })
    expect(checkNavigation('file:////host/share/x.html', 'page', 'main', APP)).toMatchObject({ allowed: false })
  })

  it('refuses everything to previewOpen until local files land', () => {
    expect(checkNavigation('https://example.com/', 'previewOpen', 'main', APP)).toEqual({ allowed: false, reason: 'scheme' })
  })

  it('lets page frames use about:blank, about:srcdoc, data: and own-origin blob:', () => {
    expect(checkNavigation('about:blank', 'page', 'frame', APP)).toEqual({ allowed: true })
    expect(checkNavigation('about:srcdoc', 'page', 'frame', APP)).toEqual({ allowed: true })
    expect(checkNavigation('data:text/html,<p>x', 'page', 'frame', APP)).toEqual({ allowed: true })
    expect(checkNavigation('blob:https://a.test/0f', 'page', 'frame', APP, 'https://a.test')).toEqual({ allowed: true })
  })

  it('refuses other about: pages, foreign blob: and blob: with no page origin in frames', () => {
    expect(checkNavigation('about:settings', 'page', 'frame', APP)).toEqual({ allowed: false, reason: 'scheme' })
    expect(checkNavigation('blob:https://b.test/0f', 'page', 'frame', APP, 'https://a.test')).toEqual({ allowed: false, reason: 'scheme' })
    expect(checkNavigation('blob:https://a.test/0f', 'page', 'frame', APP)).toEqual({ allowed: false, reason: 'scheme' })
    expect(checkNavigation('chrome://gpu', 'page', 'frame', APP)).toEqual({ allowed: false, reason: 'scheme' })
  })

  it('never lets a user source navigate a frame', () => {
    expect(checkNavigation('https://example.com/', 'address', 'frame', APP)).toEqual({ allowed: false, reason: 'scheme' })
  })

  it('refuses an unparsable address', () => {
    expect(checkNavigation('::', 'page', 'main', APP)).toEqual({ allowed: false, reason: 'scheme' })
  })
})

describe('securityStateOf', () => {
  it.each([
    [null, 'local'],
    ['https://a.test/', 'secure'],
    ['http://localhost:5173/', 'local'],
    ['http://app.localhost:3000/', 'local'],
    ['http://127.0.0.1/', 'local'],
    ['http://[::1]:8080/', 'local'],
    ['http://example.com/', 'notSecureHttp'],
    ['file:///x.html', 'file'],
    ['about:blank', 'notSecureHttp'],
    ['garbage', 'local']
  ] as const)('%s → %s', (url, state) => {
    expect(securityStateOf(url)).toBe(state)
  })
})
