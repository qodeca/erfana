// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link formatTabTitle} and {@link parseTabTitle}.
 *
 * Moved verbatim from `markdownEditorPanel.logic.test.ts` when the helper
 * became shared between the editor and the image viewer (QG-6 finding M7).
 *
 * @module tabTitle.test
 */

import { describe, it, expect } from 'vitest'

import { DELETED_TAB_MARKER, formatTabTitle, parseTabTitle } from './tabTitle'

describe('formatTabTitle', () => {
  it('should return plain file name when not modified and not deleted', () => {
    expect(formatTabTitle('doc.md', false, false)).toBe('doc.md')
  })

  it('should add bullet when modified', () => {
    expect(formatTabTitle('doc.md', true, false)).toBe('● doc.md')
  })

  it('should add (deleted) suffix when deleted', () => {
    expect(formatTabTitle('doc.md', false, true)).toBe('doc.md (deleted)')
  })

  it('should prefer deleted over modified indicator', () => {
    expect(formatTabTitle('doc.md', true, true)).toBe('doc.md (deleted)')
  })
})

describe('parseTabTitle', () => {
  it('recovers a plain file name', () => {
    expect(parseTabTitle('doc.md')).toEqual({ name: 'doc.md', modified: false, deleted: false })
  })

  it('recovers the modified bullet', () => {
    expect(parseTabTitle('● doc.md')).toEqual({ name: 'doc.md', modified: true, deleted: false })
  })

  it('recovers the deleted suffix', () => {
    expect(parseTabTitle('doc.md (deleted)')).toEqual({
      name: 'doc.md',
      modified: false,
      deleted: true
    })
  })

  it('round-trips whatever formatTabTitle produced', () => {
    // The tab components render the parsed halves separately, so a title the
    // panel set has to survive the trip back (QG-11a H5).
    expect(parseTabTitle(formatTabTitle('doc.md', false, false)).name).toBe('doc.md')
    expect(parseTabTitle(formatTabTitle('doc.md', true, false))).toEqual({
      name: 'doc.md',
      modified: true,
      deleted: false
    })
    expect(parseTabTitle(formatTabTitle('doc.md', true, true))).toEqual({
      name: 'doc.md',
      // Lossy on purpose: `formatTabTitle` drops "modified" for a deleted file,
      // because the two markers do not stack in a tab.
      modified: false,
      deleted: true
    })
  })

  it('leaves an empty title empty so the caller can fall back', () => {
    expect(parseTabTitle('')).toEqual({ name: '', modified: false, deleted: false })
  })

  it('marks a file literally named "… (deleted)" as deleted, harmlessly', () => {
    // Documented false positive: the rendered result is identical either way.
    const parsed = parseTabTitle('report (deleted).png (deleted)')
    expect(parsed.name).toBe('report (deleted).png')
    expect(parsed.deleted).toBe(true)
  })
})

describe('DELETED_TAB_MARKER', () => {
  it('is the text the tabs append, matching the formatted suffix', () => {
    expect(formatTabTitle('doc.md', false, true)).toBe(`doc.md ${DELETED_TAB_MARKER}`)
  })
})
