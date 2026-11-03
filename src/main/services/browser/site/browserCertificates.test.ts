// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Certificate errors of a tab (025-FR-021): the warning page for the main
 * frame, Proceed anyway with its 500 ms input guard, Back to safety, the
 * warning sign for subresources and proceeded hosts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock, type TestClock } from '../../../../shared/clock'
import {
  CERTIFICATE_INPUT_GUARD_MS,
  certificateErrorCode,
  certificateFingerprint,
  TabCertificates,
  type TabCertificateState
} from './browserCertificates'
import { BrowserCertificateStore, CERTIFICATE_EXCEPTION_MS } from './certificateStore'
import { testSigner } from './__test-helpers__/siteFakes'

/** A public test certificate (its key was never kept); only its bytes are hashed. */
const UNIT_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBXDCCAQKgAwIBAgIUWXmxOcZ0jxD1mKr5BBWOwT6zzPswCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJdW5pdC50ZXN0MB4XDTI2MTEwMzAxMTM0NFoXDTI2MTEwNDAx
MTM0NFowFDESMBAGA1UEAwwJdW5pdC50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEzJWtzaM0/HlDrplEhoWukeBlm0YpOzZXt1WNKK8+IkpLzLmrq00TeV7T
42pjNM2AufgJ3MVexhlWpsrPmiZFM6MyMDAwHQYDVR0OBBYEFGg8UBlDmsInkp9P
e6qbFD2vBb1TMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIge+A2
GMbeglaYyXzlz2LChD0KnK1mrqNC1X2FqzHH95ICIQCMsl0Vux+1Qx3lTGuWcV7q
x9s5hbKKmPHdgtzaAaquOQ==
-----END CERTIFICATE-----`
const UNIT_CERT_SHA256 = '8e1943417730fd582867978f2ab8be2173c727d8bcd1b7fd660d7a4bf39a1ee6'

const URL_A = 'https://selfsigned.test:8443/page'
const CERT_1 = { data: 'cert-1' }
const CERT_2 = { data: 'cert-2' }
const FINGERPRINTS: Record<string, string | null> = { 'cert-1': '1'.repeat(64), 'cert-2': '2'.repeat(64), bad: null }

let clock: TestClock
let store: BrowserCertificateStore
let states: TabCertificateState[]
let tab: {
  contents: { url: string; getURL(): string; navigationHistory: { canGoBack(): boolean } }
  canGoBack: boolean
  reloadAt: ReturnType<typeof vi.fn<(url: string) => void>>
  goBack: ReturnType<typeof vi.fn<() => void>>
  setCertificateState(state: TabCertificateState): void
}
let certs: TabCertificates
let ids: number

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

beforeEach(async () => {
  clock = createManualClock(0)
  store = await BrowserCertificateStore.open('/project', '/unused-home', testSigner(null), clock)
  states = []
  ids = 0
  const t = {
    canGoBack: false,
    contents: {
      url: '',
      getURL: (): string => t.contents.url,
      navigationHistory: { canGoBack: (): boolean => t.canGoBack }
    },
    reloadAt: vi.fn<(url: string) => void>(),
    goBack: vi.fn<() => void>(),
    setCertificateState: (state: TabCertificateState): void => {
      states.push(state)
    }
  }
  tab = t
  certs = new TabCertificates({
    tab,
    store: Promise.resolve(store),
    clock,
    newId: () => `decision${++ids}`,
    displayHost: (url) => new URL(url).host,
    fingerprint: (c) => FINGERPRINTS[c.data] ?? null
  })
})

async function certError(url: string, cert: { data: string }, isMainFrame: boolean, error = 'net::ERR_CERT_AUTHORITY_INVALID'): Promise<boolean[]> {
  const results: boolean[] = []
  const event = { preventDefault: vi.fn() }
  certs.certificateError(event, url, error, cert, (trusted) => results.push(trusted), isMainFrame)
  expect(event.preventDefault).toHaveBeenCalled()
  await flush()
  return results
}

describe('TabCertificates', () => {
  it('025-AC-021 refuses an untrusted main-frame certificate and shows the warning page naming the host and the error', async () => {
    expect(await certError(URL_A, CERT_1, true)).toEqual([false])
    expect(certs.state()).toEqual({
      warning: { decisionId: 'decision1', host: 'selfsigned.test:8443', code: -202, shownAt: 0 },
      sign: null,
      failedUrl: URL_A
    })
    expect(states).toHaveLength(1)
  })

  it('025-AC-021 ignores Proceed anyway at 499 ms and loads the page from 500 ms, saving the exception', async () => {
    await certError(URL_A, CERT_1, true)
    clock.advance(CERTIFICATE_INPUT_GUARD_MS - 1)
    expect(certs.answer('decision1', true)).toBe('guarded')
    expect(tab.reloadAt).not.toHaveBeenCalled()
    expect(certs.state().warning).not.toBeNull()
    clock.advance(1)
    expect(certs.answer('decision1', true)).toBe('accepted')
    expect(tab.reloadAt).toHaveBeenCalledWith(URL_A)
    expect(certs.state().warning).toBeNull()
    expect(store.isExcepted('selfsigned.test', FINGERPRINTS['cert-1']!)).toBe(true)

    // The reload: the exception trusts the same certificate, and the page is marked proceeded.
    expect(await certError(URL_A, CERT_1, true)).toEqual([true])
    certs.committed(URL_A)
    expect(certs.state()).toEqual({ warning: null, sign: 'proceeded' })
    certs.committed('https://other.test/')
    expect(certs.state().sign).toBeNull()
  })

  it('025-AC-021 warns again when an accepted host presents a new certificate, and after 7 days', async () => {
    await store.add('selfsigned.test', FINGERPRINTS['cert-1']!)
    expect(await certError(URL_A, CERT_2, true)).toEqual([false])
    expect(certs.state().warning).not.toBeNull()
    certs.navigationStarted()
    expect(certs.state().warning).toBeNull()
    clock.advance(CERTIFICATE_EXCEPTION_MS)
    expect(await certError(URL_A, CERT_1, true)).toEqual([false])
    expect(certs.state().warning?.decisionId).toBe('decision2')
  })

  it('025-AC-021 Back to safety goes back over the failed entry, or shows the empty tab when there is no history', async () => {
    await certError(URL_A, CERT_1, true)
    tab.contents.url = URL_A
    tab.canGoBack = true
    expect(certs.answer('decision1', false)).toBe('accepted')
    expect(tab.goBack).toHaveBeenCalledTimes(1)
    expect(certs.state().warning).toBeNull()

    await certError(URL_A, CERT_1, true)
    tab.canGoBack = false
    expect(certs.answer('decision2', false)).toBe('accepted')
    expect(tab.goBack).toHaveBeenCalledTimes(1)
    expect(certs.state().warning).toBeNull()

    // The failed load left no entry: the tab stays on the page it showed.
    await certError(URL_A, CERT_1, true)
    tab.contents.url = 'https://previous.test/'
    tab.canGoBack = true
    certs.answer('decision3', false)
    expect(tab.goBack).toHaveBeenCalledTimes(1)
  })

  it('Back to safety works inside the guard; a stale or unknown decision is ignored', async () => {
    await certError(URL_A, CERT_1, true)
    expect(certs.answer('decision1', false)).toBe('accepted')
    expect(certs.answer('decision1', true)).toBe('unknown')
    expect(certs.answer('nope', true)).toBe('unknown')
  })

  it('025-AC-021 a bad subresource certificate keeps the page and shows the warning sign until the next document', async () => {
    expect(await certError('https://api.selfsigned.test/data', CERT_1, false)).toEqual([false])
    expect(certs.state()).toEqual({ warning: null, sign: 'subresourceFailed' })
    await certError('https://api.selfsigned.test/more', CERT_1, false)
    expect(states.filter((s) => s.sign === 'subresourceFailed')).toHaveLength(1)
    certs.committed('https://app.test/')
    expect(certs.state().sign).toBeNull()
  })

  it('trusts an excepted host in a frame or subresource without a sign', async () => {
    await store.add('selfsigned.test', FINGERPRINTS['cert-1']!)
    expect(await certError(URL_A, CERT_1, false)).toEqual([true])
    expect(certs.state()).toEqual({ warning: null, sign: null })
  })

  it('warns for a certificate that does not parse, but Proceed anyway cannot save it', async () => {
    expect(await certError(URL_A, { data: 'bad' }, true)).toEqual([false])
    clock.advance(CERTIFICATE_INPUT_GUARD_MS)
    expect(certs.answer('decision1', true)).toBe('unknown')
    expect(tab.reloadAt).not.toHaveBeenCalled()
  })

  it('refuses everything once detached, and an address with no host', async () => {
    expect(await certError('data:text/html,x', CERT_1, true)).toEqual([false])
    expect(certs.state().warning).toBeNull()
    certs.detach()
    expect(await certError(URL_A, CERT_1, true)).toEqual([false])
    expect(states).toEqual([])
    expect(certs.answer('decision1', true)).toBe('unknown')
  })

  it('refuses when the store could not open, and survives a failing tab outlet', async () => {
    const failing = new TabCertificates({
      tab: { ...tab, setCertificateState: () => { throw new Error('gone') } },
      store: Promise.reject(new Error('io')),
      clock,
      newId: () => 'x',
      displayHost: (u) => u
    })
    const results: boolean[] = []
    failing.certificateError({ preventDefault: vi.fn() }, URL_A, 'net::ERR_CERT_DATE_INVALID', CERT_1, (t) => results.push(t), true)
    await flush()
    expect(results).toEqual([false])
    const throwing = new TabCertificates({
      tab: { ...tab, setCertificateState: () => { throw new Error('gone') } },
      store: Promise.resolve(store),
      clock,
      newId: () => 'y',
      displayHost: (u) => u,
      fingerprint: () => 'f'.repeat(64)
    })
    throwing.certificateError({ preventDefault: vi.fn() }, URL_A, 'net::ERR_CERT_DATE_INVALID', CERT_1, () => undefined, true)
    await flush()
    expect(throwing.state().warning?.code).toBe(-201)
  })
})

describe('certificate helpers', () => {
  it('hashes the certificate DER with SHA-256, and gives null for a PEM that does not parse', () => {
    expect(certificateFingerprint({ data: UNIT_CERT_PEM })).toBe(UNIT_CERT_SHA256)
    expect(certificateFingerprint({ data: 'not a certificate' })).toBeNull()
  })

  it('maps Electron\'s error text to the net error code, ERR_CERT_INVALID when unnamed', () => {
    expect(certificateErrorCode('net::ERR_CERT_AUTHORITY_INVALID')).toBe(-202)
    expect(certificateErrorCode('net::ERR_CERT_COMMON_NAME_INVALID')).toBe(-200)
    expect(certificateErrorCode('net::ERR_CERT_DATE_INVALID')).toBe(-201)
    expect(certificateErrorCode('ERR_CERT_REVOKED')).toBe(-206)
    expect(certificateErrorCode('net::ERR_CERT_SOMETHING_NEW')).toBe(-207)
  })
})
