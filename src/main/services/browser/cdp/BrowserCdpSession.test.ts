// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('../../LoggingService', () => ({ logger: mockLogger }))

import { createManualClock, type TestClock } from '../../../../shared/clock'
import {
  BrowserCdpSession,
  CONSOLE_RELEASE_DELAY_MS,
  RESUME_DELAY_MS,
  TARGET_CLOSED_REASON,
  TOP_TARGET,
  type BrowserCdpSessionOptions
} from './BrowserCdpSession'
import { CdpRefusedError } from './cdpAllowList'
import { currentBrowserUserAgentOverride } from '../site/browserUserAgent'
import { FLOOD_MAX_EVENTS } from './cdpFloodBudget'
import { HANG_PROBE_INTERVAL_VISIBLE_MS, HANG_THRESHOLD_MS } from './browserHangProbe'
import type { CdpWebContents } from './cdpTypes'
import { consoleCall, defaultContext, FakeContents, flush } from './__test-helpers__/fakeCdp'

interface Harness {
  session: BrowserCdpSession
  contents: FakeContents
  clock: TestClock
}

function attached(options: Partial<BrowserCdpSessionOptions> = {}): Harness {
  const clock = createManualClock(0)
  const session = new BrowserCdpSession({ kind: 'tab', clock, ...options })
  const contents = new FakeContents()
  session.attach(contents)
  return { session, contents, clock }
}

function attachChild(
  contents: FakeContents,
  sessionId: string,
  type: string,
  targetId = sessionId,
  parent = '',
  waitingForDebugger = true
): void {
  contents.debugger.emit(
    'Target.attachedToTarget',
    { sessionId, targetInfo: { targetId, type, url: `https://${targetId.toLowerCase()}.test/` }, waitingForDebugger },
    parent
  )
}

const NETWORK_ENABLE = { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 }
const UA_OVERRIDE = currentBrowserUserAgentOverride()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BrowserCdpSession – attach and child targets (ADR 0007 decision 1, P6)', () => {
  it('attaches and turns on auto-attach, Runtime, Log and Network (zero buffers) on the top target by default', () => {
    const { contents } = attached()
    expect(contents.debugger.attached).toBe(true)
    expect(contents.debugger.sent).toEqual([
      { method: 'Emulation.setUserAgentOverride', params: UA_OVERRIDE, sessionId: undefined },
      { method: 'Target.setAutoAttach', params: { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId: undefined },
      { method: 'Runtime.enable', params: {}, sessionId: undefined },
      { method: 'Log.enable', params: {}, sessionId: undefined },
      { method: 'Network.enable', params: NETWORK_ENABLE, sessionId: undefined }
    ])
  })

  it('leaves Network off with the log failed-request source', () => {
    const { contents } = attached({ failedRequestSource: 'log' })
    expect(contents.debugger.methods()).toEqual(['Emulation.setUserAgentOverride', 'Target.setAutoAttach', 'Runtime.enable', 'Log.enable'])
  })

  it('025-FR-024 gives every target the browser identity before it runs: Emulation on frames, Network on workers', () => {
    const { contents, clock } = attached()
    attachChild(contents, 'S1', 'iframe', 'F1')
    attachChild(contents, 'S2', 'worker', 'W2')
    attachChild(contents, 'S3', 'service_worker', 'W3')
    clock.advance(RESUME_DELAY_MS)
    expect(contents.debugger.sent.find(c => c.sessionId === 'S1')).toEqual({
      method: 'Emulation.setUserAgentOverride',
      params: UA_OVERRIDE,
      sessionId: 'S1'
    })
    for (const worker of ['S2', 'S3']) {
      const methods = contents.debugger.methods(worker)
      expect(methods[0]).toBe('Network.setUserAgentOverride')
      expect(methods).not.toContain('Emulation.setUserAgentOverride')
      expect(methods.indexOf('Network.setUserAgentOverride')).toBeLessThan(methods.indexOf('Runtime.runIfWaitingForDebugger'))
    }
  })

  it('025-FR-024 a popup-kind session sends the identity too', () => {
    const contents = new FakeContents()
    new BrowserCdpSession({ kind: 'popup', clock: createManualClock(0) }).attach(contents)
    expect(contents.debugger.sent[0]).toEqual({ method: 'Emulation.setUserAgentOverride', params: UA_OVERRIDE, sessionId: undefined })
  })

  it('sends no identity with userAgent null', () => {
    const { contents } = attached({ userAgent: null })
    attachChild(contents, 'S1', 'worker', 'W1')
    expect(contents.debugger.methods().filter(m => m.endsWith('setUserAgentOverride'))).toEqual([])
    expect(contents.debugger.methods('S1')).not.toContain('Network.setUserAgentOverride')
  })

  it('refuses a second attach, a destroyed view, and passes on Electron’s refusal', () => {
    const { session } = attached()
    expect(() => session.attach(new FakeContents())).toThrow('already attached')

    const fresh = new BrowserCdpSession({ kind: 'tab', clock: createManualClock(0) })
    const destroyed = new FakeContents()
    destroyed.destroyed = true
    expect(() => fresh.attach(destroyed)).toThrow('destroyed')

    const held = new FakeContents()
    held.debugger.attachError = new Error('Another debugger is already attached')
    expect(() => fresh.attach(held)).toThrow('Another debugger')
    expect(fresh.attached).toBe(false)
    expect(held.listenerCount + held.debugger.listenerCount).toBe(0)
  })

  it('sends a new child’s enables without awaiting each, then runIfWaitingForDebugger on a later task', async () => {
    const { session, contents, clock } = attached()
    contents.debugger.reply = () => new Promise(() => undefined)
    const seenAtEvent: string[][] = []
    session.on('targetAttached', () => seenAtEvent.push(contents.debugger.methods('S1')))
    attachChild(contents, 'S1', 'iframe', 'F1')
    const enables = ['Emulation.setUserAgentOverride', 'Target.setAutoAttach', 'Runtime.enable', 'Log.enable', 'Network.enable']
    // Not from the attach event's stack, nor from a microtask: Electron emits the event
    // from inside Chromium's navigation throttle, and a resume there is lost (commit-8 probe).
    expect(contents.debugger.methods('S1')).toEqual(enables)
    await flush()
    expect(contents.debugger.methods('S1')).toEqual(enables)
    clock.advance(RESUME_DELAY_MS)
    expect(contents.debugger.methods('S1')).toEqual([...enables, 'Runtime.runIfWaitingForDebugger'])
    // The event fires before the run, so the freeze can queue its pause first.
    expect(seenAtEvent).toEqual([enables])
  })

  it('does not resume a child that is not waiting, or one that went before its resume', () => {
    const { contents, clock } = attached()
    attachChild(contents, 'S1', 'worker', 'W1', '', false)
    attachChild(contents, 'S2', 'iframe', 'F2')
    attachChild(contents, 'S3', 'iframe', 'F3', 'S2')
    contents.debugger.emit('Target.detachedFromTarget', { sessionId: 'S2' })
    expect(clock.pendingTimers()).toBe(1) // the hang probe's only
    clock.advance(RESUME_DELAY_MS)
    expect(contents.debugger.methods()).not.toContain('Runtime.runIfWaitingForDebugger')
  })

  it('drops pending resumes when the debugger detaches', () => {
    const { session, contents, clock } = attached()
    attachChild(contents, 'S1', 'iframe')
    session.detach()
    contents.debugger.clearSent()
    clock.advance(RESUME_DELAY_MS)
    expect(contents.debugger.sent).toEqual([])
  })

  it('tracks frames, workers and service workers, nested children included', () => {
    const { session, contents } = attached()
    attachChild(contents, 'S1', 'iframe', 'F1')
    attachChild(contents, 'S2', 'worker', 'W1')
    attachChild(contents, 'S3', 'service_worker', 'SW1')
    attachChild(contents, 'S4', 'iframe', 'F2', 'S1')
    attachChild(contents, 'S1', 'iframe', 'F1') // duplicate: ignored
    contents.debugger.emit('Target.attachedToTarget', { sessionId: 'S9' }) // no targetInfo: ignored
    contents.debugger.emit('Target.attachedToTarget', { targetInfo: {} }) // no session id: ignored
    expect(session.attachedTargets().map(t => [t.sessionKey, t.type])).toEqual([
      [TOP_TARGET, 'page'],
      ['S1', 'iframe'],
      ['S2', 'worker'],
      ['S3', 'service_worker'],
      ['S4', 'iframe']
    ])
    const detached: string[] = []
    session.on('targetDetached', t => detached.push(t.sessionKey))
    contents.debugger.emit('Target.detachedFromTarget', { sessionId: 'S1' })
    expect(detached).toEqual(['S4', 'S1'])
    expect(session.attachedTargets().map(t => t.sessionKey)).toEqual([TOP_TARGET, 'S2', 'S3'])
    contents.debugger.emit('Target.detachedFromTarget', { sessionId: TOP_TARGET })
    contents.debugger.emit('Target.detachedFromTarget', 'bad')
    expect(session.attachedTargets()).toHaveLength(3)
  })

  it('ignores events from a target it does not know', () => {
    const { session, contents } = attached()
    contents.debugger.emit('Runtime.executionContextCreated', defaultContext(1, 'X', 'https://x.test'), 'GONE')
    contents.debugger.emit('Runtime.consoleAPICalled', consoleCall('error', 'late'), 'GONE')
    expect(session.logSnapshot().console).toHaveLength(0)
  })

  it('logs a child command failure at debug level instead of rejecting unhandled', async () => {
    const { contents } = attached()
    contents.debugger.reply = () => Promise.reject(new Error('No target with given id'))
    attachChild(contents, 'S1', 'worker')
    await flush()
    expect(mockLogger.debug).toHaveBeenCalledWith('Browser CDP: command failed', expect.objectContaining({ method: 'Runtime.enable' }))
  })
})

describe('BrowserCdpSession – send goes through the allow-list (S23)', () => {
  it('refuses a method outside the list synchronously and sends nothing', () => {
    const { session, contents } = attached()
    contents.debugger.clearSent()
    expect(() => session.send('Page.navigate', { url: 'https://evil.test' })).toThrow(CdpRefusedError)
    expect(() => session.send('Runtime.evaluate', { expression: 'document.cookie' })).toThrow(CdpRefusedError)
    expect(contents.debugger.sent).toEqual([])
    expect(mockLogger.warn).toHaveBeenCalledWith('Browser CDP: command refused', { method: 'Page.navigate', rule: 'not allowed for the tab kind' })
  })

  it('refuses the probe expression on a child target', () => {
    const { session, contents } = attached()
    attachChild(contents, 'S1', 'iframe')
    expect(() => session.send('Runtime.evaluate', { expression: '0', returnByValue: true, silent: true }, 'S1')).toThrow('top target only')
  })

  it('refuses pick-only domains outside pick mode, but allows their disable', async () => {
    const { session } = attached()
    expect(() => session.send('DOM.getBoxModel', { nodeId: 1 })).toThrow('pick mode is off')
    expect(() => session.send('Overlay.highlightQuad', {})).toThrow('pick mode is off')
    await expect(session.send('DOM.disable')).resolves.toEqual({})
  })

  it('throws for an unknown target and when not attached', () => {
    const { session } = attached()
    expect(() => session.send('Runtime.enable', undefined, 'NOPE')).toThrow('Unknown CDP target')
    session.detach()
    expect(() => session.send('Runtime.enable')).toThrow('not attached')
  })

  it('uses the popup list for a popup session', async () => {
    const { session } = attached({ kind: 'popup' })
    expect(() => session.send('Runtime.callFunctionOn', {})).toThrow('not allowed for the popup kind')
    await expect(session.enablePickDomains()).rejects.toThrow(CdpRefusedError)
  })
})

describe('BrowserCdpSession – pick domains on demand (A12)', () => {
  it('enables DOM, CSS and Overlay on frame targets only, and on frames that attach during pick', async () => {
    const { session, contents } = attached()
    attachChild(contents, 'S1', 'iframe')
    attachChild(contents, 'S2', 'worker')
    contents.debugger.clearSent()
    await session.enablePickDomains()
    expect(session.pickDomainsEnabled).toBe(true)
    expect(contents.debugger.methods(TOP_TARGET)).toEqual(['DOM.enable', 'CSS.enable', 'Overlay.enable'])
    expect(contents.debugger.methods('S1')).toEqual(['DOM.enable', 'CSS.enable', 'Overlay.enable'])
    expect(contents.debugger.methods('S2')).toEqual([])
    await expect(session.send('DOM.getBoxModel', { nodeId: 1 })).resolves.toEqual({})

    attachChild(contents, 'S3', 'iframe')
    expect(contents.debugger.methods('S3')).toContain('Overlay.enable')

    contents.debugger.clearSent()
    await session.disablePickDomains()
    expect(contents.debugger.methods(TOP_TARGET)).toEqual(['Overlay.disable', 'CSS.disable', 'DOM.disable'])
    expect(contents.debugger.methods('S1')).toEqual(['Overlay.disable', 'CSS.disable', 'DOM.disable'])
    expect(() => session.send('DOM.getBoxModel', { nodeId: 1 })).toThrow('pick mode is off')
  })

  it('rejects when the top target refuses, logs a frame’s failure, and never rejects on disable', async () => {
    const { session, contents } = attached()
    attachChild(contents, 'S1', 'iframe')
    contents.debugger.reply = () => Promise.reject(new Error('gone'))
    await expect(session.enablePickDomains()).rejects.toThrow('gone')
    await flush()
    expect(mockLogger.debug).toHaveBeenCalledWith('Browser CDP: pick domains failed on a frame', { error: 'Error: gone' })
    await expect(session.disablePickDomains()).resolves.toBeUndefined()
    session.detach()
    await expect(session.disablePickDomains()).resolves.toBeUndefined()
  })
})

describe('BrowserCdpSession – detach (Q5, S-9)', () => {
  it.each([
    // A closing view: "target closed" while not yet destroyed (commit-8 probe).
    ['viewClosed', TARGET_CLOSED_REASON, () => undefined],
    ['viewClosed', TARGET_CLOSED_REASON, (c: FakeContents) => (c.destroyed = true)],
    ['viewClosed', 'Render process gone.', (c: FakeContents) => (c.destroyed = true)],
    // DevTools does not detach the session, so "target closed" with it open is unexplained.
    ['other', TARGET_CLOSED_REASON, (c: FakeContents) => (c.devToolsOpened = true)],
    ['other', 'Render process gone.', () => undefined]
  ] as const)('records and announces a %s detach for reason "%s"', (cause, reason, arrange) => {
    const { session, contents } = attached()
    const events: unknown[] = []
    session.on('detached', e => events.push(e))
    arrange(contents)
    contents.debugger.emitDetach(reason)
    expect(events).toEqual([{ cause, reason }])
    expect(session.lastDetach).toEqual({ cause, reason })
    expect(session.attached).toBe(false)
    expect(session.attachedTargets()).toEqual([])
    expect(contents.listenerCount + contents.debugger.listenerCount).toBe(0)
  })

  it('emits nothing for its own detach, is idempotent, and can attach again', () => {
    const { session, contents } = attached()
    const events: unknown[] = []
    session.on('detached', e => events.push(e))
    session.detach()
    session.detach()
    expect(contents.debugger.attached).toBe(false)
    expect(events).toEqual([])
    expect(session.lastDetach).toBeNull()
    session.attach(contents)
    expect(session.attached).toBe(true)
  })

  it('survives a detach that throws (view already gone)', () => {
    const { session, contents } = attached()
    contents.debugger.detach = () => {
      throw new Error('not attached')
    }
    expect(() => session.detach()).not.toThrow()
    expect(mockLogger.debug).toHaveBeenCalledWith('Browser CDP: detach failed', { error: 'Error: not attached' })
  })

  it('does not call detach on a destroyed view', () => {
    const { session, contents } = attached()
    const detach = vi.spyOn(contents.debugger, 'detach')
    contents.destroyed = true
    session.detach()
    expect(detach).not.toHaveBeenCalled()
  })
})

describe('BrowserCdpSession – logs (025-FR-038)', () => {
  it('025-AC-038 snapshots console entries and failed requests, and a new top document clears them', () => {
    const { session, contents } = attached({ failedRequestSource: 'log' })
    contents.emitDidNavigate('https://app.test/')
    contents.debugger.emit('Runtime.executionContextCreated', defaultContext(1, 'MAIN', 'https://app.test'))
    contents.debugger.emit('Runtime.consoleAPICalled', consoleCall('error', 'boom'))
    contents.debugger.emit('Log.entryAdded', {
      entry: { source: 'network', level: 'error', text: 'Failed to load resource: the server responded with a status of 500', url: 'https://app.test/api' }
    })
    const snap = session.logSnapshot()
    expect(snap.console).toMatchObject([{ message: 'boom', frameOrigin: 'https://app.test', level: 'error' }])
    expect(snap.failedRequests).toMatchObject([{ status: '500', url: 'https://app.test/api', frameOrigin: 'https://app.test' }])
    contents.debugger.emit('Runtime.executionContextsCleared', {})
    expect(session.logSnapshot()).toEqual({ console: [], failedRequests: [], truncated: false })
    expect(snap.console).toHaveLength(1)
  })

  it('025-AC-038 keeps a worker’s failed request after the worker ends, drops a detached frame’s entries', () => {
    const { session, contents } = attached({ failedRequestSource: 'log' })
    attachChild(contents, 'S1', 'iframe', 'F1')
    attachChild(contents, 'S2', 'worker', 'W1')
    contents.debugger.emit('Log.entryAdded', { entry: { source: 'javascript', level: 'error', text: 'frame error' } }, 'S1')
    contents.debugger.emit(
      'Log.entryAdded',
      { entry: { source: 'network', level: 'error', text: 'net::ERR_CONNECTION_REFUSED', url: 'http://127.0.0.1:1/' } },
      'S2'
    )
    contents.debugger.emit('Target.detachedFromTarget', { sessionId: 'S1' })
    contents.debugger.emit('Target.detachedFromTarget', { sessionId: 'S2' })
    const snap = session.logSnapshot()
    expect(snap.console).toEqual([])
    expect(snap.failedRequests).toMatchObject([{ url: 'http://127.0.0.1:1/', frameOrigin: 'https://w1.test' }])
  })

  it('releases console objects once per burst per target (P7)', () => {
    const { contents, clock } = attached()
    attachChild(contents, 'S1', 'iframe')
    clock.advance(RESUME_DELAY_MS)
    contents.debugger.clearSent()
    for (let i = 0; i < 5; i++) contents.debugger.emit('Runtime.consoleAPICalled', consoleCall('log', 'x'))
    contents.debugger.emit('Runtime.consoleAPICalled', consoleCall('error', 'y'), 'S1')
    clock.advance(CONSOLE_RELEASE_DELAY_MS - 1)
    expect(contents.debugger.sent).toEqual([])
    clock.advance(1)
    expect(contents.debugger.sent).toEqual([
      { method: 'Runtime.releaseObjectGroup', params: { objectGroup: 'console' }, sessionId: undefined },
      { method: 'Runtime.discardConsoleEntries', params: {}, sessionId: undefined },
      { method: 'Runtime.releaseObjectGroup', params: { objectGroup: 'console' }, sessionId: 'S1' },
      { method: 'Runtime.discardConsoleEntries', params: {}, sessionId: 'S1' }
    ])
  })

  it('drops a pending release when the target goes', () => {
    const { contents, clock } = attached()
    attachChild(contents, 'S1', 'iframe')
    contents.debugger.emit('Runtime.consoleAPICalled', consoleCall('error', 'y'), 'S1')
    contents.debugger.emit('Target.detachedFromTarget', { sessionId: 'S1' })
    contents.debugger.clearSent()
    clock.advance(CONSOLE_RELEASE_DELAY_MS)
    expect(contents.debugger.sent).toEqual([])
  })

  it('forwards non-log events to protocolEvent listeners, and a throwing listener does not stop the rest', () => {
    const { session, contents } = attached()
    const seen: string[] = []
    session.on('protocolEvent', () => {
      throw new Error('listener bug')
    })
    const off = session.on('protocolEvent', e => seen.push(`${e.target.sessionKey}:${e.method}`))
    contents.debugger.emit('Debugger.resumed', {})
    off()
    contents.debugger.emit('Debugger.paused', {})
    contents.debugger.emit('Runtime.consoleAPICalled', consoleCall('error', 'x'))
    expect(seen).toEqual([':Debugger.resumed'])
    expect(mockLogger.error).toHaveBeenCalledWith('Browser CDP: a protocolEvent listener threw', expect.any(Error))
  })
})

describe('BrowserCdpSession – flood budget (S6, S-14)', () => {
  function flood(contents: FakeContents, sessionId: string, count = FLOOD_MAX_EVENTS + 1): void {
    for (let i = 0; i < count; i++) contents.debugger.emit('Runtime.consoleAPICalled', consoleCall('error', `e${i}`), sessionId)
  }

  it('turns a child target’s logs off at the 201st event in a second and notes "logs truncated"', () => {
    const { session, contents, clock } = attached()
    attachChild(contents, 'S1', 'iframe', 'F1')
    clock.advance(RESUME_DELAY_MS)
    const truncated: string[] = []
    session.on('logsTruncated', t => truncated.push(t.sessionKey))
    contents.debugger.clearSent()
    // The attach event arrives on the parent's session, so S1's own count starts at 0.
    flood(contents, 'S1', FLOOD_MAX_EVENTS)
    expect(contents.debugger.methods('S1')).toEqual([])
    expect(session.logSnapshot().truncated).toBe(false)
    flood(contents, 'S1', 1)
    expect(contents.debugger.methods('S1')).toEqual(['Runtime.disable', 'Log.disable', 'Network.disable'])
    expect(truncated).toEqual(['S1'])
    expect(session.logSnapshot().truncated).toBe(true)
    flood(contents, 'S1', 50)
    expect(session.logSnapshot().console.at(-1)?.message).toBe(`e${FLOOD_MAX_EVENTS - 1}`)
    expect(contents.debugger.methods(TOP_TARGET)).toEqual([])
  })

  it('keeps logs on through a page load of 400 requests in one second, and still records a later console error', () => {
    const { session, contents } = attached()
    contents.debugger.clearSent()
    for (let i = 0; i < 400; i++) {
      const url = `http://localhost:5173/src/m${i}.ts`
      contents.debugger.emit('Network.requestWillBeSent', { requestId: `r${i}`, request: { url } })
      contents.debugger.emit('Network.requestWillBeSentExtraInfo', { requestId: `r${i}`, headers: {} })
      contents.debugger.emit('Network.responseReceived', { requestId: `r${i}`, response: { url, status: 200 } })
      contents.debugger.emit('Network.responseReceivedExtraInfo', { requestId: `r${i}`, headers: {} })
      contents.debugger.emit('Network.dataReceived', { requestId: `r${i}`, dataLength: 4096 })
      contents.debugger.emit('Network.loadingFinished', { requestId: `r${i}` })
    }
    contents.debugger.emit('Runtime.consoleAPICalled', consoleCall('error', 'after load'))
    expect(contents.debugger.methods(TOP_TARGET)).not.toContain('Runtime.disable')
    expect(session.logSnapshot().truncated).toBe(false)
    expect(session.logSnapshot().console.at(-1)?.message).toBe('after load')
  })

  it('still handles target events from a flooded target', () => {
    const { session, contents, clock } = attached()
    flood(contents, TOP_TARGET)
    attachChild(contents, 'S1', 'iframe')
    clock.advance(RESUME_DELAY_MS)
    expect(session.attachedTargets().map(t => t.sessionKey)).toContain('S1')
    expect(contents.debugger.methods('S1')).toContain('Runtime.runIfWaitingForDebugger')
  })

  it('leaves Network alone with the log source', () => {
    const { contents } = attached({ failedRequestSource: 'log' })
    contents.debugger.clearSent()
    flood(contents, TOP_TARGET)
    expect(contents.debugger.methods(TOP_TARGET)).toEqual(['Runtime.disable', 'Log.disable'])
  })

  it('re-enables the top target’s logs at the next top-level navigation and clears the stale note', () => {
    const { session, contents } = attached()
    flood(contents, TOP_TARGET)
    contents.debugger.clearSent()
    contents.emitDidFrameNavigate('https://sub.test/', true)
    expect(contents.debugger.sent).toEqual([])
    contents.emitDidNavigate('https://next.test/')
    expect(contents.debugger.methods(TOP_TARGET)).toEqual(['Runtime.enable', 'Log.enable', 'Network.enable'])
    expect(session.logSnapshot()).toEqual({ console: [], failedRequests: [], truncated: false })
    contents.debugger.emit('Log.entryAdded', { entry: { source: 'javascript', level: 'warning', text: 'again' } })
    expect(session.logSnapshot().console).toMatchObject([{ message: 'again', frameOrigin: 'https://next.test' }])
  })

  it('leaves logs alone at a navigation when nothing flooded', () => {
    const { session, contents } = attached()
    contents.debugger.emit('Log.entryAdded', { entry: { source: 'javascript', level: 'warning', text: 'kept' } })
    contents.debugger.clearSent()
    contents.emitDidNavigate('https://next.test/')
    contents.emitDidFrameNavigate('https://sub.test/', false)
    expect(contents.debugger.sent).toEqual([])
    expect(session.logSnapshot().console).toHaveLength(1)
  })

  it('re-enables a flooded child target at a sub-frame navigation', () => {
    const { contents, clock } = attached()
    attachChild(contents, 'S1', 'iframe')
    clock.advance(RESUME_DELAY_MS)
    flood(contents, 'S1')
    contents.debugger.clearSent()
    contents.emitDidFrameNavigate('https://s1.test/next', false)
    expect(contents.debugger.methods('S1')).toEqual(['Runtime.enable', 'Log.enable', 'Network.enable'])
    expect(contents.debugger.methods(TOP_TARGET)).toEqual([])
  })
})

describe('BrowserCdpSession – hang probe (025-FR-056)', () => {
  it('025-AC-072 probes the top target with Runtime.evaluate("0") and reports a hang after 5 s', () => {
    const { session, contents, clock } = attached()
    const hangs: string[] = []
    session.on('hang', e => hangs.push(e))
    session.hangProbe.setVisible(true)
    contents.debugger.reply = () => new Promise(() => undefined)
    contents.debugger.clearSent()
    clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
    expect(contents.debugger.sent).toEqual([
      { method: 'Runtime.evaluate', params: { expression: '0', returnByValue: true, silent: true }, sessionId: undefined }
    ])
    clock.advance(HANG_THRESHOLD_MS)
    expect(hangs).toEqual(['hung'])
    expect(session.hangProbe.isHung).toBe(true)
  })

  it('025-AC-072 skips the probe while a JavaScript dialog is pending on the top target (X16)', () => {
    const { session, contents, clock } = attached()
    session.hangProbe.setVisible(true)
    contents.debugger.emit('Page.javascriptDialogOpening', { type: 'alert' })
    contents.debugger.clearSent()
    clock.advance(10_000)
    expect(contents.debugger.methods()).toEqual([])
    contents.debugger.emit('Page.javascriptDialogClosed', { result: true })
    clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
    expect(contents.debugger.methods()).toEqual(['Runtime.evaluate'])
  })

  it('ignores a child target’s dialog events', () => {
    const { session, contents, clock } = attached()
    session.hangProbe.setVisible(true)
    attachChild(contents, 'S1', 'iframe')
    clock.advance(RESUME_DELAY_MS)
    contents.debugger.emit('Page.javascriptDialogOpening', { type: 'alert' }, 'S1')
    contents.debugger.clearSent()
    clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
    expect(contents.debugger.methods()).toEqual(['Runtime.evaluate'])
  })

  it('025-AC-072 stops probing while detached and probes again after re-attach', () => {
    const { session, contents, clock } = attached()
    session.hangProbe.setVisible(true)
    contents.debugger.emitDetach()
    contents.debugger.clearSent()
    clock.advance(10_000)
    expect(contents.debugger.sent).toEqual([])
    session.attach(contents)
    contents.debugger.clearSent()
    clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
    expect(contents.debugger.methods()).toEqual(['Runtime.evaluate'])
  })

  it('does not probe before attach', () => {
    const clock = createManualClock(0)
    const session = new BrowserCdpSession({ kind: 'tab', clock })
    session.hangProbe.setVisible(true)
    clock.advance(10_000)
    expect(session.hangProbe.isHung).toBe(false)
  })
})

describe('BrowserCdpSession – Electron types', () => {
  it('accepts a real Electron WebContents structurally', () => {
    expectTypeOf<WebContents>().toExtend<CdpWebContents>()
  })
})
