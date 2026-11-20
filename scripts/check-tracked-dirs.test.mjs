// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deletedTracked, main } from './check-tracked-dirs.mjs'

let dir

function capture() {
  const lines = { log: [], warn: [], error: [] }
  return {
    lines,
    log: (m) => lines.log.push(m),
    warn: (m) => lines.warn.push(m),
    error: (m) => lines.error.push(m),
  }
}

function put(rel, content = 'x: 1\n') {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), content)
}

function track() {
  execFileSync('git', ['add', '-A'], { cwd: dir })
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'erfana-tracked-dirs-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('check-tracked-dirs', () => {
  it('fails and names a tracked file removed from disk', () => {
    put('.vale/x.yml')
    put('.codex/config.toml')
    track()
    unlinkSync(path.join(dir, '.vale', 'x.yml'))
    expect(deletedTracked(dir)).toEqual(['.vale/x.yml'])
    const out = capture()
    expect(main(dir, undefined, out)).toBe(1)
    expect(out.lines.error.join('\n')).toContain('.vale/x.yml')
    expect(out.lines.error.join('\n')).toContain('git restore -- .vale .codex')
  })

  it('fails when a whole guarded folder is gone', () => {
    put('.codex/a.toml')
    put('.codex/b.toml')
    track()
    rmSync(path.join(dir, '.codex'), { recursive: true })
    const out = capture()
    expect(main(dir, undefined, out)).toBe(1)
    expect(deletedTracked(dir).sort()).toEqual(['.codex/a.toml', '.codex/b.toml'])
  })

  it('passes when every tracked file is present', () => {
    put('.vale/x.yml')
    put('.codex/config.toml')
    track()
    const out = capture()
    expect(main(dir, undefined, out)).toBe(0)
    expect(out.lines.log).toHaveLength(1)
    expect(out.lines.error).toEqual([])
  })

  it('ignores deletions outside the guarded folders', () => {
    put('.vale/x.yml')
    put('docs/a.md')
    track()
    unlinkSync(path.join(dir, 'docs', 'a.md'))
    expect(main(dir, undefined, capture())).toBe(0)
  })

  it('warns and passes when git cannot run', () => {
    const notARepo = mkdtempSync(path.join(tmpdir(), 'erfana-tracked-dirs-nogit-'))
    try {
      // A working directory that does not exist makes the git spawn itself fail,
      // the same path a missing git binary takes.
      const out = capture()
      expect(main(path.join(notARepo, 'missing'), undefined, out)).toBe(0)
      expect(out.lines.warn).toHaveLength(1)
    } finally {
      rmSync(notARepo, { recursive: true, force: true })
    }
  })
})
