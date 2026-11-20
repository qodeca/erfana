// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'

import { PREVIEW } from '../constants'
import {
  DELETED_PROBE_BACKOFF,
  FRESHNESS_LIMITS,
  TIMING_PROFILES,
  TIMING_PROFILE_NAMES,
  WATCH_BUCKETS,
  type TimingProfile,
} from './timingProfiles'

/** G4's budget: a file deleted and recreated must follow again within 3 s. */
const G4_BUDGET_MS = 3_000

const profiles = Object.entries(TIMING_PROFILES) as [string, TimingProfile][]

describe('TIMING_PROFILES', () => {
  it('lets editor and image changes settle fast enough for the 250 ms median (P1)', () => {
    expect(TIMING_PROFILES.editor.settleMs).toBeLessThan(150)
    expect(TIMING_PROFILES.image.settleMs).toBeLessThan(150)
  })

  it.each(profiles)('%s: throttles at most once a second (P2)', (_name, profile) => {
    expect(profile.throttleMs).toBeGreaterThanOrEqual(0)
    expect(profile.throttleMs).toBeLessThanOrEqual(1_000)
  })

  it.each(profiles)('%s: retries a failed read three times, each wait longer (L2)', (_name, profile) => {
    expect(profile.readRetryDelaysMs).toHaveLength(3)
    for (let i = 1; i < profile.readRetryDelaysMs.length; i++) {
      expect(profile.readRetryDelaysMs[i]).toBeGreaterThan(profile.readRetryDelaysMs[i - 1])
    }
  })

  it.each(profiles)('%s: confirms a delete inside the G4 budget minus the ready wait', (_name, profile) => {
    if (profile.deleteConfirmMs === null) return
    expect(profile.deleteConfirmMs).toBeLessThan(G4_BUDGET_MS - FRESHNESS_LIMITS.readyTimeoutMs)
  })

  it.each(profiles)('%s: polls the write gate faster than it settles, under the gate cap', (_name, profile) => {
    expect(profile.pollMs).toBeLessThan(profile.settleMs)
    expect(profile.settleMs).toBeLessThan(profile.gateCapMs)
  })

  it.each(profiles)('%s: backs the deleted probe off, never faster than its first ask', (_name, profile) => {
    if (profile.deletedProbe === null) return
    expect(profile.deletedProbe.maxMs).toBeGreaterThanOrEqual(profile.deletedProbe.firstMs)
  })

  it('keeps the HTML preview at today’s values (no speed change, F21)', () => {
    expect(TIMING_PROFILES.preview.settleMs).toBe(50)
    expect(TIMING_PROFILES.preview.pollMs).toBe(25)
    expect(TIMING_PROFILES.preview.poolCoalesceMs).toBe(30)
    expect(TIMING_PROFILES.preview.throttleMs).toBe(0)
    expect(WATCH_BUCKETS.preview).toEqual({ perOwnerCap: 16, totalCap: 64 })
  })

  it('only the editor pauses its subscription for a save', () => {
    const pausing = profiles.filter(([, p]) => p.pauseMaxMs !== null).map(([name]) => name)
    expect(pausing).toEqual(['editor'])
  })

  it('keeps today’s caps for tabs and comments', () => {
    expect(WATCH_BUCKETS.tabs.totalCap).toBe(100)
    expect(WATCH_BUCKETS.comments.totalCap).toBe(64)
    expect(WATCH_BUCKETS.dependent).toEqual({ perOwnerCap: 8, totalCap: 32 })
  })

  it('names every profile once, in declaration order', () => {
    expect(TIMING_PROFILE_NAMES).toEqual(['editor', 'image', 'preview', 'dependent', 'comments'])
  })
})

describe('re-pointed constants keep their values (S1: no value change)', () => {
  it('PREVIEW watch constants read the preview profile', () => {
    expect(PREVIEW.MAX_WATCHED_FILES).toBe(16)
    expect(PREVIEW.MAX_WATCHED_FILES_GLOBAL).toBe(64)
    // The PREVIEW.WATCH_* aliases are gone (S17, F37): the pool and the coalesce read the profile
    expect(TIMING_PROFILES.preview.poolCoalesceMs).toBe(30)
    expect(TIMING_PROFILES.preview.settleMs).toBe(50)
    expect(TIMING_PROFILES.preview.pollMs).toBe(25)
  })

  it('the deleted-file probe backs off to a 2 s ceiling', () => {
    expect(DELETED_PROBE_BACKOFF.maxMs).toBe(2_000)
  })
})

describe('FRESHNESS_LIMITS', () => {
  it('limits editor text to 10 MiB and hashing to 16 MiB', () => {
    expect(FRESHNESS_LIMITS.editorTextMaxBytes).toBe(10 * 1024 * 1024)
    expect(FRESHNESS_LIMITS.hashMaxBytes).toBe(16 * 1024 * 1024)
    expect(FRESHNESS_LIMITS.hashCacheEntries).toBe(256)
  })
})
