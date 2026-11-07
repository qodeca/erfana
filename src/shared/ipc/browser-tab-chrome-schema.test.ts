// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** Commit 18 payloads of the built-in browser (spec 025, § 8). */
import { describe, expect, it } from 'vitest'
import {
  NewTabCommandEventSchema,
  OpenExternalResponseSchema,
  PopupChangedEventSchema,
  TabClosedEventSchema
} from './browser-tab-chrome-schema'
import { CloseRequestSchema } from './browser-tab-schema'

describe('browser tab chrome schemas', () => {
  it('tabClosed names one main-minted tab and nothing else', () => {
    expect(TabClosedEventSchema.safeParse({ tabId: 'browser-tab-4' }).success).toBe(true)
    expect(TabClosedEventSchema.safeParse({ tabId: 'panel-4' }).success).toBe(false)
    expect(TabClosedEventSchema.safeParse({ tabId: 'browser-tab-4', panelId: 'x' }).success).toBe(false)
  })

  it('newTabCommand carries only byKey', () => {
    expect(NewTabCommandEventSchema.safeParse({ byKey: true }).success).toBe(true)
    expect(NewTabCommandEventSchema.safeParse({}).success).toBe(false)
  })

  it('openExternal answers ok or a capped error', () => {
    expect(OpenExternalResponseSchema.safeParse({ ok: true }).success).toBe(true)
    expect(OpenExternalResponseSchema.safeParse({ error: 'x' }).success).toBe(true)
    expect(OpenExternalResponseSchema.safeParse({ error: 'x'.repeat(2001) }).success).toBe(false)
    expect(OpenExternalResponseSchema.safeParse({ ok: false }).success).toBe(false)
  })

  it('popupChanged is empty, and close takes an optional byUser', () => {
    expect(PopupChangedEventSchema.safeParse({}).success).toBe(true)
    expect(PopupChangedEventSchema.safeParse({ url: 'x' }).success).toBe(false)
    expect(CloseRequestSchema.safeParse({ tabId: 'browser-tab-1', byUser: false }).success).toBe(true)
    expect(CloseRequestSchema.safeParse({ tabId: 'browser-tab-1', byUser: 'no' }).success).toBe(false)
  })
})
