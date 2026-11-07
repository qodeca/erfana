// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zoom levels per site (025-FR-008; ADR 0009 decisions 6–7; S-26): kept
 * across a restart in a signed `zoom.json` at the home generation, memory
 * only without a key, replayed or foreign files ignored.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { tempHome, tempProject, testSigner } from '../site/__test-helpers__/siteFakes'
import { BrowserZoomStore, LOCAL_FILE_ZOOM_KEY, MAX_ZOOM_ENTRIES, ZOOM_SEGMENTS, zoomKeyOf } from './zoomStore'

let root: string
let home: string
let file: string

beforeEach(() => {
  root = tempProject('erfana-zoom-')
  home = tempHome()
  file = join(root, ...ZOOM_SEGMENTS)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

describe('zoomKeyOf', () => {
  it('keys a page by its host name, without scheme or port, and every local file alike', () => {
    expect(zoomKeyOf('http://App.Test:4100/a')).toBe('app.test')
    expect(zoomKeyOf('https://app.test/b')).toBe('app.test')
    expect(zoomKeyOf('file:///Users/me/site/index.html')).toBe(LOCAL_FILE_ZOOM_KEY)
    expect(zoomKeyOf('about:blank')).toBeNull()
    expect(zoomKeyOf(null)).toBeNull()
    expect(zoomKeyOf('not a url')).toBeNull()
  })
})

describe('BrowserZoomStore', () => {
  it('025-AC-008 keeps a site level across a restart, and 100% is the default', async () => {
    const store = await BrowserZoomStore.open(root, home, testSigner('k'))
    expect(store.persistence).toBe('saved')
    expect(store.level('app.test')).toBe(100)
    await store.set('app.test', 125)
    const reopened = await BrowserZoomStore.open(root, home, testSigner('k'))
    expect(reopened.level('app.test')).toBe(125)
    expect(reopened.level('other.test')).toBe(100)
  })

  it('does not store 100%: a reset removes the entry', async () => {
    const store = await BrowserZoomStore.open(root, home, testSigner('k'))
    await store.set('app.test', 150)
    await store.set('app.test', 100)
    expect(readFileSync(file, 'utf8')).not.toContain('app.test')
  })

  it('S-26 keeps levels in memory only without a signing key, and writes no file', async () => {
    const store = await BrowserZoomStore.open(root, home, testSigner(null))
    expect(store.persistence).toBe('session')
    await store.set('app.test', 150)
    expect(store.level('app.test')).toBe(150)
    expect(existsSync(file)).toBe(false)
  })

  it('ignores a file another key signed, and a replayed older file', async () => {
    const store = await BrowserZoomStore.open(root, home, testSigner('k'))
    await store.set('app.test', 150)
    const older = readFileSync(file, 'utf8')
    expect((await BrowserZoomStore.open(root, home, testSigner('other'))).level('app.test')).toBe(100)
    await store.set('app.test', 200)
    writeFileSync(file, older)
    expect((await BrowserZoomStore.open(root, home, testSigner('k'))).level('app.test')).toBe(100)
  })

  it('ignores a level that is not one of the zoom steps', async () => {
    const store = await BrowserZoomStore.open(root, home, testSigner('k'))
    await store.set('app.test', 150)
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries: Array<{ percent: number }> }
    parsed.entries[0].percent = 123
    writeFileSync(file, JSON.stringify(parsed))
    expect((await BrowserZoomStore.open(root, home, testSigner('k'))).level('app.test')).toBe(100)
  })

  it(`keeps at most ${MAX_ZOOM_ENTRIES} sites, the least recently set going first`, async () => {
    const store = await BrowserZoomStore.open(root, home, testSigner(null))
    for (let i = 0; i <= MAX_ZOOM_ENTRIES; i += 1) await store.set(`s${i}.test`, 110)
    expect(store.level('s0.test')).toBe(100)
    expect(store.level(`s${MAX_ZOOM_ENTRIES}.test`)).toBe(110)
  })

  it('forgets in memory without writing', async () => {
    const store = await BrowserZoomStore.open(root, home, testSigner('k'))
    await store.set('app.test', 150)
    const before = readFileSync(file, 'utf8')
    store.forgetInMemory()
    expect(store.level('app.test')).toBe(100)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })
})
