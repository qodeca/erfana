// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** The keyring notices as strip rows (spec 025, 025-FR-018; commit 18). */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock } from '../../../../shared/clock'
import type { StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { KEYRING_RESET_TEXT, KEYRING_WEAK_TEXT, KeyringStrip, type KeyringStripSetup } from './keyringStrip'

function make(notices: { weakProtection: boolean; keyringReset: boolean }, patch: Partial<KeyringStripSetup> = {}) {
  const events: StripEvent[] = []
  const clock = createManualClock(0)
  const dismissWeak = vi.fn(async () => undefined)
  const strip = new KeyringStrip('browser-tab-1', (e) => events.push(e), {
    clock,
    take: async () => notices,
    dismissWeak,
    newId: () => 'kr',
    ...patch
  })
  return { strip, events, clock, dismissWeak }
}

describe('KeyringStrip', () => {
  it('shows nothing when no notice is due', async () => {
    const { strip, events } = make({ weakProtection: false, keyringReset: false })
    await strip.start()
    expect(events).toEqual([])
    expect(strip.answer('kr', 'dismiss')).toBeNull()
  })

  it('shows the reset notice, then the weak-protection notice, each with Dismiss and the input guard', async () => {
    const { strip, events, clock, dismissWeak } = make({ weakProtection: true, keyringReset: true })
    await strip.start()
    expect(events[0]).toMatchObject({ op: 'add', row: { kind: 'keyring', text: KEYRING_RESET_TEXT, answers: ['dismiss'], takesFocus: false } })
    expect(strip.answer('kr', 'dismiss')).toBe('guarded')
    expect(strip.answer('kr', 'allow')).toBe('invalid')
    clock.advance(500)
    expect(strip.answer('kr', 'dismiss')).toBe('accepted')
    expect(dismissWeak).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ op: 'add', row: { text: KEYRING_WEAK_TEXT } })
    clock.advance(500)
    expect(strip.answer('kr', 'dismiss')).toBe('accepted')
    expect(dismissWeak).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toEqual({ tabId: 'browser-tab-1', op: 'withdraw', requestId: 'kr' })
  })

  it('logs a failed dismissal record and a failed read, never throws', async () => {
    const { strip, clock } = make({ weakProtection: true, keyringReset: false }, { dismissWeak: async () => Promise.reject(new Error('ro')) })
    await strip.start()
    clock.advance(500)
    expect(strip.answer('kr', 'dismiss')).toBe('accepted')
    const failing = make({ weakProtection: true, keyringReset: false }, { take: async () => Promise.reject(new Error('locked')) })
    await expect(failing.strip.start()).resolves.toBeUndefined()
    expect(failing.events).toEqual([])
    // A rejection that is not an Error is logged by its text.
    const odd = make({ weakProtection: true, keyringReset: false }, { dismissWeak: async () => Promise.reject('ro'), take: async () => Promise.reject('locked') })
    await expect(odd.strip.start()).resolves.toBeUndefined()
    const oddDismiss = make({ weakProtection: true, keyringReset: false }, { dismissWeak: async () => Promise.reject('ro') })
    await oddDismiss.strip.start()
    oddDismiss.clock.advance(500)
    expect(oddDismiss.strip.answer('kr', 'dismiss')).toBe('accepted')
    await Promise.resolve()
  })

  it('a tab closed before the notices arrive shows none, and detach withdraws a shown row', async () => {
    const early = make({ weakProtection: true, keyringReset: false })
    const started = early.strip.start()
    early.strip.detach()
    await started
    expect(early.events).toEqual([])
    const shown = make({ weakProtection: true, keyringReset: false })
    await shown.strip.start()
    shown.strip.detach()
    expect(shown.events.at(-1)).toMatchObject({ op: 'withdraw' })
  })
})
