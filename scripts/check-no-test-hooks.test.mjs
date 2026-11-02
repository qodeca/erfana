// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SENTINEL, fileContains, main, scan } from './check-no-test-hooks.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHUNK_BYTES = 1024 * 1024

let dir

function put(rel, content) {
  const file = path.join(dir, rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
  return file
}

function capture() {
  const lines = { log: [], error: [] }
  return { lines, options: { log: { log: m => lines.log.push(m), error: m => lines.error.push(m) } } }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'erfana-test-hooks-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('check-no-test-hooks', () => {
  it('uses the sentinel the hook module carries', () => {
    const source = readFileSync(path.join(REPO, 'src/main/testHooks/index.ts'), 'utf8')
    expect(source).toContain(`TEST_HOOK_SENTINEL = '${SENTINEL}'`)
  })

  it('passes a build folder without the sentinel', () => {
    put('out/main/index.js', 'console.log("app")')
    put('out/renderer/assets/index.js', 'export {}')
    const { lines, options } = capture()
    expect(main([path.join(dir, 'out')], options)).toBe(0)
    expect(lines.log[0]).toMatch(/No test-hook sentinel in 2 file/)
  })

  it('fails on the sentinel in a nested chunk and in a source map, naming each file', () => {
    put('out/main/index.js', 'console.log("app")')
    const chunk = put('out/main/chunks/index-abc.js', `const s="${SENTINEL}"`)
    const map = put('out/main/chunks/index-abc.js.map', JSON.stringify({ sourcesContent: [SENTINEL] }))
    const { lines, options } = capture()
    expect(main([path.join(dir, 'out')], options)).toBe(1)
    expect(lines.error).toContain(`  ${chunk}`)
    expect(lines.error).toContain(`  ${map}`)
  })

  it('fails on the sentinel inside a packed archive file', () => {
    const asar = put('app.asar', Buffer.concat([Buffer.alloc(64, 0xff), Buffer.from(SENTINEL), Buffer.alloc(8)]))
    expect(main([asar], capture().options)).toBe(1)
  })

  it('never passes a missing path or an empty folder', () => {
    mkdirSync(path.join(dir, 'empty'))
    const { lines, options } = capture()
    expect(main([path.join(dir, 'missing'), path.join(dir, 'empty')], options)).toBe(2)
    expect(lines.error.join('\n')).toMatch(/does not exist/)
    expect(lines.error.join('\n')).toMatch(/holds no files/)
  })

  it('checks `out` under the working folder when given no path, and resolves relative paths there', () => {
    put('out/main/index.js', SENTINEL)
    put('clean/index.js', 'ok')
    expect(main([], { ...capture().options, cwd: dir })).toBe(1)
    expect(main(['clean'], { ...capture().options, cwd: dir })).toBe(0)
  })

  it('does not follow a symlink out of the folder', () => {
    const outside = put('outside/hook.js', SENTINEL)
    put('out/main/index.js', 'ok')
    symlinkSync(outside, path.join(dir, 'out/main/link.js'))
    expect(scan([path.join(dir, 'out')]).found).toEqual([])
  })

  it.each([
    ['ends one byte short of the chunk boundary', CHUNK_BYTES - SENTINEL.length - 1],
    ['ends exactly at the chunk boundary', CHUNK_BYTES - SENTINEL.length],
    ['straddles the chunk boundary', CHUNK_BYTES - 5],
    ['starts at the chunk boundary', CHUNK_BYTES],
    ['sits in the second chunk', CHUNK_BYTES + 100]
  ])('finds a sentinel that %s', (_label, offset) => {
    const bytes = Buffer.alloc(offset + SENTINEL.length + 10, 0x20)
    Buffer.from(SENTINEL).copy(bytes, offset)
    expect(fileContains(put('big.bin', bytes), Buffer.from(SENTINEL))).toBe(true)
  })

  it('does not find a sentinel cut short at the end of the file or split by other bytes', () => {
    const head = SENTINEL.slice(0, 10)
    const tail = SENTINEL.slice(10)
    expect(fileContains(put('cut.bin', SENTINEL.slice(0, -1)), Buffer.from(SENTINEL))).toBe(false)
    expect(fileContains(put('split.bin', `${head}\n${tail}`), Buffer.from(SENTINEL))).toBe(false)
    expect(fileContains(put('empty.bin', ''), Buffer.from(SENTINEL))).toBe(false)
  })
})
