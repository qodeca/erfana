// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Local addresses from terminal output (025-FR-063): localhost and 127.0.0.1
 * only, escape sequences removed, sentence punctuation dropped, chunks
 * joined, each address once.
 */
import { describe, expect, it } from 'vitest'
import { findLocalAddresses, MAX_LOCAL_ADDRESSES, TerminalLocalAddresses } from './terminalLocalAddressScan'

describe('findLocalAddresses', () => {
  it('finds dev-server addresses on localhost and 127.0.0.1', () => {
    const out = '  ➜  Local:   http://localhost:5173/\n  Serving at http://127.0.0.1:8000. Press Ctrl+C\n'
    expect(findLocalAddresses(out)).toEqual(['http://localhost:5173/', 'http://127.0.0.1:8000/'])
  })

  it('ignores remote and other loopback hosts, and an out-of-range port', () => {
    expect(findLocalAddresses('https://github.test/x http://0.0.0.0:3000 http://[::1]:3000 http://localhost:99999/')).toEqual([])
  })

  it('removes colour and hyperlink escape sequences first', () => {
    const coloured = '\u001b[32mhttp://\u001b[1mlocalhost\u001b[22m:3000/\u001b[39m\n'
    expect(findLocalAddresses(coloured)).toEqual(['http://localhost:3000/'])
    const linked = '\u001b]8;;http://localhost:4000/\u0007open\u001b]8;;\u0007 http://localhost:4000/app)\n'
    expect(findLocalAddresses(linked)).toEqual(['http://localhost:4000/app'])
  })

  it('keeps paths and queries, and drops trailing punctuation', () => {
    expect(findLocalAddresses('(see https://localhost:8443/a/b?c=1#d).')).toEqual(['https://localhost:8443/a/b?c=1#d'])
  })
})

describe('TerminalLocalAddresses', () => {
  it('025-AC-078 reports each address once, across terminals', () => {
    const seen = new TerminalLocalAddresses()
    expect(seen.scan('t1', 'http://localhost:3000/\n')).toEqual(['http://localhost:3000/'])
    expect(seen.scan('t2', 'again http://localhost:3000/\n')).toEqual([])
    expect(seen.list()).toEqual(['http://localhost:3000/'])
  })

  it('joins an address split across chunks of the same terminal only', () => {
    const seen = new TerminalLocalAddresses()
    expect(seen.scan('t1', 'Local: http://local')).toEqual([])
    expect(seen.scan('t2', 'host:9999/\n')).toEqual([])
    expect(seen.scan('t1', 'host:5173/\r\n')).toEqual(['http://localhost:5173/'])
  })

  it('drops a closed terminal\'s unfinished line, and starts over on reset', () => {
    const seen = new TerminalLocalAddresses()
    seen.scan('t1', 'http://localhost:1/')
    seen.terminalGone('t1')
    expect(seen.scan('t1', '\n')).toEqual([])
    seen.scan('t1', 'http://localhost:2/\n')
    seen.reset()
    expect(seen.list()).toEqual([])
  })

  it(`keeps at most ${MAX_LOCAL_ADDRESSES} addresses`, () => {
    const seen = new TerminalLocalAddresses()
    const lines = Array.from({ length: MAX_LOCAL_ADDRESSES + 5 }, (_, i) => `http://localhost:${3000 + i}/`).join('\n')
    expect(seen.scan('t1', `${lines}\n`)).toHaveLength(MAX_LOCAL_ADDRESSES)
  })
})
