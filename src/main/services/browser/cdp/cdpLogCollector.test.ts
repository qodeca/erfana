// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { createManualClock } from '../../../../shared/clock'
import { BrowserLogBuffer } from './browserLogBuffer'
import { CdpLogCollector, MAX_TRACKED_REQUESTS, statusFromLogText, type FailedRequestSource, type LogScope } from './cdpLogCollector'
import { consoleCall, defaultContext } from './__test-helpers__/fakeCdp'

const TOP: LogScope = { sessionKey: '', rootFrameKey: 'top', rootOrigin: () => 'https://app.test' }
const CHILD: LogScope = { sessionKey: 'S1', rootFrameKey: 'FRAME-X', rootOrigin: () => 'https://x.test' }
const WORKER: LogScope = { sessionKey: 'S2', rootFrameKey: 'WORKER-1', rootOrigin: () => 'https://app.test' }

function setup(source: FailedRequestSource = 'log'): { collector: CdpLogCollector; buffer: BrowserLogBuffer } {
  const buffer = new BrowserLogBuffer(createManualClock(0))
  const collector = new CdpLogCollector(buffer, source)
  collector.handle(TOP, 'Runtime.executionContextCreated', defaultContext(1, 'MAIN', 'https://app.test'))
  return { collector, buffer }
}

describe('CdpLogCollector – console (025-FR-038)', () => {
  it('records console errors, asserts and warnings, nothing else, and asks for a release on every call', () => {
    const { collector, buffer } = setup()
    expect(collector.handle(TOP, 'Runtime.consoleAPICalled', consoleCall('error', 'boom'))).toBe(true)
    expect(collector.handle(TOP, 'Runtime.consoleAPICalled', consoleCall('assert', 'bad'))).toBe(true)
    expect(collector.handle(TOP, 'Runtime.consoleAPICalled', consoleCall('warning', 'careful'))).toBe(true)
    expect(collector.handle(TOP, 'Runtime.consoleAPICalled', consoleCall('log', 'chatty'))).toBe(true)
    expect(collector.handle(TOP, 'Runtime.consoleAPICalled', consoleCall('info', 'info'))).toBe(true)
    expect(buffer.snapshot().console.map(e => [e.level, e.message, e.frameOrigin])).toEqual([
      ['error', 'boom', 'https://app.test'],
      ['error', 'bad', 'https://app.test'],
      ['warning', 'careful', 'https://app.test']
    ])
  })

  it('joins arguments as the console shows them', () => {
    const { collector, buffer } = setup()
    collector.handle(TOP, 'Runtime.consoleAPICalled', {
      type: 'error',
      executionContextId: 1,
      args: [
        { type: 'string', value: 'count' },
        { type: 'number', value: 3 },
        { type: 'object', subtype: 'error', description: 'Error: x' },
        { type: 'number', unserializableValue: 'NaN' },
        { type: 'undefined' },
        { type: 'object', subtype: 'null', value: null },
        'not a remote object'
      ]
    })
    expect(buffer.snapshot().console[0].message).toBe('count 3 Error: x NaN undefined null ')
  })

  it('025-AC-038 records an uncaught exception and an unhandled rejection', () => {
    const { collector, buffer } = setup()
    collector.handle(TOP, 'Runtime.exceptionThrown', {
      exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: a is undefined' }, executionContextId: 1 }
    })
    collector.handle(TOP, 'Runtime.exceptionThrown', {
      exceptionDetails: { text: 'Uncaught (in promise)', exception: { description: 'Error: nope' } }
    })
    collector.handle(TOP, 'Runtime.exceptionThrown', { exceptionDetails: 'bad' })
    expect(buffer.snapshot().console.map(e => e.message)).toEqual(['Uncaught TypeError: a is undefined', 'Uncaught (in promise) Error: nope'])
  })

  it('025-AC-038 gives an error in a cross-origin frame that frame’s origin', () => {
    const { collector, buffer } = setup()
    collector.handle(CHILD, 'Runtime.executionContextCreated', defaultContext(1, 'FRAME-X', 'https://x.test'))
    collector.handle(CHILD, 'Runtime.consoleAPICalled', consoleCall('error', 'in frame', 1))
    // Same context id on another target is another context.
    collector.handle(TOP, 'Runtime.consoleAPICalled', consoleCall('error', 'in top', 1))
    expect(buffer.snapshot().console.map(e => [e.message, e.frameOrigin])).toEqual([
      ['in frame', 'https://x.test'],
      ['in top', 'https://app.test']
    ])
  })

  it('clears a frame on its new default context, not on a replayed one or an isolated world', () => {
    const { collector, buffer } = setup()
    collector.handle(TOP, 'Runtime.consoleAPICalled', consoleCall('error', 'old document'))
    // Runtime.enable replays a context it already reported: not a new document.
    collector.handle(TOP, 'Runtime.executionContextCreated', defaultContext(1, 'MAIN', 'https://app.test'))
    collector.handle(TOP, 'Runtime.executionContextCreated', {
      context: { id: 7, origin: 'https://app.test', auxData: { frameId: 'MAIN', isDefault: false } }
    })
    expect(buffer.snapshot().console).toHaveLength(1)
    collector.handle(TOP, 'Runtime.executionContextCreated', defaultContext(2, 'MAIN', 'https://app.test'))
    expect(buffer.snapshot().console).toHaveLength(0)
  })

  it('falls back to the target root for unknown or destroyed contexts', () => {
    const { collector, buffer } = setup()
    collector.handle(TOP, 'Runtime.executionContextDestroyed', { executionContextId: 1 })
    collector.handle(TOP, 'Runtime.consoleAPICalled', consoleCall('error', 'a', 1))
    collector.handle(TOP, 'Runtime.executionContextsCleared', {})
    collector.handle(TOP, 'Runtime.consoleAPICalled', { type: 'warning' })
    collector.handle(TOP, 'Runtime.executionContextCreated', { context: 'bad' })
    collector.handle(TOP, 'Runtime.executionContextCreated', { context: { id: 9 } })
    expect(collector.handle(TOP, 'Runtime.consoleAPICalled', 'not params')).toBe(false)
    expect(buffer.snapshot().console.map(e => [e.message, e.frameOrigin])).toEqual([
      ['a', 'https://app.test'],
      ['', 'https://app.test']
    ])
  })

  it('records Log errors and warnings except network and violation sources as console entries', () => {
    const { collector, buffer } = setup()
    collector.handle(TOP, 'Log.entryAdded', { entry: { source: 'javascript', level: 'error', text: 'CORS blocked' } })
    collector.handle(TOP, 'Log.entryAdded', { entry: { source: 'security', level: 'warning', text: 'mixed content' } })
    collector.handle(TOP, 'Log.entryAdded', { entry: { source: 'violation', level: 'warning', text: 'slow handler' } })
    collector.handle(TOP, 'Log.entryAdded', { entry: { source: 'other', level: 'info', text: 'info' } })
    collector.handle(TOP, 'Log.entryAdded', { entry: 'bad' })
    expect(buffer.snapshot().console.map(e => e.message)).toEqual(['CORS blocked', 'mixed content'])
  })
})

describe('CdpLogCollector – failed requests from Log (default source)', () => {
  it('025-AC-038 records a 500 and a name-resolution failure, and skips a cancelled request', () => {
    const { collector, buffer } = setup('log')
    const net = (text: string, url: string): void => {
      collector.handle(TOP, 'Log.entryAdded', { entry: { source: 'network', level: 'error', text, url } })
    }
    net('Failed to load resource: the server responded with a status of 500 (Internal Server Error)', 'https://app.test/api')
    net('Failed to load resource: net::ERR_NAME_NOT_RESOLVED', 'https://nowhere.invalid/x')
    net('Failed to load resource: net::ERR_ABORTED', 'https://app.test/cancelled')
    collector.handle(TOP, 'Log.entryAdded', { entry: { source: 'network', level: 'warning', text: 'w', url: 'https://app.test/w' } })
    expect(buffer.snapshot().failedRequests.map(r => [r.status, r.url, r.frameOrigin])).toEqual([
      ['500', 'https://app.test/api', 'https://app.test'],
      ['net::ERR_NAME_NOT_RESOLVED', 'https://nowhere.invalid/x', 'https://app.test']
    ])
    expect(buffer.snapshot().console).toHaveLength(0)
  })

  it('025-AC-038 counts a worker’s failed request for the tab', () => {
    const { collector, buffer } = setup('log')
    collector.handle(WORKER, 'Log.entryAdded', {
      entry: { source: 'network', level: 'error', text: 'Failed to load resource: net::ERR_CONNECTION_REFUSED', url: 'http://127.0.0.1:9/w' }
    })
    expect(buffer.snapshot().failedRequests).toMatchObject([{ status: 'net::ERR_CONNECTION_REFUSED', url: 'http://127.0.0.1:9/w' }])
  })

  it('ignores Network events in log mode', () => {
    const { collector, buffer } = setup('log')
    collector.handle(TOP, 'Network.requestWillBeSent', { requestId: 'r', request: { url: 'https://a.test' } })
    collector.handle(TOP, 'Network.loadingFailed', { requestId: 'r', errorText: 'net::ERR_FAILED' })
    expect(buffer.snapshot().failedRequests).toHaveLength(0)
    expect(collector.trackedRequests).toBe(0)
  })

  it('reads the status out of the engine message', () => {
    expect(statusFromLogText('the server responded with a status of 404 (Not Found)')).toBe('404')
    expect(statusFromLogText('net::ERR_CERT_AUTHORITY_INVALID')).toBe('net::ERR_CERT_AUTHORITY_INVALID')
    expect(statusFromLogText('something else')).toBe('failed')
    expect(statusFromLogText('net::ERR_ABORTED')).toBeNull()
  })
})

describe('CdpLogCollector – failed requests from Network (switch)', () => {
  function send(collector: CdpLogCollector, scope: LogScope, method: string, params: Record<string, unknown>): void {
    collector.handle(scope, method, params)
  }

  it('025-AC-038 records HTTP ≥ 400 and failures, skips cancelled and successful requests, drops finished ids', () => {
    const { collector, buffer } = setup('network')
    send(collector, TOP, 'Network.requestWillBeSent', { requestId: 'a', request: { url: 'https://app.test/500' }, frameId: 'MAIN' })
    send(collector, TOP, 'Network.responseReceived', { requestId: 'a', response: { status: 500, url: 'https://app.test/500' } })
    send(collector, TOP, 'Network.loadingFinished', { requestId: 'a' })
    send(collector, TOP, 'Network.requestWillBeSent', { requestId: 'b', request: { url: 'https://x.invalid/' } })
    send(collector, TOP, 'Network.loadingFailed', { requestId: 'b', errorText: 'net::ERR_NAME_NOT_RESOLVED' })
    send(collector, TOP, 'Network.requestWillBeSent', { requestId: 'c', request: { url: 'https://app.test/c' } })
    send(collector, TOP, 'Network.loadingFailed', { requestId: 'c', errorText: 'net::ERR_ABORTED', canceled: true })
    send(collector, TOP, 'Network.requestWillBeSent', { requestId: 'd', request: { url: 'https://app.test/ok' } })
    send(collector, TOP, 'Network.responseReceived', { requestId: 'd', response: { status: 200 } })
    send(collector, TOP, 'Network.loadingFinished', { requestId: 'd' })
    expect(buffer.snapshot().failedRequests.map(r => [r.status, r.url])).toEqual([
      ['500', 'https://app.test/500'],
      ['net::ERR_NAME_NOT_RESOLVED', 'https://x.invalid/']
    ])
    expect(collector.trackedRequests).toBe(0)
  })

  it('names blocked and CORS failures, records a 4xx once, keeps the redirect target URL', () => {
    const { collector, buffer } = setup('network')
    send(collector, TOP, 'Network.requestWillBeSent', { requestId: 'a', request: { url: 'http://a.test/' } })
    send(collector, TOP, 'Network.loadingFailed', { requestId: 'a', errorText: 'net::ERR_BLOCKED_BY_CLIENT', blockedReason: 'mixed-content' })
    send(collector, TOP, 'Network.requestWillBeSent', { requestId: 'b', request: { url: 'https://b.test/' } })
    send(collector, TOP, 'Network.loadingFailed', { requestId: 'b', errorText: 'net::ERR_FAILED', corsErrorStatus: { corsError: 'MissingAllowOriginHeader' } })
    send(collector, TOP, 'Network.requestWillBeSent', { requestId: 'c', request: { url: 'https://c.test/start' } })
    send(collector, TOP, 'Network.requestWillBeSent', { requestId: 'c', request: { url: 'https://c.test/end' } })
    send(collector, TOP, 'Network.responseReceived', { requestId: 'c', response: { status: 404 } })
    send(collector, TOP, 'Network.loadingFailed', { requestId: 'c', errorText: 'net::ERR_FAILED' })
    send(collector, TOP, 'Network.responseReceived', { requestId: 'zzz', response: { status: 500 } })
    send(collector, TOP, 'Network.loadingFailed', { requestId: '' })
    expect(buffer.snapshot().failedRequests.map(r => [r.status, r.url])).toEqual([
      ['blocked:mixed-content', 'http://a.test/'],
      ['cors:MissingAllowOriginHeader', 'https://b.test/'],
      ['404', 'https://c.test/end']
    ])
  })

  it('bounds the request-id map at 500 and still records a failure whose id was dropped', () => {
    const { collector, buffer } = setup('network')
    for (let i = 0; i <= MAX_TRACKED_REQUESTS; i++) {
      send(collector, CHILD, 'Network.requestWillBeSent', { requestId: `r${i}`, request: { url: `https://x.test/${i}` } })
    }
    expect(collector.trackedRequests).toBe(MAX_TRACKED_REQUESTS)
    send(collector, CHILD, 'Network.loadingFailed', { requestId: 'r0', errorText: 'net::ERR_FAILED' })
    send(collector, CHILD, 'Network.loadingFailed', { requestId: 'r1', errorText: '' })
    expect(buffer.snapshot().failedRequests.map(r => [r.status, r.url, r.frameOrigin])).toEqual([
      ['net::ERR_FAILED', '', 'https://x.test'],
      ['failed', 'https://x.test/1', 'https://x.test']
    ])
  })

  it('uses the frame origin known for the request’s frame, and forgets a detached target', () => {
    const { collector, buffer } = setup('network')
    collector.handle(TOP, 'Runtime.executionContextCreated', defaultContext(5, 'SUB', 'https://sub.test'))
    send(collector, TOP, 'Network.requestWillBeSent', { requestId: 'a', request: { url: 'https://sub.test/x' }, frameId: 'SUB' })
    send(collector, TOP, 'Network.responseReceived', { requestId: 'a', response: { status: 503 } })
    expect(buffer.snapshot().failedRequests[0]).toMatchObject({ frameOrigin: 'https://sub.test', status: '503' })
    send(collector, CHILD, 'Network.requestWillBeSent', { requestId: 'b', request: { url: 'https://x.test/' } })
    collector.forgetTarget('S1')
    expect(collector.trackedRequests).toBe(1)
    collector.reset()
    expect(collector.trackedRequests).toBe(0)
  })
})
