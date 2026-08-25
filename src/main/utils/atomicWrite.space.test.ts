// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * atomicWriteJSON `space` param tests (Issue #74, work item 17).
 *
 * Uses a real temp directory rather than the module-scope fs mock in
 * `atomicWrite.test.ts` (test-file split policy), so the written bytes can be
 * read back and asserted verbatim.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteJSON } from './atomicWrite'

describe('atomicWriteJSON space param', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'erfana-atomic-space-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes compact, newline-free JSON when space is omitted (unchanged default)', async () => {
    const target = join(dir, 'compact.json')
    const content = { version: 1, hosts: ['a.example.com', 'b.example.com'] }

    await atomicWriteJSON(target, content)

    const raw = await readFile(target, 'utf8')
    expect(raw).toBe(JSON.stringify(content))
    expect(raw).not.toContain('\n')
  })

  it('pretty-prints with the given indent and a trailing newline when space is passed', async () => {
    const target = join(dir, 'pretty.json')
    const content = { version: 1, hosts: ['a.example.com'] }

    await atomicWriteJSON(target, content, 2)

    const raw = await readFile(target, 'utf8')
    expect(raw).toBe(`${JSON.stringify(content, null, 2)}\n`)
    expect(raw.endsWith('\n')).toBe(true)
    // Indent is present (nested keys on their own lines).
    expect(raw).toContain('\n  "version": 1')
  })

  it('round-trips content written with a space indent', async () => {
    const target = join(dir, 'roundtrip.json')
    const content = { version: 1, hosts: ['cdn.jsdelivr.net'] }

    await atomicWriteJSON(target, content, 2)

    const parsed = JSON.parse(await readFile(target, 'utf8'))
    expect(parsed).toEqual(content)
  })

  it('creates the file in an existing nested directory', async () => {
    const nested = join(dir, 'nested')
    await mkdir(nested, { recursive: true })
    const target = join(nested, 'settings.json')

    await atomicWriteJSON(target, { ok: true }, 2)

    expect(await readFile(target, 'utf8')).toBe(`${JSON.stringify({ ok: true }, null, 2)}\n`)
  })
})
