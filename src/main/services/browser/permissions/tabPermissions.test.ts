// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One tab's permission requests (spec 025, 025-FR-019): saved decisions per
 * origin pair, Allow once, Block, Dismiss, screen sharing never saved, the
 * queue and withdrawal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock, type TestClock } from '../../../../shared/clock'
import { originParts } from '../../../../shared/browser/originFormat'
import { StripEventSchema, type StripAnswer, type StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import type { PurposeSigner } from '../browserProfileMarker'
import { BrowserPermissionStore } from './permissionStore'
import { TabPermissions, type PermissionAsk } from './tabPermissions'
import { STRIP_INPUT_GUARD_MS, STRIP_QUEUE_GAP_MS, TabStrip } from './tabStrip'

const MEMORY_ONLY: PurposeSigner = { hasKey: () => false, sign: () => undefined, verify: () => 'no-key' }
const TOP = 'https://garden.test'
const FRAME = 'https://maps.test'

let clock: TestClock
let events: StripEvent[]
let strip: TabStrip
let store: BrowserPermissionStore
let tab: TabPermissions

beforeEach(async () => {
  clock = createManualClock(0)
  events = []
  let n = 0
  strip = new TabStrip({ tabId: 'browser-tab-1', clock, emit: (e) => events.push(e), newId: () => `r${++n}` })
  store = await BrowserPermissionStore.open('/unused', '/unused-home', MEMORY_ONLY)
  tab = new TabPermissions({
    strip,
    store,
    display: { text: (o) => o.replace('https://', ''), parts: (o) => originParts(o, (h) => h) }
  })
})

function request(ask: PermissionAsk): boolean[] {
  const results: boolean[] = []
  tab.request(ask, (granted) => results.push(granted))
  return results
}

/** Answer the shown row once the guard has passed. */
function answer(value: StripAnswer): void {
  const shown = [...events].reverse().find((e) => e.op === 'add')
  if (shown?.op !== 'add') throw new Error('no row shown')
  clock.advance(STRIP_INPUT_GUARD_MS)
  expect(strip.answer(shown.row.requestId, value)).toBe('accepted')
}

const camera: PermissionAsk = { requesting: TOP, top: TOP, permissions: ['camera'] }
const location: PermissionAsk = { requesting: TOP, top: TOP, permissions: ['location'] }

describe('TabPermissions', () => {
  it('025-AC-019 prompts naming the host and permission; Allow is saved and later requests skip the prompt', () => {
    const first = request(location)
    expect(events[0]).toMatchObject({
      op: 'add',
      row: { kind: 'permission', text: 'garden.test wants to know your location', permissions: ['location'], answers: ['block', 'allow', 'dismiss'], remembered: 'session' }
    })
    expect(StripEventSchema.safeParse(events[0]).success).toBe(true)
    answer('allow')
    expect(first).toEqual([true])
    expect(store.get(TOP, TOP, 'location')).toBe('allow')
    expect(request(location)).toEqual([true])
    expect(tab.check(location)).toBe(true)
    tab.newLoad()
    expect(request(location)).toEqual([true])
    expect(events).toHaveLength(2)
  })

  it('025-AC-019 Block is saved and later requests from that pair are denied with no prompt', () => {
    const first = request(location)
    answer('block')
    expect(first).toEqual([false])
    tab.newLoad()
    expect(request(location)).toEqual([false])
    expect(tab.check(location)).toBe(false)
    expect(events).toHaveLength(2)
  })

  it('025-AC-019 closing the prompt denies for that page load, and the prompt returns on reload', () => {
    const first = request(camera)
    answer('dismiss')
    expect(first).toEqual([false])
    expect(request(camera)).toEqual([false])
    expect(events).toHaveLength(2)
    // A reload, as BrowserSite runs it: the strip is withdrawn, then the new load starts.
    strip.withdrawAll()
    tab.newLoad()
    expect(request(camera)).toEqual([])
    expect(events.at(-1)).toMatchObject({ op: 'add' })
  })

  it('025-AC-019 the camera offers Allow once, which grants for this page load only', () => {
    request(camera)
    expect(events[0]).toMatchObject({ row: { answers: ['block', 'allowOnce', 'allow', 'dismiss'], text: 'garden.test wants to use your camera' } })
    answer('allowOnce')
    expect(store.get(TOP, TOP, 'camera')).toBeUndefined()
    expect(request(camera)).toEqual([true])
    expect(tab.check(camera)).toBe(true)
    tab.newLoad()
    expect(tab.check(camera)).toBe(false)
    expect(request(camera)).toEqual([])
  })

  it('025-AC-019 a cross-origin frame request names both origins and is saved for the pair only', () => {
    const fromFrame: PermissionAsk = { requesting: FRAME, top: TOP, permissions: ['location'] }
    request(fromFrame)
    expect(events[0]).toMatchObject({
      row: {
        text: 'maps.test, inside garden.test, wants to know your location',
        requester: { origin: { kind: 'web', registrableDomain: 'maps.test' }, inside: { kind: 'web', registrableDomain: 'garden.test' } }
      }
    })
    answer('allow')
    expect(tab.check(fromFrame)).toBe(true)
    expect(tab.check({ requesting: FRAME, top: 'https://other.test', permissions: ['location'] })).toBe(false)
    expect(tab.check({ requesting: FRAME, top: FRAME, permissions: ['location'] })).toBe(false)
  })

  it('025-AC-019 screen sharing is never saved: allowed once, it asks again', () => {
    const screen: PermissionAsk = { requesting: TOP, top: TOP, permissions: ['screen'] }
    const first = request(screen)
    expect(events[0]).toMatchObject({ row: { answers: ['block', 'allow', 'dismiss'], remembered: 'never' } })
    answer('allow')
    expect(first).toEqual([true])
    expect(tab.check(screen)).toBe(false)
    clock.advance(STRIP_QUEUE_GAP_MS)
    expect(request(screen)).toEqual([])
    expect(events.at(-1)).toMatchObject({ op: 'add' })
  })

  it('screen sharing blocked counts for this page load only', () => {
    const screen: PermissionAsk = { requesting: TOP, top: TOP, permissions: ['screen'] }
    request(screen)
    answer('block')
    expect(request(screen)).toEqual([false])
    tab.newLoad()
    expect(request(screen)).toEqual([])
  })

  it('025-AC-019 queues two requests, and an answer decides the identical one waiting behind it', () => {
    const first = request(camera)
    const second = request(camera)
    const other = request(location)
    expect(events.at(-1)).toMatchObject({ op: 'change', row: { waiting: 2 } })
    answer('allow')
    expect(first).toEqual([true])
    expect(second).toEqual([true])
    expect(other).toEqual([])
    clock.advance(STRIP_QUEUE_GAP_MS)
    expect(events.at(-1)).toMatchObject({ op: 'add', row: { permissions: ['location'], waiting: 0 } })
  })

  it('asks only for the permissions still undecided, and grants once all are allowed', () => {
    void store.set(TOP, TOP, ['camera'], 'allow')
    const both: PermissionAsk = { requesting: TOP, top: TOP, permissions: ['camera', 'microphone'] }
    const result = request(both)
    expect(events[0]).toMatchObject({ row: { permissions: ['microphone'], text: 'garden.test wants to use your microphone' } })
    answer('allow')
    expect(result).toEqual([true])
    expect(tab.check(both)).toBe(true)
  })

  it('denies when any asked permission is blocked', () => {
    void store.set(TOP, TOP, ['microphone'], 'block')
    expect(request({ requesting: TOP, top: TOP, permissions: ['camera', 'microphone'] })).toEqual([false])
  })

  it('025-AC-019 a prompt withdrawn by navigation or tab close denies the request', () => {
    const first = request(camera)
    const queued = request(location)
    strip.withdrawAll()
    expect(first).toEqual([false])
    expect(queued).toEqual([false])
    strip.dispose()
    expect(request(camera)).toEqual([false])
  })

  it('denies a request that asks for nothing, and checks nothing as granted', () => {
    expect(request({ requesting: TOP, top: TOP, permissions: [] })).toEqual([false])
    expect(tab.check({ requesting: TOP, top: TOP, permissions: [] })).toBe(false)
  })

  it('leaves the origin line out when the display has no parts', () => {
    tab = new TabPermissions({ strip, store, display: { text: (o) => o, parts: () => null } })
    request(location)
    expect(events[0].op === 'add' && events[0].row.requester).toBeUndefined()
  })
})
