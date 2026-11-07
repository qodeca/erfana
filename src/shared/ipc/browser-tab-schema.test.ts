// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  BROWSER_TAB_CHANNELS,
  BROWSER_TAB_EVENTS,
  BROWSER_TAB_POPUP_CHANNELS,
  BROWSER_TAB_PREFIX
} from './browser-tab-channels'
import { BROWSER_CHANNELS } from './browser-channels'
import {
  BROWSER_ICON_MAX_BYTES,
  BROWSER_URL_MAX_CHARS,
  BoundsRequestSchema,
  ClearDataRequestSchema,
  CreateRequestSchema,
  FindResultEventSchema,
  NavigateRequestSchema,
  NavigationSourceSchema,
  NoticeEventSchema,
  OriginPartsSchema,
  PickEventSchema,
  RefineRequestSchema,
  ShowDownloadRequestSchema,
  StripEventSchema,
  TabStateEventSchema,
  TargetStatusResponseSchema,
  WriteCaptureRequestSchema,
  WriteCaptureResponseSchema
} from './browser-tab-schema'

const TAB = 'browser-tab-1'
const CAPTURE = 'a'.repeat(32)

describe('browser-tab channels (design § 8)', () => {
  it('every name carries the browser-tab: prefix, is unique, and no name collides with browser:', () => {
    const names = [
      ...Object.values(BROWSER_TAB_CHANNELS),
      ...Object.values(BROWSER_TAB_POPUP_CHANNELS),
      ...Object.values(BROWSER_TAB_EVENTS)
    ]
    expect(names.every(n => n.startsWith(BROWSER_TAB_PREFIX))).toBe(true)
    expect(new Set(names).size).toBe(names.length)
    expect(names).not.toContain(BROWSER_CHANNELS.OPEN_FILE)
    expect(Object.values(BROWSER_TAB_POPUP_CHANNELS).every(n => n.startsWith('browser-tab:popup'))).toBe(true)
  })
})

describe('browser-tab request schemas', () => {
  it('refuses unknown keys on every request (strict)', () => {
    expect(CreateRequestSchema.safeParse({ panelId: 'p', project: '/x' }).success).toBe(false)
    expect(NavigateRequestSchema.safeParse({ tabId: TAB, input: 'x', source: 'address', extra: 1 }).success).toBe(false)
  })

  it('refuses the page source on navigate, which only main may set (§ 3.4)', () => {
    expect(NavigationSourceSchema.options).toContain('page')
    for (const source of ['address', 'history', 'terminalLink', 'contextMenuLink']) {
      expect(NavigateRequestSchema.safeParse({ tabId: TAB, input: 'example.com', source }).success).toBe(true)
    }
    for (const source of ['page', 'reload', 'previewOpen', 'nope']) {
      expect(NavigateRequestSchema.safeParse({ tabId: TAB, input: 'example.com', source }).success).toBe(false)
    }
  })

  it('bounds typed input and ids', () => {
    const at = (input: string): boolean => NavigateRequestSchema.safeParse({ tabId: TAB, input, source: 'address' }).success
    expect(at('x'.repeat(BROWSER_URL_MAX_CHARS))).toBe(true)
    expect(at('x'.repeat(BROWSER_URL_MAX_CHARS + 1))).toBe(false)
    expect(at('')).toBe(false)
    expect(NavigateRequestSchema.safeParse({ tabId: 'terminal-1', input: 'x', source: 'address' }).success).toBe(false)
  })

  it('carries terminalId on writeCapture, and sendAnyway only as true', () => {
    const base = { tabId: TAB, captureId: CAPTURE, terminalId: 'terminal-3' }
    expect(WriteCaptureRequestSchema.safeParse(base).success).toBe(true)
    expect(WriteCaptureRequestSchema.safeParse({ ...base, sendAnyway: true }).success).toBe(true)
    expect(WriteCaptureRequestSchema.safeParse({ ...base, sendAnyway: false }).success).toBe(false)
    expect(WriteCaptureRequestSchema.safeParse({ tabId: TAB, captureId: CAPTURE }).success).toBe(false)
    expect(WriteCaptureRequestSchema.safeParse({ ...base, captureId: 'ABC' }).success).toBe(false)
  })

  it('answers writeCapture with paths, a guard or an error', () => {
    const paths = { context: 'a.md', screenshot: 'a.png', crop: 'a-crop.png' }
    expect(WriteCaptureResponseSchema.safeParse({ paths }).success).toBe(true)
    expect(WriteCaptureResponseSchema.safeParse({ guard: { kind: 'shell', process: 'zsh' } }).success).toBe(true)
    expect(WriteCaptureResponseSchema.safeParse({ guard: { kind: 'agent', process: 'claude' } }).success).toBe(false)
    expect(WriteCaptureResponseSchema.safeParse({ error: 'disk full' }).success).toBe(true)
    expect(TargetStatusResponseSchema.safeParse({ kind: 'wrapper', process: 'ssh', fresh: true }).success).toBe(true)
  })

  it('accepts refine moves by direction or ancestor index only', () => {
    const r = (move: unknown): boolean => RefineRequestSchema.safeParse({ tabId: TAB, captureId: CAPTURE, move }).success
    expect(r('parent')).toBe(true)
    expect(r({ ancestor: 3 })).toBe(true)
    expect(r({ ancestor: -1 })).toBe(false)
    expect(r('sideways')).toBe(false)
  })

  it('requires a bounds rect, seq, ack, visible and clip', () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 }
    const ok = { tabId: TAB, bounds: rect, seq: 4, ack: false, visible: true, clip: rect }
    expect(BoundsRequestSchema.safeParse(ok).success).toBe(true)
    expect(BoundsRequestSchema.safeParse({ ...ok, seq: -1 }).success).toBe(false)
    expect(BoundsRequestSchema.safeParse({ ...ok, bounds: { ...rect, width: Number.NaN } }).success).toBe(false)
  })

  it('needs at least one ticked category to clear data', () => {
    const none = { cookies: false, cache: false, permissions: false, credentials: false, captures: false }
    expect(ClearDataRequestSchema.safeParse({ categories: none }).success).toBe(false)
    expect(ClearDataRequestSchema.safeParse({ categories: { ...none, cache: true } }).success).toBe(true)
  })
})

describe('browser-tab event schemas', () => {
  const state = {
    tabId: TAB,
    committedUrl: 'https://example.com/',
    pendingUrl: null,
    origin: { kind: 'web', scheme: null, subdomain: '', registrableDomain: 'example.com', port: null, punycode: false },
    title: 'Example',
    canGoBack: false,
    canGoForward: false,
    loading: false,
    zoomPercent: 100,
    widthPreset: 'full',
    security: 'secure',
    erfanaPage: null,
    devToolsOpen: false
  }

  it('carries the icon as bytes, capped, and absent when unchanged', () => {
    expect(TabStateEventSchema.safeParse(state).success).toBe(true)
    expect(TabStateEventSchema.safeParse({ ...state, icon: new Uint8Array(16) }).success).toBe(true)
    expect(TabStateEventSchema.safeParse({ ...state, icon: new Uint8Array(BROWSER_ICON_MAX_BYTES + 1) }).success).toBe(false)
    expect(TabStateEventSchema.safeParse({ ...state, icon: 'data:image/png;base64,AAAA' }).success).toBe(false)
    expect(TabStateEventSchema.safeParse({ ...state, title: 'x'.repeat(201) }).success).toBe(false)
  })

  it('refuses an in-use field: no camera, microphone or screen indicator is sent (025-FR-019)', () => {
    expect(TabStateEventSchema.safeParse(state).success).toBe(true)
    expect(TabStateEventSchema.safeParse({ ...state, inUse: { camera: true, microphone: false, screen: false } }).success).toBe(false)
  })

  it('splits the origin for display only in the formatter shapes', () => {
    expect(OriginPartsSchema.safeParse({ kind: 'file' }).success).toBe(true)
    expect(OriginPartsSchema.safeParse({ kind: 'nonWeb', scheme: 'mailto' }).success).toBe(true)
    expect(OriginPartsSchema.safeParse({ ...state.origin, port: '99999x' }).success).toBe(false)
  })

  it('validates pick, strip and find events', () => {
    expect(PickEventSchema.safeParse({ tabId: TAB, kind: 'note', note: 'pageMoved' }).success).toBe(true)
    expect(PickEventSchema.safeParse({ tabId: TAB, kind: 'note', note: 'free text' }).success).toBe(false)
    expect(StripEventSchema.safeParse({ tabId: TAB, op: 'held', count: 1 }).success).toBe(true)
    expect(FindResultEventSchema.safeParse({ tabId: TAB, active: 0, total: 0 }).success).toBe(true)
    expect(FindResultEventSchema.safeParse({ tabId: TAB, active: 4, total: 3 }).success).toBe(false)
  })
})

describe('strip rows and download notices (025-FR-019, 025-FR-020)', () => {
  const web = { kind: 'web', scheme: null, subdomain: '', registrableDomain: 'a.test', port: null, punycode: false }
  const row = { requestId: 'r1', kind: 'permission', text: 'a.test wants to use your camera', answers: ['block', 'allow'], takesFocus: false }

  it('accepts the origin line, the permissions, the waiting count, persistence and the shown time', () => {
    const full = { ...row, requester: { origin: web, inside: null }, permissions: ['camera', 'microphone'], waiting: 1, remembered: 'session', shownAt: 500 }
    expect(StripEventSchema.safeParse({ tabId: TAB, op: 'add', row: full }).success).toBe(true)
    expect(StripEventSchema.safeParse({ tabId: TAB, op: 'add', row }).success).toBe(true)
  })

  it('refuses an empty or unknown permission list and a negative shown time', () => {
    expect(StripEventSchema.safeParse({ tabId: TAB, op: 'add', row: { ...row, permissions: [] } }).success).toBe(false)
    expect(StripEventSchema.safeParse({ tabId: TAB, op: 'add', row: { ...row, permissions: ['midi'] } }).success).toBe(false)
    expect(StripEventSchema.safeParse({ tabId: TAB, op: 'add', row: { ...row, shownAt: -1 } }).success).toBe(false)
  })

  it('carries a download notice\'s file name, id and reason, and no tab id once the tab closed', () => {
    const done = { tabId: null, kind: 'downloadDone', text: 'Downloaded a.pdf', download: { fileName: 'a.pdf', downloadId: 'dl1', reason: null } }
    expect(NoticeEventSchema.safeParse(done).success).toBe(true)
    expect(NoticeEventSchema.safeParse({ ...done, download: { ...done.download, reason: 'gone' } }).success).toBe(false)
    expect(ShowDownloadRequestSchema.safeParse({ downloadId: 'dl1' }).success).toBe(true)
    expect(ShowDownloadRequestSchema.safeParse({ downloadId: '../dl1' }).success).toBe(false)
  })
})
