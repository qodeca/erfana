// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Contract tests for `GraphSearchFiltersSchema`.
 *
 * Split out of `graph-schema.test.ts` to keep both files inside the house cap;
 * the filters carry enough weight to stand alone. Two of the three properties
 * here fail SILENTLY when absent, which is why they get their own file:
 *
 * - A dropped (stripped) filter key WIDENS results, so `z.strictObject` matters
 *   more here than on a request.
 * - `'doc'` without the trailing-slash transform prefix-matches
 *   `documentation/` and `doc-archive/` through the `substr()` compare, with no
 *   error anywhere.
 * - `'md'` instead of `'.md'` returns zero rows with `error: null` —
 *   indistinguishable from a genuine no-match.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 1 (M17, m4)
 * @see specs/designs/sd-021-ipc-contracts.md §7
 */
import { describe, it, expect } from 'vitest'
import { GraphSearchFiltersSchema } from './graph-schema'

describe('GraphSearchFiltersSchema', () => {
  describe('folder transform (M17)', () => {
    it("terminates 'doc' with a slash so it cannot prefix-match documentation/", () => {
      expect(GraphSearchFiltersSchema.parse({ folder: 'doc' }).folder).toBe('doc/')
    })

    it("leaves an already-terminated 'docs/' alone", () => {
      expect(GraphSearchFiltersSchema.parse({ folder: 'docs/' }).folder).toBe('docs/')
    })

    it("distinguishes 'doc' from 'docs/' after the transform", () => {
      const a = GraphSearchFiltersSchema.parse({ folder: 'doc' }).folder
      const b = GraphSearchFiltersSchema.parse({ folder: 'docs/' }).folder
      expect(a).not.toBe(b)
      expect('documentation/notes.md'.startsWith(a as string)).toBe(false)
    })

    it('handles a nested folder', () => {
      expect(GraphSearchFiltersSchema.parse({ folder: 'a/b/c' }).folder).toBe('a/b/c/')
    })

    // Confinement now runs AFTER the transform: an empty folder becomes '/',
    // which `isConfinedRelativePath` rejects as a leading-slash absolute. So the
    // schema fails closed by REJECTING rather than by yielding a '/' the caller
    // must remember not to read as "no filter". This also makes B3's proposed
    // `.min(1)` redundant — confinement already refuses ''.
    it("rejects an empty folder rather than yielding '/'", () => {
      expect(GraphSearchFiltersSchema.safeParse({ folder: '' }).success).toBe(false)
    })

    it('rejects an over-length folder', () => {
      expect(GraphSearchFiltersSchema.safeParse({ folder: 'x'.repeat(1025) }).success).toBe(false)
    })

    // Confinement is applied to the transformed value, so a `..`-bearing or
    // absolute folder is refused rather than prefix-matched into the corpus.
    // (ADS/reserved-name checks target a basename; a folder's basename is empty
    // after the trailing-slash transform, so those are covered on file fields.)
    it.each(['../secret', '/etc', 'C:\\Windows', 'docs/../../etc'])(
      'rejects the unconfined folder %j',
      (folder) => {
        expect(GraphSearchFiltersSchema.safeParse({ folder }).success).toBe(false)
      }
    )

    it('still accepts and terminates a legitimate nested folder', () => {
      expect(GraphSearchFiltersSchema.parse({ folder: 'docs/api' }).folder).toBe('docs/api/')
    })
  })

  describe('fileType regex (M17)', () => {
    it.each(['.md', '.txt', '.markdown', '.mdx', '.md2'])('accepts %j', (fileType) => {
      expect(GraphSearchFiltersSchema.parse({ fileType }).fileType).toBe(fileType)
    })

    // Each of these would return zero rows with `error: null` — a silent lie
    // indistinguishable from a genuine no-match — if the regex were absent.
    it.each(['md', '.MD', '*.md', '.Md', 'md.', '..md', '.md ', '', '.', '.md/'])(
      'rejects %j',
      (fileType) => {
        expect(GraphSearchFiltersSchema.safeParse({ fileType }).success).toBe(false)
      }
    )

    it("rejects 'md' and accepts '.md' — the pair the design names", () => {
      expect(GraphSearchFiltersSchema.safeParse({ fileType: 'md' }).success).toBe(false)
      expect(GraphSearchFiltersSchema.safeParse({ fileType: '.md' }).success).toBe(true)
    })
  })

  describe('strictObject (m4)', () => {
    // A dropped filter WIDENS results, so stripping is worse here than on a request.
    it('rejects the excludeSection key that is missing its Id suffix', () => {
      expect(GraphSearchFiltersSchema.safeParse({ excludeSection: 12 }).success).toBe(false)
    })

    it.each(['excludeFile', 'modifiedAfter', 'fileTypes', 'folders', 'excludesectionid'])(
      'rejects the unknown filter key %s',
      (key) => {
        expect(GraphSearchFiltersSchema.safeParse({ [key]: 1 }).success).toBe(false)
      }
    )

    it('accepts the full, correctly-spelled filter set', () => {
      const parsed = GraphSearchFiltersSchema.parse({
        folder: 'docs',
        fileType: '.md',
        modifiedAfterMs: 1,
        modifiedBeforeMs: 2,
        excludeFilePath: 'docs/a.md',
        excludeSectionId: 3
      })
      expect(parsed.excludeSectionId).toBe(3)
      expect(parsed.folder).toBe('docs/')
    })

    it('parses an empty filter object', () => {
      expect(GraphSearchFiltersSchema.parse({})).toEqual({})
    })
  })

  it.each([
    ['a zero excludeSectionId', { excludeSectionId: 0 }],
    ['a negative modifiedAfterMs', { modifiedAfterMs: -1 }],
    ['a fractional modifiedBeforeMs', { modifiedBeforeMs: 1.5 }],
    ['an over-length excludeFilePath', { excludeFilePath: 'x'.repeat(4097) }],
    // excludeFilePath is now confined like every other file path on the boundary.
    ['an absolute excludeFilePath', { excludeFilePath: '/etc/passwd' }],
    ['a traversal excludeFilePath', { excludeFilePath: '../a.md' }],
    ['a drive-qualified excludeFilePath', { excludeFilePath: 'C:\\x' }],
    ['an NTFS ADS excludeFilePath', { excludeFilePath: 'notes.md:hidden' }],
    ['a reserved-name excludeFilePath', { excludeFilePath: 'COM1' }]
  ])('rejects %s', (_label, payload) => {
    expect(GraphSearchFiltersSchema.safeParse(payload).success).toBe(false)
  })

  it('accepts an ordinary project-relative excludeFilePath', () => {
    expect(GraphSearchFiltersSchema.parse({ excludeFilePath: 'docs/notes.md' }).excludeFilePath).toBe(
      'docs/notes.md'
    )
  })

  // [#21] The two modified* bounds are independent on the base object, so an
  // inverted range parses and returns nothing SILENTLY. The joint leaf refine
  // rejects it. (This is the leaf the MCP filter set inherits the bound from.)
  describe('joint modified* range', () => {
    it('rejects modifiedAfterMs > modifiedBeforeMs', () => {
      expect(
        GraphSearchFiltersSchema.safeParse({ modifiedAfterMs: 2, modifiedBeforeMs: 1 }).success
      ).toBe(false)
    })

    it('accepts an ordered range', () => {
      expect(
        GraphSearchFiltersSchema.safeParse({ modifiedAfterMs: 1, modifiedBeforeMs: 2 }).success
      ).toBe(true)
    })

    it('accepts an equal range (a single-instant window)', () => {
      expect(
        GraphSearchFiltersSchema.safeParse({ modifiedAfterMs: 5, modifiedBeforeMs: 5 }).success
      ).toBe(true)
    })

    it.each([{ modifiedAfterMs: 5 }, { modifiedBeforeMs: 5 }, {}])(
      'accepts a filter set with only one bound (or neither): %j',
      (payload) => {
        expect(GraphSearchFiltersSchema.safeParse(payload).success).toBe(true)
      }
    )
  })
})

