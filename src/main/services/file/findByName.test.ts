// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * findByName on a real temp folder: matches, skips, never follows a link, and
 * stops at each of its bounds.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FIND_BY_NAME_MAX_FOLDERS, FIND_BY_NAME_MAX_RESULTS, FIND_BY_NAME_TIME_LIMIT_MS, findByName } from './findByName'

let base: string
let root: string
let outside: string

const touch = (...parts: string[]): void => {
  const target = path.join(root, ...parts)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, '')
}

const noSkip = { baseRel: '', skip: () => false }

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'erfana-find-by-name-')))
  root = path.join(base, 'proj')
  outside = path.join(base, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('findByName', () => {
  it('finds every file of the name below the folder, case-insensitively, sorted', async () => {
    touch('src', 'Button.tsx')
    touch('deep', 'er', 'button.TSX')
    touch('Button.tsx.bak')

    const result = await findByName(root, 'button.tsx', noSkip)

    expect(result).toEqual({
      paths: [path.join(root, 'deep', 'er', 'button.TSX'), path.join(root, 'src', 'Button.tsx')],
      truncated: false
    })
  })

  it('does not enter or answer with what `skip` leaves out, and passes project-relative paths', async () => {
    touch('node_modules', 'x', 'a.md')
    touch('docs', 'a.md')
    const seen: Array<string | null> = []

    const result = await findByName(root, 'a.md', {
      baseRel: '',
      skip: (name, rel) => {
        seen.push(rel)
        return name === 'node_modules'
      }
    })

    expect(result.paths).toEqual([path.join(root, 'docs', 'a.md')])
    expect(seen).toContain('docs/a.md')
    expect(seen).not.toContain('node_modules/x')
  })

  it.skipIf(process.platform === 'win32')('never follows a folder link or answers with a file link', async () => {
    writeFileSync(path.join(outside, 'a.md'), '')
    symlinkSync(outside, path.join(root, 'out'))
    symlinkSync(path.join(outside, 'a.md'), path.join(root, 'a.md'))

    const result = await findByName(root, 'a.md', noSkip)

    expect(result.paths).toEqual([])
  })

  it('stops at the result cap and says so', async () => {
    for (let i = 0; i <= FIND_BY_NAME_MAX_RESULTS + 5; i++) touch(`d${i}`, 'same.md')

    const result = await findByName(root, 'same.md', noSkip)

    expect(result.paths).toHaveLength(FIND_BY_NAME_MAX_RESULTS)
    expect(result.truncated).toBe(true)
  })

  it('stops at the time limit and says so', async () => {
    touch('a', 'b', 'c', 'x.md')
    let clock = 0
    // Every read the search starts moves the clock past the limit
    const now = (): number => (clock += FIND_BY_NAME_TIME_LIMIT_MS)

    const result = await findByName(root, 'x.md', { ...noSkip, now })

    expect(result).toEqual({ paths: [], truncated: true })
  })

  it('bounds the folders it lists', () => {
    expect(FIND_BY_NAME_MAX_FOLDERS).toBeGreaterThan(0)
    expect(FIND_BY_NAME_MAX_FOLDERS).toBeLessThanOrEqual(50_000)
  })
})
