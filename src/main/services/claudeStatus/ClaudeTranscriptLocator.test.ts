// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeTranscriptLocator tests.
 *
 * Uses an injected `root` (preferred over an env override for testability) so a
 * temp projects root can be passed directly. Covers newest-mtime selection,
 * `subagents/` exclusion, non-`.jsonl` filtering, symlink skipping, realpath
 * escape rejection, and the missing/empty-dir null paths.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2, §8, §10
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encodeProjectDir } from './encodeCwd'
import {
  locateLatestTranscript,
  locateTranscriptCandidates,
  __resetRootCacheForTests
} from './ClaudeTranscriptLocator'

let rootDir: string
/** A cwd whose encoded dir lives under rootDir. */
const CWD = '/Users/test/Projects/demo'
let encDir: string

beforeEach(async () => {
  __resetRootCacheForTests()
  // realpath the temp base so the injected root matches what the locator
  // computes via fs.realpath on the chosen file (macOS /var → /private/var).
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'erfana-locator-'))
  rootDir = await fs.realpath(base)
  encDir = path.join(rootDir, encodeProjectDir(CWD))
  await fs.mkdir(encDir, { recursive: true })
})

afterEach(async () => {
  __resetRootCacheForTests()
  await fs.rm(rootDir, { recursive: true, force: true })
})

/** Write a `.jsonl` file with an explicit mtime (ms since epoch). */
async function writeJsonl(name: string, mtimeMs: number): Promise<string> {
  const file = path.join(encDir, name)
  await fs.writeFile(file, '{}\n', 'utf8')
  const when = new Date(mtimeMs)
  await fs.utimes(file, when, when)
  return file
}

describe('locateLatestTranscript', () => {
  it('returns the newest-mtime .jsonl among several', async () => {
    await writeJsonl('old.jsonl', 1_000_000)
    const newest = await writeJsonl('new.jsonl', 9_000_000)
    await writeJsonl('mid.jsonl', 5_000_000)

    const result = await locateLatestTranscript(CWD, { root: rootDir })
    expect(result).toBe(newest)
  })

  it('breaks an mtime tie deterministically (lexicographically greater name wins)', async () => {
    // Two files share an identical mtime; selection must not depend on readdir
    // order. The lexicographically greater name ("b" > "a") is the stable winner.
    const tie = 5_000_000
    await writeJsonl('a-session.jsonl', tie)
    const expected = await writeJsonl('b-session.jsonl', tie)

    // Run twice to confirm stability (no dependence on enumeration order).
    expect(await locateLatestTranscript(CWD, { root: rootDir })).toBe(expected)
    expect(await locateLatestTranscript(CWD, { root: rootDir })).toBe(expected)
  })

  it('excludes the subagents/ subdir', async () => {
    const subagents = path.join(encDir, 'subagents')
    await fs.mkdir(subagents, { recursive: true })
    const sideFile = path.join(subagents, 'side.jsonl')
    await fs.writeFile(sideFile, '{}\n', 'utf8')
    await fs.utimes(sideFile, new Date(9_999_999), new Date(9_999_999))

    const main = await writeJsonl('main.jsonl', 1_000_000)

    const result = await locateLatestTranscript(CWD, { root: rootDir })
    expect(result).toBe(main)
  })

  it('ignores non-.jsonl files even if newer', async () => {
    await fs.writeFile(path.join(encDir, 'notes.txt'), 'x', 'utf8')
    await fs.utimes(path.join(encDir, 'notes.txt'), new Date(9_999_999), new Date(9_999_999))
    const jsonl = await writeJsonl('session.jsonl', 1_000_000)

    const result = await locateLatestTranscript(CWD, { root: rootDir })
    expect(result).toBe(jsonl)
  })

  it('skips a symlink entry even if it is the newest', async () => {
    const realTarget = path.join(rootDir, 'outside-target.jsonl')
    await fs.writeFile(realTarget, '{}\n', 'utf8')

    const link = path.join(encDir, 'link.jsonl')
    await fs.symlink(realTarget, link)
    // Make the symlink the newest by lstat mtime.
    await fs.lutimes(link, new Date(9_999_999), new Date(9_999_999))

    const real = await writeJsonl('real.jsonl', 1_000_000)

    const result = await locateLatestTranscript(CWD, { root: rootDir })
    expect(result).toBe(real)
  })

  it('returns null when the only entry is a symlink (no regular jsonl)', async () => {
    const target = path.join(os.tmpdir(), 'erfana-locator-external.jsonl')
    await fs.writeFile(target, '{}\n', 'utf8')
    await fs.symlink(target, path.join(encDir, 'only-link.jsonl'))

    const result = await locateLatestTranscript(CWD, { root: rootDir })
    expect(result).toBeNull()
    await fs.rm(target, { force: true })
  })

  it('rejects a file whose realpath escapes the root (symlinked ENC dir)', async () => {
    // Build an outside dir containing a regular jsonl, then make the ENC dir a
    // symlink to it. The regular file passes isFile(), but its realpath lands
    // outside the root and must be rejected.
    const outsideBase = await fs.mkdtemp(path.join(os.tmpdir(), 'erfana-escape-'))
    const outside = await fs.realpath(outsideBase)
    await fs.writeFile(path.join(outside, 'escaped.jsonl'), '{}\n', 'utf8')

    await fs.rm(encDir, { recursive: true, force: true })
    await fs.symlink(outside, encDir)

    const result = await locateLatestTranscript(CWD, { root: rootDir })
    expect(result).toBeNull()

    await fs.rm(outside, { recursive: true, force: true })
  })

  it('returns null when the ENC dir is missing', async () => {
    const result = await locateLatestTranscript('/Users/test/no/such/dir', { root: rootDir })
    expect(result).toBeNull()
  })

  it('returns null for an empty ENC dir', async () => {
    const result = await locateLatestTranscript(CWD, { root: rootDir })
    expect(result).toBeNull()
  })

  describe('minMtimeMs floor (#216 fresh-launch fix)', () => {
    it('excludes files modified before the floor, selecting the newest eligible one', async () => {
      await writeJsonl('prior.jsonl', 1_000_000) // a stale prior session
      const fresh = await writeJsonl('fresh.jsonl', 9_000_000)

      const result = await locateLatestTranscript(CWD, { root: rootDir, minMtimeMs: 5_000_000 })
      expect(result).toBe(fresh)
    })

    it('returns null when every transcript predates the floor (fresh launch, no own turn yet)', async () => {
      // Only prior-session files exist; the new session has not written a turn,
      // so nothing qualifies and the bar must hide.
      await writeJsonl('a.jsonl', 1_000_000)
      await writeJsonl('b.jsonl', 2_000_000)

      const result = await locateLatestTranscript(CWD, { root: rootDir, minMtimeMs: 9_000_000 })
      expect(result).toBeNull()
    })

    it('readmits a file within the 2s clock-skew tolerance just below the floor', async () => {
      // MTIME_SKEW_MS = 2000 → floor 5_000_000 admits mtimes >= 4_998_000.
      await writeJsonl('too-old.jsonl', 4_997_000) // below the skew window → excluded
      const within = await writeJsonl('within-skew.jsonl', 4_999_000) // within skew → admitted

      const result = await locateLatestTranscript(CWD, { root: rootDir, minMtimeMs: 5_000_000 })
      expect(result).toBe(within)
    })

    it('admits a file at exactly the skew boundary (floor − MTIME_SKEW_MS), excluding one below', async () => {
      // The predicate is strict `<`, so mtime === floor − 2000 is admitted. This
      // pins the boundary against a `<` → `<=` regression that would flip it.
      await writeJsonl('below-boundary.jsonl', 4_997_000) // < 4_998_000 → excluded
      const boundary = await writeJsonl('at-boundary.jsonl', 4_998_000) // == floor − 2000 → admitted

      const result = await locateLatestTranscript(CWD, { root: rootDir, minMtimeMs: 5_000_000 })
      expect(result).toBe(boundary)
    })

    it('admits all files when the floor is 0 (no real lower bound)', async () => {
      await writeJsonl('old.jsonl', 1_000_000)
      const newest = await writeJsonl('new.jsonl', 9_000_000)

      // mtimeMs < 0 − 2000 is never true for real (non-negative) mtimes.
      const result = await locateLatestTranscript(CWD, { root: rootDir, minMtimeMs: 0 })
      expect(result).toBe(newest)
    })

    it('applies no floor when minMtimeMs is omitted (back-compat)', async () => {
      const prior = await writeJsonl('prior.jsonl', 1_000_000)

      const result = await locateLatestTranscript(CWD, { root: rootDir })
      expect(result).toBe(prior)
    })
  })

  describe('encoding fallback (finding #3)', () => {
    it('resolves a trailing-separator cwd via the stripped-form alternate dir', async () => {
      // The primary encoding of a trailing-slash cwd (`…demo/` → `-…-demo-`) does
      // not exist; the locator must fall back to the stripped form (`-…-demo`),
      // which is the real dir created in beforeEach.
      const file = await writeJsonl('session.jsonl', 5_000_000)

      const result = await locateLatestTranscript(`${CWD}/`, { root: rootDir })
      expect(result).toBe(file)
    })

    it('returns null when no candidate dir exists', async () => {
      const result = await locateLatestTranscript('/Users/test/Projects/nonexistent', {
        root: rootDir
      })
      expect(result).toBeNull()
    })
  })

  describe('locateTranscriptCandidates (turn-aware selection support)', () => {
    it('returns eligible files newest-first (so the caller can skip a sidecar)', async () => {
      await writeJsonl('old.jsonl', 1_000_000)
      await writeJsonl('new.jsonl', 9_000_000)
      await writeJsonl('mid.jsonl', 5_000_000)

      const result = await locateTranscriptCandidates(CWD, { root: rootDir })
      expect(result.map((p) => path.basename(p))).toEqual(['new.jsonl', 'mid.jsonl', 'old.jsonl'])
    })

    it('applies the start-time floor to every candidate', async () => {
      await writeJsonl('stale.jsonl', 1_000_000)
      await writeJsonl('fresh.jsonl', 9_000_000)

      const result = await locateTranscriptCandidates(CWD, {
        root: rootDir,
        minMtimeMs: 5_000_000
      })
      expect(result.map((p) => path.basename(p))).toEqual(['fresh.jsonl'])
    })

    it('breaks an mtime tie by lexicographically greater name (deterministic order)', async () => {
      const tie = 5_000_000
      await writeJsonl('a.jsonl', tie)
      await writeJsonl('b.jsonl', tie)

      const result = await locateTranscriptCandidates(CWD, { root: rootDir })
      expect(result.map((p) => path.basename(p))).toEqual(['b.jsonl', 'a.jsonl'])
    })

    it('returns [] when the dir is missing or has no eligible file', async () => {
      expect(
        await locateTranscriptCandidates('/Users/test/Projects/none', { root: rootDir })
      ).toEqual([])
    })

    it('locateLatestTranscript returns the first candidate (back-compat)', async () => {
      await writeJsonl('a.jsonl', 1_000_000)
      const newest = await writeJsonl('b.jsonl', 9_000_000)
      expect(await locateLatestTranscript(CWD, { root: rootDir })).toBe(newest)
    })
  })
})
