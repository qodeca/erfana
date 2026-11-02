// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `markdownPreview.comments.enabled` (spec 024 architecture note 001 § 4):
 * lenient, default on – a malformed block never trips the corruption reset.
 */
import { describe, expect, it } from 'vitest'
import {
  GlobalSettingsSchema,
  isAnyPreviewCommentsEnabled,
  isMarkdownPreviewCommentsEnabled
} from './global-settings-schema'

describe('markdownPreview.comments.enabled', () => {
  it('is on when absent', () => {
    const settings = GlobalSettingsSchema.parse({})
    expect(isMarkdownPreviewCommentsEnabled(settings)).toBe(true)
  })

  it('keeps an explicit off', () => {
    const settings = GlobalSettingsSchema.parse({ markdownPreview: { comments: { enabled: false } } })
    expect(isMarkdownPreviewCommentsEnabled(settings)).toBe(false)
  })

  it.each([
    ['a string block', 'yes'],
    ['a bad comments block', { comments: 7 }],
    ['a bad flag', { comments: { enabled: 'no' } }]
  ])('reads %s as on, and parses the rest of the file', (_name, markdownPreview) => {
    const parsed = GlobalSettingsSchema.safeParse({ markdownPreview, logging: { level: 'warn' } })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(isMarkdownPreviewCommentsEnabled(parsed.data)).toBe(true)
    expect(parsed.data.logging.level).toBe('warn')
  })

  it('either preview\'s comments on is "any on"; both off is not', () => {
    const off = { comments: { enabled: false } }
    expect(isAnyPreviewCommentsEnabled({})).toBe(true)
    expect(isAnyPreviewCommentsEnabled({ htmlPreview: { enabled: true, ...off } })).toBe(true)
    expect(isAnyPreviewCommentsEnabled({ htmlPreview: { enabled: true, ...off }, markdownPreview: off })).toBe(false)
  })
})
