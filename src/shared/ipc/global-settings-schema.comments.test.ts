// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML Preview comments feature flag, `htmlPreview.comments.enabled`
 * (docs/designs/html-preview-comments.md §3 "Feature flag", §18): default on,
 * lenient, and read through `isHtmlPreviewCommentsEnabled`.
 */
import { describe, expect, it } from 'vitest'
import {
  GlobalSettingsSchema,
  getDefaultGlobalSettings,
  isHtmlPreviewCommentsEnabled
} from './global-settings-schema'

describe('htmlPreview.comments.enabled', () => {
  it('is on by default, without adding a block to settings that have none', () => {
    const defaults = getDefaultGlobalSettings()
    expect(isHtmlPreviewCommentsEnabled(defaults)).toBe(true)
    expect(GlobalSettingsSchema.parse({ htmlPreview: { enabled: true } }).htmlPreview).toEqual({
      enabled: true
    })
  })

  it('turns off only when set to false', () => {
    const off = GlobalSettingsSchema.parse({
      htmlPreview: { enabled: true, comments: { enabled: false } }
    })
    expect(off.htmlPreview.comments).toEqual({ enabled: false })
    expect(isHtmlPreviewCommentsEnabled(off)).toBe(false)
    const on = GlobalSettingsSchema.parse({ htmlPreview: { comments: { enabled: true } } })
    expect(isHtmlPreviewCommentsEnabled(on)).toBe(true)
  })

  it.each([['yes'], [null], [{ enabled: 'no' }], [7]])(
    'a malformed block (%j) resolves to on and never trips the settings reset',
    comments => {
      const parsed = GlobalSettingsSchema.safeParse({ htmlPreview: { enabled: false, comments } })
      expect(parsed.success).toBe(true)
      expect(parsed.data!.htmlPreview.enabled).toBe(false)
      expect(isHtmlPreviewCommentsEnabled(parsed.data!)).toBe(true)
    }
  )
})
