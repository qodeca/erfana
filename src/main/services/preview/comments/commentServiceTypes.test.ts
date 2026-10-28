// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where the comment IPC handlers find a panel's service
 * (docs/designs/html-preview-comments.md §8; SEC-07): by panel and window
 * together, so another window's request never reaches it.
 */
import { describe, expect, it } from 'vitest'
import { createPreviewCommentRegistry, type CommentServiceApi } from './commentServiceTypes'

const service = (panelId: string, windowId: number): CommentServiceApi =>
  ({ panelId, windowId }) as unknown as CommentServiceApi

describe('createPreviewCommentRegistry', () => {
  it('SEC-07 finds a service by its panel in its own window only', () => {
    const registry = createPreviewCommentRegistry()
    const a = service('preview-a', 1)
    registry.add(a)
    expect(registry.get('preview-a', 1)).toBe(a)
    expect(registry.get('preview-a', 2)).toBeUndefined()
    expect(registry.get('preview-b', 1)).toBeUndefined()
  })

  it('a replaced service\'s removal leaves its successor registered', () => {
    const registry = createPreviewCommentRegistry()
    const old = service('preview-a', 1)
    const removeOld = registry.add(old)
    const next = service('preview-a', 1)
    const removeNext = registry.add(next)
    removeOld()
    expect(registry.get('preview-a', 1)).toBe(next)
    expect(registry.all()).toEqual([next])
    removeNext()
    expect(registry.all()).toEqual([])
  })
})
