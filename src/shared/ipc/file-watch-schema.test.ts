// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/** The freshness `file-watch:*` wire contract (#478 plan step S7, § 3.3; D1, F39). */
import { describe, expect, it } from 'vitest'

import { TIMING_PROFILE_NAMES } from '../freshness/timingProfiles'
import { FILE_WATCH_CHANNELS } from './file-watch-channels'
import {
  FileWatchCheckSchema,
  FileWatchSubscriptionEventSchema,
  ProbeReplySchema,
  ProbeRequestSchema,
  ResumeWatchReplySchema,
  SubscribeReplySchema,
  SubscribeRequestSchema,
  TextReadReplySchema,
  TimingProfileSchema,
  WatchIdRequestSchema,
  WriteTextReplySchema,
  WriteTextRequestSchema,
} from './file-watch-schema'

const ID = '0b6f3c52-8f4e-4b8a-9d3c-1f2e3a4b5c6d'
const HASH = 'a'.repeat(64)
const STAMP = { size: 3, mtimeMs: 1_700_000_000_000.123, ctimeMs: 1_700_000_000_000.5, ino: '18446744073709551615', hash: HASH }

describe('file-watch channel names', () => {
  it('are unique and all under file-watch:', () => {
    const names = Object.values(FILE_WATCH_CHANNELS)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^file-watch:[a-zA-Z]+$/)
  })

  it('do not reuse a legacy name still registered until S16 (decision 50)', () => {
    const legacy = ['start', 'stop', 'stopAll', 'pause', 'resume', 'changed', 'deleted', 'error'].map((n) => `file-watch:${n}`)
    for (const name of Object.values(FILE_WATCH_CHANNELS)) expect(legacy).not.toContain(name)
  })
})

describe('TimingProfileSchema (F39)', () => {
  it('is the timing source’s profile names, nothing else', () => {
    expect(TimingProfileSchema.options).toEqual(TIMING_PROFILE_NAMES)
    expect(TimingProfileSchema.safeParse('fast').success).toBe(false)
  })
})

describe('SubscribeRequestSchema', () => {
  it('accepts a window profile with a UUID id', () => {
    for (const profile of ['editor', 'image', 'dependent']) {
      expect(SubscribeRequestSchema.safeParse({ watchId: ID, filePath: '/p/a.md', profile }).success).toBe(true)
    }
  })

  it('refuses the main-side profiles from a window', () => {
    for (const profile of ['preview', 'comments']) {
      expect(SubscribeRequestSchema.safeParse({ watchId: ID, filePath: '/p/a.md', profile }).success).toBe(false)
    }
  })

  it('refuses a non-UUID id, an empty path and any extra key (strict)', () => {
    expect(SubscribeRequestSchema.safeParse({ watchId: 'w1', filePath: '/p/a.md', profile: 'editor' }).success).toBe(false)
    expect(SubscribeRequestSchema.safeParse({ watchId: ID, filePath: '', profile: 'editor' }).success).toBe(false)
    expect(
      SubscribeRequestSchema.safeParse({ watchId: ID, filePath: '/p/a.md', profile: 'editor', cap: 999 }).success
    ).toBe(false)
  })
})

describe('replies and events', () => {
  it('subscribe: started, queued, refused', () => {
    expect(SubscribeReplySchema.parse({ status: 'started', stamp: STAMP, liveRefresh: 'limited' })).toEqual({
      status: 'started',
      stamp: STAMP,
      liveRefresh: 'limited',
    })
    expect(SubscribeReplySchema.safeParse({ status: 'queued' }).success).toBe(true)
    expect(SubscribeReplySchema.safeParse({ status: 'refused', code: 'PAGE_CHANGED' }).success).toBe(true)
    expect(SubscribeReplySchema.safeParse({ status: 'refused', code: 'NOPE' }).success).toBe(false)
  })

  it('a stamp is strict: a decimal file id, a SHA-256 hex hash', () => {
    const bad = [{ ...STAMP, ino: '12a' }, { ...STAMP, hash: 'XYZ' }, { ...STAMP, extra: 1 }, { ...STAMP, size: -1 }]
    for (const stamp of bad) {
      expect(SubscribeReplySchema.safeParse({ status: 'started', stamp, liveRefresh: 'full' }).success).toBe(false)
    }
  })

  it('id requests and the resume reply', () => {
    expect(WatchIdRequestSchema.safeParse({ watchId: ID }).success).toBe(true)
    expect(WatchIdRequestSchema.safeParse({ watchId: ID, filePath: '/p' }).success).toBe(false)
    expect(ResumeWatchReplySchema.safeParse({ success: true, missed: false }).success).toBe(true)
  })

  it('probe: a known hash must be SHA-256 hex', () => {
    expect(ProbeRequestSchema.safeParse({ filePath: '/p/a.md', knownHash: HASH }).success).toBe(true)
    expect(ProbeRequestSchema.safeParse({ filePath: '/p/a.md', knownHash: 'short' }).success).toBe(false)
    expect(ProbeReplySchema.safeParse({ status: 'unreadable', code: 'EBUSY' }).success).toBe(true)
    expect(ProbeReplySchema.safeParse({ status: 'missing' }).success).toBe(true)
  })

  it('readText: every classified status, and too-large carries its size', () => {
    for (const status of ['binary', 'unsupported-encoding', 'unsupported', 'missing', 'unreadable', 'busy']) {
      expect(TextReadReplySchema.safeParse({ status }).success).toBe(true)
    }
    expect(TextReadReplySchema.safeParse({ status: 'too-large', size: 11 * 1024 * 1024 }).success).toBe(true)
    expect(TextReadReplySchema.safeParse({ status: 'ok', text: 'x', stamp: STAMP, eol: 'crlf' }).success).toBe(true)
    expect(TextReadReplySchema.safeParse({ status: 'ok', text: 'x', stamp: STAMP, eol: 'cr' }).success).toBe(false)
  })

  it('writeText: like file:writeFile plus an optional expected stamp', () => {
    expect(
      WriteTextRequestSchema.safeParse({ filePath: '/p/a.md', content: '', generation: 3, expectedStamp: STAMP }).success
    ).toBe(true)
    expect(WriteTextRequestSchema.safeParse({ filePath: '/p/a.md', content: '', createParentDirs: false }).success).toBe(
      false
    )
    expect(WriteTextReplySchema.safeParse({ status: 'changed-on-disk', stamp: null }).success).toBe(true)
    expect(WriteTextReplySchema.safeParse({ status: 'written', stamp: STAMP }).success).toBe(true)
  })

  it('events name a subscription id, never a path', () => {
    expect(FileWatchSubscriptionEventSchema.safeParse({ watchId: ID, kind: 'changed' }).success).toBe(true)
    expect(FileWatchSubscriptionEventSchema.safeParse({ watchId: ID, kind: 'changed', filePath: '/p' }).success).toBe(
      false
    )
    // A forced change (the gate cap, a health-round re-arm – F8) carries only `forced: true`
    expect(FileWatchSubscriptionEventSchema.safeParse({ watchId: ID, kind: 'changed', forced: true }).success).toBe(true)
    expect(FileWatchSubscriptionEventSchema.safeParse({ watchId: ID, kind: 'changed', forced: false }).success).toBe(false)
    expect(FileWatchSubscriptionEventSchema.safeParse({ watchId: ID, kind: 'deleted', forced: true }).success).toBe(false)
    // A settled change carries the stamp the writes settled at (P3); a malformed one is refused
    expect(FileWatchSubscriptionEventSchema.safeParse({ watchId: ID, kind: 'changed', stamp: STAMP }).success).toBe(true)
    expect(
      FileWatchSubscriptionEventSchema.safeParse({ watchId: ID, kind: 'changed', stamp: { ...STAMP, size: -1 } }).success
    ).toBe(false)
    expect(FileWatchSubscriptionEventSchema.safeParse({ watchId: ID, kind: 'deleted', stamp: STAMP }).success).toBe(false)
    expect(
      FileWatchSubscriptionEventSchema.safeParse({ watchId: ID, kind: 'ended', reason: 'project-switch' }).success
    ).toBe(true)
    expect(FileWatchSubscriptionEventSchema.safeParse({ watchId: ID, kind: 'ended', reason: 'other' }).success).toBe(
      false
    )
    expect(FileWatchCheckSchema.safeParse({ reason: 'resume' }).success).toBe(true)
  })
})
