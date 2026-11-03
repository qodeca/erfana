// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Per-tab wiring of certificates and sign-in (025-FR-021, 025-FR-022): the
 * tab's events reach the handlers, stores are shared per project, Clear
 * empties them, and a destroyed or detached tab stops listening.
 */
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock, type TestClock } from '../../../../shared/clock'
import type { StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { FakeContents } from '../__test-helpers__/fakeBrowserView'
import { STRIP_INPUT_GUARD_MS, TabStrip } from '../permissions/tabStrip'
import { CERTIFICATE_INPUT_GUARD_MS, type TabCertificateState } from './browserCertificates'
import { SiteSecurity, type SecurityTabRef } from './siteSecurity'
import { tempProject, testCrypto, testSigner } from './__test-helpers__/siteFakes'

const PAGE = 'https://selfsigned.test/'
const display = { text: (o: string) => new URL(o).host, parts: () => null }

let root: string
let clock: TestClock
let events: StripEvent[]
let strip: TabStrip
let contents: FakeContents
let states: TabCertificateState[]
let ref: SecurityTabRef
let security: SiteSecurity

/** Waits for the stores' file reads (real I/O) and the promise chains after them. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  root = tempProject('erfana-sec-')
  clock = createManualClock(0)
  events = []
  states = []
  strip = new TabStrip({ tabId: 'browser-tab-1', clock, emit: (e) => events.push(e) })
  contents = new FakeContents()
  ref = {
    projectRoot: root,
    contents: contents as never,
    setCertificateState: (s) => states.push(s),
    hasPendingUserNavigation: () => true,
    reloadAt: vi.fn(),
    goBack: vi.fn()
  }
  security = new SiteSecurity({
    clock,
    signer: testSigner('k'),
    credentialCrypto: testCrypto(),
    storageBackend: () => 'keychain',
    display,
    newId: () => 'd1'
  })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function certificateError(target: FakeContents, isMainFrame = true): boolean[] {
  const results: boolean[] = []
  target.emit('certificate-error', { preventDefault: vi.fn() }, PAGE, 'net::ERR_CERT_AUTHORITY_INVALID', { data: 'x' }, (t: boolean) => results.push(t), isMainFrame)
  return results
}

describe('SiteSecurity', () => {
  it('025-AC-021 routes the tab\'s certificate error to the warning page and its answer back', async () => {
    const link = security.attachTab(ref, strip)
    const results = certificateError(contents)
    await flush()
    expect(results).toEqual([false])
    expect(states.at(-1)?.warning).toMatchObject({ decisionId: 'd1', host: 'selfsigned.test', code: -202 })
    clock.advance(CERTIFICATE_INPUT_GUARD_MS)
    expect(link.answerCertificate('d1', false)).toBe('accepted')
  })

  it('a main-frame navigation start clears the warning page, and a commit sets the committed host', async () => {
    security.attachTab(ref, strip)
    certificateError(contents)
    await flush()
    contents.emit('did-start-navigation', { url: 'https://x.test/', isMainFrame: false })
    contents.emit('did-start-navigation', { url: PAGE, isMainFrame: true, isSameDocument: true })
    expect(states.at(-1)?.warning).not.toBeNull()
    contents.emit('did-start-navigation', { url: 'https://x.test/', isMainFrame: true, isSameDocument: false })
    expect(states.at(-1)?.warning).toBeNull()
    contents.emit('did-navigate', {}, 'https://x.test/')
    expect(states.at(-1)).toEqual({ warning: null, sign: null })
  })

  it('025-AC-022 routes the tab\'s login to a focused sign-in box for its main-frame navigation', async () => {
    const link = security.attachTab(ref, strip)
    contents.emit('did-start-navigation', { url: 'https://a.test/start', isMainFrame: true })
    contents.emit('did-redirect-navigation', { url: 'https://a.test/basic', isMainFrame: true })
    contents.emit('did-redirect-navigation', { url: 'https://frame.test/', isMainFrame: false })
    const calls: unknown[] = []
    contents.emit(
      'login',
      { preventDefault: vi.fn() },
      { url: 'https://a.test/basic', isRequestForNavigation: true, firstAuthAttempt: true },
      { isProxy: false, scheme: 'basic', host: 'a.test', port: 443, realm: 'R' },
      (...a: unknown[]) => calls.push(a)
    )
    await flush()
    const add = events.find((e) => e.op === 'add')
    expect(add?.op === 'add' && add.row).toMatchObject({ kind: 'signIn', takesFocus: true, text: 'Sign in to a.test' })
    clock.advance(STRIP_INPUT_GUARD_MS)
    if (add?.op !== 'add') throw new Error('no row')
    strip.answer(add.row.requestId, 'signIn', { username: 'u', password: 'p', remember: true })
    link.requestCompleted('https://a.test/basic', 200)
    await flush()
    expect(calls).toEqual([['u', 'p']])

    // A second tab of the project shares the store: the sign-in is sent without a box.
    const other = new FakeContents()
    security.attachTab({ ...ref, contents: other as never }, strip)
    const sent: unknown[] = []
    other.emit('login', { preventDefault: vi.fn() }, { url: 'https://a.test/basic', firstAuthAttempt: true }, { isProxy: false, scheme: 'basic', host: 'a.test', port: 443, realm: 'R' }, (...a: unknown[]) => sent.push(a))
    await flush()
    expect(sent).toEqual([['u', 'p']])

    await security.clearCredentials(root)
    await security.clearCredentials('/never/opened')
    const again: unknown[] = []
    other.emit('login', { preventDefault: vi.fn() }, { url: 'https://a.test/basic', firstAuthAttempt: true }, { isProxy: false, scheme: 'basic', host: 'a.test', port: 443, realm: 'R' }, (...a: unknown[]) => again.push(a))
    await flush()
    expect(again).toEqual([])
  })

  it('025-AC-021 Clear forgets the project\'s certificate exceptions', async () => {
    const link = security.attachTab(ref, strip)
    const fp = { data: 'not a pem' }
    contents.emit('certificate-error', { preventDefault: vi.fn() }, PAGE, 'net::ERR_CERT_AUTHORITY_INVALID', fp, () => undefined, true)
    await flush()
    await security.clearCertificates(root)
    await security.clearCertificates('/never/opened')
    expect(link.answerCertificate('nope', true)).toBe('unknown')
  })

  it('stops listening when the page is destroyed or the link detaches', async () => {
    const link = security.attachTab(ref, strip)
    link.detach()
    link.detach()
    expect(contents.listenerCount('certificate-error')).toBe(0)
    expect(contents.listenerCount('login')).toBe(0)
    expect(link.answerCertificate('d1', true)).toBe('unknown')

    const second = new FakeContents()
    const secondLink = security.attachTab({ projectRoot: root, contents: second as never }, strip)
    // A ref without the tab's optional methods still answers safely.
    const before = certificateError(second)
    await flush()
    expect(before).toEqual([false])
    second.destroy()
    // After `destroyed` the handlers are closed: an error that still arrives is refused, nothing shows.
    const after = certificateError(second)
    await flush()
    expect(after).toEqual([false])
    expect(secondLink.answerCertificate('d1', true)).toBe('unknown')
  })

  it('keeps sign-ins in memory only when the backend cannot be read or no key store is given', async () => {
    const throwing = new SiteSecurity({ clock, signer: testSigner('k'), credentialCrypto: testCrypto(), storageBackend: () => { throw new Error('dbus') }, display })
    const bare = new SiteSecurity({ clock, signer: testSigner('k'), display })
    for (const s of [throwing, bare]) {
      const c = new FakeContents()
      s.attachTab({ projectRoot: root, contents: c as never }, strip)
      c.emit('login', { preventDefault: vi.fn() }, { url: 'https://b.test/', firstAuthAttempt: true }, { isProxy: false, scheme: 'basic', host: 'b.test', port: 443, realm: 'R' }, () => undefined)
      await flush()
      const add = [...events].reverse().find((e) => e.op === 'add')
      expect(add?.op === 'add' && add.row.signIn?.remember).toBe('noKeyring')
      strip.withdrawAll()
    }
  })
})
