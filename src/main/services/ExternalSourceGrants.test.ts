// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import nodePath from 'path'
import {
  ExternalSourceGrants,
  MAX_GRANTS_PER_SENDER,
  SOURCE_GRANT_TTL_MS
} from './ExternalSourceGrants'

function makeGrants(flavour: 'posix' | 'win32' | 'darwin') {
  const clock = { now: 1_000 }
  const grants = new ExternalSourceGrants({
    now: () => clock.now,
    path: flavour === 'win32' ? nodePath.win32 : nodePath.posix,
    platform: flavour === 'win32' ? 'win32' : flavour === 'darwin' ? 'darwin' : 'linux'
  })
  return { grants, clock }
}

describe('ExternalSourceGrants', () => {
  it('answers false for a path nobody picked', () => {
    const { grants } = makeGrants('posix')
    expect(grants.consume(1, '/in/notes.md')).toBe(false)
  })

  it('answers true once for a picked path', () => {
    const { grants } = makeGrants('posix')
    grants.issue(1, ['/in/notes.md'])

    expect(grants.consume(1, '/in/notes.md')).toBe(true)
    expect(grants.consume(1, '/in/notes.md')).toBe(false)
  })

  it('keeps the records of one window from another', () => {
    const { grants } = makeGrants('posix')
    grants.issue(1, ['/in/notes.md'])

    expect(grants.consume(2, '/in/notes.md')).toBe(false)
    expect(grants.consume(null, '/in/notes.md')).toBe(false)
    expect(grants.consume(1, '/in/notes.md')).toBe(true)
  })

  it('does not match a different path', () => {
    const { grants } = makeGrants('posix')
    grants.issue(1, ['/in/notes.md'])

    expect(grants.consume(1, '/in/other.md')).toBe(false)
    expect(grants.consume(1, '/in/sub/../notes.md')).toBe(true)
  })

  it('lapses after the time limit', () => {
    const { grants, clock } = makeGrants('posix')
    grants.issue(1, ['/in/notes.md'])

    clock.now += SOURCE_GRANT_TTL_MS
    expect(grants.consume(1, '/in/notes.md')).toBe(false)
  })

  it('is still good just before the time limit', () => {
    const { grants, clock } = makeGrants('posix')
    grants.issue(1, ['/in/notes.md'])

    clock.now += SOURCE_GRANT_TTL_MS - 1
    expect(grants.consume(1, '/in/notes.md')).toBe(true)
  })

  it('renews a record when the file is picked again', () => {
    const { grants, clock } = makeGrants('posix')
    grants.issue(1, ['/in/notes.md'])
    clock.now += SOURCE_GRANT_TTL_MS - 1
    grants.issue(1, ['/in/notes.md'])
    clock.now += SOURCE_GRANT_TTL_MS - 1

    expect(grants.consume(1, '/in/notes.md')).toBe(true)
  })

  it('drops the oldest records past the cap', () => {
    const { grants } = makeGrants('posix')
    const paths = Array.from({ length: MAX_GRANTS_PER_SENDER + 1 }, (_, i) => `/in/${i}.md`)
    grants.issue(1, paths)

    expect(grants.consume(1, '/in/0.md')).toBe(false)
    expect(grants.consume(1, `/in/${MAX_GRANTS_PER_SENDER}.md`)).toBe(true)
  })

  it('forgets everything on clear', () => {
    const { grants } = makeGrants('posix')
    grants.issue(1, ['/in/notes.md'])
    grants.clear()

    expect(grants.consume(1, '/in/notes.md')).toBe(false)
  })

  describe('letter case', () => {
    it('matters on a case-sensitive host', () => {
      const { grants } = makeGrants('posix')
      grants.issue(1, ['/in/Notes.md'])

      expect(grants.consume(1, '/in/notes.md')).toBe(false)
    })

    it('does not matter on macOS', () => {
      const { grants } = makeGrants('darwin')
      grants.issue(1, ['/in/Notes.md'])

      expect(grants.consume(1, '/in/notes.md')).toBe(true)
    })

    it('does not matter on Windows, and slashes agree', () => {
      const { grants } = makeGrants('win32')
      grants.issue(1, ['C:\\In\\Notes.md'])

      expect(grants.consume(1, 'c:/in/notes.md')).toBe(true)
      expect(grants.consume(1, 'c:/in/notes.md')).toBe(false)
    })
  })
})
