// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import { MAX_ALLOWLIST_HOSTS } from '../../../shared/ipc/preview-settings-schema'
import { createPreviewAllowlistStore } from './PreviewAllowlistStore'

let root: string
let realRoot: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'erfana-allowlist-'))
  realRoot = await realpath(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Write a `.erfana/settings.json` with the given raw content. */
async function writeSettings(content: string): Promise<string> {
  const erfanaDir = join(root, '.erfana')
  await mkdir(erfanaDir, { recursive: true })
  const settingsPath = join(erfanaDir, 'settings.json')
  await writeFile(settingsPath, content, 'utf8')
  return settingsPath
}

describe('PreviewAllowlistStore.load', () => {
  it('returns an empty, write-back-enabled state when no settings file exists', async () => {
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })
    const state = await store.load()

    expect(state.origins).toEqual([])
    expect(state.writeBackEnabled).toBe(true)
  })

  it('parses a valid version-1 allowlist block', async () => {
    await writeSettings(
      JSON.stringify({
        htmlPreview: { allowlist: { version: 1, hosts: ['cdn.example.com', 'a.example.org'] } }
      })
    )
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })
    const state = await store.load()

    expect([...state.origins].sort()).toEqual([
      'https://a.example.org',
      'https://cdn.example.com'
    ])
    expect(state.writeBackEnabled).toBe(true)
  })

  it('treats a bad block as empty with write-back disabled and a badge, never throwing', async () => {
    // A non-approvable host (localhost) makes the block fail safeParse.
    await writeSettings(
      JSON.stringify({ htmlPreview: { allowlist: { version: 1, hosts: ['localhost'] } } })
    )
    const onBadge = vi.fn<(badge: PreviewFailureInput) => void>()
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root, onBadge })

    const state = await store.load()

    expect(state.origins).toEqual([])
    expect(state.writeBackEnabled).toBe(false)
    expect(onBadge).toHaveBeenCalledTimes(1)
    expect(onBadge.mock.calls[0][0].type).toBe('allowlist-invalid')
  })

  it('fails closed with a badge on an unsupported version', async () => {
    await writeSettings(
      JSON.stringify({ htmlPreview: { allowlist: { version: 2, hosts: ['cdn.example.com'] } } })
    )
    const onBadge = vi.fn<(badge: PreviewFailureInput) => void>()
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root, onBadge })

    const state = await store.load()

    expect(state.origins).toEqual([])
    expect(state.writeBackEnabled).toBe(false)
    expect(onBadge.mock.calls[0][0].type).toBe('allowlist-unsupported-version')
  })

  it('treats corrupt JSON as a bad block without throwing', async () => {
    await writeSettings('{ this is not json')
    const onBadge = vi.fn<(badge: PreviewFailureInput) => void>()
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root, onBadge })

    const state = await store.load()

    expect(state.origins).toEqual([])
    expect(state.writeBackEnabled).toBe(false)
    expect(onBadge).toHaveBeenCalledTimes(1)
  })

  it('leaves write-back enabled when htmlPreview has no allowlist block', async () => {
    await writeSettings(JSON.stringify({ htmlPreview: {}, other: 1 }))
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    const state = await store.load()

    expect(state.origins).toEqual([])
    expect(state.writeBackEnabled).toBe(true)
  })
})

describe('PreviewAllowlistStore.approveOrigin', () => {
  it('writes the origin as pretty (2-space + trailing newline) JSON atomically', async () => {
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    const origins = await store.approveOrigin('https://cdn.example.com')

    expect(origins).toEqual(['https://cdn.example.com'])
    expect(store.getOrigins().has('https://cdn.example.com')).toBe(true)

    const settingsPath = join(realRoot, '.erfana', 'settings.json')
    const written = await readFile(settingsPath, 'utf8')
    // Pretty-printed: 2-space indent and a trailing newline.
    expect(written.endsWith('\n')).toBe(true)
    expect(written).toContain('\n  "htmlPreview"')
    const parsed = JSON.parse(written)
    // DUAL-WRITE at version 1: `origins` is the truth, `hosts` the projection an
    // older build reads. The version must NOT move — on an unrecognised one,
    // load() applies an empty set and every write is refused, so a bump would
    // leave an older Erfana with no approved hosts and no way to re-approve.
    expect(parsed.htmlPreview.allowlist).toEqual({
      version: 1,
      hosts: ['cdn.example.com'],
      origins: ['https://cdn.example.com']
    })
  })

  it('projects only what a host entry could ever have meant', async () => {
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    await store.approveOrigin('https://cdn.example.com')
    await store.approveOrigin('https://example.com:8443')

    const parsed = JSON.parse(
      await readFile(join(realRoot, '.erfana', 'settings.json'), 'utf8')
    )
    // A non-default port has no bare-host form, so it is absent from `hosts` —
    // an older build loses that grant rather than being handed a wider one it
    // cannot express. Losing is the safe direction for a one-way door.
    expect(parsed.htmlPreview.allowlist.hosts).toEqual(['cdn.example.com'])
    expect(parsed.htmlPreview.allowlist.origins).toEqual([
      'https://cdn.example.com',
      'https://example.com:8443'
    ])
  })

  it('preserves unknown keys already present in the file', async () => {
    await writeSettings(JSON.stringify({ editor: { theme: 'dark' }, custom: [1, 2] }))
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    await store.approveOrigin('https://cdn.example.com')

    const settingsPath = join(realRoot, '.erfana', 'settings.json')
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(parsed.editor).toEqual({ theme: 'dark' })
    expect(parsed.custom).toEqual([1, 2])
    expect(parsed.htmlPreview.allowlist.origins).toEqual(['https://cdn.example.com'])
  })

  it('merges into an existing allowlist and keeps the set sorted', async () => {
    await writeSettings(
      JSON.stringify({ htmlPreview: { allowlist: { version: 1, hosts: ['b.example.com'] } } })
    )
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    const origins = await store.approveOrigin('https://a.example.com')

    // The legacy `hosts` entry is read as the origin it always meant.
    expect(origins).toEqual(['https://a.example.com', 'https://b.example.com'])
  })

  it('resolves the root from the injected accessor, not from any caller input', async () => {
    // The accessor points at `root`; the host string is a path-looking value that
    // must be rejected by validation rather than used to steer the write target.
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    await store.approveOrigin('https://good.example.com')

    // Write landed under the accessor's root, nowhere else.
    const settingsPath = join(realRoot, '.erfana', 'settings.json')
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(parsed.htmlPreview.allowlist.hosts).toEqual(['good.example.com'])
  })

  it('rejects a non-approvable host with PREVIEW_HOST_NOT_APPROVABLE', async () => {
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    await expect(store.approveOrigin('https://127.0.0.1')).rejects.toMatchObject({
      code: ErrorCode.PREVIEW_HOST_NOT_APPROVABLE
    })
  })

  it('rejects a path-shaped host value rather than treating it as a filesystem path', async () => {
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    // A slash-bearing value cannot pass the host schema; it must never reach the FS.
    await expect(store.approveOrigin('../../etc/passwd')).rejects.toBeInstanceOf(AppError)
  })

  it('aborts when no project is open', async () => {
    const store = createPreviewAllowlistStore({ getProjectRoot: () => null })

    await expect(store.approveOrigin('https://cdn.example.com')).rejects.toMatchObject({
      code: ErrorCode.PROJECT_NOT_FOUND
    })
  })

  it('serialises concurrent approvals without losing hosts', async () => {
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    await Promise.all([
      store.approveOrigin('https://a.example.com'),
      store.approveOrigin('https://b.example.com'),
      store.approveOrigin('https://c.example.com')
    ])

    const settingsPath = join(realRoot, '.erfana', 'settings.json')
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(parsed.htmlPreview.allowlist.hosts).toEqual([
      'a.example.com',
      'b.example.com',
      'c.example.com'
    ])
  })
})

describe('PreviewAllowlistStore.approveOrigin cap', () => {
  it('rejects with PREVIEW_ALLOWLIST_FULL past the cap and does not grow the file', async () => {
    // Seed the file at exactly the cap with valid hosts.
    const seeded = Array.from({ length: MAX_ALLOWLIST_HOSTS }, (_, i) => `host-${i}.example.com`)
    await writeSettings(
      JSON.stringify({ htmlPreview: { allowlist: { version: 1, hosts: seeded } } })
    )
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    // Approving one MORE distinct host would exceed the cap.
    await expect(store.approveOrigin('https://overflow.example.com')).rejects.toMatchObject({
      code: ErrorCode.PREVIEW_ALLOWLIST_FULL
    })

    // The cap check runs before the write-back, so the file still holds exactly
    // the cap — the overflow host was never persisted.
    const settingsPath = join(realRoot, '.erfana', 'settings.json')
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(parsed.htmlPreview.allowlist.hosts).toHaveLength(MAX_ALLOWLIST_HOSTS)
    expect(parsed.htmlPreview.allowlist.hosts).not.toContain('overflow.example.com')
  })
})
