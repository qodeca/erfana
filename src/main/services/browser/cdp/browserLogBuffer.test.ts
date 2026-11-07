// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { createManualClock } from '../../../../shared/clock'
import {
  BrowserLogBuffer,
  failedRequestUrl,
  LOG_BUFFER_MAX_ENTRIES,
  LOG_MESSAGE_MAX_CODE_UNITS,
  LOG_URL_MAX_CODE_UNITS
} from './browserLogBuffer'

function buffer(): { log: BrowserLogBuffer; advance: (ms: number) => void } {
  const clock = createManualClock(1_000)
  return { log: new BrowserLogBuffer(clock), advance: ms => clock.advance(ms) }
}

describe('BrowserLogBuffer (025-FR-038)', () => {
  it('025-AC-038 keeps the last 20 console entries of either level in time order', () => {
    const { log, advance } = buffer()
    for (let i = 1; i <= 3; i++) log.addConsole('F', 'https://a.test', 'warning', `early warning ${i}`)
    for (let i = 1; i <= 25; i++) {
      advance(1)
      log.addConsole('F', 'https://a.test', 'error', `error ${i}`)
    }
    log.addConsole('F', 'https://a.test', 'warning', 'final warning')
    const { console: entries } = log.snapshot()
    expect(entries).toHaveLength(20)
    expect(entries.map(e => e.message)).toEqual([...Array.from({ length: 19 }, (_, i) => `error ${i + 7}`), 'final warning'])
    expect(entries.at(-1)?.level).toBe('warning')
    expect(entries.some(e => e.message.startsWith('early'))).toBe(false)
  })

  it('025-AC-038 keeps 20 failed requests and drops the oldest at 21', () => {
    const { log } = buffer()
    for (let i = 1; i <= 20; i++) log.addFailedRequest('F', 'https://a.test', '500', `https://a.test/${i}`)
    expect(log.snapshot().failedRequests).toHaveLength(LOG_BUFFER_MAX_ENTRIES)
    expect(log.snapshot().failedRequests[0].url).toBe('https://a.test/1')
    log.addFailedRequest('F', 'https://a.test', '500', 'https://a.test/21')
    const requests = log.snapshot().failedRequests
    expect(requests).toHaveLength(20)
    expect(requests[0].url).toBe('https://a.test/2')
    expect(requests.at(-1)?.url).toBe('https://a.test/21')
  })

  it('025-AC-038 clears a frame on its new document and keeps the other frames', () => {
    const { log } = buffer()
    log.addConsole('top', 'https://a.test', 'error', 'top error')
    log.addConsole('child', 'https://b.test', 'error', 'child error')
    log.clearFrame('top')
    expect(log.snapshot().console.map(e => e.message)).toEqual(['child error'])
    log.clearAll()
    expect(log.snapshot()).toEqual({ console: [], failedRequests: [], truncated: false })
  })

  it('merges frames in time order and keeps the last 20 overall, with each frame origin', () => {
    const { log, advance } = buffer()
    for (let i = 0; i < 15; i++) {
      advance(1)
      log.addConsole('top', 'https://a.test', 'error', `a${i}`)
      log.addConsole('child', 'https://b.test', 'warning', `b${i}`)
    }
    const entries = log.snapshot().console
    expect(entries).toHaveLength(20)
    expect(entries[0].message).toBe('a5')
    expect(entries.at(-1)).toMatchObject({ message: 'b14', frameOrigin: 'https://b.test', level: 'warning', timeMs: 1015 })
    for (let i = 1; i < entries.length; i++) expect(entries[i].timeMs).toBeGreaterThanOrEqual(entries[i - 1].timeMs)
  })

  it('cuts a message at 500 code units: 500 stays whole, 501 loses one', () => {
    const { log } = buffer()
    log.addConsole('F', 'o', 'error', 'x'.repeat(500))
    log.addConsole('F', 'o', 'error', `${'y'.repeat(500)}z`)
    const [whole, cut] = log.snapshot().console
    expect(whole.message).toHaveLength(LOG_MESSAGE_MAX_CODE_UNITS)
    expect(cut.message).toBe('y'.repeat(500))
  })

  it('never splits a surrogate pair at the 500 cut', () => {
    const { log } = buffer()
    log.addConsole('F', 'o', 'error', `${'x'.repeat(499)}😀`)
    expect(log.snapshot().console[0].message).toBe('x'.repeat(499))
  })

  it('returns a frozen snapshot that later entries do not change (025-FR-053)', () => {
    const { log } = buffer()
    log.addConsole('F', 'o', 'error', 'before')
    const snap = log.snapshot()
    log.addConsole('F', 'o', 'error', 'after')
    expect(snap.console.map(e => e.message)).toEqual(['before'])
    expect(Object.isFrozen(snap)).toBe(true)
    expect(Object.isFrozen(snap.console)).toBe(true)
    expect(Object.isFrozen(snap.console[0])).toBe(true)
  })

  it('reports truncation until the truncated frame gets a new document', () => {
    const { log } = buffer()
    log.addConsole('F', 'o', 'error', 'e')
    log.markTruncated('F')
    expect(log.snapshot()).toMatchObject({ truncated: true, console: [{ message: 'e' }] })
    log.clearFrame('F')
    expect(log.snapshot().truncated).toBe(false)
  })
})

describe('failedRequestUrl (025-FR-038, 025-FR-042)', () => {
  it('keeps path and query, drops userinfo and fragment', () => {
    expect(failedRequestUrl('https://user:secret@a.test/p/q?x=1&y=2#frag')).toBe('https://a.test/p/q?x=1&y=2')
  })

  it('reduces a data URL to its media type', () => {
    expect(failedRequestUrl(`data:image/png;base64,${'A'.repeat(10_000)}`)).toBe('data:image/png;base64,…')
    expect(failedRequestUrl('data:nocomma')).toBe('data:nocomma,…')
  })

  it('keeps unparseable text and cuts every URL at 2048 code units', () => {
    expect(failedRequestUrl('not a url')).toBe('not a url')
    expect(failedRequestUrl('')).toBe('')
    const long = `https://a.test/${'p'.repeat(5000)}`
    expect(failedRequestUrl(long)).toHaveLength(LOG_URL_MAX_CODE_UNITS)
  })
})
