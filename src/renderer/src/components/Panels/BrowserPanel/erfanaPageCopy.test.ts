// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import type { OriginPartsPayload } from '../../../../../shared/ipc/browser-tab-schema'
import { certificateCopy, isLoopbackOrigin, loadErrorCopy, sentenceHost } from './erfanaPageCopy'

type WebParts = Extract<OriginPartsPayload, { kind: 'web' }>
const web = (host: string, port: string | null = null, scheme: 'http' | null = 'http'): WebParts => ({
  kind: 'web',
  scheme,
  subdomain: '',
  registrableDomain: host,
  port,
  punycode: false
})

describe('loadErrorCopy (025-FR-059)', () => {
  it('uses the per-code title and the loopback hint in place of the next step', () => {
    const local = loadErrorCopy(-102, web('localhost', '5173'), '')
    expect(local.title).toBe('localhost refused to connect')
    expect(local.nextStep).toBe('Is your dev server running? Start it in a terminal, then press Reload.')
    expect(local.code).toBe('ERR_CONNECTION_REFUSED (-102)')
    const remote = loadErrorCopy(-102, web('example.test', null, null), '')
    expect(remote.nextStep).toBe('Check that the server is running, then press Reload.')
  })

  it('fills the port, the file name and the host in the hint', () => {
    expect(loadErrorCopy(-312, web('localhost', '6000'), '').title).toBe("Browser tabs can't open port 6000")
    expect(loadErrorCopy(-312, web('localhost', '6000'), '').nextStep).toMatch(/another port/)
    expect(loadErrorCopy(-6, { kind: 'file' }, 'index.html').title).toBe("Can't find index.html")
    expect(loadErrorCopy(-10, { kind: 'file' }, '').title).toBe("Can't open this file")
    expect(loadErrorCopy(-107, web('app.localhost'), '').nextStep).toBe('Dev servers often run without https – try http://app.localhost.')
    expect(loadErrorCopy(-137, web('127.0.0.1'), '').nextStep).toBe('Check your network connection, then press Reload.')
  })

  it.each([
    [-105, "Can't find a.test"],
    [-137, "Can't find a.test"],
    [-118, 'a.test took too long to respond'],
    [-7, 'a.test took too long to respond'],
    [-106, "You're offline"],
    [-21, 'Your network changed'],
    [-101, 'The connection to a.test was reset'],
    [-100, 'a.test closed the connection'],
    [-324, "a.test didn't send anything"],
    [-109, "Can't reach a.test"],
    [-107, "Can't make a secure connection to a.test"],
    [-310, 'a.test redirected too many times'],
    [-20, 'Erfana blocked this address']
  ])('titles code %i with the deck sentence', (code, title) => {
    const copy = loadErrorCopy(code, web('a.test'), '')
    expect(copy.title).toBe(title)
    expect(copy.sentence.length).toBeGreaterThan(0)
    expect(copy.nextStep.length).toBeGreaterThan(0)
  })

  it('falls back to the Any other row', () => {
    const other = loadErrorCopy(-999, null, '')
    expect(other.title).toBe("Can't open this page")
    expect(other.sentence).toBe("The page at this address didn't load.")
    expect(other.code).toBe('(-999)')
  })
})

describe('isLoopbackOrigin and sentenceHost', () => {
  it('recognises loopback hosts only', () => {
    expect(isLoopbackOrigin(web('localhost'))).toBe(true)
    expect(isLoopbackOrigin({ ...web('localhost'), subdomain: 'app.' })).toBe(true)
    expect(isLoopbackOrigin(web('127.0.0.1'))).toBe(true)
    expect(isLoopbackOrigin(web('[::1]'))).toBe(true)
    expect(isLoopbackOrigin(web('example.test'))).toBe(false)
    expect(isLoopbackOrigin({ kind: 'file' })).toBe(false)
    expect(isLoopbackOrigin(null)).toBe(false)
    expect(sentenceHost(web('example.test', '8080'))).toBe('example.test')
    expect(sentenceHost(null)).toBe('this address')
  })
})

describe('certificateCopy (025-FR-021)', () => {
  it('has its own sentence and caution text per code, each with the 7-day note', () => {
    for (const code of [-202, -201, -200, -206, -207]) {
      const copy = certificateCopy(code, 'staging.test')
      expect(copy.caution).toMatch(/7 days/)
      expect(copy.sentence.length).toBeGreaterThan(0)
    }
    expect(certificateCopy(-202, 'staging.test').caution).toMatch(/for staging\.test for 7 days/)
    expect(certificateCopy(-200, 'staging.test').sentence).toBe('Its certificate is for a different site, not staging.test.')
    expect(certificateCopy(-206, 'x').sentence).toMatch(/withdrawn/)
    expect(certificateCopy(-207, 'x').sentence).toBe("Its certificate isn't valid.")
  })
})
