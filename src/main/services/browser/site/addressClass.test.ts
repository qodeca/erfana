// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The address classifier of 025-FR-022 and S-16: loopback, RFC 1918
 * private, other local, public – from the host literal only.
 */
import { describe, expect, it } from 'vitest'
import { hostAddressClass, isLocalOrPrivate, urlAddressClass } from './addressClass'

describe('hostAddressClass', () => {
  it('025-AC-022 counts 10.0.0.1, 172.16.0.1 and 192.168.1.1 as private, and 172.32.0.1 and 8.8.8.8 as not', () => {
    expect(hostAddressClass('10.0.0.1')).toBe('private')
    expect(hostAddressClass('172.16.0.1')).toBe('private')
    expect(hostAddressClass('192.168.1.1')).toBe('private')
    expect(hostAddressClass('172.32.0.1')).toBe('public')
    expect(hostAddressClass('8.8.8.8')).toBe('public')
  })

  it('takes the edges of every RFC 1918 range', () => {
    expect(hostAddressClass('10.255.255.255')).toBe('private')
    expect(hostAddressClass('172.31.255.255')).toBe('private')
    expect(hostAddressClass('172.15.255.255')).toBe('public')
    expect(hostAddressClass('192.168.0.0')).toBe('private')
    expect(hostAddressClass('192.169.0.1')).toBe('public')
    expect(hostAddressClass('11.0.0.1')).toBe('public')
  })

  it('counts localhost, 127.0.0.0/8 and ::1 as loopback', () => {
    for (const host of ['localhost', 'LOCALHOST', 'localhost.', 'app.localhost', '127.0.0.1', '127.255.0.9', '::1', '[::1]', '0:0:0:0:0:0:0:1']) {
      expect(hostAddressClass(host)).toBe('loopback')
    }
  })

  it('counts the unspecified, link-local and unique-local addresses as other local, never private', () => {
    for (const host of ['0.0.0.0', '169.254.1.1', '[::]', 'fe80::1', 'fe80::1%en0', 'fd00::1', 'fc12:3456::1']) {
      expect(hostAddressClass(host)).toBe('otherLocal')
    }
  })

  it('classifies IPv4-mapped IPv6 by its IPv4 part, in both spellings', () => {
    expect(hostAddressClass('::ffff:127.0.0.1')).toBe('loopback')
    expect(hostAddressClass('[::ffff:7f00:1]')).toBe('loopback')
    expect(hostAddressClass('::ffff:192.168.0.5')).toBe('private')
    expect(hostAddressClass('::ffff:8.8.8.8')).toBe('public')
  })

  it('treats names and malformed literals as public', () => {
    for (const host of ['staging.test', 'example.com', 'localhost.example.com', '10.0.0', '10.0.0.256', '1.2.3.4.5', '01x.2.3.4', '2001:db8::1', '1::2::3', 'g::1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7']) {
      expect(hostAddressClass(host)).toBe('public')
    }
  })
})

describe('urlAddressClass and isLocalOrPrivate', () => {
  it('reads the host of a URL, and null when there is none', () => {
    expect(urlAddressClass('http://192.168.1.1:8080/x')).toBe('private')
    expect(urlAddressClass('http://[::1]:3000/')).toBe('loopback')
    expect(urlAddressClass('https://staging.test/')).toBe('public')
    expect(urlAddressClass('not a url')).toBeNull()
    expect(urlAddressClass('about:blank')).toBeNull()
  })

  it('lets only loopback and private addresses receive a saved sign-in without asking', () => {
    expect(isLocalOrPrivate('loopback')).toBe(true)
    expect(isLocalOrPrivate('private')).toBe(true)
    expect(isLocalOrPrivate('otherLocal')).toBe(false)
    expect(isLocalOrPrivate('public')).toBe(false)
  })
})
