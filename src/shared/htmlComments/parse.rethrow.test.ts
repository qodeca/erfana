// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Only a parse that went past its bounds is "page too large"
 * (`parseBounds.ts`, S-M); any other parse failure is a bug and is thrown,
 * never turned into a read-only page. Its own file: the module mock is
 * hoisted (docs/windows/contributing.md "Test-file split policy").
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('./htmlIndex', async importOriginal => {
  const actual = await importOriginal<typeof import('./htmlIndex')>()
  return { ...actual, indexHtml: vi.fn(actual.indexHtml) }
})

const { indexHtml } = await import('./htmlIndex')
const { analyzeCommentDocument } = await import('./parse')

describe('analyzeCommentDocument', () => {
  it('rethrows a parse failure that is not a parse bound', () => {
    vi.mocked(indexHtml).mockImplementationOnce(() => {
      throw new TypeError('not a bound')
    })
    expect(() => analyzeCommentDocument('<p>x</p>')).toThrow('not a bound')
    // The next parse is the real one again.
    expect(analyzeCommentDocument('<p>x</p>').state.writable).toBe(true)
  })
})
