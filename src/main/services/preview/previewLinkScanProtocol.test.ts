// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The link scan worker's message contract (issue #124 audit, follow-up): main
 * trusts a reply only when every field has the shape and the size the worker
 * may send, and logs an error only by a short name.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_LINKS_PER_DOCUMENT,
  MAX_SRCDOC_PER_DOCUMENT,
  isErrorName,
  isLinkScanReply,
  isLinkScanRequest,
  type LinkScanOk
} from './previewLinkScanProtocol'

const OK: LinkScanOk = {
  kind: 'ok',
  links: ['a.css'],
  frames: { src: ['f.html'], srcdoc: [new Uint8Array([60, 112, 62])] },
  limits: ['attributes-per-tag', 'document-length', 'links-per-document']
}

const reply = (outcome: unknown, extra: Record<string, unknown> = {}): unknown => ({
  type: 'result',
  id: 1,
  outcome,
  ...extra
})

describe('isLinkScanRequest', () => {
  it('accepts a scan of bytes or of text', () => {
    expect(isLinkScanRequest({ type: 'scan', id: 1, html: new Uint8Array(1), frames: true })).toBe(true)
    expect(isLinkScanRequest({ type: 'scan', id: 2, html: '<p>', frames: false })).toBe(true)
  })

  it.each([
    ['nothing', null],
    ['a string', 'scan'],
    ['another type', { type: 'job', id: 1, html: '', frames: true }],
    ['an id that is not an integer', { type: 'scan', id: 1.5, html: '', frames: true }],
    ['markup of another kind', { type: 'scan', id: 1, html: [60], frames: true }],
    ['no frames flag', { type: 'scan', id: 1, html: '' }]
  ])('refuses %s', (_label, message) => {
    expect(isLinkScanRequest(message)).toBe(false)
  })
})

describe('isLinkScanReply', () => {
  it('accepts a full scan, a scan without frames, one whose frames threw, and an error', () => {
    expect(isLinkScanReply(reply(OK))).toBe(true)
    expect(isLinkScanReply(reply({ ...OK, frames: null, limits: [] }))).toBe(true)
    expect(isLinkScanReply(reply({ ...OK, frames: null, framesError: 'RangeError' }))).toBe(true)
    expect(isLinkScanReply(reply({ kind: 'error', error: 'TypeError' }))).toBe(true)
  })

  it('accepts the most the worker may send', () => {
    const many = Array.from({ length: MAX_LINKS_PER_DOCUMENT }, (_, n) => `${n}.png`)
    const srcdoc = Array.from({ length: MAX_SRCDOC_PER_DOCUMENT }, () => new Uint8Array(1))
    expect(isLinkScanReply(reply({ ...OK, links: many, frames: { src: many, srcdoc } }))).toBe(true)
  })

  it.each([
    ['nothing', null],
    ['another type', { type: 'error', id: 1, outcome: OK }],
    ['an id that is not an integer', { type: 'result', id: '1', outcome: OK }],
    ['no outcome', reply(null)],
    ['an outcome of another kind', reply({ ...OK, kind: 'failed' })],
    ['an error with free text', reply({ kind: 'error', error: 'Cannot read C:\\proj\\a.html' })],
    ['an error that is not text', reply({ kind: 'error', error: 7 })],
    ['links that are not text', reply({ ...OK, links: [1] })],
    ['too many links', reply({ ...OK, links: Array.from({ length: MAX_LINKS_PER_DOCUMENT + 1 }, () => 'a') })],
    ['frames that are not an object', reply({ ...OK, frames: 'f.html' })],
    ['frame sources that are not a list', reply({ ...OK, frames: { src: 'f.html', srcdoc: [] } })],
    ['srcdoc markup as text', reply({ ...OK, frames: { src: [], srcdoc: ['<p>'] } })],
    ['srcdoc that is not a list', reply({ ...OK, frames: { src: [], srcdoc: {} } })],
    [
      'too many srcdoc frames',
      reply({ ...OK, frames: { src: [], srcdoc: Array.from({ length: MAX_SRCDOC_PER_DOCUMENT + 1 }, () => new Uint8Array(1)) } })
    ],
    ['a frames error with free text', reply({ ...OK, framesError: 'no such file C:\\a' })],
    ['an unknown bound', reply({ ...OK, limits: ['time'] })],
    ['bounds that are not a list', reply({ ...OK, limits: 'document-length' })]
  ])('refuses %s', (_label, message) => {
    expect(isLinkScanReply(message)).toBe(false)
  })
})

describe('isErrorName', () => {
  it('takes a short identifier only', () => {
    expect(isErrorName('RangeError')).toBe(true)
    expect(isErrorName('string')).toBe(true)
    expect(isErrorName('$_x9')).toBe(true)
    expect(isErrorName('')).toBe(false)
    expect(isErrorName('9Error')).toBe(false)
    expect(isErrorName('Range Error')).toBe(false)
    expect(isErrorName('E'.repeat(65))).toBe(false)
    expect(isErrorName(undefined)).toBe(false)
  })
})
