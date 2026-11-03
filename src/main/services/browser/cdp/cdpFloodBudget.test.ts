// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { createManualClock } from '../../../../shared/clock'
import {
  CdpFloodBudget,
  floodClassOf,
  FLOOD_MAX_BYTES,
  FLOOD_MAX_EVENTS,
  FLOOD_MAX_NETWORK_BYTES,
  FLOOD_MAX_NETWORK_EVENTS,
  FLOOD_WINDOW_MS,
  keptPayloadSize,
  TargetFloodBudget
} from './cdpFloodBudget'

describe('CdpFloodBudget (S6, ADR 0007 decision 3)', () => {
  it('allows 200 events in one window and trips on the 201st', () => {
    const budget = new CdpFloodBudget(createManualClock(1000))
    for (let i = 0; i < FLOOD_MAX_EVENTS; i++) expect(budget.count(10)).toBe(false)
    expect(budget.isTripped).toBe(false)
    expect(budget.count(10)).toBe(true)
    expect(budget.isTripped).toBe(true)
  })

  it('reports a trip once and stays tripped until reset', () => {
    const clock = createManualClock(0)
    const budget = new CdpFloodBudget(clock)
    for (let i = 0; i <= FLOOD_MAX_EVENTS; i++) budget.count(1)
    expect(budget.count(1)).toBe(false)
    clock.advance(10 * FLOOD_WINDOW_MS)
    expect(budget.count(1)).toBe(false)
    expect(budget.isTripped).toBe(true)
    budget.reset()
    expect(budget.isTripped).toBe(false)
    expect(budget.count(1)).toBe(false)
  })

  it('allows exactly 1 MB in one window and trips one byte past it', () => {
    const budget = new CdpFloodBudget(createManualClock(0))
    expect(budget.count(FLOOD_MAX_BYTES - 1)).toBe(false)
    expect(budget.count(1)).toBe(false)
    expect(budget.count(1)).toBe(true)
  })

  it('starts a new window 1000 ms after the last one began, not 999 ms', () => {
    const clock = createManualClock(0)
    const budget = new CdpFloodBudget(clock)
    for (let i = 0; i < FLOOD_MAX_EVENTS; i++) budget.count(1)
    clock.advance(FLOOD_WINDOW_MS - 1)
    expect(budget.count(1)).toBe(true)

    const fresh = new CdpFloodBudget(clock)
    for (let i = 0; i < FLOOD_MAX_EVENTS; i++) fresh.count(1)
    clock.advance(FLOOD_WINDOW_MS)
    for (let i = 0; i < FLOOD_MAX_EVENTS; i++) expect(fresh.count(1)).toBe(false)
  })

})

const consoleCall = (text: string): unknown => ({ type: 'error', args: [{ type: 'string', value: text }] })
const request = (id: number): Array<[string, unknown]> => [
  ['Network.requestWillBeSent', { requestId: `r${id}`, request: { url: `http://localhost:5173/src/m${id}.ts` } }],
  ['Network.requestWillBeSentExtraInfo', { requestId: `r${id}`, headers: { a: 'b' } }],
  ['Network.responseReceived', { requestId: `r${id}`, response: { url: `http://localhost:5173/src/m${id}.ts`, status: 200 } }],
  ['Network.responseReceivedExtraInfo', { requestId: `r${id}`, headers: { a: 'b' } }],
  ['Network.dataReceived', { requestId: `r${id}`, dataLength: 4096 }],
  ['Network.loadingFinished', { requestId: `r${id}` }]
]

describe('floodClassOf and keptPayloadSize (025-FR-038)', () => {
  it('counts the three log events as log, the four collected Network events as network, and nothing else', () => {
    for (const m of ['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded']) expect(floodClassOf(m)).toBe('log')
    for (const m of ['Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed']) {
      expect(floodClassOf(m)).toBe('network')
    }
    for (const m of ['Network.dataReceived', 'Network.requestWillBeSentExtraInfo', 'Target.attachedToTarget', 'Runtime.executionContextCreated']) {
      expect(floodClassOf(m)).toBeNull()
    }
  })

  it('measures the kept text, not the whole event', () => {
    expect(keptPayloadSize('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: 'abc' }, { type: 'number', value: 12 }], stackTrace: { callFrames: new Array(50).fill({ url: 'x'.repeat(100) }) } })).toBe(5)
    expect(keptPayloadSize('Runtime.exceptionThrown', { exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: x' } } })).toBe(16)
    expect(keptPayloadSize('Log.entryAdded', { entry: { text: 'hello', url: 'http://a/' } })).toBe(14)
    expect(keptPayloadSize('Network.requestWillBeSent', { request: { url: 'http://a/', headers: { big: 'y'.repeat(9999) } } })).toBe(9)
    expect(keptPayloadSize('Network.responseReceived', { response: { url: 'http://a/b' } })).toBe(10)
    expect(keptPayloadSize('Network.loadingFailed', { errorText: 'net::ERR_FAILED', blockedReason: 'mixed' })).toBe(20)
    expect(keptPayloadSize('Network.loadingFinished', { requestId: 'r1' })).toBe(0)
    expect(keptPayloadSize('Log.entryAdded', null)).toBe(0)
    expect(keptPayloadSize('Runtime.consoleAPICalled', { args: 'not an array' })).toBe(0)
    // Missing or odd fields count nothing rather than throw.
    expect(keptPayloadSize('Runtime.exceptionThrown', {})).toBe(0)
    expect(keptPayloadSize('Runtime.exceptionThrown', { exceptionDetails: { text: 'abc', exception: 'x' } })).toBe(3)
    expect(keptPayloadSize('Log.entryAdded', { entry: 'x' })).toBe(0)
    expect(keptPayloadSize('Log.entryAdded', { entry: { text: 7 } })).toBe(0)
    expect(keptPayloadSize('Network.requestWillBeSent', {})).toBe(0)
    expect(keptPayloadSize('Network.responseReceived', { response: null })).toBe(0)
    expect(keptPayloadSize('Target.attachedToTarget', { targetInfo: { url: 'x'.repeat(100) } })).toBe(0)
  })
})

describe('TargetFloodBudget (025-FR-038, performance review high finding)', () => {
  it('lets a dev-server load of 600 module requests in one second through, with every network event the engine sends', () => {
    const budget = new TargetFloodBudget(createManualClock(0))
    for (let i = 0; i < 600; i++) for (const [method, params] of request(i)) expect(budget.count(method, params)).toBe(false)
    expect(budget.isTripped).toBe(false)
  })

  it('still trips on the 201st console call in a second, network events aside', () => {
    const budget = new TargetFloodBudget(createManualClock(0))
    for (let i = 0; i < 100; i++) for (const [method, params] of request(i)) budget.count(method, params)
    for (let i = 0; i < FLOOD_MAX_EVENTS; i++) expect(budget.count('Runtime.consoleAPICalled', consoleCall('e'))).toBe(false)
    expect(budget.count('Log.entryAdded', { entry: { text: 'x' } })).toBe(true)
    expect(budget.isTripped).toBe(true)
  })

  it('trips the log class on 1 MB of console text in a second', () => {
    const budget = new TargetFloodBudget(createManualClock(0))
    expect(budget.count('Runtime.consoleAPICalled', consoleCall('x'.repeat(FLOOD_MAX_BYTES)))).toBe(false)
    expect(budget.count('Runtime.consoleAPICalled', consoleCall('x'))).toBe(true)
  })

  it('trips the network class past its own event limit, and reports a trip once until reset', () => {
    const clock = createManualClock(0)
    const budget = new TargetFloodBudget(clock)
    for (let i = 0; i < FLOOD_MAX_NETWORK_EVENTS; i++) expect(budget.count('Network.loadingFinished', { requestId: `r${i}` })).toBe(false)
    expect(budget.count('Network.loadingFinished', { requestId: 'over' })).toBe(true)
    expect(budget.count('Runtime.consoleAPICalled', consoleCall('e'))).toBe(false)
    clock.advance(10 * FLOOD_WINDOW_MS)
    expect(budget.isTripped).toBe(true)
    budget.reset()
    expect(budget.isTripped).toBe(false)
    expect(budget.count('Network.loadingFinished', { requestId: 'again' })).toBe(false)
  })

  it('trips the network class on its byte limit', () => {
    const budget = new TargetFloodBudget(createManualClock(0))
    const big = { request: { url: `data:,${'x'.repeat(FLOOD_MAX_NETWORK_BYTES)}` } }
    expect(budget.count('Network.requestWillBeSent', big)).toBe(true)
  })

  it('never counts a free event, however many arrive', () => {
    const budget = new TargetFloodBudget(createManualClock(0))
    for (let i = 0; i < 10 * FLOOD_MAX_NETWORK_EVENTS; i++) expect(budget.count('Network.dataReceived', { dataLength: 1 })).toBe(false)
    expect(budget.isTripped).toBe(false)
  })
})
