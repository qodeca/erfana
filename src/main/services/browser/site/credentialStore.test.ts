// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Saved sign-ins (025-FR-022, ADR 0009 decisions 6–7): per scheme, host,
 * port and realm; encrypted with the key store and signed; memory only on
 * Linux `basic_text`, without encryption or without a signing key.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { BrowserCredentialStore, CREDENTIALS_SEGMENTS, MAX_SAVED_CREDENTIALS, type CredentialKey } from './credentialStore'
import { tempProject, testCrypto, testSigner } from './__test-helpers__/siteFakes'

const KEY: CredentialKey = { scheme: 'https', host: 'staging.test', port: 443, realm: 'Staging' }
const SECRET = { username: 'staging-user', password: 'p4ss-w0rd-secret' }

let root: string
let file: string

beforeEach(() => {
  root = tempProject('erfana-cred-')
  file = join(root, ...CREDENTIALS_SEGMENTS)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const open = (options: Partial<Parameters<typeof BrowserCredentialStore.open>[1]> = {}): Promise<BrowserCredentialStore> =>
  BrowserCredentialStore.open(root, { signer: testSigner('k'), crypto: testCrypto(), backend: 'keychain', ...options })

describe('BrowserCredentialStore', () => {
  it('025-AC-022 keeps a remembered sign-in across a restart, never in plain text in the file', async () => {
    const store = await open()
    expect(store.persistence).toBe('saved')
    await store.set(KEY, SECRET)
    const text = readFileSync(file, 'utf8')
    expect(text).not.toContain(SECRET.password)
    expect(text).not.toContain(SECRET.username)
    expect((await open()).get(KEY)).toEqual(SECRET)
  })

  it('025-AC-022 uses a sign-in only for the same scheme, host, port and realm', async () => {
    const store = await open()
    await store.set(KEY, SECRET)
    expect(store.get({ ...KEY, host: 'STAGING.TEST' })).toEqual(SECRET)
    expect(store.get({ ...KEY, scheme: 'http' })).toBeUndefined()
    expect(store.get({ ...KEY, port: 8443 })).toBeUndefined()
    expect(store.get({ ...KEY, realm: 'Other' })).toBeUndefined()
    expect(store.get({ ...KEY, host: 'other.test' })).toBeUndefined()
  })

  it('025-AC-022 offers no saving on Linux basic_text and keeps sign-ins in memory only', async () => {
    const store = await open({ backend: 'basic_text' })
    expect(store.persistence).toBe('session')
    await store.set(KEY, SECRET)
    expect(store.get(KEY)).toEqual(SECRET)
    expect(existsSync(file)).toBe(false)
    expect((await open({ backend: 'basic_text' })).get(KEY)).toBeUndefined()
  })

  it('keeps sign-ins in memory only without encryption or without a signing key', async () => {
    expect((await open({ crypto: testCrypto(false) })).persistence).toBe('session')
    expect((await open({ signer: testSigner(null) })).persistence).toBe('session')
    const throwing = { ...testCrypto(), isEncryptionAvailable: () => { throw new Error('no dbus') } }
    expect((await open({ crypto: throwing })).persistence).toBe('session')
  })

  it('does not read a file from a session store, and ignores a file signed by another key', async () => {
    await (await open()).set(KEY, SECRET)
    expect((await open({ backend: 'basic_text' })).size()).toBe(0)
    expect((await open({ signer: testSigner('other') })).size()).toBe(0)
  })

  it('drops an entry that no longer decrypts (the keyring changed)', async () => {
    await (await open()).set(KEY, SECRET)
    const crypto = testCrypto()
    crypto.broken = true
    const store = await open({ crypto })
    expect(store.size()).toBe(1)
    expect(store.get(KEY)).toBeUndefined()
    expect(store.size()).toBe(0)
  })

  it('does not save when encryption fails, or a field is too long', async () => {
    const failing = { ...testCrypto(), encryptString: () => { throw new Error('locked') } }
    const store = await open({ crypto: failing })
    await store.set(KEY, SECRET)
    expect(store.size()).toBe(0)
    await store.set(KEY, { username: 'u', password: 'x'.repeat(2000) })
    expect(store.size()).toBe(0)
  })

  it('025-AC-023 Clear forgets every saved sign-in, in memory and in the file', async () => {
    const store = await open()
    await store.set(KEY, SECRET)
    await store.clear()
    expect(store.get(KEY)).toBeUndefined()
    expect((await open()).size()).toBe(0)
    const session = await open({ backend: 'basic_text' })
    await session.set(KEY, SECRET)
    await session.clear()
    expect(session.size()).toBe(0)
  })

  it('ignores a file whose secret is not base64 or whose entries do not match', async () => {
    writeFileSync(file, JSON.stringify({ version: 1, entries: [{ ...KEY, secret: 'not base64!' }], hmac: 'a'.repeat(64) }))
    expect((await open()).size()).toBe(0)
  })

  it('keeps at most the newest sign-ins, in both kinds of store', async () => {
    for (const store of [await open({ backend: 'basic_text' }), await open()]) {
      for (let i = 0; i <= MAX_SAVED_CREDENTIALS; i += 1) void store.set({ ...KEY, host: `h${i}.test` }, SECRET)
      expect(store.size()).toBe(MAX_SAVED_CREDENTIALS)
      expect(store.get({ ...KEY, host: 'h0.test' })).toBeUndefined()
    }
  })
})
