// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  browserUserAgent,
  browserUserAgentOverride,
  chromiumBrands,
  currentBrowserUserAgentOverride,
  type UserAgentFacts
} from './browserUserAgent'

const MAC_ARM: UserAgentFacts = { platform: 'darwin', chromeVersion: '152.0.7977.167', arch: 'arm64', systemVersion: '27.2.0' }

describe('browserUserAgentOverride (025-FR-024)', () => {
  it('matches what Electron 44.9.3 itself reports on macOS arm64 (probe 2026-11-03)', () => {
    // navigator.userAgentData.brands and getHighEntropyValues() of a page in a
    // plain Electron 44.9.3 session on macOS 27.2.0, Apple silicon.
    expect(browserUserAgentOverride(MAC_ARM)).toEqual({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      userAgentMetadata: {
        brands: [
          { brand: 'Not?A_Brand', version: '24' },
          { brand: 'Chromium', version: '152' }
        ],
        fullVersionList: [
          { brand: 'Not?A_Brand', version: '24.0.0.0' },
          { brand: 'Chromium', version: '152.0.7977.167' }
        ],
        platform: 'macOS',
        platformVersion: '27.2.0',
        architecture: 'arm',
        model: '',
        mobile: false,
        bitness: '64',
        wow64: false,
        formFactors: ['Desktop']
      }
    })
  })

  it('reports Windows and Linux without a platform version, x86 for x64', () => {
    const win = browserUserAgentOverride({ platform: 'win32', chromeVersion: '152.0.1.2', arch: 'x64', systemVersion: '10.0.22631' })
    expect(win.userAgent).toContain('(Windows NT 10.0; Win64; x64)')
    expect(win.userAgentMetadata).toMatchObject({ platform: 'Windows', platformVersion: '', architecture: 'x86', bitness: '64' })
    const linux = browserUserAgentOverride({ platform: 'linux', chromeVersion: '152.0.1.2', arch: 'x64', systemVersion: '6.8.0' })
    expect(linux.userAgent).toContain('(X11; Linux x86_64)')
    expect(linux.userAgentMetadata).toMatchObject({ platform: 'Linux', platformVersion: '', architecture: 'x86' })
  })

  it('reports 32-bit for ia32 and arm, and pads a short macOS version', () => {
    expect(browserUserAgentOverride({ ...MAC_ARM, arch: 'ia32' }).userAgentMetadata.bitness).toBe('32')
    expect(browserUserAgentOverride({ ...MAC_ARM, arch: 'arm' }).userAgentMetadata).toMatchObject({ bitness: '32', architecture: 'arm' })
    expect(browserUserAgentOverride({ ...MAC_ARM, systemVersion: '15' }).userAgentMetadata.platformVersion).toBe('15.0.0')
    expect(browserUserAgentOverride({ ...MAC_ARM, systemVersion: '' }).userAgentMetadata.platformVersion).toBe('0.0.0')
  })

  it('carries no Electron or Erfana token anywhere', () => {
    expect(JSON.stringify(browserUserAgentOverride(MAC_ARM))).not.toMatch(/electron|erfana/i)
  })
})

describe('chromiumBrands', () => {
  it('builds the GREASE brand Google Chrome 156 sends ("Not:A-Brand";v="8")', () => {
    expect(chromiumBrands(156, '156', false)).toContainEqual({ brand: 'Not:A-Brand', version: '8' })
  })

  it('puts Chromium first for an odd major, second for an even one', () => {
    expect(chromiumBrands(153, '153', false).map(b => b.brand)).toEqual(['Chromium', 'Not_A Brand'])
    expect(chromiumBrands(152, '152', false).map(b => b.brand)).toEqual(['Not?A_Brand', 'Chromium'])
  })

  it('gives the GREASE brand a full version in the full list', () => {
    expect(chromiumBrands(152, '152.0.1.2', true)).toEqual([
      { brand: 'Not?A_Brand', version: '24.0.0.0' },
      { brand: 'Chromium', version: '152.0.1.2' }
    ])
  })
})

describe('browserUserAgent', () => {
  it('falls back to major 0 for an unreadable version', () => {
    expect(browserUserAgent('linux', 'x')).toContain('Chrome/0.0.0.0')
    expect(browserUserAgentOverride({ ...MAC_ARM, chromeVersion: '' }).userAgentMetadata.brands).toContainEqual({
      brand: 'Chromium',
      version: '0'
    })
  })
})

describe('currentBrowserUserAgentOverride', () => {
  it('is built once, frozen to the leaves', () => {
    const identity = currentBrowserUserAgentOverride()
    expect(currentBrowserUserAgentOverride()).toBe(identity)
    expect(Object.isFrozen(identity)).toBe(true)
    expect(Object.isFrozen(identity.userAgentMetadata.brands[0])).toBe(true)
    expect(identity.userAgentMetadata.formFactors).toEqual(['Desktop'])
  })
})
