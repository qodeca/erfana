// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The issue #124 contract, pinned at the boundary (WI-7).
 *
 * Nothing calls these schemas yet; later work items build on them. So this file
 * pins what they must hold before anything relies on them: every object is
 * strict, every string and number is bounded, a refusal may carry the tab's
 * new history, and each zod schema agrees with the leaf type in
 * `preview-types.ts` that main's modules use without importing zod.
 *
 * It also covers what WI-7 adds to `preview-schema.ts` (`settled`,
 * `disposition`, the still's CSS size and `stale`, the frame failure types).
 * Those fields must stay optional, so every payload that parsed before still
 * parses.
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'

import { ErrorCode } from '../errors'
import type { PreviewBridge as MovedPreviewBridge } from './preview-bridge-types'
import { PreviewChannels, PreviewEvents } from './preview-channels'
import {
  PreviewHistoryStateSchema,
  PreviewNavigateRequestSchema,
  PreviewNavigateResultSchema,
  PreviewPageChangedPayloadSchema,
  PreviewPageTargetSchema,
  PreviewResizeHoldPayloadSchema
} from './preview-navigation-schema'
import {
  PreviewFailureSchema,
  PreviewOpenFileRequestedSchema,
  PreviewSetBoundsSchema,
  PreviewStillFrameSchema,
  type PreviewBridge,
  type PreviewFailure
} from './preview-schema'
import type {
  PreviewFailureType,
  PreviewHistoryState,
  PreviewLinkDisposition,
  PreviewNavigateResult,
  PreviewPageChange,
  PreviewPageTarget
} from './preview-types'

type Payload = Record<string, unknown>

const PANEL_ID = 'preview-1'
const PAGE = '/project/site/pricing.html'

const HISTORY: PreviewHistoryState = {
  canGoBack: true,
  canGoForward: false,
  backTarget: { filePath: '/project/site/index.html', anchor: null },
  forwardTarget: null,
  generation: 4
}

function accepts(schema: z.ZodType, value: unknown): boolean {
  return schema.safeParse(value).success
}

/** A copy of `value` without `key`. */
function without(value: Payload, key: string): Payload {
  const copy = { ...value }
  delete copy[key]
  return copy
}

function openRequest(overrides: Payload = {}): Payload {
  return { panelId: PANEL_ID, phase: 'check', action: 'open', filePath: PAGE, anchor: null, ...overrides }
}

function stepRequest(overrides: Payload = {}): Payload {
  return { panelId: PANEL_ID, phase: 'commit', action: 'back', generation: 4, ...overrides }
}

describe('preview:navigate request', () => {
  it('accepts an open in either phase, with or without an anchor', () => {
    expect(accepts(PreviewNavigateRequestSchema, openRequest())).toBe(true)
    expect(accepts(PreviewNavigateRequestSchema, openRequest({ phase: 'commit', anchor: 'plans' }))).toBe(true)
  })

  it('accepts a back or forward step that carries the history generation', () => {
    expect(accepts(PreviewNavigateRequestSchema, stepRequest())).toBe(true)
    expect(accepts(PreviewNavigateRequestSchema, stepRequest({ action: 'forward', phase: 'check' }))).toBe(true)
  })

  it('refuses an unknown phase or action', () => {
    expect(accepts(PreviewNavigateRequestSchema, openRequest({ phase: 'apply' }))).toBe(false)
    expect(accepts(PreviewNavigateRequestSchema, stepRequest({ action: 'reload' }))).toBe(false)
    expect(accepts(PreviewNavigateRequestSchema, stepRequest({ action: 'go' }))).toBe(false)
  })

  it('is strict: the renderer never supplies a URL, a token or a project root', () => {
    for (const extra of [
      { url: 'erfana-preview://0123456789abcdef0123456789abcdef/pricing.html' },
      { token: '0123456789abcdef0123456789abcdef' },
      { projectPath: '/project' }
    ]) {
      expect(accepts(PreviewNavigateRequestSchema, openRequest(extra))).toBe(false)
      expect(accepts(PreviewNavigateRequestSchema, stepRequest(extra))).toBe(false)
    }
  })

  it('keeps the two shapes apart: a step names no file, an open names no generation', () => {
    expect(accepts(PreviewNavigateRequestSchema, stepRequest({ filePath: PAGE }))).toBe(false)
    expect(accepts(PreviewNavigateRequestSchema, openRequest({ generation: 1 }))).toBe(false)
    expect(accepts(PreviewNavigateRequestSchema, without(openRequest(), 'filePath'))).toBe(false)
    expect(accepts(PreviewNavigateRequestSchema, without(stepRequest(), 'generation'))).toBe(false)
  })

  it('requires the anchor on an open – null for the top of the page', () => {
    expect(accepts(PreviewNavigateRequestSchema, without(openRequest(), 'anchor'))).toBe(false)
  })

  it('bounds the path to 1–4096 characters and the anchor to 1024', () => {
    expect(accepts(PreviewNavigateRequestSchema, openRequest({ filePath: '' }))).toBe(false)
    expect(accepts(PreviewNavigateRequestSchema, openRequest({ filePath: 'a'.repeat(4096) }))).toBe(true)
    expect(accepts(PreviewNavigateRequestSchema, openRequest({ filePath: 'a'.repeat(4097) }))).toBe(false)
    expect(accepts(PreviewNavigateRequestSchema, openRequest({ anchor: 'a'.repeat(1024) }))).toBe(true)
    expect(accepts(PreviewNavigateRequestSchema, openRequest({ anchor: 'a'.repeat(1025) }))).toBe(false)
  })

  it('takes only a whole, non-negative, safe generation', () => {
    expect(accepts(PreviewNavigateRequestSchema, stepRequest({ generation: 0 }))).toBe(true)
    for (const generation of [-1, 1.5, '4', Number.MAX_SAFE_INTEGER + 1, Infinity]) {
      expect(accepts(PreviewNavigateRequestSchema, stepRequest({ generation }))).toBe(false)
    }
  })

  it('reuses the panel-id bound', () => {
    expect(accepts(PreviewNavigateRequestSchema, openRequest({ panelId: '' }))).toBe(false)
    expect(accepts(PreviewNavigateRequestSchema, openRequest({ panelId: 'p'.repeat(257) }))).toBe(false)
  })
})

describe('preview:navigate answer', () => {
  const accepted = { ok: true, target: { filePath: PAGE, anchor: 'plans' }, generation: 5 }
  const refused = { ok: false, errorCode: ErrorCode.PREVIEW_NAV_TARGET_MISSING }

  it('accepts an accepted move with its checked target and generation', () => {
    expect(accepts(PreviewNavigateResultSchema, accepted)).toBe(true)
  })

  it('accepts a refusal with only a code', () => {
    for (const errorCode of [
      ErrorCode.PREVIEW_NAV_TARGET_MISSING,
      ErrorCode.PREVIEW_NAV_TARGET_REFUSED,
      ErrorCode.PREVIEW_NAV_UNAVAILABLE,
      ErrorCode.PREVIEW_NAV_SKIPPED
    ]) {
      expect(accepts(PreviewNavigateResultSchema, { ok: false, errorCode })).toBe(true)
    }
  })

  it("accepts a refusal carrying the tab's new history (RU2-3)", () => {
    expect(accepts(PreviewNavigateResultSchema, { ...refused, history: HISTORY })).toBe(true)
  })

  it('refuses a raw error message – no raw error crosses IPC', () => {
    expect(accepts(PreviewNavigateResultSchema, { ...refused, error: 'ENOENT: /Users/me/x.html' })).toBe(false)
    expect(accepts(PreviewNavigateResultSchema, { ok: false, errorCode: 'ENOENT' })).toBe(false)
  })

  it('keeps success and refusal apart', () => {
    expect(accepts(PreviewNavigateResultSchema, { ...accepted, errorCode: refused.errorCode })).toBe(false)
    expect(accepts(PreviewNavigateResultSchema, { ...accepted, history: HISTORY })).toBe(false)
    expect(accepts(PreviewNavigateResultSchema, { ok: false, target: accepted.target })).toBe(false)
  })

  it('is strict inside the history and its targets too', () => {
    expect(accepts(PreviewNavigateResultSchema, { ...refused, history: { ...HISTORY, extra: 1 } })).toBe(false)
    const looseTarget = { ...HISTORY, backTarget: { filePath: PAGE, anchor: null, url: 'x' } }
    expect(accepts(PreviewNavigateResultSchema, { ...refused, history: looseTarget })).toBe(false)
    expect(accepts(PreviewHistoryStateSchema, without(HISTORY as unknown as Payload, 'generation'))).toBe(false)
  })
})

describe('preview:pageChanged payload', () => {
  const PAGE_CHANGED: Payload = {
    panelId: PANEL_ID,
    filePath: PAGE,
    anchor: 'plans',
    sameDocument: false,
    failed: false,
    ...HISTORY
  }

  it('accepts a full payload, including a failed commit', () => {
    expect(accepts(PreviewPageChangedPayloadSchema, PAGE_CHANGED)).toBe(true)
    expect(accepts(PreviewPageChangedPayloadSchema, { ...PAGE_CHANGED, failed: true })).toBe(true)
  })

  it('requires every field', () => {
    for (const key of Object.keys(PAGE_CHANGED)) {
      expect(accepts(PreviewPageChangedPayloadSchema, without(PAGE_CHANGED, key)), key).toBe(false)
    }
  })

  it('is strict: the committed URL never travels', () => {
    expect(accepts(PreviewPageChangedPayloadSchema, { ...PAGE_CHANGED, url: 'erfana-preview://x/y' })).toBe(false)
  })

  it('bounds the path and the anchor like the request', () => {
    expect(accepts(PreviewPageChangedPayloadSchema, { ...PAGE_CHANGED, filePath: '' })).toBe(false)
    expect(accepts(PreviewPageChangedPayloadSchema, { ...PAGE_CHANGED, filePath: 'a'.repeat(4097) })).toBe(false)
    expect(accepts(PreviewPageChangedPayloadSchema, { ...PAGE_CHANGED, anchor: 'a'.repeat(1025) })).toBe(false)
    expect(accepts(PreviewPageTargetSchema, { filePath: PAGE, anchor: 'a'.repeat(1024) })).toBe(true)
  })
})

describe('preview:resizeHold payload', () => {
  it('accepts a hold and its end', () => {
    expect(accepts(PreviewResizeHoldPayloadSchema, { panelId: PANEL_ID, held: true })).toBe(true)
    expect(accepts(PreviewResizeHoldPayloadSchema, { panelId: PANEL_ID, held: false })).toBe(true)
  })

  it('is strict and needs a real boolean', () => {
    expect(accepts(PreviewResizeHoldPayloadSchema, { panelId: PANEL_ID, held: true, windowId: 1 })).toBe(false)
    expect(accepts(PreviewResizeHoldPayloadSchema, { panelId: PANEL_ID, held: 'yes' })).toBe(false)
    expect(accepts(PreviewResizeHoldPayloadSchema, { panelId: PANEL_ID })).toBe(false)
  })
})

describe('channel names', () => {
  it('names the new invoke and the two new events', () => {
    expect(PreviewChannels.NAVIGATE).toBe('preview:navigate')
    expect(PreviewEvents.PAGE_CHANGED).toBe('preview:pageChanged')
    expect(PreviewEvents.RESIZE_HOLD).toBe('preview:resizeHold')
  })

  it('has no link-mode channel: the mode lives in the renderer only (RA7)', () => {
    expect(Object.values(PreviewChannels)).not.toContain('preview:setLinkMode')
  })

  it('keeps every preview channel name unique', () => {
    const names = [...Object.values(PreviewChannels), ...Object.values(PreviewEvents)]
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('what WI-7 adds to preview-schema.ts stays optional', () => {
  it('setBounds: accepts `settled`, and every push without it as before', () => {
    const push = { panelId: PANEL_ID, bounds: { x: 0, y: 0, width: 10, height: 10 }, seq: 1 }
    expect(accepts(PreviewSetBoundsSchema, push)).toBe(true)
    expect(accepts(PreviewSetBoundsSchema, { ...push, settled: true })).toBe(true)
    expect(accepts(PreviewSetBoundsSchema, { ...push, ack: true, settled: true })).toBe(true)
    expect(accepts(PreviewSetBoundsSchema, { ...push, settled: 'yes' })).toBe(false)
  })

  it('openFileRequested: accepts each disposition, and none', () => {
    const request = { sourcePanelId: PANEL_ID, filePath: PAGE, anchor: null }
    expect(accepts(PreviewOpenFileRequestedSchema, request)).toBe(true)
    for (const disposition of ['same-tab', 'new-tab', 'by-mode']) {
      expect(accepts(PreviewOpenFileRequestedSchema, { ...request, disposition })).toBe(true)
    }
    expect(accepts(PreviewOpenFileRequestedSchema, { ...request, disposition: 'new-window' })).toBe(false)
  })

  it('stillFrameChanged: accepts the CSS size and `stale`, and a frame without them', () => {
    const frame = { panelId: PANEL_ID, dataUrl: 'data:image/png;base64,', width: 10, height: 10, capturedAt: 1 }
    expect(accepts(PreviewStillFrameSchema, frame)).toBe(true)
    expect(accepts(PreviewStillFrameSchema, { ...frame, cssWidth: 800.5, cssHeight: 600, stale: true })).toBe(true)
    expect(accepts(PreviewStillFrameSchema, { ...frame, cssWidth: -1 })).toBe(false)
    expect(accepts(PreviewStillFrameSchema, { ...frame, stale: 'true' })).toBe(false)
  })

  it('failuresChanged: accepts the six frame failure types (part 2 §2.12)', () => {
    const entry = {
      id: '1',
      resourceUrlOrHost: 'https://cdn.example/frame.html',
      reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED,
      timestamp: 1
    }
    for (const type of [
      'frame-remote',
      'frame-escape',
      'frame-excluded',
      'frame-too-deep',
      'frame-over-limit',
      'frame-link-blocked'
    ]) {
      expect(accepts(PreviewFailureSchema, { ...entry, type }), type).toBe(true)
    }
    expect(accepts(PreviewFailureSchema, { ...entry, type: 'frame-unknown' })).toBe(false)
  })
})

describe('each schema agrees with its leaf type (enum equality)', () => {
  it('navigation shapes match preview-types', () => {
    expectTypeOf<z.infer<typeof PreviewPageTargetSchema>>().toEqualTypeOf<PreviewPageTarget>()
    expectTypeOf<z.infer<typeof PreviewHistoryStateSchema>>().toEqualTypeOf<PreviewHistoryState>()
    // `.branded` compares structure: `z.enum(ErrorCode)` accepts exactly the
    // `ErrorCode` values, but TypeScript's strict identity check does not treat
    // its inferred type as the enum type itself.
    expectTypeOf<z.infer<typeof PreviewNavigateResultSchema>>()
      .branded.toEqualTypeOf<PreviewNavigateResult>()
    expectTypeOf<
      Omit<z.infer<typeof PreviewPageChangedPayloadSchema>, 'panelId'>
    >().toEqualTypeOf<PreviewPageChange>()
  })

  it('the failure-type enum and the disposition enum match their unions', () => {
    expectTypeOf<PreviewFailure['type']>().toEqualTypeOf<PreviewFailureType>()
    expectTypeOf<
      NonNullable<z.infer<typeof PreviewOpenFileRequestedSchema>['disposition']>
    >().toEqualTypeOf<PreviewLinkDisposition>()
  })

  it('PreviewBridge is still importable from preview-schema after the move', () => {
    expectTypeOf<PreviewBridge>().toEqualTypeOf<MovedPreviewBridge>()
  })
})
