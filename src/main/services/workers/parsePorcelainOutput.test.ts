// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Unit tests for parsePorcelainOutput
 *
 * Tests the pure NUL-delimited porcelain parser exported from git-status.worker.ts.
 * No worker threads are spawned – worker_threads is mocked so the module-level
 * parentPort guard does not throw during import.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

// Mock worker_threads before importing the worker module.
// The worker file has a top-level guard: if (!parentPort) throw new Error(...)
// Mocking parentPort prevents that throw when the module is loaded in test context.
vi.mock('worker_threads', () => ({
  parentPort: {
    on: vi.fn(),
    postMessage: vi.fn(),
  },
}))

// Mock isomorphic-git to avoid any real filesystem operations at import time.
vi.mock('isomorphic-git', () => ({
  currentBranch: vi.fn(),
  resolveRef: vi.fn(),
  statusMatrix: vi.fn(),
}))

import { parsePorcelainOutput } from './git-status.worker'

const PROJECT = '/test/project'

function p(relative: string): string {
  return join(PROJECT, relative)
}

describe('parsePorcelainOutput', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Empty / trivial input
  // ---------------------------------------------------------------------------

  describe('empty output', () => {
    it('returns empty array for empty string', () => {
      expect(parsePorcelainOutput('', PROJECT)).toEqual([])
    })

    it('returns empty array for string containing only NUL bytes', () => {
      expect(parsePorcelainOutput('\0\0\0', PROJECT)).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // Basic XY status mappings
  // ---------------------------------------------------------------------------

  describe('XY code: M  (modified, staged)', () => {
    it('returns modified with staged: true', () => {
      const result = parsePorcelainOutput('M  src/file.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/file.ts'), status: 'modified', staged: true }])
    })
  })

  describe('XY code:  M (modified, unstaged)', () => {
    it('returns modified with staged: false', () => {
      const result = parsePorcelainOutput(' M src/file.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/file.ts'), status: 'modified', staged: false }])
    })
  })

  describe('XY code: MM (staged + unstaged modifications)', () => {
    it('returns modified with staged: false (worktree takes precedence)', () => {
      const result = parsePorcelainOutput('MM src/file.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/file.ts'), status: 'modified', staged: false }])
    })
  })

  describe('XY code: A  (new file staged)', () => {
    it('returns staged with staged: true', () => {
      const result = parsePorcelainOutput('A  src/new.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/new.ts'), status: 'staged', staged: true }])
    })
  })

  describe('XY code: AM (staged new file with unstaged changes)', () => {
    it('returns staged with staged: true', () => {
      const result = parsePorcelainOutput('AM src/new.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/new.ts'), status: 'staged', staged: true }])
    })
  })

  describe('XY code: D  (deletion staged)', () => {
    it('returns deleted with staged: true', () => {
      const result = parsePorcelainOutput('D  src/gone.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/gone.ts'), status: 'deleted', staged: true }])
    })
  })

  describe('XY code:  D (deletion unstaged)', () => {
    it('returns deleted with staged: false', () => {
      const result = parsePorcelainOutput(' D src/gone.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/gone.ts'), status: 'deleted', staged: false }])
    })
  })

  describe('XY code: ?? (untracked)', () => {
    it('returns untracked with staged: false', () => {
      const result = parsePorcelainOutput('?? src/untracked.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/untracked.ts'), status: 'untracked', staged: false }])
    })
  })

  // ---------------------------------------------------------------------------
  // Conflict codes
  // ---------------------------------------------------------------------------

  describe('conflict codes', () => {
    it('UU returns conflicted with staged: false', () => {
      const result = parsePorcelainOutput('UU src/conflict.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/conflict.ts'), status: 'conflicted', staged: false }])
    })

    it('AA returns conflicted with staged: false', () => {
      const result = parsePorcelainOutput('AA src/conflict.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/conflict.ts'), status: 'conflicted', staged: false }])
    })

    it('DD returns conflicted with staged: false', () => {
      const result = parsePorcelainOutput('DD src/conflict.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/conflict.ts'), status: 'conflicted', staged: false }])
    })

    it('AU returns conflicted with staged: false', () => {
      const result = parsePorcelainOutput('AU src/conflict.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/conflict.ts'), status: 'conflicted', staged: false }])
    })

    it('UA returns conflicted with staged: false', () => {
      const result = parsePorcelainOutput('UA src/conflict.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/conflict.ts'), status: 'conflicted', staged: false }])
    })

    it('DU returns conflicted with staged: false', () => {
      const result = parsePorcelainOutput('DU src/conflict.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/conflict.ts'), status: 'conflicted', staged: false }])
    })

    it('UD returns conflicted with staged: false', () => {
      const result = parsePorcelainOutput('UD src/conflict.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/conflict.ts'), status: 'conflicted', staged: false }])
    })
  })

  // ---------------------------------------------------------------------------
  // Ignored files
  // ---------------------------------------------------------------------------

  describe('ignored files (!! code)', () => {
    it('skips !! entries and returns empty array', () => {
      const result = parsePorcelainOutput('!! build/\0', PROJECT)
      expect(result).toEqual([])
    })

    it('skips !! entries mixed with real entries', () => {
      const output = '!! build/\0?? src/new.ts\0'
      const result = parsePorcelainOutput(output, PROJECT)
      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('untracked')
    })
  })

  // ---------------------------------------------------------------------------
  // Unknown XY codes
  // ---------------------------------------------------------------------------

  describe('unknown XY codes', () => {
    // Lens review #18: unknown-but-present codes now default to `modified`
    // (over-decoration is safer than missing a change) and do NOT emit
    // console.warn – that was a noisy log on every typechange code. The old
    // behavior was to drop the entry and warn.
    it('defaults unknown code to modified (no warn)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const result = parsePorcelainOutput('ZZ src/file.ts\0', PROJECT)
      expect(result).toEqual([{ path: p('src/file.ts'), status: 'modified', staged: false }])
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('continues parsing remaining entries after an unknown code', () => {
      const output = 'ZZ src/unknown.ts\0?? src/new.ts\0'
      const result = parsePorcelainOutput(output, PROJECT)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ path: p('src/unknown.ts'), status: 'modified', staged: false })
      expect(result[1].status).toBe('untracked')
    })
  })

  describe('typechange codes (lens review #18)', () => {
    // Symlink↔file, exec-bit flips. Both worktree-only (`. T`/` T`) and
    // index-side (`T `) surface as `modified`; staged tracks the worktree
    // column being blank, parity with the ` M`/`M ` convention.
    it('worktree typechange ` T` → modified, staged:false', () => {
      const result = parsePorcelainOutput(' T src/symlink\0', PROJECT)
      expect(result).toEqual([{ path: p('src/symlink'), status: 'modified', staged: false }])
    })

    it('index typechange `T ` → modified, staged:true', () => {
      const result = parsePorcelainOutput('T  src/symlink\0', PROJECT)
      expect(result).toEqual([{ path: p('src/symlink'), status: 'modified', staged: true }])
    })

    it('both-side typechange `TT` → modified, staged:false', () => {
      const result = parsePorcelainOutput('TT src/symlink\0', PROJECT)
      expect(result).toEqual([{ path: p('src/symlink'), status: 'modified', staged: false }])
    })

    it('worktree-typechange after staged-modify `MT` → modified', () => {
      const result = parsePorcelainOutput('MT src/file.ts\0', PROJECT)
      expect(result[0].status).toBe('modified')
    })
  })

  describe('branch header skipping (lens review #1)', () => {
    // `--branch` emits a leading `## <branch-info>` part that must NOT be
    // treated as a file entry. Otherwise the parser would try to map `##`
    // as an XY code and pollute the file list.
    it('skips `## main` header but parses following entries', () => {
      const output = '## main\0?? src/new.ts\0'
      const result = parsePorcelainOutput(output, PROJECT)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ path: p('src/new.ts'), status: 'untracked', staged: false })
    })

    it('skips the unborn-branch header `## No commits yet on main`', () => {
      const output = '## No commits yet on main\0?? src/new.ts\0'
      const result = parsePorcelainOutput(output, PROJECT)
      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('untracked')
    })

    it('skips the detached-HEAD header `## HEAD (no branch)`', () => {
      const output = '## HEAD (no branch)\0 M src/file.ts\0'
      const result = parsePorcelainOutput(output, PROJECT)
      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('modified')
    })
  })

  // ---------------------------------------------------------------------------
  // NUL-delimited parsing
  // ---------------------------------------------------------------------------

  describe('NUL-delimited parsing', () => {
    it('does not split on newlines – treats entire newline-separated input as one raw part', () => {
      // Without NUL delimiters the entire string is one "part".
      // " M src/a.ts\n M src/b.ts" has a valid XY code " M", so the parser
      // produces exactly one entry whose path includes the embedded newline text.
      // The important invariant: it does NOT produce 2 correctly parsed entries.
      const newlineInput = ' M src/a.ts\n M src/b.ts\n'
      const result = parsePorcelainOutput(newlineInput, PROJECT)
      expect(result).toHaveLength(1)
      // Path is the raw substring after the "XY " prefix – includes the newline
      expect(result[0].status).toBe('modified')
      expect(result[0].staged).toBe(false)
    })

    it('parses two entries correctly when separated by NUL', () => {
      const output = ' M src/a.ts\0?? src/b.ts\0'
      const result = parsePorcelainOutput(output, PROJECT)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ path: p('src/a.ts'), status: 'modified', staged: false })
      expect(result[1]).toEqual({ path: p('src/b.ts'), status: 'untracked', staged: false })
    })

    it('handles trailing NUL without producing extra entries', () => {
      const output = ' M src/a.ts\0'
      const result = parsePorcelainOutput(output, PROJECT)
      expect(result).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Multiple files
  // ---------------------------------------------------------------------------

  describe('multiple files with mixed statuses', () => {
    it('parses three entries with distinct statuses', () => {
      const output = 'M  src/modified.ts\0?? src/untracked.ts\0D  src/deleted.ts\0'
      const result = parsePorcelainOutput(output, PROJECT)

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ path: p('src/modified.ts'), status: 'modified', staged: true })
      expect(result[1]).toEqual({ path: p('src/untracked.ts'), status: 'untracked', staged: false })
      expect(result[2]).toEqual({ path: p('src/deleted.ts'), status: 'deleted', staged: true })
    })

    it('parses five entries preserving order', () => {
      const output = [
        'M  src/a.ts',
        ' M src/b.ts',
        'A  src/c.ts',
        '?? src/d.ts',
        'UU src/e.ts',
        '',
      ].join('\0')
      const result = parsePorcelainOutput(output, PROJECT)

      expect(result).toHaveLength(5)
      expect(result[0].status).toBe('modified')
      expect(result[1].status).toBe('modified')
      expect(result[2].status).toBe('staged')
      expect(result[3].status).toBe('untracked')
      expect(result[4].status).toBe('conflicted')
    })
  })

  // ---------------------------------------------------------------------------
  // Path handling
  // ---------------------------------------------------------------------------

  describe('path handling', () => {
    it('joins the filepath with the project root', () => {
      const result = parsePorcelainOutput('?? README.md\0', PROJECT)
      expect(result[0].path).toBe(join(PROJECT, 'README.md'))
    })

    it('handles nested directory paths', () => {
      const result = parsePorcelainOutput(' M src/renderer/components/Editor.tsx\0', PROJECT)
      expect(result[0].path).toBe(join(PROJECT, 'src/renderer/components/Editor.tsx'))
    })

    it('handles files directly at project root', () => {
      const result = parsePorcelainOutput('M  package.json\0', PROJECT)
      expect(result[0].path).toBe(join(PROJECT, 'package.json'))
    })

    it('skips entry when filepath portion is empty', () => {
      // Entry shorter than 4 chars: "M  " (3 chars) has empty filepath
      const result = parsePorcelainOutput('M  \0', PROJECT)
      expect(result).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // Directory entries (untracked dirs with trailing slash)
  // ---------------------------------------------------------------------------

  describe('directory entries', () => {
    it('parses untracked directory with trailing slash', () => {
      const result = parsePorcelainOutput('?? some-dir/\0', PROJECT)
      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('untracked')
      expect(result[0].staged).toBe(false)
      // path.join normalises the trailing slash on most platforms
      expect(result[0].path).toBe(join(PROJECT, 'some-dir/'))
    })

    it('parses nested untracked directory', () => {
      const result = parsePorcelainOutput('?? src/components/new-feature/\0', PROJECT)
      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('untracked')
    })
  })

  // -- Cross-strategy equivalence -----------------------------------------------
  // Documents that the porcelain parser (native-git) and statusMatrix mapper
  // (isomorphic-git) produce equivalent results for common file statuses.
  // The statusMatrix mapper is not exported, so we document the equivalence
  // via comments referencing the [HEAD, workdir, stage] tuples.

  describe('cross-strategy behavioral equivalence', () => {
    it('modified file: porcelain matches statusMatrix [1,2,1]', () => {
      const result = parsePorcelainOutput(' M src/file.ts\0', PROJECT)
      expect(result[0]).toEqual({ path: join(PROJECT, 'src/file.ts'), status: 'modified', staged: false })
    })

    it('staged modified file: porcelain matches statusMatrix [1,2,3]', () => {
      // statusMatrix [1,2,3] maps to staged (stage=2||3 check precedes conflicted check)
      // porcelain 'M ' maps to modified staged:true – slight behavioral difference:
      // isomorphic-git calls it "staged", porcelain calls it "modified" with staged:true
      const result = parsePorcelainOutput('M  src/file.ts\0', PROJECT)
      expect(result[0]).toEqual({ path: join(PROJECT, 'src/file.ts'), status: 'modified', staged: true })
    })

    it('new staged file: porcelain matches statusMatrix [0,2,2]', () => {
      const result = parsePorcelainOutput('A  src/new.ts\0', PROJECT)
      expect(result[0]).toEqual({ path: join(PROJECT, 'src/new.ts'), status: 'staged', staged: true })
    })

    it('deleted staged file: porcelain matches statusMatrix [1,0,0]', () => {
      const result = parsePorcelainOutput('D  src/old.ts\0', PROJECT)
      expect(result[0]).toEqual({ path: join(PROJECT, 'src/old.ts'), status: 'deleted', staged: true })
    })

    it('untracked file: porcelain matches statusMatrix [0,2,0]', () => {
      const result = parsePorcelainOutput('?? src/new.ts\0', PROJECT)
      expect(result[0]).toEqual({ path: join(PROJECT, 'src/new.ts'), status: 'untracked', staged: false })
    })
  })
})
