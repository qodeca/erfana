// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The test-CA hook (probe 10c): a certificate the CA signed passes when the
 * authority is the only complaint; every other verdict stays Chromium's.
 */
import { describe, expect, it } from 'vitest'
import { X509Certificate } from 'node:crypto'
import { createBrowserSiteTestHook, testCaVerdict } from './browserSiteHook'

/** A public self-signed test certificate (its key was never kept): it is its own CA. */
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

type Proc = (request: { hostname: string; errorCode: number; certificate: { data: string } }, callback: (result: number) => void) => void

describe('browserSiteHook.trustTestCa', () => {
  it('accepts a leaf the CA signed in every open session, with Chromium\'s verdict for any other leaf', async () => {
    const procs: Proc[] = []
    const session = { setCertificateVerifyProc: (proc: Proc) => procs.push(proc) }
    const runtime = { profiles: { openSessions: async () => [session, session] } }
    const hook = createBrowserSiteTestHook(() => runtime as never)
    expect(await hook.trustTestCa(UNIT_CERT_PEM)).toBe(2)
    expect(procs).toHaveLength(2)
    let result = NaN
    procs[0]({ hostname: 'other.test', errorCode: -202, certificate: { data: 'not a certificate' } }, (r) => (result = r))
    expect(result).toBe(-3)
  })

  it('fails a CA-signed leaf as a trusted root would: out of date, or for another host', () => {
    const ca = new X509Certificate(UNIT_CERT_PEM)
    const inDate = Date.parse(ca.validFrom) + 1000
    expect(testCaVerdict(UNIT_CERT_PEM, 'unit.test', ca, inDate)).toBe(0)
    expect(testCaVerdict(UNIT_CERT_PEM, 'other.test', ca, inDate)).toBe(-200)
    expect(testCaVerdict(UNIT_CERT_PEM, 'unit.test', ca, Date.parse(ca.validTo) + 1000)).toBe(-201)
    expect(testCaVerdict(UNIT_CERT_PEM, 'unit.test', ca, Date.parse(ca.validFrom) - 1000)).toBe(-201)
  })

  it('closes connections and clears the auth cache of every open session', async () => {
    const calls: string[] = []
    const session = { closeAllConnections: async () => void calls.push('close'), clearAuthCache: async () => void calls.push('auth') }
    const hook = createBrowserSiteTestHook(() => ({ profiles: { openSessions: async () => [session] } }) as never)
    await hook.resetConnections()
    expect(calls.sort()).toEqual(['auth', 'close'])
  })

  it('throws when the browser runtime is not installed', async () => {
    await expect(createBrowserSiteTestHook(() => null).trustTestCa(UNIT_CERT_PEM)).rejects.toThrow('not installed')
  })
})
