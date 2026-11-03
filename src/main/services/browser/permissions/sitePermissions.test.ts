// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** What a permission prompt asks and says (spec 025, 025-FR-019). */
import { describe, expect, it } from 'vitest'
import {
  askerText,
  lockNoticeText,
  offersAllowOnce,
  orderedPermissions,
  permissionAnswers,
  permissionPromptText,
  requestPhrase,
  requestingOrigin,
  siteOrigin,
  sitePermissionsFor
} from './sitePermissions'

describe('sitePermissionsFor', () => {
  it.each([
    ['media', { mediaTypes: ['video'] as const }, ['camera']],
    ['media', { mediaTypes: ['audio'] as const }, ['microphone']],
    ['media', { mediaTypes: ['audio', 'video'] as const }, ['camera', 'microphone']],
    ['media', {}, []],
    ['geolocation', {}, ['location']],
    ['geolocation-approximate', {}, ['location']],
    ['clipboard-read', {}, ['clipboardRead']],
    ['display-capture', {}, ['screen']],
    ['notifications', {}, ['notifications']],
    ['midi', {}, []]
  ])('%s %j asks for %j', (permission, details, expected) => {
    expect(sitePermissionsFor(permission, details)).toEqual(expected)
  })

  it('orders permissions and drops repeats', () => {
    expect(orderedPermissions(['microphone', 'camera', 'camera'])).toEqual(['camera', 'microphone'])
  })
})

describe('siteOrigin', () => {
  it.each([
    ['https://a.test/path?q#f', 'https://a.test'],
    ['http://user:pw@a.test:8080/x', 'http://a.test:8080'],
    ['erfana-local://abc123/index.html', 'erfana-local://abc123'],
    ['erfana-local:///nohost', null],
    ['data:text/html,x', null],
    ['about:blank', null],
    ['file:///etc/passwd', null],
    ['not a url', null],
    ['', null],
    [undefined, null],
    [null, null]
  ])('%s → %s', (url, expected) => {
    expect(siteOrigin(url)).toBe(expected)
  })

  it('prefers the media security origin over the requesting address', () => {
    expect(requestingOrigin({ securityOrigin: 'https://frame.test', requestingUrl: 'https://top.test/' })).toBe('https://frame.test')
    expect(requestingOrigin({ requestingUrl: 'https://top.test/a' })).toBe('https://top.test')
    expect(requestingOrigin({ securityOrigin: 'null', requestingUrl: 'https://top.test/a' })).toBe('https://top.test')
    expect(requestingOrigin({})).toBeNull()
  })
})

describe('prompt answers and text (design site-prompts.html)', () => {
  it('025-AC-019 offers Allow once next to Allow for the camera and the microphone only', () => {
    expect(permissionAnswers(['camera'])).toEqual(['block', 'allowOnce', 'allow', 'dismiss'])
    expect(permissionAnswers(['camera', 'microphone'])).toEqual(['block', 'allowOnce', 'allow', 'dismiss'])
    expect(permissionAnswers(['screen'])).toEqual(['block', 'allow', 'dismiss'])
    expect(permissionAnswers(['location'])).toEqual(['block', 'allow', 'dismiss'])
    expect(offersAllowOnce([])).toBe(false)
  })

  it.each([
    [['camera'], 'wants to use your camera'],
    [['microphone'], 'wants to use your microphone'],
    [['microphone', 'camera'], 'wants to use your camera and microphone'],
    [['screen'], 'wants to see your screen'],
    [['location'], 'wants to know your location'],
    [['notifications'], 'wants to show notifications'],
    [['clipboardRead'], 'wants to see what you copy']
  ] as const)('%j reads "%s"', (permissions, phrase) => {
    expect(requestPhrase(permissions)).toBe(phrase)
  })

  it('025-AC-019 names both origins when a frame asks, asker first', () => {
    expect(askerText('maps.example.net', null)).toBe('maps.example.net')
    expect(permissionPromptText('maps.example.net', 'harbour-garden.org', ['location'])).toBe(
      'maps.example.net, inside harbour-garden.org, wants to know your location'
    )
  })

  it('composes the fullscreen and pointer-lock notices', () => {
    expect(lockNoticeText('fullscreen', 'a.test')).toBe('a.test is now full screen. Press Esc to exit.')
    expect(lockNoticeText('pointerLock', 'a.test')).toBe('a.test has hidden your pointer. Press Esc to exit.')
  })
})
