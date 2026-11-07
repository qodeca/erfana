// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTTP sign-in of a tab (025-FR-022, S-16): the sign-in box on the strip,
 * auto-send rules per scheme and address class, Remember only after the
 * site accepted, refusals, cancel, frames, focus, and what is not ours.
 */
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock, type TestClock } from '../../../../shared/clock'
import type { StripEvent, StripRow } from '../../../../shared/ipc/browser-tab-schema'
import { STRIP_INPUT_GUARD_MS, STRIP_QUEUE_GAP_MS, TabStrip, type StripFields } from '../permissions/tabStrip'
import { TabAuth, type AuthChallenge } from './browserAuth'
import { BrowserCredentialStore, type CredentialKey } from './credentialStore'
import { tempHome, tempProject, testCrypto, testSigner } from './__test-helpers__/siteFakes'

const BASIC = 'https://staging.test/basic'
const CHALLENGE: AuthChallenge = { isProxy: false, scheme: 'basic', host: 'staging.test', port: 443, realm: 'Staging' }
const KEY: CredentialKey = { scheme: 'https', host: 'staging.test', port: 443, realm: 'Staging' }
const SAVED = { username: 'staging', password: 'saved-pass' }

let clock: TestClock
let events: StripEvent[]
let strip: TabStrip
let store: BrowserCredentialStore
let root: string
let home: string
let topUrl: string
let pendingUser: boolean
let auth: TabAuth
let rows: number

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

async function setup(persistence: 'saved' | 'session'): Promise<void> {
  store =
    persistence === 'saved'
      ? await BrowserCredentialStore.open(root, { homeDir: home, signer: testSigner('k'), crypto: testCrypto(), backend: 'keychain' })
      : await BrowserCredentialStore.open(root, { homeDir: home, signer: testSigner('k'), crypto: testCrypto(), backend: 'basic_text' })
  auth = new TabAuth({
    tab: { contents: { getURL: () => topUrl }, hasPendingUserNavigation: () => pendingUser },
    strip,
    store: Promise.resolve(store),
    display: {
      text: (origin) => new URL(origin).host,
      parts: (origin) => ({ kind: 'web', scheme: null, subdomain: '', registrableDomain: new URL(origin).hostname, port: null, punycode: false })
    }
  })
}

beforeEach(async () => {
  root = tempProject('erfana-auth-')
  home = tempHome()
  clock = createManualClock(0)
  events = []
  rows = 0
  strip = new TabStrip({ tabId: 'browser-tab-1', clock, emit: (e) => events.push(e), newId: () => `row${++rows}` })
  topUrl = 'https://staging.test/'
  pendingUser = false
  await setup('saved')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

interface Login {
  readonly calls: Array<[string?, string?]>
  readonly prevented: boolean
}

async function login(url: string, options: { challenge?: Partial<AuthChallenge>; first?: boolean; navigation?: boolean } = {}): Promise<Login> {
  const calls: Array<[string?, string?]> = []
  let prevented = false
  auth.login(
    { preventDefault: () => (prevented = true) },
    { url, firstAuthAttempt: options.first ?? true, isRequestForNavigation: options.navigation ?? true },
    { ...CHALLENGE, ...options.challenge },
    (u, p) => calls.push([u, p])
  )
  await flush()
  return {
    calls,
    get prevented() {
      return prevented
    }
  }
}

function shownRow(): StripRow {
  const add = [...events].reverse().find((e) => e.op === 'add')
  if (add?.op !== 'add') throw new Error('no row')
  return add.row
}

function answer(value: 'signIn' | 'cancel', fields?: StripFields): string {
  clock.advance(STRIP_INPUT_GUARD_MS)
  const row = shownRow()
  expect(strip.answer(row.requestId, value, fields)).toBe('accepted')
  // The next request of the kind shows only after the queue gap.
  clock.advance(STRIP_QUEUE_GAP_MS)
  return row.requestId
}

describe('TabAuth', () => {
  it('025-AC-022 shows the box naming the host, focused after a user-started navigation, and signs in', async () => {
    auth.mainNavigation(BASIC)
    pendingUser = true
    const result = await login(BASIC)
    expect(result.prevented).toBe(true)
    expect(shownRow()).toMatchObject({
      kind: 'signIn',
      text: 'Sign in to staging.test',
      answers: ['signIn', 'cancel'],
      takesFocus: true,
      remembered: 'saved',
      signIn: { username: '', savedPassword: false, insecure: false, rejected: null, remember: 'available' }
    })
    answer('signIn', { username: 'staging', password: 'typed' })
    expect(result.calls).toEqual([['staging', 'typed']])
  })

  it('025-AC-022 a challenge the page caused shows the box without taking focus', async () => {
    pendingUser = true
    await login('https://staging.test/basic/api', { navigation: false })
    expect(shownRow().takesFocus).toBe(false)
  })

  it('025-AC-022 Remember saves only once the site accepted the sign-in', async () => {
    auth.mainNavigation(BASIC)
    await login(BASIC)
    answer('signIn', { username: 'staging', password: 'right', remember: true })
    expect(store.get(KEY)).toBeUndefined()
    auth.requestCompleted(BASIC, 200)
    await flush()
    expect(store.get(KEY)).toEqual({ username: 'staging', password: 'right' })
  })

  it('025-AC-022 a wrong password with Remember ticked saves nothing, and the box returns with an error line', async () => {
    auth.mainNavigation(BASIC)
    await login(BASIC)
    answer('signIn', { username: 'staging', password: 'wrong', remember: true })
    const retry = await login(BASIC, { first: false })
    expect(shownRow().signIn).toMatchObject({ username: 'staging', rejected: 'typed' })
    answer('cancel')
    expect(retry.calls).toEqual([[undefined, undefined]])
    auth.requestCompleted(BASIC, 401)
    await flush()
    expect(store.get(KEY)).toBeUndefined()
  })

  it('025-AC-022 a 401 or a failed request after Remember saves nothing', async () => {
    auth.mainNavigation(BASIC)
    await login(BASIC)
    answer('signIn', { username: 'staging', password: 'x', remember: true })
    auth.requestCompleted(BASIC, 401)
    await login(BASIC)
    answer('signIn', { username: 'staging', password: 'x', remember: true })
    auth.requestCompleted(BASIC, null)
    auth.requestCompleted('https://elsewhere.test/', 200)
    await flush()
    expect(store.size()).toBe(0)
  })

  it('025-AC-022 Cancel cancels the challenge and saves nothing', async () => {
    const result = await login(BASIC)
    answer('cancel')
    expect(result.calls).toEqual([[undefined, undefined]])
    expect(store.size()).toBe(0)
  })

  it('025-AC-022 sends a saved https sign-in without a box, and shows the saved-error box when it is refused', async () => {
    await store.set(KEY, SAVED)
    const first = await login(BASIC)
    expect(first.calls).toEqual([['staging', 'saved-pass']])
    expect(events).toEqual([])
    await login(BASIC, { first: false })
    expect(shownRow().signIn).toMatchObject({ username: 'staging', savedPassword: false, rejected: 'saved' })
  })

  it('025-AC-022 sends a saved http sign-in to localhost without a box, but not on another port or realm', async () => {
    const local: CredentialKey = { scheme: 'http', host: 'localhost', port: 4000, realm: 'Staging' }
    await store.set(local, SAVED)
    topUrl = 'http://localhost:4000/'
    const challenge = { host: 'localhost', port: 4000 }
    expect((await login('http://localhost:4000/basic', { challenge })).calls).toEqual([['staging', 'saved-pass']])
    expect((await login('http://localhost:4001/basic', { challenge: { ...challenge, port: 4001 } })).calls).toEqual([])
    expect(shownRow().signIn).toMatchObject({ savedPassword: false, insecure: false })
    strip.withdrawAll()
    expect((await login('http://localhost:4000/basic', { challenge: { ...challenge, realm: 'Other' } })).calls).toEqual([])
  })

  it('025-AC-022 opens the box pre-filled with the warning for a saved sign-in to a remote http host', async () => {
    const remote: CredentialKey = { scheme: 'http', host: 'staging.test', port: 80, realm: 'Staging' }
    await store.set(remote, SAVED)
    topUrl = 'http://staging.test/'
    const challenge = { port: 80 }
    const result = await login('http://staging.test/basic', { challenge })
    expect(result.calls).toEqual([])
    expect(shownRow().signIn).toEqual({ username: 'staging', savedPassword: true, insecure: true, rejected: null, remember: 'available' })
    // Signing in without typing a password uses the saved one, which never reached the row.
    answer('signIn', { username: 'staging' })
    expect(result.calls).toEqual([['staging', 'saved-pass']])
  })

  it('025-AC-022 a credential saved over https is not offered for http on the same host', async () => {
    await store.set({ ...KEY, port: 80 }, SAVED)
    topUrl = 'http://staging.test/'
    await login('http://staging.test/basic', { challenge: { port: 80 } })
    expect(shownRow().signIn).toMatchObject({ username: '', savedPassword: false, insecure: true })
  })

  it('S-16 does not send a saved local sign-in when the top-level page is public', async () => {
    await store.set({ scheme: 'http', host: '192.168.1.5', port: 80, realm: 'Staging' }, SAVED)
    topUrl = 'https://public.example/'
    const result = await login('http://192.168.1.5/x', { challenge: { host: '192.168.1.5', port: 80 }, navigation: false })
    expect(result.calls).toEqual([])
    expect(shownRow().signIn).toMatchObject({ savedPassword: true, insecure: false })
  })

  it('025-AC-022 a challenge from a cross-origin frame names the frame host first', async () => {
    topUrl = 'https://app.test/'
    auth.mainNavigation('https://app.test/')
    await login('https://frame.test/basic', { challenge: { host: 'frame.test' } })
    expect(shownRow()).toMatchObject({
      text: 'frame.test, inside app.test, asks you to sign in',
      takesFocus: false,
      requester: { origin: { registrableDomain: 'frame.test' }, inside: { registrableDomain: 'app.test' } }
    })
  })

  it('025-AC-022 on Linux basic_text Remember is not offered, and a ticked box saves nothing', async () => {
    await setup('session')
    auth.mainNavigation(BASIC)
    await login(BASIC)
    expect(shownRow()).toMatchObject({ remembered: 'session', signIn: { remember: 'noKeyring' } })
    answer('signIn', { username: 'u', password: 'p', remember: true })
    auth.requestCompleted(BASIC, 200)
    await flush()
    expect(store.size()).toBe(0)
  })

  it('leaves proxy, NTLM and Negotiate challenges and non-web addresses to Electron\'s default', async () => {
    for (const challenge of [{ isProxy: true }, { scheme: 'ntlm' }, { scheme: 'Negotiate' }]) {
      const result = await login(BASIC, { challenge })
      expect(result.prevented).toBe(false)
    }
    expect((await login('ftp://staging.test/')).prevented).toBe(false)
    expect((await login('not a url')).prevented).toBe(false)
    expect(events).toEqual([])
  })

  it('handles Digest like Basic', async () => {
    const result = await login(BASIC, { challenge: { scheme: 'Digest' } })
    expect(result.prevented).toBe(true)
    expect(shownRow().kind).toBe('signIn')
  })

  it('cancels when the row is withdrawn, the store fails, or the tab closed', async () => {
    const withdrawn = await login(BASIC)
    strip.withdrawAll()
    expect(withdrawn.calls).toEqual([[undefined, undefined]])

    const broken = new TabAuth({
      tab: { contents: { getURL: () => topUrl }, hasPendingUserNavigation: () => false },
      strip,
      store: Promise.reject(new Error('io')),
      display: { text: (o) => o, parts: () => null }
    })
    const calls: unknown[] = []
    broken.login({ preventDefault: vi.fn() }, { url: BASIC }, CHALLENGE, (...a) => calls.push(a))
    await flush()
    expect(calls).toEqual([[]])

    auth.mainNavigation(BASIC)
    await login(BASIC)
    clock.advance(STRIP_INPUT_GUARD_MS)
    const row = shownRow()
    auth.detach()
    const late = await login(BASIC)
    expect(late.calls).toEqual([[undefined, undefined]])
    strip.answer(row.requestId, 'signIn', { username: 'a', password: 'b', remember: true })
    auth.requestCompleted(BASIC, 200)
    await flush()
    expect(store.size()).toBe(0)
  })

  it('a row without a requester still works when the formatter gives no parts', async () => {
    const plain = new TabAuth({
      tab: { contents: { getURL: () => topUrl }, hasPendingUserNavigation: () => false },
      strip,
      store: Promise.resolve(store),
      display: { text: (o) => o, parts: () => null }
    })
    plain.login({ preventDefault: vi.fn() }, { url: BASIC }, CHALLENGE, () => undefined)
    await flush()
    expect(shownRow().requester).toBeUndefined()
    answer('signIn')
  })
})
