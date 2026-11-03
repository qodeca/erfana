// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Certificate exceptions (025-FR-021, ADR 0009 decisions 6–7, S-26): host
 * and fingerprint, 7 days on the clock, a signed `trust.json` at the home
 * generation, memory only without a key, untrusted or replayed files
 * ignored, never written through a link.
 */
import { readFileSync, rmSync, symlinkSync, writeFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock, type TestClock } from '../../../../shared/clock'
import { homeGenerationsPath, profileGenerations } from '../profileGenerations'
import { BrowserCertificateStore, CERTIFICATE_EXCEPTION_MS, MAX_CERTIFICATE_EXCEPTIONS, TRUST_PURPOSE, TRUST_SEGMENTS } from './certificateStore'
import { tempHome, tempProject, testSigner } from './__test-helpers__/siteFakes'

const itPosix = process.platform === 'win32' ? it.skip : it
const FP_A = 'a'.repeat(64)
const FP_B = 'b'.repeat(64)

let root: string
let home: string
let file: string
let clock: TestClock

beforeEach(() => {
  root = tempProject('erfana-trust-')
  home = tempHome()
  file = join(root, ...TRUST_SEGMENTS)
  clock = createManualClock(1_000_000)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

describe('BrowserCertificateStore', () => {
  it('025-AC-021 keeps an exception for the host and that certificate only, across a restart', async () => {
    const store = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
    expect(store.persistence).toBe('saved')
    await store.add('Staging.Test', FP_A)
    expect(store.isExcepted('staging.test', FP_A)).toBe(true)
    expect(store.isExcepted('staging.test', FP_B)).toBe(false)
    expect(store.isExcepted('other.test', FP_A)).toBe(false)
    const reopened = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
    expect(reopened.isExcepted('staging.test', FP_A)).toBe(true)
  })

  it('025-AC-021 forgets an exception 7 days after Proceed anyway, on the clock', async () => {
    const store = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
    await store.add('staging.test', FP_A)
    clock.advance(CERTIFICATE_EXCEPTION_MS - 1)
    expect(store.isExcepted('staging.test', FP_A)).toBe(true)
    clock.advance(1)
    expect(store.isExcepted('staging.test', FP_A)).toBe(false)
    expect(store.size()).toBe(0)
  })

  it('does not load an expired exception from the file, and does not write one', async () => {
    const store = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
    await store.add('a.test', FP_A)
    clock.advance(CERTIFICATE_EXCEPTION_MS)
    await store.add('b.test', FP_B)
    expect(readFileSync(file, 'utf8')).not.toContain('a.test')
    const reopened = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
    expect(reopened.isExcepted('a.test', FP_A)).toBe(false)
    expect(reopened.isExcepted('b.test', FP_B)).toBe(true)
  })

  it('025-AC-021 Clear removes every exception, in memory and in the file', async () => {
    const store = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
    await store.add('staging.test', FP_A)
    await store.clear()
    expect(store.isExcepted('staging.test', FP_A)).toBe(false)
    expect((await BrowserCertificateStore.open(root, home, testSigner('k'), clock)).size()).toBe(0)
  })

  it('keeps exceptions in memory only without a signing key (S-26)', async () => {
    const store = await BrowserCertificateStore.open(root, home, testSigner(null), clock)
    expect(store.persistence).toBe('session')
    await store.add('staging.test', FP_A)
    expect(store.isExcepted('staging.test', FP_A)).toBe(true)
    expect(existsSync(file)).toBe(false)
    await store.clear()
    expect(store.size()).toBe(0)
  })

  it('ignores a file signed by another key, for another project, or edited', async () => {
    const store = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
    await store.add('staging.test', FP_A)
    expect((await BrowserCertificateStore.open(root, home, testSigner('other'), clock)).size()).toBe(0)

    const otherRoot = tempProject('erfana-trust-b-')
    try {
      // The other project is at the same generation (1), so only the signed project path refuses the copy.
      await (await BrowserCertificateStore.open(otherRoot, home, testSigner('k'), clock)).add('other.test', FP_B)
      writeFileSync(join(otherRoot, ...TRUST_SEGMENTS), readFileSync(file))
      expect((await BrowserCertificateStore.open(otherRoot, home, testSigner('k'), clock)).size()).toBe(0)
    } finally {
      rmSync(otherRoot, { recursive: true, force: true })
    }

    const edited = JSON.parse(readFileSync(file, 'utf8')) as { entries: Array<{ host: string }> }
    edited.entries[0].host = 'bank.test'
    writeFileSync(file, JSON.stringify(edited))
    expect((await BrowserCertificateStore.open(root, home, testSigner('k'), clock)).size()).toBe(0)

    writeFileSync(file, '{ not json')
    expect((await BrowserCertificateStore.open(root, home, testSigner('k'), clock)).size()).toBe(0)
    writeFileSync(file, JSON.stringify({ version: 1, entries: [{ host: 'x', fingerprint: 'zz', expiresAt: 1 }] }))
    expect((await BrowserCertificateStore.open(root, home, testSigner('k'), clock)).size()).toBe(0)
  })

  it('ADR 0009 decision 6 refuses an older signed file put back (a removed exception restored)', async () => {
    const store = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
    await store.add('staging.test', FP_A)
    const older = readFileSync(file)
    await store.clear()
    writeFileSync(file, older)
    const reopened = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
    expect(reopened.isExcepted('staging.test', FP_A)).toBe(false)
    expect(reopened.size()).toBe(0)
  })

  it('refuses an existing file when the home generation record is missing (fail closed)', async () => {
    await (await BrowserCertificateStore.open(root, home, testSigner('k'), clock)).add('staging.test', FP_A)
    rmSync(homeGenerationsPath(home, root))
    const reopened = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
    expect(reopened.size()).toBe(0)
    // The next save starts the kind again and is trusted.
    await reopened.add('b.test', FP_B)
    expect((await BrowserCertificateStore.open(root, home, testSigner('k'), clock)).isExcepted('b.test', FP_B)).toBe(true)
  })

  it('ignores a version 1 file, even one signed by this account', async () => {
    const entries = [{ host: 'staging.test', fingerprint: FP_A, expiresAt: clock.now() + 1000 }]
    const body = JSON.stringify({ version: 1, kind: TRUST_PURPOSE, project: root, entries })
    writeFileSync(file, JSON.stringify({ version: 1, entries, hmac: testSigner('k').sign(TRUST_PURPOSE, body) }))
    expect((await BrowserCertificateStore.open(root, home, testSigner('k'), clock)).size()).toBe(0)
  })

  it('keeps the generation monotonic when saves overlap, and the last file wins', async () => {
    const store = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
    const saves = Array.from({ length: 10 }, (_, i) => store.add(`h${i}.test`, FP_A))
    await Promise.all(saves)
    expect(JSON.parse(readFileSync(file, 'utf8')).generation).toBe(10)
    expect(await profileGenerations(home, root).current(TRUST_PURPOSE)).toBe(10)
    expect((await BrowserCertificateStore.open(root, home, testSigner('k'), clock)).size()).toBe(10)
  })

  it('keeps an exception in memory, and writes no file, when the generation cannot be taken', async () => {
    mkdirSync(homeGenerationsPath(home, root), { recursive: true })
    const store = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
    await store.add('staging.test', FP_A)
    expect(store.isExcepted('staging.test', FP_A)).toBe(true)
    expect(existsSync(file)).toBe(false)
  })

  it('takes no generation in memory-only mode', async () => {
    await (await BrowserCertificateStore.open(root, home, testSigner(null), clock)).add('staging.test', FP_A)
    expect(existsSync(homeGenerationsPath(home, root))).toBe(false)
  })

  itPosix('never reads or writes through a link at the file name', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'erfana-trust-out-'))
    try {
      const target = join(outside, 'target.json')
      writeFileSync(target, 'outside')
      symlinkSync(target, file)
      const store = await BrowserCertificateStore.open(root, home, testSigner('k'), clock)
      expect(store.size()).toBe(0)
      await store.add('staging.test', FP_A)
      expect(readFileSync(target, 'utf8')).toBe('outside')
      expect(lstatSync(file).isSymbolicLink()).toBe(false)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('keeps at most the newest exceptions', async () => {
    const store = await BrowserCertificateStore.open(root, home, testSigner(null), clock)
    for (let i = 0; i <= MAX_CERTIFICATE_EXCEPTIONS; i += 1) void store.add(`h${i}.test`, FP_A)
    expect(store.size()).toBe(MAX_CERTIFICATE_EXCEPTIONS)
    expect(store.isExcepted('h0.test', FP_A)).toBe(false)
    expect(store.isExcepted(`h${MAX_CERTIFICATE_EXCEPTIONS}.test`, FP_A)).toBe(true)
  })
})
