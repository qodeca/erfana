// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * Tests for the capture's privacy pass (#138, design § Privacy; R138-11).
 * Each test names the break it catches in privacy.mjs. The identities below
 * are invented; the real deny-list is built from this machine at run time.
 */

import { describe, expect, it } from 'vitest'

import { buildDenyList, findEmails, sampleFrames, sampleTimes, scanText, stripAnsi } from './privacy.mjs'

const fakeMachine = {
  env: { ERFANA_CAPTURE_DENY_EXTRA: 'acmelabs' },
  secrets: ['tok-SECRET-VALUE-0123456789'],
  userInfo: () => ({ username: 'jdoe', homedir: '/Users/jdoe' }),
  hostname: () => 'Janes-MacBook.local',
  git: ([key]) => (key === 'user.email' ? 'jane.doe@corp.test' : 'Jane Doe'),
  fullName: () => 'Jane Doe'
}
const deny = buildDenyList(fakeMachine)

describe('buildDenyList', () => {
  it('holds the user name, home, host, git identity, name parts, secrets and operator terms', () => {
    const kinds = new Set(deny.map((e) => e.kind))
    for (const k of ['username', 'home-path', 'hostname', 'git-email', 'git-name', 'full-name', 'name-part', 'secret', 'operator-term']) {
      expect(kinds.has(k), k).toBe(true)
    }
  })

  it('skips values too short to match safely (break: an empty git name would match everything)', () => {
    const d = buildDenyList({ ...fakeMachine, git: () => '', fullName: () => '', userInfo: () => ({ username: 'ab', homedir: '/Users/ab' }) })
    expect(d.some((e) => e.value === '')).toBe(false)
    expect(d.some((e) => e.kind === 'username')).toBe(false)
  })
})

describe('scanText', () => {
  it('finds each identity kind and never returns the matched value', () => {
    const hits = scanText('cd /Users/jdoe && echo Janes-MacBook tok-SECRET-VALUE-0123456789', deny)
    expect(hits).toEqual(expect.arrayContaining(['home-path', 'username', 'hostname', 'secret']))
    expect(hits.join()).not.toMatch(/jdoe|SECRET/)
  })

  it('the real user name inside the sandbox path is not masked away by an allow rule (break: stripping allowed paths or addresses before the literal checks)', () => {
    // The sandbox path and an example.org address are both allowed on their own…
    expect(scanText('/Users/Shared/erfana-capture/home/Projects/harbour-garden', deny)).toEqual([])
    expect(scanText('committee@example.org', deny)).toEqual([])
    // …but a user name inside either is still reported.
    expect(scanText('/Users/Shared/erfana-capture/jdoe/Projects', deny)).toContain('username')
    expect(scanText('jdoe@example.org', deny)).toContain('username')
  })

  it('name parts match whole words only (break: "Doe" matching inside "Doer")', () => {
    expect(scanText('Doer and Janet', deny)).toEqual([])
    expect(scanText('by Jane, today', deny)).toContain('name-part')
  })

  it('any email outside example.org / example.com is reported, subdomains of those are allowed', () => {
    expect(scanText('mail someone@gmail.com', deny)).toContain('email')
    expect(scanText('orders@example.com and x@cdn.example.org', deny)).toEqual([])
    expect(scanText('x@example.org.evil.test', deny)).toContain('email')
  })

  it('token shapes, money and usage phrases (break: dropping a pattern kind)', () => {
    expect(scanText('key sk-ant-abcdefghijklmnop1234', deny)).toContain('token-shape')
    expect(scanText('a task-list item', deny)).toEqual([])
    expect(scanText('Total cost: $0.42', deny)).toContain('money')
    expect(scanText('You have hit your weekly limit', deny)).toContain('usage')
    expect(scanText('Sonnet 5 · 1M · 4%', deny)).toEqual([])
  })

  it('stays linear on hostile input (break: a backtracking email regex)', () => {
    const t = Date.now()
    scanText(`${'a.'.repeat(50_000)}@${'b.'.repeat(50_000)}`, deny)
    scanText('@'.repeat(100_000), deny)
    expect(Date.now() - t).toBeLessThan(2000)
  })
})

describe('findEmails', () => {
  it('trims trailing dots and needs a letter TLD', () => {
    expect(findEmails('write to a@b.co.')).toEqual([{ local: 'a', domain: 'b.co' }])
    expect(findEmails('user@host and v1@1.2')).toEqual([])
  })
})

describe('stripAnsi', () => {
  it('removes CSI, OSC and control characters but keeps text and line breaks', () => {
    expect(stripAnsi('\x1b[1;32mgreen\x1b[0m\r\n\x1b]0;title\x07ok\x1b]8;;x\x1b\\\x07')).toBe('green\r\nok')
  })
})

describe('frame sampling (R138-11)', () => {
  it('at least one frame per second plus the first and the last (break: an off-by-one that drops the last frame)', () => {
    expect(sampleFrames(30, 12)).toEqual([0, 12, 24, 29])
    expect(sampleFrames(1, 12)).toEqual([0])
    expect(sampleFrames(0, 12)).toEqual([])
    expect(() => sampleFrames(5, 0)).toThrow()
  })

  it('by time for files whose frames are uneven', () => {
    expect(sampleTimes(3.4)).toEqual([0, 1, 2, 3, 3.15])
    expect(sampleTimes(0)).toEqual([])
  })
})
