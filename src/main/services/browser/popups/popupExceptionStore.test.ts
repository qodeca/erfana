// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pop-up exceptions (025-FR-011 rule 3, 025-FR-023, ADR 0009 decisions 6–7,
 * S-26): per site origin, a signed `popups.json` at the home generation,
 * memory only without a key, untrusted or replayed files ignored.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { homeGenerationsPath } from '../profileGenerations'
import { tempHome, tempProject, testSigner } from '../site/__test-helpers__/siteFakes'
import { MAX_POPUP_EXCEPTIONS, POPUPS_SEGMENTS, PopupExceptionStore } from './popupExceptionStore'

const SITE = 'http://staging.test:8080'

let root: string
let home: string
let file: string

beforeEach(() => {
  root = tempProject('erfana-popups-')
  home = tempHome()
  file = join(root, ...POPUPS_SEGMENTS)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

describe('PopupExceptionStore', () => {
  it('025-AC-011 Always allow is kept per site, across a restart, and no other site is covered', async () => {
    const store = await PopupExceptionStore.open(root, home, testSigner('k'))
    expect(store.persistence).toBe('saved')
    await store.add(SITE)
    expect(store.allows(SITE)).toBe(true)
    expect(store.allows('http://other.test:8080')).toBe(false)
    expect(store.allows('https://staging.test:8080')).toBe(false)
    const reopened = await PopupExceptionStore.open(root, home, testSigner('k'))
    expect(reopened.allows(SITE)).toBe(true)
  })

  it('025-AC-023 Clear removes every exception, in memory and in the file', async () => {
    const store = await PopupExceptionStore.open(root, home, testSigner('k'))
    await store.add(SITE)
    await store.clear()
    expect(store.allows(SITE)).toBe(false)
    expect((await PopupExceptionStore.open(root, home, testSigner('k'))).size()).toBe(0)
  })

  it('keeps exceptions in memory only without a signing key, writing no file and taking no generation (S-26)', async () => {
    const store = await PopupExceptionStore.open(root, home, testSigner(null))
    expect(store.persistence).toBe('session')
    await store.add(SITE)
    expect(store.allows(SITE)).toBe(true)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(homeGenerationsPath(home, root))).toBe(false)
  })

  it('ignores a file signed by another key, an edited file and an older signed copy put back', async () => {
    const store = await PopupExceptionStore.open(root, home, testSigner('k'))
    await store.add(SITE)
    expect((await PopupExceptionStore.open(root, home, testSigner('other'))).size()).toBe(0)

    const older = readFileSync(file)
    await store.clear()
    writeFileSync(file, older)
    expect((await PopupExceptionStore.open(root, home, testSigner('k'))).allows(SITE)).toBe(false)

    await store.add(SITE)
    const edited = JSON.parse(readFileSync(file, 'utf8')) as { entries: Array<{ origin: string }> }
    edited.entries[0]!.origin = 'http://bank.test'
    writeFileSync(file, JSON.stringify(edited))
    expect((await PopupExceptionStore.open(root, home, testSigner('k'))).size()).toBe(0)
  })

  it('keeps at most the newest sites; adding a kept site again makes it the newest', async () => {
    const store = await PopupExceptionStore.open(root, home, testSigner(null))
    for (let i = 0; i < MAX_POPUP_EXCEPTIONS; i += 1) void store.add(`http://h${i}.test`)
    void store.add('http://h0.test')
    void store.add('http://new.test')
    expect(store.size()).toBe(MAX_POPUP_EXCEPTIONS)
    expect(store.allows('http://h0.test')).toBe(true)
    expect(store.allows('http://h1.test')).toBe(false)
    expect(store.allows('http://new.test')).toBe(true)
  })
})
