// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the blocked-resource kind mapper (issue #74 follow-up).
 *
 * The label these produce sits next to a hostname in a consent row. So the
 * property that matters is not "every input maps to something" but that a
 * resource we did not recognise never acquires a specific, reassuring label.
 *
 * @see previewBlockedKind.ts
 */
import { describe, it, expect } from 'vitest'

import {
  kindFromResourceType,
  kindFromDirective,
  mergeBlockedKinds,
  PREVIEW_BLOCKED_KINDS,
  type PreviewBlockedKind
} from './previewBlockedKind'

describe('kindFromResourceType', () => {
  it('maps the Electron resource types a preview actually sees', () => {
    expect(kindFromResourceType('script')).toBe('script')
    expect(kindFromResourceType('stylesheet')).toBe('style')
    expect(kindFromResourceType('font')).toBe('font')
    expect(kindFromResourceType('image')).toBe('image')
    expect(kindFromResourceType('xhr')).toBe('connect')
    expect(kindFromResourceType('subFrame')).toBe('frame')
  })

  it('falls back to `other` for an unknown or absent type', () => {
    // The filter's timeout sweep keeps only host and URL, so `undefined` is a
    // real production input, not a defensive nicety.
    expect(kindFromResourceType(undefined)).toBe('other')
    expect(kindFromResourceType('somethingNewInElectron40')).toBe('other')
  })
})

describe('kindFromDirective', () => {
  it('maps a directive by its prefix, so the -elem and -attr forms agree', () => {
    // Chromium reports the most specific form it can. Matching the whole string
    // would leave `script-src-elem` — the common case for a blocked <script> —
    // labelled "other".
    expect(kindFromDirective('script-src')).toBe('script')
    expect(kindFromDirective('script-src-elem')).toBe('script')
    expect(kindFromDirective('script-src-attr')).toBe('script')
    expect(kindFromDirective('style-src-elem')).toBe('style')
    expect(kindFromDirective('img-src')).toBe('image')
    expect(kindFromDirective('font-src')).toBe('font')
    expect(kindFromDirective('connect-src')).toBe('connect')
  })

  it('treats default-src as unknown, because that is what it means', () => {
    // `default-src` is reported when no specific directive matched: it says a
    // request was refused and nothing about what it was.
    expect(kindFromDirective('default-src')).toBe('other')
  })

  it('falls back to `other` for an empty or unrecognised directive', () => {
    expect(kindFromDirective('')).toBe('other')
    expect(kindFromDirective('trusted-types')).toBe('other')
  })
})

describe('the two vocabularies agree where they overlap', () => {
  it('maps a stylesheet to the same kind from either source', () => {
    // The whole reason this module exists: CSP says `style-src`, the filter says
    // `stylesheet`, and the renderer must not learn both dialects.
    expect(kindFromDirective('style-src')).toBe(kindFromResourceType('stylesheet'))
    expect(kindFromDirective('img-src')).toBe(kindFromResourceType('image'))
    expect(kindFromDirective('connect-src')).toBe(kindFromResourceType('xhr'))
  })
})

describe('mergeBlockedKinds', () => {
  it('accumulates the kinds one host is refused for', () => {
    // A host commonly serves several things. Keeping only the FIRST would label
    // a host that will run scripts as "font" — and a reader who agreed to a font
    // was then misinformed by the surface built to inform them.
    let kinds: PreviewBlockedKind[] = []
    kinds = mergeBlockedKinds(kinds, 'font') ?? kinds
    kinds = mergeBlockedKinds(kinds, 'script') ?? kinds

    expect(kinds).toEqual(['script', 'font'])
  })

  it('returns null when the kind is already known, so nothing re-emits', () => {
    expect(mergeBlockedKinds(['script'], 'script')).toBeNull()
  })

  it('drops `other` once something specific is known', () => {
    // "other" beside "script" adds nothing and dilutes the row.
    expect(mergeBlockedKinds(['other'], 'script')).toEqual(['script'])
  })

  it('keeps `other` when it is all there is', () => {
    expect(mergeBlockedKinds([], 'other')).toEqual(['other'])
  })

  it('orders by capability, so the most powerful kind reads first', () => {
    let kinds: PreviewBlockedKind[] = []
    for (const kind of ['image', 'connect', 'script'] as const) {
      kinds = mergeBlockedKinds(kinds, kind) ?? kinds
    }
    expect(kinds).toEqual(['script', 'image', 'connect'])
    expect(PREVIEW_BLOCKED_KINDS.indexOf('script')).toBeLessThan(
      PREVIEW_BLOCKED_KINDS.indexOf('image')
    )
  })
})
