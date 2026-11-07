// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Keyring notices and canary on a real temporary profile (025-FR-018, ADR 0009
 * decisions 7 and 8), run for every storage backend. The fake crypto is keyed:
 * a canary written under one key does not decrypt under another, as when the
 * OS key store changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const warn = vi.fn()
vi.mock('../LoggingService', () => ({
  logger: { info: vi.fn(), warn: (...a: unknown[]) => warn(...a), error: vi.fn(), debug: vi.fn() }
}))

import { BrowserProfileError, canonicalProjectPath, ensureBrowserFolder, ensureProfileTree } from './browserProfileGuards'
import {
  CANARY_SEGMENTS,
  KEYRING_CANARY_TEXT,
  NOTICES_SEGMENTS,
  assessKeyring,
  dismissWeakProtectionNotice,
  type KeyringCrypto
} from './browserKeyringState'

const itPosix = process.platform === 'win32' ? it.skip : it
const runsAsRoot = typeof process.getuid === 'function' && process.getuid() === 0
const itPosixNonRoot = process.platform === 'win32' || runsAsRoot ? it.skip : it
const KEY_BACKENDS = ['keychain', 'dpapi', 'gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'] as const

/** XOR with a one-byte key and a tag, so a wrong key fails like `safeStorage` does. */
function fakeCrypto(key: number): KeyringCrypto {
  return {
    encryptString: (text) => Buffer.from([0x76, key, ...Buffer.from(text, 'utf8').map((b) => b ^ key)]),
    decryptString: (buf) => {
      if (buf[0] !== 0x76 || buf[1] !== key) throw new Error('Error while decrypting the ciphertext provided')
      return Buffer.from(buf.subarray(2).map((b) => b ^ key)).toString('utf8')
    }
  }
}

let base: string
let project: string

const read = (segments: readonly string[]): Promise<string> => readFile(join(project, ...segments), 'utf8')
const notices = async (): Promise<Record<string, unknown>> => JSON.parse(await read(NOTICES_SEGMENTS)) as Record<string, unknown>

beforeEach(async () => {
  warn.mockClear()
  base = await canonicalProjectPath(await mkdtemp(join(tmpdir(), 'erfana-keyring-')))
  project = join(base, 'project')
  await mkdir(project)
  await ensureBrowserFolder(project)
  await ensureProfileTree(project)
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe.each(KEY_BACKENDS)('assessKeyring – %s', (backend) => {
  it('a new profile writes a canary that decrypts, records the backend and shows no notice', async () => {
    const crypto = fakeCrypto(1)
    expect(await assessKeyring(project, backend, crypto)).toEqual({ weakProtection: false, keyringReset: false })
    const canary = Buffer.from(await read(CANARY_SEGMENTS), 'base64')
    expect(crypto.decryptString(canary)).toBe(KEYRING_CANARY_TEXT)
    expect(await notices()).toEqual({ version: 1, backend })
  })

  it('the same key on a later start shows no notice and keeps the canary', async () => {
    await assessKeyring(project, backend, fakeCrypto(1))
    const before = await read(CANARY_SEGMENTS)
    expect(await assessKeyring(project, backend, fakeCrypto(1))).toEqual({ weakProtection: false, keyringReset: false })
    expect(await read(CANARY_SEGMENTS)).toBe(before)
  })

  it('a changed key shows the reset notice once and rewrites the canary', async () => {
    await assessKeyring(project, backend, fakeCrypto(1))
    expect(await assessKeyring(project, backend, fakeCrypto(2))).toEqual({ weakProtection: false, keyringReset: true })
    expect(warn).toHaveBeenCalledWith('Browser keyring changed: stored logins were reset', { backend })
    expect(await assessKeyring(project, backend, fakeCrypto(2))).toEqual({ weakProtection: false, keyringReset: false })
  })

  it('a canary that decrypts to another text counts as a changed key', async () => {
    await writeFile(join(project, ...CANARY_SEGMENTS), fakeCrypto(1).encryptString('something else').toString('base64'))
    expect((await assessKeyring(project, backend, fakeCrypto(1))).keyringReset).toBe(true)
  })

  it('never shows the weak-protection notice, even when dismissal was never recorded', async () => {
    await writeFile(join(project, ...NOTICES_SEGMENTS), JSON.stringify({ version: 1, backend: 'basic_text' }))
    expect((await assessKeyring(project, backend, fakeCrypto(1))).weakProtection).toBe(false)
  })
})

describe('assessKeyring – basic_text (Linux with no keyring)', () => {
  it('shows the weak-protection notice on every start until dismissed, and writes no canary', async () => {
    const crypto = fakeCrypto(0)
    expect(await assessKeyring(project, 'basic_text', crypto)).toEqual({ weakProtection: true, keyringReset: false })
    expect(await assessKeyring(project, 'basic_text', crypto)).toEqual({ weakProtection: true, keyringReset: false })
    await dismissWeakProtectionNotice(project)
    expect(await assessKeyring(project, 'basic_text', crypto)).toEqual({ weakProtection: false, keyringReset: false })
    expect(await notices()).toEqual({ version: 1, backend: 'basic_text', weakProtectionDismissed: true })
    const erfanaDir = join(project, ...CANARY_SEGMENTS.slice(0, -1))
    expect(await readdir(erfanaDir)).not.toContain('keyring-canary.bin')
  })

  it('a switch from a keyring backend shows the reset notice once', async () => {
    await assessKeyring(project, 'gnome_libsecret', fakeCrypto(1))
    expect(await assessKeyring(project, 'basic_text', fakeCrypto(0))).toEqual({ weakProtection: true, keyringReset: true })
    expect(await assessKeyring(project, 'basic_text', fakeCrypto(0))).toEqual({ weakProtection: true, keyringReset: false })
  })

  it('back on the keyring, the old canary still decrypts: no reset', async () => {
    await assessKeyring(project, 'gnome_libsecret', fakeCrypto(1))
    await assessKeyring(project, 'basic_text', fakeCrypto(0))
    expect(await assessKeyring(project, 'gnome_libsecret', fakeCrypto(1))).toEqual({ weakProtection: false, keyringReset: false })
  })

  it('dismissal is per project: another project still shows the notice', async () => {
    await dismissWeakProtectionNotice(project)
    const other = join(base, 'other')
    await mkdir(other)
    await ensureBrowserFolder(other)
    await ensureProfileTree(other)
    expect((await assessKeyring(other, 'basic_text', fakeCrypto(0))).weakProtection).toBe(true)
    expect((await assessKeyring(project, 'basic_text', fakeCrypto(0))).weakProtection).toBe(false)
  })
})

describe('notices file robustness', () => {
  it('a corrupt notices file is treated as empty and rewritten', async () => {
    await writeFile(join(project, ...NOTICES_SEGMENTS), '{not json')
    expect(await assessKeyring(project, 'basic_text', fakeCrypto(0))).toEqual({ weakProtection: true, keyringReset: false })
    expect(await notices()).toEqual({ version: 1, backend: 'basic_text' })
  })

  it('a notices file with unknown fields is treated as empty', async () => {
    await writeFile(join(project, ...NOTICES_SEGMENTS), JSON.stringify({ version: 1, weakProtectionDismissed: true, extra: 1 }))
    expect((await assessKeyring(project, 'basic_text', fakeCrypto(0))).weakProtection).toBe(true)
  })

  it('dismissing twice writes once', async () => {
    await dismissWeakProtectionNotice(project)
    const first = await read(NOTICES_SEGMENTS)
    await dismissWeakProtectionNotice(project)
    expect(await read(NOTICES_SEGMENTS)).toBe(first)
  })

  it('leaves no temp files behind', async () => {
    await assessKeyring(project, 'keychain', fakeCrypto(1))
    await dismissWeakProtectionNotice(project)
    const names = await readdir(join(project, ...NOTICES_SEGMENTS.slice(0, -1)))
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('a folder at the canary name refuses the tab', async () => {
    await mkdir(join(project, ...CANARY_SEGMENTS))
    await expect(assessKeyring(project, 'keychain', fakeCrypto(1))).rejects.toBeInstanceOf(BrowserProfileError)
  })

  itPosix('a link at notices.json refuses the tab and the link target is never written', async () => {
    const target = join(base, 'target.json')
    await writeFile(target, 'untouched')
    await symlink(target, join(project, ...NOTICES_SEGMENTS))
    await expect(assessKeyring(project, 'basic_text', fakeCrypto(0))).rejects.toMatchObject({ code: 'link' })
    await expect(dismissWeakProtectionNotice(project)).rejects.toMatchObject({ code: 'link' })
    expect(await readFile(target, 'utf8')).toBe('untouched')
  })

  itPosix('a link at the canary refuses the tab', async () => {
    const target = join(base, 'canary-target')
    await writeFile(target, 'untouched')
    await symlink(target, join(project, ...CANARY_SEGMENTS))
    await expect(assessKeyring(project, 'keychain', fakeCrypto(1))).rejects.toMatchObject({ code: 'link' })
    expect(await readFile(target, 'utf8')).toBe('untouched')
  })

  itPosixNonRoot('an unreadable notices file is logged and treated as empty', async () => {
    await writeFile(join(project, ...NOTICES_SEGMENTS), JSON.stringify({ version: 1, weakProtectionDismissed: true }))
    await chmod(join(project, ...NOTICES_SEGMENTS), 0o000)
    try {
      expect((await assessKeyring(project, 'basic_text', fakeCrypto(0))).weakProtection).toBe(true)
      expect(warn).toHaveBeenCalledWith('Browser keyring: notices file unreadable', expect.any(Object))
    } finally {
      await chmod(join(project, ...NOTICES_SEGMENTS), 0o600).catch(() => undefined)
    }
  })

  it('a failing encrypt is logged and the browser keeps working', async () => {
    const broken: KeyringCrypto = {
      encryptString: () => {
        throw new Error('Encryption is not available')
      },
      decryptString: () => ''
    }
    expect(await assessKeyring(project, 'keychain', broken)).toEqual({ weakProtection: false, keyringReset: false })
    expect(warn).toHaveBeenCalledWith('Browser keyring: canary not written', expect.any(Object))
  })
})
