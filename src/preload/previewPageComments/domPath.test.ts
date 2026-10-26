// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Edge cases of quotes and snapshots (docs/designs/html-preview-comments.md
 * §5.3, decision 34). The main cases live in `picks.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { QUOTE_CONTEXT_CHARS, SNAPSHOT_MAX_BYTES } from './constants'
import { quoteOf, snapshotOf } from './domPath'

afterEach(() => {
  document.body.innerHTML = ''
})

function mountHtml(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body.firstElementChild as HTMLElement
}

describe('domPath edges', () => {
  it('cuts the prefix without splitting a surrogate pair', () => {
    const before = `x😀${'b'.repeat(QUOTE_CONTEXT_CHARS - 1)}`
    const root = mountHtml(`<div>${before}<b>word</b></div>`)
    expect(quoteOf(root, root.querySelector('b') as Element)?.prefix).toBe('b'.repeat(QUOTE_CONTEXT_CHARS - 1))
  })

  it('keeps an attribute value that only looks like an open comment', () => {
    const root = mountHtml('<p title="<!-- open">x</p>')
    expect(snapshotOf(root)).toEqual({ snapshot: root.outerHTML, truncated: false })
  })

  it('counts 2- and 4-byte characters at their UTF-8 size', () => {
    // `<p>` is 3 bytes and each pair 6 (é 2 + 😀 4): one byte is left over,
    // too few for the next é.
    expect((SNAPSHOT_MAX_BYTES - 3) % 6).toBe(1)
    const pairs = Math.floor((SNAPSHOT_MAX_BYTES - 3) / 6)
    const cut = snapshotOf(mountHtml(`<p>${'é😀'.repeat(pairs + 1)}</p>`))
    expect(cut).toEqual({ snapshot: `<p>${'é😀'.repeat(pairs)}`, truncated: true })
  })
})
