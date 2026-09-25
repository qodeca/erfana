// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findShebangs, main, startsWithShebang, trackedCandidates } from './check-shebangs.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHEBANG = '#!/usr/bin/env node\r\n// fixture\n'
const PLAIN = '// fixture\nexport {}\n'
const quiet = { log: () => {}, error: () => {} }

let dir

function put(rel, content) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), content)
}

function track() {
  execFileSync('git', ['add', '-A'], { cwd: dir })
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'erfana-shebang-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('check-shebangs', () => {
  it('fails on a tracked script that starts with a shebang', () => {
    put('scripts/tool.mjs', SHEBANG)
    put('scripts/other.mjs', PLAIN)
    track()
    expect(findShebangs(dir, trackedCandidates(dir), new Map())).toEqual(['scripts/tool.mjs'])
    expect(main(dir, new Map(), quiet)).toBe(1)
  })

  it('passes when no file starts with a shebang', () => {
    put('scripts/tool.mjs', PLAIN)
    put('src/main/a.ts', PLAIN)
    put('e2e/b.js', `${PLAIN}// #! later in the file is fine\n`)
    track()
    expect(main(dir, new Map(), quiet)).toBe(0)
  })

  it('passes an allow-listed file', () => {
    put('scripts/tool.mjs', SHEBANG)
    track()
    expect(main(dir, new Map([['scripts/tool.mjs', 'run directly']]), quiet)).toBe(0)
  })

  it('covers .js, .cjs and .ts under src/ and e2e/, and ignores other extensions and roots', () => {
    for (const f of ['src/a.js', 'src/b.cjs', 'e2e/c.ts', 'scripts/d.sh', 'tools/e.mjs']) put(f, SHEBANG)
    track()
    expect(findShebangs(dir, trackedCandidates(dir), new Map()).sort()).toEqual([
      'e2e/c.ts',
      'src/a.js',
      'src/b.cjs',
    ])
  })

  // Creating a symlink needs a privilege a Windows runner may not grant.
  it.skipIf(process.platform === 'win32')('ignores untracked files and does not follow a symlink', () => {
    put('outside.mjs', SHEBANG)
    put('scripts/untracked.mjs', SHEBANG)
    mkdirSync(path.join(dir, 'src'))
    symlinkSync(path.join(dir, 'outside.mjs'), path.join(dir, 'src', 'link.mjs'))
    execFileSync('git', ['add', 'src/link.mjs'], { cwd: dir })
    expect(findShebangs(dir, trackedCandidates(dir), new Map())).toEqual([])
  })

  it('sees a shebang behind a UTF-8 BOM', () => {
    expect(startsWithShebang(Buffer.from('﻿#!/x'))).toBe(true)
    expect(startsWithShebang(Buffer.from('#'))).toBe(false)
    expect(startsWithShebang(Buffer.alloc(0))).toBe(false)
  })

  it('finds no shebang in this repository', () => {
    expect(findShebangs(REPO, trackedCandidates(REPO))).toEqual([])
  })
})
