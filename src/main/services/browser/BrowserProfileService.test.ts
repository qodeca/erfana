// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * BrowserProfileService on a real temporary project (025-FR-015, 025-FR-016,
 * 025-FR-018; ADR 0009 decisions 2–4, 7; panel findings S3, A5, A13).
 * `session.fromPath`, the project lock, git and the signer are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../LoggingService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { createManualClock } from '../../../shared/clock'
import type { LockResult, LockStatus } from '../../../shared/ipc/project-lock-schema'
import {
  BrowserProfileService,
  storageBackendFor,
  type BrowserProfileServiceDeps,
  type StorageBackend
} from './BrowserProfileService'
import { canonicalProjectPath } from './browserProfileGuards'
import { homeMarkerPath, type PurposeSigner } from './browserProfileMarker'

const itPosix = process.platform === 'win32' ? it.skip : it
const START = Date.UTC(2026, 10, 2, 10, 15, 30, 123)

/** A signer with a fixed key, or none (Linux basic_text). */
function fakeSigner(keyed: boolean, secret = 'k1'): PurposeSigner {
  const digest = (purpose: string, body: string): string =>
    createHmac('sha256', `${secret}:${purpose}`).update(body).digest('hex')
  return {
    hasKey: () => keyed,
    sign: (purpose, body) => (keyed ? digest(purpose, body) : undefined),
    verify: (purpose, body, value) => {
      if (!value) return 'missing'
      if (!keyed) return 'no-key'
      return value === digest(purpose, body) ? 'valid' : 'invalid'
    }
  }
}

let base: string
let project: string
let home: string
let fromPathCalls: string[]
let lockStatus: LockStatus
let acquireResult: LockResult
let tracked: boolean
let deps: BrowserProfileServiceDeps

/** A keyed fake of `safeStorage`: a canary written under one key fails to decrypt under another. */
function fakeKeyringCrypto(key: number): BrowserProfileServiceDeps['keyringCrypto'] {
  return {
    encryptString: (text) => Buffer.from([key, ...Buffer.from(text, 'utf8')]),
    decryptString: (buf) => {
      if (buf[0] !== key) throw new Error('Error while decrypting the ciphertext provided')
      return buf.subarray(1).toString('utf8')
    }
  }
}

const browserDir = (): string => join(project, '.erfana', 'browser')
const markerFile = (): string => join(browserDir(), 'profile', 'Erfana', 'marker.json')

function makeService(overrides: Partial<BrowserProfileServiceDeps> = {}): BrowserProfileService {
  deps = {
    projectSession: {
      current: () => ({ generation: 1, root: project, realRoot: project, caseSensitive: true, ownerWebContentsId: 1 })
    },
    lockService: {
      checkLock: vi.fn(async () => lockStatus),
      acquireLock: vi.fn(async () => acquireResult)
    },
    fromPath: vi.fn((path: string) => {
      fromPathCalls.push(path)
      return { path }
    }),
    registerSession: vi.fn(),
    hardenSession: vi.fn(),
    signer: fakeSigner(true),
    keyringCrypto: fakeKeyringCrypto(1),
    storageBackend: () => 'keychain',
    isTrackedByGit: vi.fn(async () => tracked),
    markIgnoredBySync: vi.fn(async () => undefined),
    homeDir: home,
    platform: 'darwin',
    clock: createManualClock(START),
    ...overrides
  }
  return new BrowserProfileService(deps)
}

beforeEach(async () => {
  base = await canonicalProjectPath(await mkdtemp(join(tmpdir(), 'erfana-profile-')))
  project = join(base, 'project')
  home = join(base, 'home')
  await mkdir(project)
  await mkdir(home)
  fromPathCalls = []
  lockStatus = { status: 'locked_by_self', lockPath: '/locks/x.lock' }
  acquireResult = { status: 'acquired', lockPath: '/locks/x.lock' }
  tracked = false
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('BrowserProfileService.openForTab – first tab', () => {
  it('025-AC-016 writes .gitignore before the browser session is created', async () => {
    const service = makeService({
      fromPath: vi.fn((path: string) => {
        // Recorded at the moment the session is created
        fromPathCalls.push(path)
        expect(existsSync(join(browserDir(), '.gitignore'))).toBe(true)
        return { path }
      })
    })
    await service.openForTab()
    expect(fromPathCalls).toEqual([join(project, '.erfana', 'browser', 'profile')])
    expect(await readFile(join(browserDir(), '.gitignore'), 'utf8')).toBe('*')
  })

  it('creates the session from the canonical path and registers it as a browser session', async () => {
    const link = join(base, 'via-link')
    await symlink(project, link, 'dir')
    const service = makeService({
      projectSession: {
        current: () => ({ generation: 1, root: link, realRoot: project, caseSensitive: true, ownerWebContentsId: 1 })
      }
    })
    const profile = await service.openForTab()
    expect(profile.projectRoot).toBe(project)
    expect(fromPathCalls).toEqual([join(project, '.erfana', 'browser', 'profile')])
    expect(deps.registerSession).toHaveBeenCalledWith(profile.session)
  })

  it('lists the sessions opened in this run, leaving out a failed open', async () => {
    const service = makeService()
    expect(await service.openSessions()).toEqual([])
    const profile = await service.openForTab()
    expect(await service.openSessions()).toEqual([profile.session])
  })

  it('leaves out an open that fails while the list is being read', async () => {
    let rejectLock: ((error: Error) => void) | undefined
    const service = makeService({
      lockService: {
        checkLock: vi.fn(
          () =>
            new Promise<never>((_resolve, reject) => {
              rejectLock = reject
            })
        ),
        acquireLock: vi.fn()
      }
    })
    const opening = service.openForTab()
    await vi.waitFor(() => expect(rejectLock).toBeTypeOf('function'))
    const sessions = service.openSessions()
    rejectLock?.(new Error('lock read failed'))
    await expect(opening).rejects.toThrow('lock read failed')
    expect(await sessions).toEqual([])
  })

  it('hardens the session once, right after registering it and before openForTab returns', async () => {
    const order: string[] = []
    const service = makeService({
      registerSession: vi.fn(() => order.push('register')),
      hardenSession: vi.fn(() => order.push('harden'))
    })
    const profile = await service.openForTab()
    expect(order).toEqual(['register', 'harden'])
    expect(deps.hardenSession).toHaveBeenCalledWith(profile.session)
    await service.openForTab()
    expect(deps.hardenSession).toHaveBeenCalledTimes(1)
  })

  it('creates the profile and captures folders and a signed marker with a home copy', async () => {
    const service = makeService()
    const profile = await service.openForTab()
    expect(profile).toMatchObject({ backend: 'keychain', trust: 'signed', setAside: null })
    const marker = JSON.parse(await readFile(markerFile(), 'utf8'))
    expect(marker).toEqual({
      version: 1,
      projectPath: project,
      createdAt: '2026-11-02T10:15:30.123Z',
      hmac: expect.stringMatching(/^[0-9a-f]{64}$/)
    })
    expect(JSON.parse(await readFile(homeMarkerPath(home, project), 'utf8'))).toEqual(marker)
    expect((await readdir(browserDir())).sort()).toEqual(['.gitignore', 'captures', 'profile'])
  })

  it('asks cloud sync to ignore the browser folder', async () => {
    const service = makeService()
    await service.openForTab()
    expect(deps.markIgnoredBySync).toHaveBeenCalledWith(browserDir())
  })

  it('refuses when no project is open', async () => {
    const service = makeService({ projectSession: { current: () => null } })
    await expect(service.openForTab()).rejects.toMatchObject({ code: 'no-project' })
  })

  it('refuses when the project folder moved since it was opened', async () => {
    const service = makeService({
      projectSession: {
        current: () => ({ generation: 1, root: project, realRoot: join(base, 'elsewhere'), caseSensitive: true, ownerWebContentsId: 1 })
      }
    })
    await expect(service.openForTab()).rejects.toMatchObject({ code: 'no-project' })
    expect(fromPathCalls).toEqual([])
  })

  itPosix('025-AC-069 refuses a symlinked profile and creates no session', async () => {
    await mkdir(join(base, 'outside'))
    await mkdir(join(project, '.erfana', 'browser'), { recursive: true })
    await symlink(join(base, 'outside'), join(browserDir(), 'profile'), 'dir')
    const service = makeService()
    await expect(service.openForTab()).rejects.toMatchObject({ code: 'link', relPath: '.erfana/browser/profile' })
    expect(fromPathCalls).toEqual([])
  })
})

describe('one browser session per project process (ADR 0009 decision 4, A5)', () => {
  it('refuses when another Erfana process holds the project lock, naming it', async () => {
    lockStatus = { status: 'locked_by_other', holderPid: 4242, holderHostname: 'h' }
    const service = makeService()
    const error = await service.openForTab().catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'locked-elsewhere' })
    expect((error as Error).message).toContain('4242')
    expect(fromPathCalls).toEqual([])
    expect(existsSync(join(project, '.erfana'))).toBe(false)
  })

  it('takes a free (or stale) lock through the lock service', async () => {
    lockStatus = { status: 'unlocked' }
    const service = makeService()
    await service.openForTab()
    expect(deps.lockService.acquireLock).toHaveBeenCalledWith(project)
    expect(fromPathCalls).toHaveLength(1)
  })

  it('refuses when the free lock was taken by another process first', async () => {
    lockStatus = { status: 'unlocked' }
    acquireResult = { status: 'already_locked', holderPid: 7, holderHostname: 'h' }
    const service = makeService()
    await expect(service.openForTab()).rejects.toMatchObject({ code: 'locked-elsewhere' })
  })

  it.each<[LockStatus, LockResult]>([
    [{ status: 'error', message: 'x' }, { status: 'acquired', lockPath: 'l' }],
    [{ status: 'unlocked' }, { status: 'error', message: 'disk' }]
  ])('fails closed when the lock cannot be confirmed (%j, %j)', async (status, acquired) => {
    lockStatus = status
    acquireResult = acquired
    const service = makeService()
    await expect(service.openForTab()).rejects.toMatchObject({ code: 'locked-elsewhere' })
    expect(fromPathCalls).toEqual([])
  })

  it('creates the session once for concurrent first tabs', async () => {
    const service = makeService()
    const [a, b] = await Promise.all([service.openForTab(), service.openForTab()])
    expect(a.session).toBe(b.session)
    expect(fromPathCalls).toHaveLength(1)
  })

  it('retries from scratch after a failed first open', async () => {
    lockStatus = { status: 'locked_by_other', holderPid: 1, holderHostname: 'h' }
    const service = makeService()
    await expect(service.openForTab()).rejects.toBeDefined()
    lockStatus = { status: 'locked_by_self', lockPath: 'l' }
    await service.openForTab()
    expect(fromPathCalls).toHaveLength(1)
  })
})

describe('later tabs', () => {
  it('025-AC-016 writes a deleted .gitignore again before the next tab opens, with the same session', async () => {
    const service = makeService()
    const first = await service.openForTab()
    await rm(join(browserDir(), '.gitignore'))
    const second = await service.openForTab()
    expect(second).toBe(first)
    expect(await readFile(join(browserDir(), '.gitignore'), 'utf8')).toBe('*')
    expect(fromPathCalls).toHaveLength(1)
    expect(deps.lockService.checkLock).toHaveBeenCalledTimes(1)
  })

  itPosix('025-AC-069 refuses a later tab when captures became a symlink', async () => {
    const service = makeService()
    await service.openForTab()
    await mkdir(join(base, 'outside'))
    await rm(join(browserDir(), 'captures'), { recursive: true })
    await symlink(join(base, 'outside'), join(browserDir(), 'captures'), 'dir')
    await expect(service.openForTab()).rejects.toMatchObject({ code: 'link', relPath: '.erfana/browser/captures' })
  })
})

describe('a cloned or copied profile is set aside (S3, spec change S-12)', () => {
  async function seedProfile(): Promise<void> {
    await makeService().openForTab()
    await writeFile(join(browserDir(), 'profile', 'Cookies'), 'old cookies')
  }

  async function openAgain(overrides: Partial<BrowserProfileServiceDeps> = {}): Promise<{ setAside: string | null }> {
    // A new service is a new run of the app
    return makeService(overrides).openForTab()
  }

  it('keeps a profile Erfana created for this path on this account', async () => {
    await seedProfile()
    const profile = await openAgain()
    expect(profile.setAside).toBeNull()
    expect(await readFile(join(browserDir(), 'profile', 'Cookies'), 'utf8')).toBe('old cookies')
  })

  it('sets aside a profile with no home copy (cloned from another machine or account)', async () => {
    await seedProfile()
    await rm(homeMarkerPath(home, project))
    const profile = await openAgain()
    expect(profile.setAside).toBe('profile.untrusted-2026-11-02T10-15-30-123Z')
    expect(await readFile(join(browserDir(), profile.setAside!, 'Cookies'), 'utf8')).toBe('old cookies')
    expect(existsSync(join(browserDir(), 'profile', 'Cookies'))).toBe(false)
    // A fresh profile gets a fresh marker and home copy
    expect(JSON.parse(await readFile(markerFile(), 'utf8')).projectPath).toBe(project)
    expect(existsSync(homeMarkerPath(home, project))).toBe(true)
  })

  it('sets aside a profile with no marker', async () => {
    await mkdir(join(browserDir(), 'profile'), { recursive: true })
    await writeFile(join(browserDir(), 'profile', 'Cookies'), 'shipped')
    expect((await openAgain()).setAside).not.toBeNull()
  })

  it('sets aside a profile whose marker names another path (copied project)', async () => {
    await seedProfile()
    const marker = JSON.parse(await readFile(markerFile(), 'utf8'))
    const moved = { ...marker, projectPath: '/somewhere/else' }
    await writeFile(markerFile(), JSON.stringify(moved))
    await writeFile(homeMarkerPath(home, project), JSON.stringify(moved))
    expect((await openAgain()).setAside).not.toBeNull()
  })

  it('sets aside a profile whose two marker copies differ', async () => {
    await seedProfile()
    const marker = JSON.parse(await readFile(markerFile(), 'utf8'))
    await writeFile(homeMarkerPath(home, project), JSON.stringify({ ...marker, createdAt: '2020-01-01T00:00:00.000Z' }))
    expect((await openAgain()).setAside).not.toBeNull()
  })

  it('sets aside a profile whose signature does not verify with this account key', async () => {
    await seedProfile()
    expect((await openAgain({ signer: fakeSigner(true, 'other-account') })).setAside).not.toBeNull()
  })

  it('sets aside a profile with an unreadable marker', async () => {
    await seedProfile()
    await writeFile(markerFile(), '{not json')
    expect((await openAgain()).setAside).not.toBeNull()
  })

  it('sets aside a marker with unknown fields', async () => {
    await seedProfile()
    const marker = JSON.parse(await readFile(markerFile(), 'utf8'))
    const extended = JSON.stringify({ ...marker, extra: true })
    await writeFile(markerFile(), extended)
    await writeFile(homeMarkerPath(home, project), extended)
    expect((await openAgain()).setAside).not.toBeNull()
  })

  it('sets aside a profile git tracks, whatever its marker says', async () => {
    await seedProfile()
    tracked = true
    expect((await openAgain()).setAside).not.toBeNull()
  })

  it('does not ask git when there is no profile yet', async () => {
    await openAgain()
    expect(deps.isTrackedByGit).not.toHaveBeenCalled()
  })

  it('picks a free name when a set-aside folder of the same time exists', async () => {
    await seedProfile()
    await mkdir(join(browserDir(), 'profile.untrusted-2026-11-02T10-15-30-123Z'))
    await rm(homeMarkerPath(home, project))
    expect((await openAgain()).setAside).toBe('profile.untrusted-2026-11-02T10-15-30-123Z-1')
  })
})

describe('per safeStorage backend (ADR 0009 decision 7, A13)', () => {
  const keyed: StorageBackend[] = ['keychain', 'dpapi', 'gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']

  it.each(keyed)('%s: signs the marker and keeps trust in signed files', async (backend) => {
    const profile = await makeService({ storageBackend: () => backend, signer: fakeSigner(true) }).openForTab()
    expect(profile).toMatchObject({ backend, trust: 'signed' })
    expect(JSON.parse(await readFile(markerFile(), 'utf8')).hmac).toMatch(/^[0-9a-f]{64}$/)
  })

  it('basic_text: writes an unsigned marker and keeps trust in memory only', async () => {
    const profile = await makeService({ storageBackend: () => 'basic_text', signer: fakeSigner(false) }).openForTab()
    expect(profile).toMatchObject({ backend: 'basic_text', trust: 'memory' })
    expect(JSON.parse(await readFile(markerFile(), 'utf8'))).not.toHaveProperty('hmac')
  })

  it('basic_text: keeps its own profile on the two-copies rule across runs', async () => {
    const run = (): Promise<{ setAside: string | null }> =>
      makeService({ storageBackend: () => 'basic_text', signer: fakeSigner(false) }).openForTab()
    await run()
    expect((await run()).setAside).toBeNull()
  })

  it('basic_text: still sets aside a cloned profile (no home copy)', async () => {
    const run = (): Promise<{ setAside: string | null }> =>
      makeService({ storageBackend: () => 'basic_text', signer: fakeSigner(false) }).openForTab()
    await run()
    await rm(homeMarkerPath(home, project))
    expect((await run()).setAside).not.toBeNull()
  })

  it('a switch from basic_text to a keyring sets the unsigned profile aside (its cookies are unreadable anyway)', async () => {
    await makeService({ storageBackend: () => 'basic_text', signer: fakeSigner(false) }).openForTab()
    const profile = await makeService({ storageBackend: () => 'gnome_libsecret', signer: fakeSigner(true) }).openForTab()
    expect(profile.setAside).not.toBeNull()
  })

  it('a switch from a keyring to basic_text keeps the profile on the two-copies rule', async () => {
    await makeService({ signer: fakeSigner(true) }).openForTab()
    const profile = await makeService({ storageBackend: () => 'basic_text', signer: fakeSigner(false) }).openForTab()
    expect(profile.setAside).toBeNull()
  })
})

describe('keyring notices (025-FR-018)', () => {
  it('a keyring backend shows no notice, and a changed key shows the reset notice to the first tab only', async () => {
    const first = makeService()
    await first.openForTab()
    expect(await first.takeKeyringNotices()).toEqual({ weakProtection: false, keyringReset: false })

    const changed = makeService({ keyringCrypto: fakeKeyringCrypto(2) })
    await changed.openForTab()
    expect(await changed.takeKeyringNotices()).toEqual({ weakProtection: false, keyringReset: true })
    await changed.openForTab()
    expect(await changed.takeKeyringNotices()).toEqual({ weakProtection: false, keyringReset: false })
  })

  it('basic_text: the weak-protection notice shows on the first tab of each run until dismissed', async () => {
    const run = async (): Promise<BrowserProfileService> => {
      const service = makeService({ storageBackend: () => 'basic_text', signer: fakeSigner(false) })
      await service.openForTab()
      return service
    }
    const one = await run()
    expect((await one.takeKeyringNotices()).weakProtection).toBe(true)
    expect((await one.takeKeyringNotices()).weakProtection).toBe(false)
    const two = await run()
    expect((await two.takeKeyringNotices()).weakProtection).toBe(true)
    await two.dismissWeakProtectionNotice()
    const three = await run()
    expect((await three.takeKeyringNotices()).weakProtection).toBe(false)
  })

  it('takes no notices while the project has no open profile', async () => {
    expect(await makeService().takeKeyringNotices()).toEqual({ weakProtection: false, keyringReset: false })
  })

  it('the profile carries what the keyring check found', async () => {
    const profile = await makeService({ storageBackend: () => 'basic_text', signer: fakeSigner(false) }).openForTab()
    expect(profile.keyring).toEqual({ weakProtection: true, keyringReset: false })
  })
})

describe('storageBackendFor', () => {
  it.each<[NodeJS.Platform, StorageBackend]>([
    ['darwin', 'keychain'],
    ['win32', 'dpapi'],
    ['freebsd', 'unknown']
  ])('%s → %s', (platform, expected) => {
    expect(storageBackendFor(platform, () => 'basic_text')).toBe(expected)
  })

  it.each(['basic_text', 'gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6', 'unknown'] as const)(
    'linux reports %s from safeStorage',
    (backend) => {
      expect(storageBackendFor('linux', () => backend)).toBe(backend)
    }
  )
})

describe('deleteBrowserData', () => {
  it('deletes a path under .erfana/browser of the open project', async () => {
    const service = makeService()
    await service.openForTab()
    await writeFile(join(browserDir(), 'captures', 'a.png'), 'x')
    expect(await service.deleteBrowserData(['captures', 'a.png'])).toBe('deleted')
    expect(await service.deleteBrowserData(['captures', 'a.png'])).toBe('absent')
  })

  it('runs no pending deletes when none are stored', async () => {
    await expect(makeService().runPendingDeletes()).resolves.toBeUndefined()
  })
})
