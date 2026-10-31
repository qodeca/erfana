// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Why HTML comment mode is unavailable for the page's file (spec 024 menu
 * matrix § 2, M-07; state table F-04): read-only, or full at 500 comments.
 */
import { describe, expect, it } from 'vitest'
import type { CommentFileView } from '../../../../../../shared/ipc/comment-common-schema'
import { MD_SURFACE_COPY } from '../../../Comments/commentCopyWords'
import { pageBlockReason } from './usePreviewModeBlock'

const page = (over: Partial<CommentFileView>): CommentFileView => ({
  fileKey: 'k'.repeat(43),
  displayPath: 'index.html',
  filePath: '/p/index.html',
  frame: false,
  writable: true,
  threads: [],
  damaged: [],
  newer: [],
  ...over
})

const FULL = 'index.html already has 500 comments, the most Erfana adds to one file. Delete resolved threads to add more.'

describe('pageBlockReason', () => {
  it('024-AC-035 M-07 F-04 a writable page at 500 comments blocks comment mode with the "500 comments" sentence', () => {
    expect(pageBlockReason([page({ addRefusal: 'too-many-blocks' })])).toBe(FULL)
    expect(MD_SURFACE_COPY.modeUnavailable(FULL)).toBe(`Comment mode is unavailable: ${FULL.replace(/\.$/, '')}.`)
  })

  it('024-AC-035 M-07 a writable page below the cap, or one not listed yet, does not block', () => {
    expect(pageBlockReason([page({})])).toBeNull()
    expect(pageBlockReason([])).toBeNull()
    // Only the page's own file decides, not a frame's.
    expect(pageBlockReason([page({}), page({ frame: true, addRefusal: 'too-many-blocks' })])).toBeNull()
  })

  it('024-AC-035 M-07 a read-only page blocks with its reason; the same sentence the menu shows', () => {
    expect(pageBlockReason([page({ writable: false, readOnlyReason: 'conflict-markers' })])).toBe(
      'index.html has unresolved git conflicts. Resolve them first.'
    )
    expect(pageBlockReason([page({ writable: false })])).toBe('index.html is read-only.')
  })
})
