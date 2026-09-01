// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPreviewCsp } from './previewCsp'
import { createPreviewRootRegistry } from './PreviewRootRegistry'

let root: string
let realRoot: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'erfana-registry-'))
  realRoot = await realpath(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('PreviewRootRegistry', () => {
  it('issues a 32-char lowercase-hex token with no dashes', async () => {
    const registry = createPreviewRootRegistry()
    const token = await registry.issue(root, [])

    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(token).not.toContain('-')
  })

  it('resolves an issued token to the realpathed root, project path and CSP', async () => {
    const registry = createPreviewRootRegistry()
    const hosts = ['cdn.example.com']
    const token = await registry.issue(root, hosts)

    const entry = registry.resolve(token)
    expect(entry).toBeDefined()
    expect(entry?.realRoot).toBe(realRoot)
    expect(entry?.projectPath).toBe(root)
    expect(entry?.csp).toBe(buildPreviewCsp(hosts))
  })

  it('builds the CSP from the supplied hosts', async () => {
    const registry = createPreviewRootRegistry()
    const token = await registry.issue(root, ['https://assets.example.com'])

    const csp = registry.resolve(token)?.csp
    expect(csp).toContain('https://assets.example.com')
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('sandbox allow-scripts')
  })

  it('returns undefined for an unknown token', () => {
    const registry = createPreviewRootRegistry()
    expect(registry.resolve('deadbeef')).toBeUndefined()
  })

  it('revoking a token makes resolve return undefined (⇒ 404)', async () => {
    const registry = createPreviewRootRegistry()
    const token = await registry.issue(root, [])

    expect(registry.resolve(token)).toBeDefined()
    registry.revoke(token)
    expect(registry.resolve(token)).toBeUndefined()
  })

  it('rebuildCsp replaces the entry CSP while keeping root and project path', async () => {
    const registry = createPreviewRootRegistry()
    const token = await registry.issue(root, [])
    const before = registry.resolve(token)
    expect(before?.csp).toBe(buildPreviewCsp([]))
    expect(before?.csp).not.toContain('https://cdn.example.com')

    registry.rebuildCsp(token, ['https://cdn.example.com'])

    const after = registry.resolve(token)
    expect(after?.realRoot).toBe(realRoot)
    expect(after?.projectPath).toBe(root)
    expect(after?.csp).toBe(buildPreviewCsp(['https://cdn.example.com']))
    expect(after?.csp).toContain('https://cdn.example.com')
  })

  it('rebuildCsp is a no-op for an unknown token', async () => {
    const registry = createPreviewRootRegistry()
    await registry.issue(root, [])
    expect(() => registry.rebuildCsp('unknown', ['cdn.example.com'])).not.toThrow()
  })

  it('clear drops every entry', async () => {
    const registry = createPreviewRootRegistry()
    const a = await registry.issue(root, [])
    const b = await registry.issue(root, [])

    registry.clear()

    expect(registry.resolve(a)).toBeUndefined()
    expect(registry.resolve(b)).toBeUndefined()
  })

  it('mints a distinct token per issue', async () => {
    const registry = createPreviewRootRegistry()
    const a = await registry.issue(root, [])
    const b = await registry.issue(root, [])
    expect(a).not.toBe(b)
  })
})
