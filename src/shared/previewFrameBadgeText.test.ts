// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the frame badge entry texts (issue #124, answer 9).
 *
 * Main writes these sentences into a failure entry and the badge shows them as
 * they are, so this pins the wording in the singular and the plural, and that
 * every sentence survives the failure schema main validates entries with
 * before they are sent.
 *
 * @see previewFrameBadgeText.ts
 */
import { describe, expect, it } from 'vitest'

import { ErrorCode } from './errors'
import { PreviewFailureSchema } from './ipc/preview-schema'
import { PREVIEW_LIMITS } from './preview-limits'
import { describeFramesOverLimit, SRCDOC_TOO_DEEP_ENTRY } from './previewFrameBadgeText'

describe('SRCDOC_TOO_DEEP_ENTRY', () => {
  it('says a srcdoc frame nested too deep is shown anyway', () => {
    expect(SRCDOC_TOO_DEEP_ENTRY).toBe(
      'srcdoc frame – shown anyway; the depth limit covers src frames only'
    )
  })
})

describe('describeFramesOverLimit', () => {
  it('uses the singular for one src frame over the limit', () => {
    expect(describeFramesOverLimit(1, 'src')).toBe('1 frame over the limit of 50 was left empty')
  })

  it('uses the plural for several src frames over the limit', () => {
    expect(describeFramesOverLimit(12, 'src')).toBe(
      '12 frames over the limit of 50 were left empty'
    )
  })

  it('says srcdoc frames over the limit are shown anyway, singular and plural', () => {
    expect(describeFramesOverLimit(1, 'srcdoc')).toBe(
      '1 srcdoc frame over the limit of 50 is shown anyway'
    )
    expect(describeFramesOverLimit(10, 'srcdoc')).toBe(
      '10 srcdoc frames over the limit of 50 are shown anyway'
    )
  })

  it("names the guard's own cap, so the text cannot drift from it", () => {
    expect(PREVIEW_LIMITS.MAX_FRAMES_PER_PAGE).toBe(50)
    expect(describeFramesOverLimit(2, 'src')).toContain(
      `limit of ${PREVIEW_LIMITS.MAX_FRAMES_PER_PAGE}`
    )
  })
})

describe('every text survives the failure schema', () => {
  it.each([
    ['frame-too-deep', SRCDOC_TOO_DEEP_ENTRY],
    ['frame-over-limit', describeFramesOverLimit(1, 'src')],
    ['frame-over-limit', describeFramesOverLimit(12, 'src')],
    ['frame-over-limit', describeFramesOverLimit(1, 'srcdoc')],
    ['frame-over-limit', describeFramesOverLimit(10, 'srcdoc')]
  ] as const)('%s: "%s"', (type, text) => {
    const entry = {
      id: '1',
      type,
      resourceUrlOrHost: text,
      reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED,
      timestamp: 1
    }
    expect(PreviewFailureSchema.safeParse(entry).success).toBe(true)
  })
})
