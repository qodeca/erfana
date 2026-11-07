// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The address history (025-FR-063; ADR 0009 decisions 6–7): the last 100
 * addresses, most recent first, signed with a key and plain on Linux
 * `basic_text`; suggestions from it only; user names and passwords never kept.
 */
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { tempHome, tempProject, testSigner } from '../site/__test-helpers__/siteFakes'
import { BrowserHistoryStore, HISTORY_SEGMENTS, historyAddressOf, MAX_HISTORY_ENTRIES, suggestAddresses } from './historyStore'

const itPosix = process.platform === 'win32' ? it.skip : it

let root: string
let home: string
let file: string

beforeEach(() => {
  root = tempProject('erfana-history-')
  home = tempHome()
  file = join(root, ...HISTORY_SEGMENTS)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

describe('historyAddressOf', () => {
  it('keeps http, https and local file addresses, without a user name or password', () => {
    expect(historyAddressOf('http://localhost:4100/')).toBe('http://localhost:4100/')
    expect(historyAddressOf('https://user:secret@app.test/a?b#c')).toBe('https://app.test/a?b#c')
    expect(historyAddressOf('file:///Users/me/site/index.html')).toBe('file:///Users/me/site/index.html')
  })

  it('keeps nothing else', () => {
    expect(historyAddressOf('about:blank')).toBeNull()
    expect(historyAddressOf('data:text/html,x')).toBeNull()
    expect(historyAddressOf('nonsense')).toBeNull()
    expect(historyAddressOf(`http://app.test/${'a'.repeat(9000)}`)).toBeNull()
  })
})

describe('suggestAddresses', () => {
  const history = ['https://www.app.test/settings', 'http://localhost:4100/', 'https://docs.test/guide']

  it('025-AC-078 suggests an address from the start of what is typed, with or without the scheme and www', () => {
    expect(suggestAddresses(history, 'local', 10)).toEqual(['http://localhost:4100/'])
    expect(suggestAddresses(history, 'https://docs', 10)).toEqual(['https://docs.test/guide'])
    expect(suggestAddresses(history, 'APP.test', 10)).toEqual(['https://www.app.test/settings'])
    expect(suggestAddresses(history, 'www.app', 10)).toEqual(['https://www.app.test/settings'])
    expect(suggestAddresses(history, 'test', 10)).toEqual([])
  })

  it('lists every address, most recent first, for empty input, up to the cap', () => {
    expect(suggestAddresses(history, '  ', 10)).toEqual(history)
    expect(suggestAddresses(history, '', 2)).toEqual(history.slice(0, 2))
    expect(suggestAddresses(history, '', -1)).toEqual([])
  })
})

describe('BrowserHistoryStore', () => {
  it('025-AC-078 keeps loaded addresses most recent first across a restart; a reload moves one to the front', async () => {
    const store = await BrowserHistoryStore.open(root, home, testSigner('k'))
    expect(store.format).toBe('signed')
    await store.record('http://a.test/')
    await store.record('http://b.test/')
    await store.record('http://b.test/')
    await store.record('http://a.test/')
    expect(store.list()).toEqual(['http://a.test/', 'http://b.test/'])
    expect((await BrowserHistoryStore.open(root, home, testSigner('k'))).list()).toEqual(['http://a.test/', 'http://b.test/'])
  })

  it('025-AC-078 holds the last 100 after 101 loads', async () => {
    const store = await BrowserHistoryStore.open(root, home, testSigner(null))
    for (let i = 0; i <= MAX_HISTORY_ENTRIES; i += 1) await store.record(`http://app.test/${i}`)
    expect(store.list()).toHaveLength(MAX_HISTORY_ENTRIES)
    expect(store.list()[0]).toBe(`http://app.test/${MAX_HISTORY_ENTRIES}`)
    expect(store.list()).not.toContain('http://app.test/0')
  })

  it('never writes a user name or password, and ignores addresses it does not keep', async () => {
    const store = await BrowserHistoryStore.open(root, home, testSigner('k'))
    await store.record('https://user:secret@app.test/')
    await store.record('about:blank')
    expect(readFileSync(file, 'utf8')).not.toContain('secret')
    expect(store.list()).toEqual(['https://app.test/'])
  })

  it('ADR 0009 decision 7: on basic_text keeps a plain file, and a signed file is not read as one', async () => {
    const signed = await BrowserHistoryStore.open(root, home, testSigner('k'))
    await signed.record('http://signed.test/')
    const plain = await BrowserHistoryStore.open(root, home, testSigner(null))
    expect(plain.format).toBe('plain')
    expect(plain.list()).toEqual([])
    await plain.record('http://plain.test/')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, entries: [{ url: 'http://plain.test/' }] })
    expect((await BrowserHistoryStore.open(root, home, testSigner(null))).list()).toEqual(['http://plain.test/'])
    expect((await BrowserHistoryStore.open(root, home, testSigner('k'))).list()).toEqual([])
  })

  it('ignores a malformed or replayed file', async () => {
    const store = await BrowserHistoryStore.open(root, home, testSigner('k'))
    await store.record('http://a.test/')
    const older = readFileSync(file, 'utf8')
    await store.record('http://b.test/')
    writeFileSync(file, older)
    expect((await BrowserHistoryStore.open(root, home, testSigner('k'))).list()).toEqual([])
    writeFileSync(file, '{not json')
    expect((await BrowserHistoryStore.open(root, home, testSigner(null))).list()).toEqual([])
  })

  it('025-AC-078 empties the history on clear; forgetting in memory writes nothing', async () => {
    const store = await BrowserHistoryStore.open(root, home, testSigner(null))
    await store.record('http://a.test/')
    await store.clear()
    expect(store.list()).toEqual([])
    expect(JSON.parse(readFileSync(file, 'utf8')).entries).toEqual([])
    await store.record('http://b.test/')
    const before = readFileSync(file, 'utf8')
    store.forgetInMemory()
    expect(store.list()).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  itPosix('never writes through a link planted at history.json', async () => {
    const outside = join(home, 'outside.json')
    writeFileSync(outside, 'keep')
    symlinkSync(outside, file)
    const store = await BrowserHistoryStore.open(root, home, testSigner(null))
    await store.record('http://a.test/')
    expect(readFileSync(outside, 'utf8')).toBe('keep')
    expect(lstatSync(file).isSymbolicLink()).toBe(false)
  })

  it('keeps entries in memory when the file cannot be written', async () => {
    rmSync(join(root, ...HISTORY_SEGMENTS.slice(0, -1)), { recursive: true, force: true })
    const store = await BrowserHistoryStore.open(root, home, testSigner(null))
    await store.record('http://a.test/')
    expect(store.list()).toEqual(['http://a.test/'])
    expect(existsSync(file)).toBe(false)
  })
})
