// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for `PreviewRootRegistry` (Issue #74, work item 14) and the own-token
 * `frame-src` it carries into every entry's CSP (issue #124 WI-13).
 */
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../LoggingService'
import { buildPreviewCsp } from './previewCsp'
import { createPreviewRootRegistry } from './PreviewRootRegistry'

// The real `randomUUID`, replaceable once per test: forcing a malformed mint is
// the only way to hand the registry a bad token.
vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) }
})

let root: string
let realRoot: string

/** The `frame-src` directive of a policy. */
function frameSrcOf(csp: string | undefined): string | undefined {
  return csp?.split('; ').find(directive => directive.startsWith('frame-src'))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'erfana-registry-'))
  realRoot = await realpath(root)
})

afterEach(async () => {
  vi.restoreAllMocks()
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
    expect(entry?.csp).toBe(buildPreviewCsp(hosts, { ownToken: token }))
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
    expect(before?.csp).toBe(buildPreviewCsp([], { ownToken: token }))
    expect(before?.csp).not.toContain('https://cdn.example.com')

    registry.rebuildCsp(token, ['https://cdn.example.com'])

    const after = registry.resolve(token)
    expect(after?.realRoot).toBe(realRoot)
    expect(after?.projectPath).toBe(root)
    expect(after?.csp).toBe(buildPreviewCsp(['https://cdn.example.com'], { ownToken: token }))
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

describe('PreviewRootRegistry own-token frame-src (issue #124 WI-13)', () => {
  it("names the issued token, and only it, in the entry's frame-src", async () => {
    const registry = createPreviewRootRegistry()
    const token = await registry.issue(root, ['https://cdn.example.com'])

    const csp = registry.resolve(token)?.csp
    expect(frameSrcOf(csp)).toBe(`frame-src erfana-preview://${token}`)
    expect(csp).not.toContain('frame-ancestors')
  })

  it("gives each root its own token and never another root's", async () => {
    const registry = createPreviewRootRegistry()
    const a = await registry.issue(root, [])
    const b = await registry.issue(root, [])

    expect(frameSrcOf(registry.resolve(a)?.csp)).toBe(`frame-src erfana-preview://${a}`)
    expect(frameSrcOf(registry.resolve(b)?.csp)).toBe(`frame-src erfana-preview://${b}`)
    expect(registry.resolve(a)?.csp).not.toContain(b)
  })

  it('rebuildCsp keeps the same token in frame-src while the hosts change', async () => {
    const registry = createPreviewRootRegistry()
    const token = await registry.issue(root, [])

    registry.rebuildCsp(token, ['https://cdn.example.com'])

    const csp = registry.resolve(token)?.csp
    expect(frameSrcOf(csp)).toBe(`frame-src erfana-preview://${token}`)
    expect(csp).toContain('https://cdn.example.com')
  })

  it("fails closed on a malformed mint: frame-src 'none', logged without the token", async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    vi.mocked(randomUUID).mockReturnValueOnce('ABCDEF01-2345-6789-ABCD-EF0123456789')
    const registry = createPreviewRootRegistry()

    const token = await registry.issue(root, [])
    expect(token).toBe('ABCDEF0123456789ABCDEF0123456789')
    expect(frameSrcOf(registry.resolve(token)?.csp)).toBe("frame-src 'none'")
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0]?.[2]).toEqual({ site: 'issue' })

    expect(() => registry.rebuildCsp(token, [])).not.toThrow()
    expect(frameSrcOf(registry.resolve(token)?.csp)).toBe("frame-src 'none'")
    expect(error).toHaveBeenCalledTimes(2)
    expect(error.mock.calls[1]?.[2]).toEqual({ site: 'rebuildCsp' })
    expect(JSON.stringify(error.mock.calls)).not.toContain(token)
  })

  it('logs nothing for a well-formed token, nor for a host the builder skips', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const registry = createPreviewRootRegistry()

    const token = await registry.issue(root, ['not a host'])
    registry.rebuildCsp(token, ['also not a host'])

    expect(error).not.toHaveBeenCalled()
  })
})
