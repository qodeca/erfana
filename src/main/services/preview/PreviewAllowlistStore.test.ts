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
    // An IPv6 literal makes the block fail safeParse. It used to be `localhost`
    // here, which is a perfectly good host again — the fixture had to move to
    // something refused for a structural reason rather than a policy one.
    await writeSettings(
      JSON.stringify({ htmlPreview: { allowlist: { version: 1, hosts: ['[::1]'] } } })
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

  it('accepts a loopback origin now, and still refuses what cannot be expressed', async () => {
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    // The policy that refused these is gone (#108). It never worked — a name
    // resolving to a private address was undetected either way — and it was paid
    // for with a row that had no button and no reason.
    await expect(store.approveOrigin('https://127.0.0.1')).resolves.toEqual(['https://127.0.0.1'])
    await expect(store.approveOrigin('http://localhost:3000')).resolves.toEqual([
      'http://localhost:3000',
      'https://127.0.0.1'
    ])

    // An IPv6 literal is still refused, and for a reason that is not a choice:
    // Chromium reports "contains an invalid source … It will be ignored", so a
    // grant would live in the network filter and never reach the CSP.
    await expect(store.approveOrigin('https://[::1]:3000')).rejects.toMatchObject({
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

describe('PreviewAllowlistStore.approveOrigin — the write path validates like the read path', () => {
  it('refuses a block with no version key, instead of adopting and versioning it', async () => {
    // THE ONE THAT MATTERS. `load()` refuses this block because the schema
    // requires `version: 1` — but the approve path's version guard only fires
    // when the key is PRESENT and wrong, so a versionless block sailed straight
    // past it. Approving one CDN then merged every origin in the file and
    // stamped `version: 1` on the result, making a clone-delivered allowlist the
    // badge had already rejected go live on the user's next click.
    await writeSettings(
      JSON.stringify({
        htmlPreview: {
          allowlist: {
            hosts: ['evil.example.com'],
            origins: ['https://evil.example.com', 'http://tracker.example:8080']
          }
        }
      })
    )
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    // The load half of the guarantee: nothing is approved, write-back is off.
    const state = await store.load()
    expect(state.origins).toEqual([])
    expect(state.writeBackEnabled).toBe(false)

    await expect(store.approveOrigin('https://cdn.jsdelivr.net')).rejects.toMatchObject({
      code: ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
    })

    // And the file is untouched — still versionless, so it cannot have been
    // adopted. Reading it back is the point: the old bug's damage was on disk.
    const settingsPath = join(realRoot, '.erfana', 'settings.json')
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(parsed.htmlPreview.allowlist.version).toBeUndefined()
    expect(parsed.htmlPreview.allowlist.origins).not.toContain('https://cdn.jsdelivr.net')
  })

  it('does not resurrect a hand-revoked grant from the legacy hosts key', async () => {
    // `origins: []` means "deliberately approved nothing". The approve path used
    // to union both keys unconditionally, so removing an entry from `origins` by
    // hand was undone by the next approval — and hand-editing is currently the
    // only revocation there is (#86).
    await writeSettings(
      JSON.stringify({
        htmlPreview: { allowlist: { version: 1, hosts: ['revoked.example.com'], origins: [] } }
      })
    )
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    const origins = await store.approveOrigin('https://cdn.jsdelivr.net')

    expect(origins).toEqual(['https://cdn.jsdelivr.net'])
    expect(origins).not.toContain('https://revoked.example.com')
  })

  it('reports a malformed stored origin as a settings error, not an unhandled TypeError', async () => {
    // `hostOfOrigin` ran `new URL()` over raw strings from inside the ARGUMENT to
    // the validate-before-write guard, so one bad entry threw `TypeError` before
    // the guard meant to refuse it. The handler mapped that to UNKNOWN_ERROR, so
    // every approval in the project failed forever with a bare "Not saved".
    await writeSettings(
      JSON.stringify({ htmlPreview: { allowlist: { version: 1, hosts: [], origins: ['not a url'] } } })
    )
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    const error = await store.approveOrigin('https://cdn.jsdelivr.net').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ code: ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED })
  })

  it('refuses a stored origin that is not canonical', async () => {
    // The schema refines `parsePreviewOrigin(v) === v`, so an upper-case host is
    // reachable-but-not-canonical and fails the whole block rather than being
    // silently normalised into a grant the user never wrote.
    await writeSettings(
      JSON.stringify({
        htmlPreview: { allowlist: { version: 1, hosts: [], origins: ['https://EXAMPLE.com'] } }
      })
    )
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    await expect(store.approveOrigin('https://cdn.jsdelivr.net')).rejects.toMatchObject({
      code: ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
    })
  })

  it('still approves into a project that has no allowlist block at all', async () => {
    // THE LANDMINE. A fresh project reaches the resolver with `block ===
    // undefined`, and `PreviewAllowlistSchema.safeParse(undefined)` fails — so a
    // literal "validate the block or throw" would make the FIRST approval in
    // every new project impossible. Absent means empty and CONTINUE.
    await writeSettings(JSON.stringify({ theme: 'dark' }))
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    const origins = await store.approveOrigin('https://cdn.jsdelivr.net')

    expect(origins).toEqual(['https://cdn.jsdelivr.net'])
    // The unrelated key above the block survives, which is the file's promise.
    const settingsPath = join(realRoot, '.erfana', 'settings.json')
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(parsed.theme).toBe('dark')
  })

  it('refuses to write over a htmlPreview that is not an object', async () => {
    // Overwriting it is data loss with no notice: this key cannot hold both the
    // user's value and an allowlist, so the choice is destroy or refuse.
    await writeSettings(JSON.stringify({ htmlPreview: 'oops' }))
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    await expect(store.approveOrigin('https://cdn.jsdelivr.net')).rejects.toMatchObject({
      code: ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
    })

    const settingsPath = join(realRoot, '.erfana', 'settings.json')
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(parsed.htmlPreview).toBe('oops')
  })

  it('preserves unknown keys INSIDE the allowlist block across a write', async () => {
    // The file header promises unknown keys survive a round trip. That held only
    // for keys ABOVE `allowlist`; the block itself was replaced wholesale. This
    // schema deliberately never bumps its version, so a build that does not know
    // a key must preserve it rather than delete it.
    await writeSettings(
      JSON.stringify({
        htmlPreview: {
          allowlist: { version: 1, hosts: [], origins: [], futureKey: { kept: true } }
        }
      })
    )
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    await store.approveOrigin('https://cdn.jsdelivr.net')

    const settingsPath = join(realRoot, '.erfana', 'settings.json')
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(parsed.htmlPreview.allowlist.futureKey).toEqual({ kept: true })
    expect(parsed.htmlPreview.allowlist.origins).toEqual(['https://cdn.jsdelivr.net'])
  })
})

describe('PreviewAllowlistStore.load — origins is the truth', () => {
  it('reads origins:[] as approving nothing, never falling back to hosts', async () => {
    // Precedence is KEY PRESENT, not array non-empty. Until now this was proven
    // only by a docblock: a regression to `origins?.length ? … : hosts` would
    // resurrect every revoked grant and the suite would stay green.
    await writeSettings(
      JSON.stringify({
        htmlPreview: { allowlist: { version: 1, hosts: ['revoked.example.com'], origins: [] } }
      })
    )
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    const state = await store.load()

    expect(state.origins).toEqual([])
    expect(state.writeBackEnabled).toBe(true)
  })

  it('loads a stored origin carrying a non-default port from disk', async () => {
    // Written-then-re-read inside approveOrigin is not the same guarantee as
    // read from a file this process did not write.
    await writeSettings(
      JSON.stringify({
        htmlPreview: {
          allowlist: { version: 1, hosts: [], origins: ['https://example.com:8443'] }
        }
      })
    )
    const store = createPreviewAllowlistStore({ getProjectRoot: () => root })

    const state = await store.load()

    expect(state.origins).toEqual(['https://example.com:8443'])
  })
})
