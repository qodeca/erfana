// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Saved site-permission decisions (spec 025, 025-FR-019; ADR 0009 decisions
 * 6–7, S-26): the signed `profile/Erfana/permissions.json` at the home
 * generation, replayed or copied files refused, memory only without a key,
 * never through a link.
 */
import { createHmac } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import type { PurposeSigner } from '../browserProfileMarker'
import { homeGenerationsPath, profileGenerations } from '../profileGenerations'
import { BrowserPermissionStore, MAX_DECISIONS, PERMISSIONS_PURPOSE, PERMISSIONS_SEGMENTS } from './permissionStore'

/** Creating a symbolic link needs a privilege on Windows. */
const itPosix = process.platform === 'win32' ? it.skip : it

const A = 'https://a.test'
const B = 'https://b.test'

function signer(key: string | null): PurposeSigner {
  const digest = (purpose: string, body: string): string => createHmac('sha256', key ?? '').update(`${purpose}\0${body}`).digest('hex')
  return {
    hasKey: () => key !== null,
    sign: (purpose, body) => (key === null ? undefined : digest(purpose, body)),
    verify: (purpose, body, d) => {
      if (!d) return 'missing'
      if (key === null) return 'no-key'
      return digest(purpose, body) === d ? 'valid' : 'invalid'
    }
  }
}

let root: string
let home: string
let file: string

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-perm-')))
  mkdirSync(join(root, ...PERMISSIONS_SEGMENTS.slice(0, -1)), { recursive: true })
  file = join(root, ...PERMISSIONS_SEGMENTS)
  home = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-perm-home-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

describe('BrowserPermissionStore', () => {
  it('025-AC-019 keeps Allow and Block per requesting and top-level origin pair, across a restart', async () => {
    const store = await BrowserPermissionStore.open(root, home, signer('k'))
    expect(store.persistence).toBe('saved')
    await store.set(A, A, ['notifications'], 'allow')
    await store.set(B, A, ['location'], 'block')
    expect(store.get(A, A, 'notifications')).toBe('allow')
    expect(store.get(B, B, 'location')).toBeUndefined()

    const reopened = await BrowserPermissionStore.open(root, home, signer('k'))
    expect(reopened.get(A, A, 'notifications')).toBe('allow')
    expect(reopened.get(B, A, 'location')).toBe('block')
    expect(reopened.size()).toBe(2)
    expect(JSON.parse(readFileSync(file, 'utf8')).hmac).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never saves screen sharing', async () => {
    const store = await BrowserPermissionStore.open(root, home, signer('k'))
    await store.set(A, A, ['screen'], 'allow')
    expect(store.get(A, A, 'screen')).toBeUndefined()
    expect(store.size()).toBe(0)
  })

  it('a later answer replaces an earlier one', async () => {
    const store = await BrowserPermissionStore.open(root, home, signer('k'))
    await store.set(A, A, ['camera', 'microphone'], 'allow')
    await store.set(A, A, ['camera'], 'block')
    expect(store.get(A, A, 'camera')).toBe('block')
    expect(store.get(A, A, 'microphone')).toBe('allow')
  })

  it('ignores a file signed by another key, a file with no signature and a malformed file', async () => {
    const store = await BrowserPermissionStore.open(root, home, signer('k'))
    await store.set(A, A, ['camera'], 'allow')
    expect((await BrowserPermissionStore.open(root, home, signer('other'))).size()).toBe(0)

    const planted = JSON.parse(readFileSync(file, 'utf8'))
    delete planted.hmac
    writeFileSync(file, JSON.stringify(planted))
    expect((await BrowserPermissionStore.open(root, home, signer('k'))).size()).toBe(0)

    writeFileSync(file, '{not json')
    expect((await BrowserPermissionStore.open(root, home, signer('k'))).size()).toBe(0)
    writeFileSync(file, JSON.stringify({ version: 1, decisions: [{ requesting: A, top: A, permission: 'screen', decision: 'allow' }] }))
    expect((await BrowserPermissionStore.open(root, home, signer('k'))).size()).toBe(0)
  })

  it('ADR 0009 decision 6 refuses an older signed file put back (a revoked Allow restored)', async () => {
    const store = await BrowserPermissionStore.open(root, home, signer('k'))
    await store.set(A, A, ['camera'], 'allow')
    const older = readFileSync(file)
    await store.set(A, A, ['camera'], 'block')
    writeFileSync(file, older)
    const reopened = await BrowserPermissionStore.open(root, home, signer('k'))
    expect(reopened.get(A, A, 'camera')).toBeUndefined()
    expect(reopened.size()).toBe(0)
  })

  it('refuses a file copied from another project, even at the same generation', async () => {
    await (await BrowserPermissionStore.open(root, home, signer('k'))).set(A, A, ['camera'], 'allow')
    const other = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-perm-b-')))
    try {
      mkdirSync(join(other, ...PERMISSIONS_SEGMENTS.slice(0, -1)), { recursive: true })
      await (await BrowserPermissionStore.open(other, home, signer('k'))).set(B, B, ['location'], 'block')
      writeFileSync(join(other, ...PERMISSIONS_SEGMENTS), readFileSync(file))
      expect((await BrowserPermissionStore.open(other, home, signer('k'))).size()).toBe(0)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('refuses an existing file when the home generation record is missing (fail closed)', async () => {
    await (await BrowserPermissionStore.open(root, home, signer('k'))).set(A, A, ['camera'], 'allow')
    rmSync(homeGenerationsPath(home, root))
    expect((await BrowserPermissionStore.open(root, home, signer('k'))).size()).toBe(0)
  })

  it('ignores a version 1 file, even one signed by this account', async () => {
    const decisions = [{ requesting: A, top: A, permission: 'camera', decision: 'allow' }]
    const hmac = signer('k').sign(PERMISSIONS_PURPOSE, JSON.stringify({ version: 1, decisions }))
    writeFileSync(file, JSON.stringify({ version: 1, decisions, hmac }))
    expect((await BrowserPermissionStore.open(root, home, signer('k'))).size()).toBe(0)
  })

  it('keeps the generation monotonic when saves overlap', async () => {
    const store = await BrowserPermissionStore.open(root, home, signer('k'))
    await Promise.all(Array.from({ length: 8 }, (_, i) => store.set(`https://s${i}.test`, A, ['camera'], 'allow')))
    expect(JSON.parse(readFileSync(file, 'utf8')).generation).toBe(8)
    expect((await BrowserPermissionStore.open(root, home, signer('k'))).size()).toBe(8)
  })

  it('S-26 keeps decisions in memory only, and never reads or writes the file, with no signing key', async () => {
    const signed = await BrowserPermissionStore.open(root, home, signer('k'))
    await signed.set(A, A, ['camera'], 'allow')
    const before = readFileSync(file, 'utf8')

    const memory = await BrowserPermissionStore.open(root, home, signer(null))
    expect(memory.persistence).toBe('session')
    expect(memory.get(A, A, 'camera')).toBeUndefined()
    await memory.set(B, B, ['location'], 'block')
    expect(memory.get(B, B, 'location')).toBe('block')
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(await profileGenerations(home, root).current(PERMISSIONS_PURPOSE)).toBe(1)
  })

  itPosix('does not follow a link planted at the file name, and keeps working in memory', async () => {
    const outside = join(root, 'outside.json')
    writeFileSync(outside, 'secret')
    symlinkSync(outside, file)
    const store = await BrowserPermissionStore.open(root, home, signer('k'))
    expect(store.size()).toBe(0)
    await store.set(A, A, ['camera'], 'allow')
    expect(store.get(A, A, 'camera')).toBe('allow')
    // The rename replaced the link; the file it pointed at is untouched.
    expect(readFileSync(outside, 'utf8')).toBe('secret')
  })

  it('keeps working in memory when the file cannot be written', async () => {
    rmSync(join(root, ...PERMISSIONS_SEGMENTS.slice(0, -1)), { recursive: true })
    const store = await BrowserPermissionStore.open(root, home, signer('k'))
    await store.set(A, A, ['camera'], 'block')
    expect(store.get(A, A, 'camera')).toBe('block')
  })

  it('clears every decision (Clear browsing data) and writes the empty set', async () => {
    const store = await BrowserPermissionStore.open(root, home, signer('k'))
    await store.set(A, A, ['camera'], 'allow')
    await store.clear()
    expect(store.size()).toBe(0)
    expect((await BrowserPermissionStore.open(root, home, signer('k'))).size()).toBe(0)
  })

  it(`keeps at most ${MAX_DECISIONS} decisions, dropping the oldest`, async () => {
    const store = await BrowserPermissionStore.open(root, home, signer(null))
    for (let i = 0; i <= MAX_DECISIONS; i += 1) void store.set(`https://s${i}.test`, A, ['camera'], 'allow')
    expect(store.size()).toBe(MAX_DECISIONS)
    expect(store.get('https://s0.test', A, 'camera')).toBeUndefined()
    expect(store.get(`https://s${MAX_DECISIONS}.test`, A, 'camera')).toBe('allow')
  })

  it('signs with its own purpose', async () => {
    const seen: string[] = []
    const base = signer('k')
    const store = await BrowserPermissionStore.open(root, home, { ...base, sign: (p, b) => (seen.push(p), base.sign(p, b)) })
    await store.set(A, A, ['camera'], 'allow')
    expect(seen).toEqual([PERMISSIONS_PURPOSE])
  })
})
